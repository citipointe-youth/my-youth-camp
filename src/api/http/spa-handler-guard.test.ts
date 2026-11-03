import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard for the SPA's inline handlers. A value dropped into an `on*="..."` attribute lands inside a
 * JS string inside an HTML attribute, so a name like `O'Brien` or `x');alert(1);('` breaks out
 * unless it went through `esc(jsq(...))`. `jsq` is only a convention, so this test fails when a
 * new interpolation (`${x}` or `'+x+'`) appears in an `on*=` attribute that is not one of:
 *   - wrapped in `jsq(...)` / `JSON.stringify(...)` (inside `esc`)
 *   - a generated id (`id`, `x.id`, `camperId`, ... optionally in `esc(...)`)
 *   - on the short ALLOW list below: values the code itself supplies (constants, indexes, handler
 *     strings), never data typed by a person or imported from Elvanto.
 * Added after the 4 Nov 2026 security review (LC-01 pattern). Regex-based: it finds the usual
 * shapes, not every possible sink. If this fails, wrap the value in `esc(jsq(...))`; only add to
 * ALLOW when the value cannot come from a user or an import.
 */

const HANDLER_ATTR = /\bon(?:click|change|input|submit|keyup|keydown|keypress|focus|blur|load|error|mouseover|touchstart|toggle|dblclick|contextmenu)\s*=\s*"/g;
const SAFE_WRAP = /^esc\((?:jsq|JSON\.stringify)\(/;
const SAFE_ID = /^(?:esc\()?(?:\w+\.)*(?:id|\w*Id)\)?$/;

const ALLOW = new Set([
  // Literals or numbers the calling code passes in (screen names, modes, steps, directions).
  'scr', 'which', 'u', 'dir', 'i', 'r[1]', 'key', 'd', 'from', 'back', 'lead', 'fn', 'action',
  'newMode', 'esc(label)', 'o.v', 'e.key', 'u.role',
  // Handler strings built in code.
  'onclick', 'onchange', 'o.onName', 'o.onPass', 'o.onPreview', 'o.onDel', '_faBackExpr(scr)',
  // Booleans and fixed-choice ternaries.
  '!!isLeader', "c.kind==='leader'", "c.present?'out':'in'",
  "_isIncidentNotice(n)?\"go('incidents')\":\"gotoTab('notifs')\"",
  "dailyDisabled?`toast('${dailyBlockedMsg}')`:\"openCheckinFace('checkin')\"",
  "disabled?`toast('${blockedMsg}')`:\"openCheckinFace('signin')\"",
  "locked?lockMsg:`selDevoDay('${dy}')`",
]);

export function unsafeHandlerValues(html: string): string[] {
  const bad = new Set<string>();
  let m: RegExpExecArray | null;
  HANDLER_ATTR.lastIndex = 0;
  while ((m = HANDLER_ATTR.exec(html))) {
    let j = HANDLER_ATTR.lastIndex;
    let depth = 0;
    for (; j < html.length; j++) {
      const c = html[j];
      if (c === '$' && html[j + 1] === '{') { depth++; j++; continue; }
      if (depth && c === '{') depth++;
      else if (depth && c === '}') depth--;
      else if (!depth && c === '"') break;
    }
    const val = html.slice(HANDLER_ATTR.lastIndex, j);
    const exprs = [
      ...[...val.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((x) => x[1]!.trim()),
      ...[...val.matchAll(/'\s*\+\s*([^+]+?)\s*\+\s*'/g)].map((x) => x[1]!.trim()),
    ];
    for (const e of exprs) if (!SAFE_WRAP.test(e) && !SAFE_ID.test(e) && !ALLOW.has(e)) bad.add(e);
  }
  return [...bad];
}

describe('SPA inline handlers', () => {
  it('flags a raw value and passes a jsq-wrapped one (the guard itself works)', () => {
    expect(unsafeHandlerValues(`<b onclick="open('\${p.firstName}')">`)).toEqual(['p.firstName']);
    expect(unsafeHandlerValues(`<b onclick="open('\${esc(jsq(p.firstName))}','\${p.id}')">`)).toEqual([]);
    expect(unsafeHandlerValues(`'<b onclick="open(\\''+name+'\\')">'`)).toEqual(['name']);
  });

  it('public/index.html has no unwrapped value in an on*= attribute', () => {
    const html = readFileSync(resolve(__dirname, '../../../public/index.html'), 'utf8');
    expect(html).toContain('onclick="');
    expect(unsafeHandlerValues(html)).toEqual([]);
  });
});
