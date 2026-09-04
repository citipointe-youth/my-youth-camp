import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORT_WARNING_META } from '../core/types/import-warning';
import type { ImportWarningCode } from '../core/types/import-warning';

// ---------------------------------------------------------------------------
// import-warning-codes.test.ts — guards the warning `code` CONTRACT.
//
// The codes are consumed OUTSIDE this repo: the upload machine's polling script
// posts the three import CSVs to the API and groups its emailed summary by
// `warning.code`. That client cannot be typechecked from here, so the two ways
// it silently breaks are guarded by source inspection:
//
//   1. A new warnings.push() added without a `code` — the script's grouping
//      drops it into an "unknown" bucket and the category count goes wrong.
//   2. A code emitted by a service that has no entry in IMPORT_WARNING_META —
//      the SPA renders a prettified fallback label instead of a real one.
//
// A rename is deliberately NOT guarded (a test can't know intent); the comment
// in import-warning.ts carries that rule for humans.
// ---------------------------------------------------------------------------

const SERVICES = ['import.service.ts', 'ticket-import.service.ts', 'invoice-import.service.ts'];

function sourceOf(file: string): string {
  return readFileSync(join(__dirname, file), 'utf-8');
}

describe('import warning codes — the out-of-repo API contract', () => {
  it('every warnings.push() in all three importers supplies a code', () => {
    const offenders: string[] = [];
    for (const file of SERVICES) {
      const src = sourceOf(file);
      // Each push is an object literal; walk from the call to its closing brace
      // and require a `code:` key inside. Cheap and exact enough for a literal.
      const re = /warnings\.push\(\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const start = m.index;
        let depth = 0;
        let end = start;
        for (let i = start + 'warnings.push('.length; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        const literal = src.slice(start, end + 1);
        if (!/\bcode:/.test(literal)) {
          const line = src.slice(0, start).split('\n').length;
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders, `warnings.push() without a code at: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every code string emitted by a service is declared in IMPORT_WARNING_META', () => {
    const declared = new Set(Object.keys(IMPORT_WARNING_META));
    const emitted = new Set<string>();
    for (const file of SERVICES) {
      const src = sourceOf(file);
      for (const m of src.matchAll(/\bcode:\s*'([a-z0-9-]+)'/g)) emitted.add(m[1]!);
      // The invoice split assigns its code through a typed local first. Strip the
      // `=== '...'` comparison operands out of that expression before scraping, or
      // the split METHOD names ('ticket-price', 'residual') get read as codes.
      for (const m of src.matchAll(/ImportWarningCode\s*=[\s\S]{0,400}?;/g)) {
        const branches = m[0].replace(/===\s*'[a-z0-9-]+'/g, '');
        for (const c of branches.matchAll(/'([a-z0-9-]+)'/g)) emitted.add(c[1]!);
      }
    }
    const undeclared = [...emitted].filter((c) => !declared.has(c));
    expect(undeclared, `codes with no IMPORT_WARNING_META entry: ${undeclared.join(', ')}`).toEqual(
      [],
    );
    // Sanity: the scrape found a realistic number, so a regex that silently
    // matches nothing can't make this suite pass vacuously.
    expect(emitted.size).toBeGreaterThanOrEqual(20);
  });

  it('every declared code has a non-empty label and a valid severity', () => {
    for (const [code, meta] of Object.entries(IMPORT_WARNING_META)) {
      expect(meta.label.length, `${code} has an empty label`).toBeGreaterThan(0);
      expect(['critical', 'review', 'info'], `${code} has severity "${meta.severity}"`).toContain(
        meta.severity,
      );
    }
  });

  it('the SPA label mirror covers every declared code', () => {
    // public/index.html has no build step, so IMPORT_WARN_LABELS is a hand-kept
    // mirror. An unknown code degrades gracefully rather than throwing, so this
    // is a nudge to keep the labels good, not a correctness guard.
    const spa = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf-8');
    const block = spa.match(/const IMPORT_WARN_LABELS=\{[\s\S]*?\n\};/);
    expect(block, 'IMPORT_WARN_LABELS not found in public/index.html').toBeTruthy();
    const inSpa = new Set([...block![0].matchAll(/'([a-z0-9-]+)':\[/g)].map((m) => m[1]!));
    const missing = (Object.keys(IMPORT_WARNING_META) as ImportWarningCode[]).filter(
      (c) => !inSpa.has(c),
    );
    expect(missing, `codes missing a SPA label: ${missing.join(', ')}`).toEqual([]);
  });
});
