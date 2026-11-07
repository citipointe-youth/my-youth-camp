/*
 * Session/queue harness (camp arch round 2026-11-07, C15 queue gate). Drives the REAL transport
 * (_doFetch, api), the SESSION block (leave, listeners, enterShell), doLogin, the preview functions,
 * _tryRestoreSession, the check-in queue and the offline-boot block of public/index.html in a vm,
 * against a fake token-checking server that attributes every POST /checkin to a login.
 *
 *   node scripts/session-queue-harness.js
 *
 * The rule under test: a login's saved taps are only ever sent under that login.
 */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const SRC=fs.readFileSync(require('path').join(__dirname,'..','public','index.html'),'utf8');
function extract(sig){const i=SRC.indexOf(sig);if(i<0)throw new Error('missing '+sig);let d=0,s=false;for(let k=i;k<SRC.length;k++){if(SRC[k]==='{'){d++;s=true;}else if(SRC[k]==='}'){d--;if(s&&!d)return SRC.slice(i,k+1);}}}
function between(a,b){const i=SRC.indexOf(a),j=SRC.indexOf(b,i);if(i<0||j<0)throw new Error('markers '+a+' / '+b);return SRC.slice(i,j);}
const results=[];let failures=0;
async function T(name,fn){try{await fn();results.push('PASS '+name);}catch(e){failures++;results.push('FAIL '+name+'\n     '+(e&&e.message));}}
const flush=async(n=20)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};

function box(opt={}){
  const store={...(opt.store||{})},sess={};
  const users={admin:{id:'u1',username:'admin',role:'admin',firstName:'Ad',lastName:'Min'},
    alice:{id:'u2',username:'alice',role:'zoneLeader',firstName:'Al',lastName:'Ice'},
    bob:{id:'u3',username:'bob',role:'zoneLeader',firstName:'Bo',lastName:'B'},
    church1:{id:'u4',username:'church1',role:'church',firstName:'Grace',lastName:'Pt'}};
  // server state
  const srv={tokens:{},posts:[],mode:'ok',checkin:'ok',hold:null,mustChange:{},n:0,
    offline:false,log:[]};
  const issue=(u,preview)=>{const t='tok'+(++srv.n)+'_'+u;srv.tokens[t]={user:u,preview:!!preview};return t;};
  const elts={};
  const el=(id)=>elts[id]||(elts[id]={id,style:{},value:'',textContent:'',classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},contains(c){return this._s.has(c);}},prepend(){},remove(){},focus(){},innerHTML:''});
  const timers=new Map();let tid=0;
  const out={toasts:[],modals:[],reloads:0,gate:0};
  const W=new EventTarget();W._ciqRestored=false;
  const reply=(status,body,ct='application/json')=>({ok:status>=200&&status<300,status,headers:{get:()=>ct},json:async()=>{if(body===undefined)throw new Error('no body');return body;},blob:async()=>body});
  const fetch=async(path,init)=>{
    const auth=(init.headers.Authorization||'').replace('Bearer ','');
    const method=init.method||'GET';const body=init.body?JSON.parse(init.body):undefined;
    if(srv.offline)throw new TypeError('Failed to fetch');
    srv.log.push(method+' '+path+' '+(auth||'-'));
    if(path==='/auth/login'){const u=users[body.username];if(!u)return reply(401,{code:'UNAUTH',message:'Invalid credentials'});
      return reply(200,{token:issue(body.username),user:{...u,mustChangePassword:!!srv.mustChange[body.username]}});}
    const t=srv.tokens[auth];
    if(!t)return reply(401,{code:'UNAUTHORIZED',message:'Missing bearer token'});
    if(srv.mustChange[t.user]&&!['/accounts/me/password','/auth/me','/auth/logout'].includes(path))return reply(403,{code:'MUST_CHANGE_PASSWORD',message:'Change your password'});
    if(path==='/checkin'&&method==='POST'){
      if(srv.hold){const h=srv.hold;srv.hold=null;await h.p;}
      if(t.preview)return reply(403,{code:'FORBIDDEN',message:'preview read only'});
      const res=typeof srv.checkin==='function'?srv.checkin(body,t):srv.checkin;
      if(res==='503')return reply(503,{code:'INTERNAL',message:'Server error'});
      srv.posts.push({user:t.user,camperId:body.camperId,sessionId:body.sessionId,type:body.type,initials:body.initials});
      return reply(200,{ok:true});
    }
    if(path.endsWith('/preview')&&method==='POST')return reply(200,{token:issue('church1',true),user:users.church1});
    if(path==='/accounts/me/password'){delete srv.mustChange[t.user];return reply(200,{ok:true});}
    if(path==='/auth/logout'){delete srv.tokens[auth];return reply(204);}
    if(path==='/auth/me')return reply(200,{user:users[t.user]});
    if(path==='/settings')return reply(200,{campMode:opt.campMode||'at-camp'});
    if(path==='/checkin/sessions/current')return reply(200,{id:'s1'});
    return reply(200,{});
  };
  const c={console,Date,JSON,Set,Map,Promise,Math,Object,Array,String,Error,EventTarget,CustomEvent,
    fetch,AbortController,
    setTimeout:(f,ms)=>{if(ms<=200)return setTimeout(f,0);const id=++tid;timers.set(id,{f,ms});return {fake:id};},
    clearTimeout:(h)=>{if(h&&h.fake)timers.delete(h.fake);else clearTimeout(h);},
    setInterval:()=>0,clearInterval(){},
    navigator:{onLine:true},
    window:W,location:{reload:()=>{out.reloads++;},search:''},
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('x'+Math.random())},
    toast:m=>out.toasts.push(m),
  };
  vm.createContext(c);
  vm.runInContext(`const API_TIMEOUT_MS=20000,API_IMPORT_TIMEOUT_MS=90000;const _inflight=new Map();
const MUST_CHANGE_PASSWORD_ENFORCED=true;
let TOKEN=null,ACTOR=null,SETTINGS=null,CAMP_MODE='pre-camp',STACK=['home'],PREVIEW_MODE=false;
let ACCOUNT_PREVIEW=false,_previewStash=null,SESSIONS=[],SEL_SESSION=null;
let LAST_LEADER='',LEADER_INITIALS='',_rosterInUse=false,_previewLocalFlips={};
var __out=null;
const _npStart=()=>{},_npDone=()=>{},_invalidate=()=>{},_rosterClear=()=>{},closeModal=()=>{},_hideUndoToast=()=>{};
const updateModeUI=()=>{},buildTabs=()=>{},_prefetch=()=>{},_restoreFilters=()=>{},_renderWideNav=()=>{},_pushNavTo=()=>{};
const _consumePushNav=()=>null,_offerAlertsAfterLogin=()=>{};var _offerNoteDraft=()=>{},_ndKey=()=>'nd';
const _loadLeaderInitials=()=>{LEADER_INITIALS=ACTOR&&ACTOR.role!=='church'?'XX':'';};
const _isChurchAccount=()=>!!(ACTOR&&ACTOR.role==='church');
const modal=(h)=>{__out.modals.push(h.slice(0,40));};
async function gotoTab(id){STACK=[id];} async function _navTo(){} async function _rCheckin(){}
const icSm=()=>'',_rosterSynced=()=>{},_updatePreviewBanner=()=>{};
const Cache={get:()=>null,set(){},clear(){},del(){}};
`,c);
  vm.runInContext('__out=null',c);c.__outRef=out;vm.runInContext('__out=__outRef',c);
  vm.runInContext(extract('async function _doFetch('),c);
  vm.runInContext(extract('function _isAppAnswer('),c);
  vm.runInContext(between('async function api(','/* After login, warm'),c);
  vm.runInContext(between('function leave(reason){','/* ===== AUTH'),c);
  for(const f of ['async function doLogin(','function _showChangePasswordGate(','function _mcpErr(','async function submitChangePassword(','function enforceInitials(',
    'function enterPreview(','function _previewShell(','function exitPreview(','async function enterAccountPreview(','function exitAccountPreview(','function _togglePreviewMode(','async function _tryRestoreSession('])
    vm.runInContext(extract(f),c);
  vm.runInContext(between('const CHECKIN_QUEUE=[]','function _dismissFailedCheckins('),c);
  vm.runInContext(between('let _bootOffline=false;','/* ===== BOOT'),c);
  const r=(code)=>vm.runInContext(code,c);
  const login=async(u)=>{el('username').value=u;el('password').value='pw';await r('doLogin()');await flush();};
  const tap=(id,sid='s1')=>r(`_queueEntry(${JSON.stringify(id)},'in',${JSON.stringify(sid)})`);
  const q=()=>JSON.parse(r('JSON.stringify(CHECKIN_QUEUE.map(e=>e.camperId))'));
  const disk=(u)=>JSON.parse(store['ycp_ciq_'+u]||'[]').map(e=>e.camperId);
  const fireTimers=async()=>{const all=[...timers.entries()];timers.clear();for(const [,t] of all)t.f();await flush();};
  const hold=()=>{let res;const p=new Promise(x=>res=x);srv.hold={p};return ()=>res();};
  const expire=(u)=>{for(const k in srv.tokens)if(srv.tokens[k].user===u)delete srv.tokens[k];};
  const posts=()=>srv.posts.map(p=>p.user+':'+p.camperId);
  return {c,r,srv,store,out,el,login,tap,q,disk,fireTimers,hold,expire,posts,timers,
    get:(n)=>r(n)};
}

(async()=>{
// 1. offline tap -> session expiry -> re-login same user
await T('1a offline tap, expiry, same user re-login: drains once under alice',async()=>{
  const b=box();await b.login('alice');
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  assert.deepStrictEqual(b.q(),['k1']);assert.deepStrictEqual(b.disk('alice'),['k1']);
  b.srv.offline=false;b.c.navigator.onLine=true;b.expire('alice');
  await b.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  assert.strictEqual(b.get('TOKEN'),null);assert.deepStrictEqual(b.q(),[]);assert.deepStrictEqual(b.disk('alice'),['k1']);
  assert.strictEqual(b.el('loginErr').textContent,'Session expired — please sign in again.');
  b.c.window.dispatchEvent(new Event('online'));await b.fireTimers();
  assert.deepStrictEqual(b.posts(),[]);
  await b.login('alice');
  assert.deepStrictEqual(b.posts(),['alice:k1']);assert.deepStrictEqual(b.disk('alice'),[]);
  await b.fireTimers();assert.deepStrictEqual(b.posts(),['alice:k1']);
});
// 1b. different user
await T('1b offline tap, expiry, bob logs in: never sent under bob; alice later sends once',async()=>{
  const b=box();await b.login('alice');
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');b.tap('k2');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;b.expire('alice');
  await b.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  await b.login('bob');await b.fireTimers();
  b.c.window.dispatchEvent(new Event('online'));await flush();
  assert.deepStrictEqual(b.posts(),[]);assert.deepStrictEqual(b.disk('alice'),['k1','k2']);assert.deepStrictEqual(b.disk('bob'),[]);
  b.tap('b1');await flush();assert.deepStrictEqual(b.posts(),['bob:b1']);
  b.expire('bob');await b.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  await b.login('alice');assert.deepStrictEqual(b.posts(),['bob:b1','alice:k1','alice:k2']);
});
// 2. tap -> change password (gate at login)
await T('4 tap, logout, bob logs in: alice taps never sent under bob',async()=>{
  const b=box();await b.login('alice');
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;
  b.r("leave('logout')");await flush();assert.strictEqual(b.out.reloads,1);assert.deepStrictEqual(b.disk('alice'),[]);
  // simulate the reload: fresh page, same storage
  const b2=box({store:b.store});await b2.r('_tryRestoreSession()');await flush();
  await b2.login('bob');await b2.fireTimers();assert.deepStrictEqual(b2.posts(),[]);
  // and in the old page before the reload lands: nothing posts with a token
  b.c.window.dispatchEvent(new Event('online'));await b.fireTimers();
  assert.ok(!b.srv.log.some(l=>l.startsWith('POST /checkin')&&!l.endsWith(' -')),'no authed post after logout');
});
await T('8a 401 on the first of 3 drained taps: stops, nothing else posted, all 3 saved',async()=>{
  const b=box();await b.login('alice');b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');b.tap('k2');b.tap('k3');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;b.expire('alice');
  b.c.window.dispatchEvent(new Event('online'));await flush();
  assert.deepStrictEqual(b.posts(),[]);assert.deepStrictEqual(b.disk('alice'),['k1','k2','k3']);
  assert.strictEqual(b.srv.log.filter(l=>l.startsWith('POST /checkin')).length,1,'only one attempt');
  assert.strictEqual(b.get('_draining'),false);
});
await T('9b offline boot, token dead on recovery: login screen, tap saved, bob never sends it',async()=>{
  const b=box();await b.login('alice');b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  const b2=box({store:{...b.store}});b2.srv.offline=true;b2.c.navigator.onLine=false;
  await b2.r('_tryRestoreSession()');await flush();
  b2.srv.offline=false;b2.c.navigator.onLine=true;b2.c.window.dispatchEvent(new Event('online'));await flush();
  assert.strictEqual(b2.get('TOKEN'),null);assert.strictEqual(b2.el('login').style.display,'flex');assert.deepStrictEqual(b2.disk('alice'),['k1']);
  await b2.login('bob');await b2.fireTimers();assert.deepStrictEqual(b2.posts(),[]);
  b2.expire('bob');await b2.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  await b2.login('alice');assert.deepStrictEqual(b2.posts(),['alice:k1']);
});
// C15 queue gate minor: a throw inside enterShell after the restore loaded alice's taps lands in
// _tryRestoreSession's catch -> leave('refused'). It must drop alice's in-memory queue (still saved
// for her) so bob's login can never send her taps.
await T('9d throw inside enterShell after the queue step: leave(refused) parks alice taps; bob never sends them',async()=>{
  const b=box();await b.login('alice');b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  const b2=box({store:{...b.store}});Object.assign(b2.srv.tokens,b.srv.tokens);b2.srv.offline=true;b2.c.navigator.onLine=false;
  b2.r("_offerNoteDraft=()=>{throw new Error('boom')}");
  await b2.r('_tryRestoreSession()');await flush();b2.r("_offerNoteDraft=()=>{}");
  assert.strictEqual(b2.get('ACTOR'),null);assert.deepStrictEqual(b2.q(),[],'memory emptied');assert.strictEqual(b2.get('window._ciqRestored'),false);
  assert.deepStrictEqual(b2.disk('alice'),['k1'],'still saved for alice');
  b2.srv.offline=false;b2.c.navigator.onLine=true;
  await b2.login('bob');await flush();await b2.fireTimers();
  assert.deepStrictEqual(b2.posts(),[],'nothing under bob');assert.deepStrictEqual(b2.disk('bob'),[]);assert.deepStrictEqual(b2.disk('alice'),['k1']);
  b2.expire('bob');await b2.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  await b2.login('alice');assert.deepStrictEqual(b2.posts(),['alice:k1'],'sent once, under alice');
});
console.log(results.join('\n'));console.log(failures?failures+' FAILED':'all passed');process.exitCode=failures?1:0;
})();
