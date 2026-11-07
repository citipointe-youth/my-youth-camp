/*
 * Camp arch round 2026-11-07 regression harness (SPA side). Drives the REAL transport (_doFetch,
 * api), the SESSION block (leave, enterShell), doLogin, submitChangePassword, the preview functions,
 * _tryRestoreSession and the check-in queue of public/index.html in a vm against a fake
 * token-checking server (box() as in session-queue-harness.js). Cases promoted from the round's
 * scratch verify (c15q/queue-vm.js) plus gaps the existing harnesses did not pin. Every case name
 * carries its round id.
 *
 *   node scripts/round-2026-11-07-harness.js
 *
 * Already covered elsewhere (not repeated here): sw-harness.js (B-12a/b/c), preview-queue-harness.js
 * (B-14), session-teardown-harness.js (A-5, B-11, S1 order, logout), session-queue-harness.js (C15
 * queue), qa-batch2-harness.js (B-10, B-13, B-17 drain, P4 clock, S3 events), filter-persist-harness.js (S4).
 * A case run with K() is a KNOWN-FAIL documenting a FINDING; it does not fail the exit code.
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

const KNOWN=[];
async function K(name,fn){try{await fn();results.push('PASS(unexpected) '+name);}catch(e){KNOWN.push(name);results.push('KNOWN-FAIL '+name+'\n     '+(e&&e.message));}}
const saved=(id)=>JSON.stringify([{camperId:id,type:'in',sessionId:'s1',initials:'AI',at:Date.now()}]);
const changePw=async(b)=>{b.el('mcp-cur').value='pw';b.el('mcp-new').value='newpass';b.el('mcp-new2').value='newpass';await b.r('submitChangePassword()');await flush();};
const expireNow=async(b,u)=>{b.expire(u);await b.r("api('/home',{noCache:true}).catch(()=>{})");await flush();};

(async()=>{
// IA-OQ-13: the camp-wide settings row goes with the session; the saved queue does not.
await T('[IA-OQ-13] expiry removes ycp_settings, ycp_ciq_<login> untouched',async()=>{
  const b=box();await b.login('alice');
  assert.ok(b.store.ycp_settings,'setup: login cached the settings row');
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;await expireNow(b,'alice');
  assert.strictEqual(b.get('TOKEN'),null,'session ended');
  assert.strictEqual(b.store.ycp_settings,undefined,'settings row removed on expiry');
  assert.deepStrictEqual(b.disk('alice'),['k1'],'saved queue untouched');
});
// Q9 (ruled NO): the server stamps the time. A drained tap sends no client timestamp.
await T('[Q9] a drained saved tap posts only camperId/sessionId/type/initials (no client time)',async()=>{
  const b=box();await b.login('alice');const bodies=[];b.srv.checkin=(body)=>{bodies.push(body);return 'ok';};
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  assert.ok(JSON.parse(b.store.ycp_ciq_alice)[0].at>0,'setup: the saved tap has a local time (for the 48 h purge)');
  b.srv.offline=false;b.c.navigator.onLine=true;b.c.window.dispatchEvent(new Event('online'));await flush();
  assert.strictEqual(bodies.length,1,'sent once');
  assert.deepStrictEqual(Object.keys(bodies[0]).sort(),['camperId','initials','sessionId','type']);
});
// IA-OQ-11 / S1: change of password loads and drains the saved queue and offers the note draft.
await T('[C15][IA-OQ-11] saved taps, login with mustChange: nothing sent at gate; after change sent once, note draft offered',async()=>{
  const b=box({store:{ycp_ciq_alice:saved('k1')}});let drafts=0;b.c.__draft=()=>{drafts++;};b.r('_offerNoteDraft=()=>__draft()');
  b.srv.mustChange.alice=true;await b.login('alice');
  assert.strictEqual(b.el('mcpGate').style.display,'flex','gate up');assert.deepStrictEqual(b.posts(),[]);
  const before=drafts;await changePw(b);
  assert.deepStrictEqual(b.posts(),['alice:k1']);assert.deepStrictEqual(b.disk('alice'),[]);
  assert.strictEqual(drafts,before+1,'note draft offered after the change');
  await b.r('submitChangePassword()').catch(()=>{});await flush();
  assert.deepStrictEqual(b.posts(),['alice:k1'],'no re-send');
});
await T('[C15][IA-OQ-11] mid-session gate (403 MUST_CHANGE on a read), tap queued offline, then change: no dup, no loss',async()=>{
  const b=box();await b.login('alice');
  b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;b.srv.mustChange.alice=true;
  await b.r("api('/home',{noCache:true}).catch(()=>{})");await flush();
  assert.strictEqual(b.el('mcpGate').style.display,'flex');assert.deepStrictEqual(b.q(),['k1']);
  await changePw(b);
  assert.deepStrictEqual(b.posts(),['alice:k1']);assert.deepStrictEqual(b.q(),[]);
});
// B-17 across the session boundary (the drain rules themselves are in qa-batch2-harness).
await T('[B-17] online tap 503: kept with tries, expiry clears the retry, same-user login sends once',async()=>{
  const b=box();await b.login('alice');b.srv.checkin='503';b.tap('k1');await flush();
  assert.deepStrictEqual(b.q(),['k1']);assert.strictEqual(JSON.parse(b.store.ycp_ciq_alice)[0].tries,1);
  assert.strictEqual(b.get('_checkinFailed'),0,'no red banner');
  await expireNow(b,'alice');
  assert.strictEqual(b.timers.size,0,'retry timer cleared by leave');
  b.srv.checkin='ok';await b.login('alice');assert.deepStrictEqual(b.posts(),['alice:k1']);
  await b.fireTimers();assert.deepStrictEqual(b.posts(),['alice:k1']);
});
await T('[B-17] online tap 503, expiry, bob logs in, timers fire: never sent under bob',async()=>{
  const b=box();await b.login('alice');b.srv.checkin='503';b.tap('k1');await flush();
  await expireNow(b,'alice');
  b.srv.checkin='ok';await b.login('bob');await b.fireTimers();b.c.window.dispatchEvent(new Event('online'));await flush();
  assert.deepStrictEqual(b.posts(),[]);assert.strictEqual(JSON.parse(b.store.ycp_ciq_alice)[0].tries,1);
});
await T('[B-17][C15] 503 during the change-password drain: kept, retried after the gate cleared',async()=>{
  const b=box({store:{ycp_ciq_alice:saved('k1')}});
  b.srv.mustChange.alice=true;await b.login('alice');b.srv.checkin='503';
  await changePw(b);assert.deepStrictEqual(b.q(),['k1']);assert.deepStrictEqual(b.posts(),[]);
  b.srv.checkin='ok';await b.fireTimers();assert.deepStrictEqual(b.posts(),['alice:k1']);
});
// A-5 / B-14 across a reload mid account preview.
await T('[A-5][B-14] reload mid church account-preview: no queue load/drain, no initials sheet; exit drains admin once',async()=>{
  const b=box();await b.login('admin');b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;
  await b.r("enterAccountPreview('u4')");await flush();
  const b2=box({store:{...b.store,ycp_ciq_church1:JSON.stringify([{camperId:'c9',type:'in',sessionId:'s1',initials:'GP',at:Date.now()}])}});
  Object.assign(b2.srv.tokens,b.srv.tokens);
  await b2.r('_tryRestoreSession()');await flush();
  assert.strictEqual(b2.get('ACCOUNT_PREVIEW'),true,'preview resumed');assert.strictEqual(b2.out.modals.length,0,'no initials sheet');
  assert.deepStrictEqual(b2.q(),[]);
  await b2.fireTimers();b2.c.window.dispatchEvent(new Event('online'));await flush();assert.deepStrictEqual(b2.posts(),[]);
  b2.r('exitAccountPreview()');await flush();
  assert.deepStrictEqual(b2.posts(),['admin:k1']);assert.deepStrictEqual(b2.disk('church1'),['c9'],'church key untouched');
});
await T('[A-5] reload mid church preview, every token dead: login screen, stash gone, admin taps kept for admin',async()=>{
  const b=box();await b.login('admin');b.srv.offline=true;b.c.navigator.onLine=false;b.tap('k1');await flush();
  b.srv.offline=false;b.c.navigator.onLine=true;await b.r("enterAccountPreview('u4')");await flush();
  const b2=box({store:{...b.store}});
  await b2.r('_tryRestoreSession()');await flush();
  assert.strictEqual(b2.get('ACCOUNT_PREVIEW'),false);assert.strictEqual(b2.store.ycp_preview_stash,undefined,'stash gone');
  assert.deepStrictEqual(b2.disk('admin'),['k1']);
  await b2.login('church1');assert.deepStrictEqual(b2.posts(),[]);
  await expireNow(b2,'church1');
  await b2.login('admin');assert.deepStrictEqual(b2.posts(),['admin:k1']);
});
// B-11 end to end: the next login's forms start blank.
await T('[B-11] expiry then another login: LAST_LEADER is blank',async()=>{
  const b=box();await b.login('alice');b.r("LAST_LEADER='Sarah'");
  await expireNow(b,'alice');
  await b.login('bob');assert.strictEqual(b.get('LAST_LEADER'),'');
});
console.log(results.join('\n'));
console.log(failures?failures+' FAILED':'all passed'+(KNOWN.length?' ('+KNOWN.length+' KNOWN-FAIL)':''));
process.exitCode=failures?1:0;
})();
