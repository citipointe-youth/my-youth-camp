/* Runs the REAL extracted `_vpKick` scheduling functions from public/index.html against stubbed
   globals and a fake clock. Proves the 2026-08-01 jitter fix: coalescing, echo suppression,
   bounded retries. No device and no browser needed — this is pure scheduling logic, which IS
   verifiable here even though the CSS half of the viewport bug is not.

   USAGE — extract the two ranges, then run. The ranges DRIFT; re-derive them, don't trust these:
     cd <repo>
     { sed -n '1890,1911p' public/index.html;      # _VP_MAX_SHORT .. _vpShortfall
       sed -n '1991,2060p' public/index.html;      # _VP_KICK_* consts .. end of _vpKick
     } > /tmp/vpkick-real.js
     node scripts/vpkick-harness.js /tmp/vpkick-real.js
   Derive them with (the second range ENDS at the `}` before `requestAnimationFrame(_vpKick)`):
     grep -n '^var _VP_MAX_SHORT\|^function _vpShortfall\|^var _VP_KICK_COOLDOWN\|^function _vpKick(\|^requestAnimationFrame(_vpKick)' public/index.html

   To prove scenario 6 can still FAIL (i.e. that it tests the latch rather than passing by
   accident), neuter the latch in a copy and re-run — it should fail 3 of its 4 checks:
     sed 's/^function _vpApplyLatch(){$/function _vpApplyLatch(){if(1)return;/' \
       /tmp/vpkick-real.js > /tmp/vpkick-nolatch.js
     node scripts/vpkick-harness.js /tmp/vpkick-nolatch.js

   ⚠️ TWO STUB TRAPS, both of which produce a silent "0 kicks" that looks like a code failure:
     1. `_vpIsIOS` reads a BARE `navigator`, not `window.navigator`. Without it the function
        throws, returns false, and every kick early-returns.
     2. `_vpKickAt` initialises to 0, so a fake clock starting at 0 makes the first cooldown
        check (`now - _vpKickAt < COOLDOWN`) block every kick. Start at a real epoch value.
     3. The kick's observable here is the 1px SCROLL, not the min-height write. Since 2026-08-02
        the latch writes min-height permanently, so counting height writes counts the latch too.
   ⚠️ Model the iOS chrome animation as a STREAM of resize events (see vpkick-compare.js), not a
   single echo — the single-echo model hides the retry-chain bug this harness was written to find.
   ⚠️ And model iOS COLLAPSING the view back on a non-scrollable document (`collapsesOnShortDoc`,
   scenario 6) — without that, the Home bug is invisible and the latch looks like dead code. */
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
  // The observable "a kick really happened" is the 1px SCROLL, not the min-height write.
  // (Changed 2026-08-02: the latch also writes min-height, permanently, so min-height stopped
  // being a clean per-kick signal. The scroll is the actual mechanism anyway — the height change
  // only exists to make the scroll possible — so this is the more honest probe.)
  const scrollingElement = {
    _t: 0,
    get scrollTop() { return this._t; },
    set scrollTop(v) {
      const up = v > this._t;
      this._t = v;
      if (up) {
        kicks.push(now);
        // Simulate iOS: a kick fires a visualViewport resize a little later, and (if the
        // device is cooperative) actually grows the view.
        setTimeout_(() => {
          if (opts.iosCooperates) shortfall = 0;
          if (resizeHandler) resizeHandler();
        }, opts.resizeEchoDelay);
        // ...and then, on a short screen, iOS COLLAPSES the view again the moment the document
        // stops being scrollable. This is the 2026-08-02 Home bug. The latch defeats it by
        // keeping min-height above the true screen height, so model exactly that.
        if (opts.collapsesOnShortDoc) {
          setTimeout_(() => {
            const floor = parseInt(de.style.minHeight, 10) || 0;
            if (floor <= 874) { shortfall = 60; if (resizeHandler) resizeHandler(); }
          }, opts.resizeEchoDelay + 120);
        }
      }
    },
  };
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
             kickAt:function(){return _vpKickAt;}, latch:function(){return _vpLatchValue();},
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
  console.log(`  latch: ${api.latch() || 'off'}   final shortfall: ${shortfall}`);
  return { kicks: kicks.length, minGap, worstPerSecond, tries: api.tries(), latch: api.latch(),
           shortfall };
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

// 6. THE 2026-08-02 BUG: returning to Home. iOS accepts the kick, then collapses the view back
//    the moment the document stops being scrollable — which on Home is immediately. Without the
//    latch this is an unbounded accept/collapse loop that only stops when the try budget runs
//    out; with it, one kick holds.
r = run('return to Home — iOS collapses the view back (latch)', {
  iosCooperates: true, resizeEchoDelay: 200, collapsesOnShortDoc: true,
  seed: (api) => { api.soon(120); },
});
check('one kick holds — no accept/collapse loop', r.kicks === 1);
check('latch armed above screen.height', r.latch === '875px');
check('shortfall stayed resolved', r.shortfall === 0);
check('did not exhaust the retry budget', r.tries < 3);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
