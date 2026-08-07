/* Harness for the day-1-only devotional guard (2026-08-07).
 * Runs the REAL extracted `_devoDay1Only` / `RENDER.devotional` / `selDevoDay` from
 * public/index.html against stubs. Never reimplements them.
 *
 * Extracts the block itself from public/index.html by its comment markers, so it cannot rot
 * against a moved line range (the ranges in CLAUDE.md have drifted repeatedly).
 *
 *   node scripts/devotional-preview-harness.js
 *
 * Proven to catch a regression: replace `_devoDay1Only`'s body with `return false` and 8 of the
 * 19 checks fail.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const START = '/* ===== DEVOTIONAL ===== */';
const END = '/* ===== FAQ (pre-camp Help aid) ===== */';
const a = html.indexOf(START), b = html.indexOf(END);
if (a === -1 || b === -1 || b < a) {
  console.error('Could not locate the devotional block markers in public/index.html');
  process.exit(1);
}
const src = html.slice(a, b);

const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
let fails = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { fails++; console.log('  FAIL: ' + label); }
  else console.log('  ok  : ' + label);
}

// Build a fresh sandbox per scenario so DEVO_DAY never leaks between cases.
function run({ role, preview, accountPreview, today, presetDay }) {
  const ctx = {
    ACTOR: role ? { role } : null,
    PREVIEW_MODE: !!preview,
    ACCOUNT_PREVIEW: !!accountPreview,
    SETTINGS: { checkInDays: DAYS },
    RENDER: {},
    painted: null,
    localDateISO: () => today,
    api: async () => ({ verse: 'v', reference: 'r', reflection: 'f', prayer: 'p' }),
    paint: (screen, body) => { ctx.painted = body; },
    esc: (s) => String(s),
    dayLong: (d) => d,
    toast: () => {},
  };
  const fn = new Function(
    'ACTOR', 'PREVIEW_MODE', 'ACCOUNT_PREVIEW', 'SETTINGS', 'RENDER',
    'localDateISO', 'api', 'paint', 'esc', 'dayLong', 'toast', 'ctx',
    src + '\n; if (ctx.presetDay) DEVO_DAY = ctx.presetDay;' +
    '\n return { render: RENDER.devotional, sel: selDevoDay, only: _devoDay1Only,' +
    ' getDay: () => DEVO_DAY };'
  );
  ctx.presetDay = presetDay;
  const api = fn(ctx.ACTOR, ctx.PREVIEW_MODE, ctx.ACCOUNT_PREVIEW, ctx.SETTINGS, ctx.RENDER,
    ctx.localDateISO, ctx.api, ctx.paint, ctx.esc, ctx.dayLong, ctx.toast, ctx);
  return { ctx, ...api };
}

// How many day buttons are locked (greyed), and which day is selected.
function inspect(body) {
  const buttons = body.match(/<button[^>]*>/g) || [];
  return {
    total: buttons.length,
    locked: buttons.filter(b => b.includes('opacity:.4')).length,
    selected: buttons.filter(b => /class="on"/.test(b)).length,
    previewMsg: /Only day 1 is available in preview/.test(body),
    todayMsg: /devotional is the current one/.test(body),
  };
}

(async () => {
  console.log('\n1. Church in at-camp PREVIEW, pre-camp (today is NOT a camp day)');
  {
    const h = run({ role: 'church', preview: true, today: '2026-08-08' });
    await h.render();
    const i = inspect(h.ctx.painted);
    ok(h.only() === true, 'predicate is true');
    ok(h.getDay() === DAYS[0], 'DEVO_DAY forced to day 1');
    ok(i.total === 4 && i.locked === 3, '3 of 4 day buttons locked (only day 1 open)');
    ok(i.selected === 1, 'exactly one day selected');
    ok(i.previewMsg && !i.todayMsg, 'preview lock message used, not the at-camp one');
  }

  console.log('\n2. Church preview with a STALE DEVO_DAY already on day 3');
  {
    const h = run({ role: 'church', preview: true, today: '2026-08-08', presetDay: DAYS[2] });
    await h.render();
    ok(h.getDay() === DAYS[0], 'stale day 3 forced back to day 1 on render');
    ok(inspect(h.ctx.painted).locked === 3, 'still 3 locked');
  }

  console.log('\n3. Church preview: selDevoDay refuses a non-day-1 jump');
  {
    const h = run({ role: 'church', preview: true, today: '2026-08-08' });
    await h.render();
    h.sel(DAYS[3]);
    ok(h.getDay() === DAYS[0], 'selDevoDay(day 4) ignored');
    h.sel(DAYS[0]);
    ok(h.getDay() === DAYS[0], 'selDevoDay(day 1) still allowed');
  }

  console.log('\n4. Admin previewing a CHURCH account (ACCOUNT_PREVIEW)');
  {
    const h = run({ role: 'church', accountPreview: true, today: '2026-08-08' });
    await h.render();
    ok(h.only() === true, 'predicate true for ACCOUNT_PREVIEW too');
    ok(inspect(h.ctx.painted).locked === 3, '3 locked');
  }

  console.log('\n5. NOT church (admin) in preview — guard must NOT apply');
  {
    const h = run({ role: 'admin', preview: true, today: '2026-08-08' });
    await h.render();
    const i = inspect(h.ctx.painted);
    ok(h.only() === false, 'predicate false for admin');
    ok(i.locked === 0, 'no days locked — admin keeps all four');
    h.sel(DAYS[3]);
    ok(h.getDay() === DAYS[3], 'admin can still select day 4');
  }

  console.log('\n6. Church NOT in preview, real at-camp on day 2 — existing rule intact');
  {
    const h = run({ role: 'church', today: DAYS[1] });
    await h.render();
    const i = inspect(h.ctx.painted);
    ok(h.only() === false, 'predicate false outside preview');
    ok(h.getDay() === DAYS[1], 'defaults to TODAY (day 2), not day 1');
    ok(i.locked === 3 && i.todayMsg && !i.previewMsg, 'isCampToday rule still locks the other 3');
  }

  console.log('\n7. Church NOT in preview, pre-camp — unchanged (all days open)');
  {
    const h = run({ role: 'church', today: '2026-08-08' });
    await h.render();
    ok(inspect(h.ctx.painted).locked === 0, 'no lock without preview (pre-existing behaviour)');
  }

  console.log('\n8. Edge: no camp days configured, church preview');
  {
    const h = run({ role: 'church', preview: true, today: '2026-08-08' });
    h.ctx.SETTINGS.checkInDays = [];
    await h.render();
    ok(/No camp days configured/.test(h.ctx.painted), 'falls back to the empty-state, no crash');
  }

  console.log(`\n${fails ? 'FAILED' : 'PASSED'} — ${checks - fails}/${checks} checks\n`);
  process.exit(fails ? 1 : 0);
})();
