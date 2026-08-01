/* Old vs new `_vpKick` under the SAME conditions — proves the harness can actually DETECT the
   2026-08-01 jitter bug, rather than just passing against the fixed code.

   USAGE — extract both versions next to this script, then run:
     git show <pre-fix-commit>:public/index.html > /tmp/old-index.html
     # old: _VP_MAX_SHORT..._vpShortfall, then _VP_KICK_COOLDOWN...end of _vpKick, plus shims
     # for the symbols the old version did not have:
     { sed -n '1873,1894p' /tmp/old-index.html; sed -n '1930,1953p' /tmp/old-index.html;
       echo 'function _vpKickSoon(ms){setTimeout(_vpKick,ms);}';   # old had no coalescing
       echo 'function _vpKickReset(){}';
       echo 'var _VP_KICK_SETTLE=0,_VP_KICK_MAX=999,_vpTries=0;';  # no echo guard, no cap
     } > /tmp/vpkick-old.js
     # new: see the ranges in vpkick-harness.js
     node scripts/vpkick-compare.js /tmp/vpkick-old.js /tmp/vpkick-real.js

   Result on a device modelled as NEVER accepting the kick (the honest worst case):
     OLD  20 kicks in 12s, ~608ms apart, and it never stops (there was no retry cap)
     NEW   5 kicks, ~944ms apart, then it stops
   The old spacing is floored by its own 600ms cooldown, so this model does not reproduce the
   owner's literal "10 times a second" — what it does prove is the SUSTAINED, UNBOUNDED
   re-entry that the visible jitter came from. */
const fs = require('fs');

function run(srcPath, { echoGuard, volley }) {
  const src = fs.readFileSync(srcPath, 'utf8');
  const T0 = 1_700_000_000_000;
  let now = T0, timers = [], rafs = [];
  const setTimeout_ = (fn, ms) => { const id = {}; timers.push({ at: now + (ms || 0), fn, id }); return id; };
  const clearTimeout_ = (id) => { timers = timers.filter((t) => t.id !== id); };
  const requestAnimationFrame_ = (fn) => { rafs.push(fn); };

  const kicks = [];
  let shortfall = 60, resizeHandler = null, inKick = false;
  const de = { style: { minHeight: '' }, get offsetHeight() { return 1; } };
  Object.defineProperty(de.style, 'minHeight', {
    get() { return this._v || ''; },
    set(v) {
      this._v = v;
      if (v && !inKick) {
        inKick = true; kicks.push(now);
        // A real iOS chrome animation emits a STREAM of visualViewport resize events, not one.
        // This is the honest model of the reported symptom: each kick starts an animation that
        // fires ~10 resizes over ~600ms, and every one of them is a potential re-entry point.
        for (let i = 1; i <= 10; i++) {
          setTimeout_(() => {
            if (kicks.length >= 999) shortfall = 0;  // iOS NEVER accepts: does the kicking ever stop?
            if (resizeHandler) resizeHandler();
          }, i * 60);
        }
      }
      if (!v) inKick = false;
    },
  });
  const windowStub = { screen: { height: 874 }, matchMedia: () => ({ matches: true }),
    navigator: { standalone: true }, scrollY: 0 };
  Object.defineProperty(windowStub, 'innerHeight', { get() { return 874 - shortfall; } });

  const sandbox = {
    window: windowStub,
    document: { documentElement: de, scrollingElement: { scrollTop: 0 }, activeElement: { tagName: 'DIV' } },
    navigator: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true },
    setTimeout: setTimeout_, clearTimeout: clearTimeout_,
    requestAnimationFrame: requestAnimationFrame_, Date: { now: () => now }, console,
  };
  const api = new Function(...Object.keys(sandbox), src +
    ';return {kick:_vpKick, soon:_vpKickSoon, kickAt:function(){return _vpKickAt;}, SETTLE:_VP_KICK_SETTLE};'
  )(...Object.values(sandbox));

  resizeHandler = () => {
    if (echoGuard && now - api.kickAt() < api.SETTLE) return;
    api.soon(120);
  };

  volley.forEach((ms) => api.soon(ms));
  while (now <= T0 + 12000) {
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.fn());
    const p = rafs; rafs = []; p.forEach((f) => f());
    now += 16;
  }
  const worst = kicks.reduce((m, t) => Math.max(m, kicks.filter((u) => u >= t && u < t + 1000).length), 0);
  return { n: kicks.length, worst, at: kicks.map((t) => t - T0) };
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error('usage: node scripts/vpkick-compare.js <extracted-old.js> <extracted-new.js>');
  process.exit(2);
}
// Old: uncoalesced volley of four timers, no echo guard — exactly as shipped 2026-07-31.
const old = run(oldPath, { echoGuard: false, volley: [120, 400, 900, 1600] });
// New: one seeded attempt; the retry chain schedules itself.
const neu = run(newPath, { echoGuard: true, volley: [120] });

console.log('OLD (as shipped):', JSON.stringify(old));
console.log('NEW (fixed)     :', JSON.stringify(neu));
console.log();
const detects = neu.n < old.n && neu.n <= 5;
console.log(detects
  ? `PASS  old kicks ${old.n}x and never stops; new stops after ${neu.n} (capped)`
  : `FAIL  cannot tell them apart (old ${old.n}, new ${neu.n})`);
process.exit(detects ? 0 : 1);
