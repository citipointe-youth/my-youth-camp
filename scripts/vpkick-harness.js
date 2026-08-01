/* Runs the REAL extracted `_vpKick` scheduling functions from public/index.html against stubbed
   globals and a fake clock. Proves the 2026-08-01 jitter fix: coalescing, echo suppression,
   bounded retries. No device and no browser needed — this is pure scheduling logic, which IS
   verifiable here even though the CSS half of the viewport bug is not.

   USAGE — extract the two ranges, then run. The ranges DRIFT; re-derive them, don't trust these:
     cd <repo>
     { sed -n '1890,1911p' public/index.html;      # _VP_MAX_SHORT .. _vpShortfall
       sed -n '1966,2016p' public/index.html;      # _VP_KICK_* consts .. end of _vpKick
     } > /tmp/vpkick-real.js
     node scripts/vpkick-harness.js /tmp/vpkick-real.js
   Derive them with:
     grep -n '^var _VP_MAX_SHORT\|^function _vpShortfall\|^var _VP_KICK_COOLDOWN\|^function _vpKick(' public/index.html

   ⚠️ TWO STUB TRAPS, both of which produce a silent "0 kicks" that looks like a code failure:
     1. `_vpIsIOS` reads a BARE `navigator`, not `window.navigator`. Without it the function
        throws, returns false, and every kick early-returns.
     2. `_vpKickAt` initialises to 0, so a fake clock starting at 0 makes the first cooldown
        check (`now - _vpKickAt < COOLDOWN`) block every kick. Start at a real epoch value.
   ⚠️ Model the iOS chrome animation as a STREAM of resize events (see vpkick-compare.js), not a
   single echo — the single-echo model hides the retry-chain bug this harness was written to find. */
const fs = require('fs');
const path = process.argv[2];
const src = fs.readFileSync(path, 'utf8');

function run(name, opts) {
  // ---- fake clock -------------------------------------------------------
  // Must start at a REAL epoch value: `_vpKickAt` initialises to 0, so a clock starting at 0
  // makes the very first cooldown check (`now - _vpKickAt < COOLDOWN`) block every kick. That
  // is an artifact of the fake clock, not of the code.
  const T0 = 1_700_000_000_000;
  let now = T0;
  let timers = [];       // {at, fn}
  let rafs = [];         // fn
  const setTimeout_ = (fn, ms) => { const id = {}; timers.push({ at: now + (ms || 0), fn, id }); return id; };
  const clearTimeout_ = (id) => { timers = timers.filter((t) => t.id !== id); };
  const requestAnimationFrame_ = (fn) => { rafs.push(fn); };

  // ---- stubbed environment ---------------------------------------------
  const kicks = [];      // timestamps of real kicks (minHeight actually set)
  let shortfall = 60;    // iOS is short by 60px until something fixes it
  let resizeHandler = null;

  const de = {
    style: { minHeight: '' },
    get offsetHeight() { return 1; },
  };
  const scrollingElement = { scrollTop: 0 };
  const documentStub = {
    documentElement: de,
    scrollingElement,
    activeElement: opts.focusedInput ? { tagName: 'INPUT' } : { tagName: 'DIV' },
  };
  const windowStub = {
    innerHeight: 874 - shortfall,
    screen: { height: 874 },
    navigator: { standalone: true, userAgent: 'iPhone' },
    matchMedia: () => ({ matches: true }),
    scrollY: 0,
  };
  Object.defineProperty(windowStub, 'innerHeight', {
    get() { return 874 - shortfall; },
  });

  // Setting minHeight is the observable "a kick really happened".
  let inKick = false;
  Object.defineProperty(de.style, 'minHeight', {
    get() { return this._v || ''; },
    set(v) {
      this._v = v;
      if (v && !inKick) {
        inKick = true;
        kicks.push(now);
        // Simulate iOS: a kick fires a visualViewport resize a little later, and (if the
        // device is cooperative) actually grows the view.
        setTimeout_(() => {
          if (opts.iosCooperates) shortfall = 0;
          if (resizeHandler) resizeHandler();
        }, opts.resizeEchoDelay);
      }
      if (!v) inKick = false;
    },
  });

  const sandbox = {
    window: windowStub,
    document: documentStub,
    // `_vpIsIOS` reads a BARE `navigator`, not `window.navigator` — without this it throws,
    // returns false, and every kick silently early-returns (the first run of this harness).
    navigator: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true },
    setTimeout: setTimeout_,
    clearTimeout: clearTimeout_,
    requestAnimationFrame: requestAnimationFrame_,
    Date: { now: () => now },
    console,
  };

  const fn = new Function(...Object.keys(sandbox), src + `
    ;return {kick:_vpKick, soon:_vpKickSoon, reset:_vpKickReset,
             tries:function(){return _vpTries;}, kicks:function(){return _vpKicks;},
             kickAt:function(){return _vpKickAt;},
             SETTLE:_VP_KICK_SETTLE, MAX:_VP_KICK_MAX};
  `);
  const api = fn(...Object.values(sandbox));

  // The real resize listener body, mirrored from index.html (echo guard + coalesced schedule).
  resizeHandler = () => {
    if (sandbox.Date.now() - api.kickAt() < api.SETTLE) return;   // our own echo
    api.soon(120);
  };

  // ---- drive the clock --------------------------------------------------
  opts.seed(api);
  const END = T0 + 12000;
  while (now <= END) {
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.fn());
    const pending = rafs; rafs = [];
    pending.forEach((f) => f());
    now += 16;
  }

  const gaps = kicks.slice(1).map((t, i) => t - kicks[i]);
  const minGap = gaps.length ? Math.min(...gaps) : Infinity;
  const worstPerSecond = kicks.reduce((m, t) =>
    Math.max(m, kicks.filter((u) => u >= t && u < t + 1000).length), 0);

  console.log(`\n${name}`);
  console.log(`  kicks: ${kicks.length}  at ${JSON.stringify(kicks.map(t=>t-T0))}`);
  console.log(`  min gap between kicks: ${minGap === Infinity ? 'n/a' : minGap + 'ms'}`);
  console.log(`  worst kicks-in-any-1s window: ${worstPerSecond}`);
  return { kicks: kicks.length, minGap, worstPerSecond, tries: api.tries() };
}

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fail++; };

// 1. iOS cooperates (the normal case): one kick, done.
let r = run('iOS accepts the kick (normal launch)', {
  iosCooperates: true, resizeEchoDelay: 200,
  seed: (api) => { api.soon(120); },
});
check('exactly one kick', r.kicks === 1);
check('no oscillation', r.worstPerSecond <= 1);

// 2. iOS IGNORES the kick — the jitter scenario. Must stay bounded and slow.
r = run('iOS ignores the kick (worst case — this is what jittered)', {
  iosCooperates: false, resizeEchoDelay: 200,
  seed: (api) => { api.soon(120); },
});
check('retries capped at _VP_KICK_MAX', r.kicks <= 5);
check('never more than 2 kicks in any 1s window', r.worstPerSecond <= 2);
check('kicks spaced >= 900ms cooldown', r.minGap >= 900);

// 3. A burst of triggers must coalesce into one kick.
r = run('burst of 5 triggers in 200ms (coalescing)', {
  iosCooperates: true, resizeEchoDelay: 200,
  // Five triggers land in quick succession (launch + load + pageshow + a resize or two).
  // Each _vpKickSoon replaces the pending timer, so this must collapse to ONE kick.
  seed: (api) => { [0, 40, 80, 120, 160].forEach((d) => { api.soon(d); }); },
});
check('burst collapses to a single kick', r.kicks === 1);

// 4. Fast resize echo (the exact feedback loop) must not re-enter.
r = run('resize echo arrives 60ms after our own kick (feedback loop)', {
  iosCooperates: false, resizeEchoDelay: 60,
  seed: (api) => { api.soon(120); },
});
check('echo suppressed — still bounded', r.kicks <= 5);
check('no rapid oscillation from the echo', r.worstPerSecond <= 2);

// 5. Focused input is never kicked out from under.
r = run('input focused (must not kick)', {
  iosCooperates: false, resizeEchoDelay: 200, focusedInput: true,
  seed: (api) => { api.soon(120); },
});
check('no kick while an input has focus', r.kicks === 0);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
