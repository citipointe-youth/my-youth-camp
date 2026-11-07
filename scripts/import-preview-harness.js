/*
 * Import preview harness (camp arch round 2026-11-07, Gate A UX fixes). Runs the REAL
 * `_renderImportPreview`, `_warnGroupHtml` and `_importExtraLine` from public/index.html against stubs.
 *
 *   node scripts/import-preview-harness.js
 *
 * UX 1: a file the server refuses (e.g. a consent column missing) hides "Confirm & import" and says what to do.
 * UX 2: the "absent, KEPT, needs review" group opens by default so the names are seen.
 * UX 3: a Ticket preview whose orphans are all near-miss spellings does not say "import the Form first".
 * I2: the batch previews in one POST /import/batch; per-file errors stay on their file.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true; }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced extraction for ' + decl);
}

function sandbox(api, batch) {
  const box = { style: {}, innerHTML: '' };
  const ctx = {
    JSON, Map, String, Promise, api,
    document: { getElementById: (id) => (id === 'impResult' ? box : null) },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    icSm: () => '', zoneSel: () => '',
  };
  vm.createContext(ctx);
  for (const decl of ['const IMPORT_TYPES={', 'const IMPORT_WARN_LABELS={', 'const _WARN_SEV_ORDER={', 'const _WARN_SEV_COLOR={',
    'function _warnMeta(', 'function _warnGroupHtml(', 'function _importExtraLine(', 'async function _renderImportPreview(']) {
    vm.runInContext(extract(decl), ctx);
  }
  vm.runInContext(SRC.match(/^const WARN_ROW_CAP=.*$/m)[0] + SRC.match(/^const _WARN_OPEN_CODES=.*$/m)[0] + 'let _importBatch=' + JSON.stringify(batch) + ';', ctx);
  return { ctx, box };
}

(async () => {
  // UX 1: one file hard-stopped -> no Confirm button, a next step instead. Cancel stays.
  {
    const api = (p) => (p === '/settings' ? Promise.resolve({})
      : Promise.reject(new Error('Consent column missing from this file: "A". Import stopped.')));
    const { ctx, box } = sandbox(api, [{ type: 'form', name: 'form.csv', csvData: 'x' }]);
    await ctx._renderImportPreview();
    assert.ok(!box.innerHTML.includes('Confirm &amp; import'), 'hard stop: Confirm hidden');
    assert.ok(box.innerHTML.includes('Nothing was imported'), 'hard stop: next step shown');
    assert.ok(box.innerHTML.includes('_clearImport()'), 'hard stop: Cancel still there');
  }
  // A clean preview still offers Confirm.
  {
    const ok = { created: 1, updated: 0, skipped: 0, errors: [], warnings: [] };
    const api = (p) => Promise.resolve(p === '/settings' ? {} : { dryRun: true, results: [{ type: 'form', result: ok }] });
    const { ctx, box } = sandbox(api, [{ type: 'form', name: 'form.csv', csvData: 'x' }]);
    await ctx._renderImportPreview();
    assert.ok(box.innerHTML.includes('Confirm &amp; import'), 'clean: Confirm shown');
  }
  // I2: the whole batch previews in ONE POST /import/batch, files in order; a per-file error stays
  // on that file; Ticket/Invoice cards show their real counts (no "Matches finalise" suppression).
  {
    const calls = [];
    const t = { created: 0, updated: 2, skipped: 0, errors: [], warnings: [] };
    const api = (p, o) => {
      if (p === '/settings') return Promise.resolve({});
      calls.push({ p, body: o && o.body });
      return Promise.resolve({ dryRun: true, results: [{ type: 'form', error: 'Consent column missing' }, { type: 'tickets', result: t }] });
    };
    const { ctx, box } = sandbox(api, [{ type: 'form', name: 'form.csv', csvData: 'F' }, { type: 'tickets', name: 't.csv', csvData: 'T' }]);
    await ctx._renderImportPreview();
    assert.strictEqual(calls.length, 1, 'batch: one preview request');
    assert.strictEqual(calls[0].p, '/import/batch', 'batch: endpoint');
    assert.strictEqual(calls[0].body.files.map((f) => f.type + ':' + f.csvData).join(','), 'form:F,tickets:T', 'batch: files in order');
    assert.ok(box.innerHTML.includes('Consent column missing'), 'batch: per-file error shown');
    assert.ok(box.innerHTML.includes('2 to update'), 'batch: ticket counts shown');
    assert.ok(!box.innerHTML.includes('Matches finalise'), 'batch: no suppression line');
    assert.ok(!box.innerHTML.includes('Confirm &amp; import'), 'batch: a refused file still hides Confirm');
  }
  // UX 2: the needs-review "kept" group (and its block) render open, listing the names.
  {
    const { ctx } = sandbox(() => Promise.resolve({}), []);
    const html = ctx._warnGroupHtml({ warnings: [
      { code: 'absent-kept-needs-review', row: 0, message: 'Bobby Builder (Victory) is no longer in this file' },
      { code: 'unknown-grade', row: 3, message: 'grade x' },
    ] });
    const opens = (html.match(/<details[^>]*\bopen\b/g) || []).length;
    assert.strictEqual(opens, 2, 'needs-review: outer block and its group open');
    assert.ok(html.includes('Bobby Builder'), 'needs-review: name listed');
    const plain = ctx._warnGroupHtml({ warnings: [{ code: 'unknown-grade', row: 3, message: 'grade x' }] });
    assert.ok(!/<details[^>]*\bopen\b/.test(plain), 'review-only block stays collapsed');
  }
  // UX 3: all ticket orphans are near-miss spellings -> no "import the Form first" advice.
  {
    const { ctx } = sandbox(() => Promise.resolve({}), []);
    const near = ctx._importExtraLine('tickets', { created: 1, warnings: [{ code: 'ticket-possible-match' }] });
    assert.ok(!near.includes('Form'), 'possible match: no Form advice');
    const real = ctx._importExtraLine('tickets', { created: 2, warnings: [{ code: 'ticket-possible-match' }] });
    assert.ok(real.includes('Form'), 'plain orphan: Form advice kept');
  }
  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
