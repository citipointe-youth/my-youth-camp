import { describe, it, expect } from 'vitest';
import {
  ELVANTO_HEADERS, cleanCareText, normalizeDate, formatDateAU,
  parseGradeOrLeader, yesToConsent, field, titleCaseName, submissionSortKey,
  isPlaceholderCareText, missingColumns, CARE_COLUMNS,
} from './elvanto-mapping';

describe('elvanto-mapping', () => {
  it('has 29 canonical headers starting with Date Submitted and ending with Today\'s Date', () => {
    expect(ELVANTO_HEADERS).toHaveLength(29);
    expect(ELVANTO_HEADERS[0]).toBe('Date Submitted');
    expect(ELVANTO_HEADERS[28]).toBe("Today's Date");
    expect(ELVANTO_HEADERS).toContain('Medical Conditions');
  });

  it('strips whole-value junk but keeps real care text', () => {
    expect(cleanCareText('NA')).toBe('');
    expect(cleanCareText('  no ')).toBe('');
    expect(cleanCareText('-')).toBe('');
    expect(cleanCareText('No dairy no eggs no nuts')).toBe('No dairy no eggs no nuts');
    expect(cleanCareText('Ritalin\nFluexotine')).toBe('Ritalin\nFluexotine');
  });

  /* 2026-08-04 — audited against the real exports (Camp data/27.7 and 21.7). The three
     spellings below are verbatim from those files and were all being KEPT, so the people
     carrying them got `medicalFlag: true` on the check-in roster and a red "Medical alert"
     card reading `Meds: not applicable`. An alert that cries wolf is worse than no alert. */
  it('🔴 strips the placeholder spellings the real Elvanto exports actually contain', () => {
    for (const v of ['n.a.', 'n.a', 'not applicable']) {
      expect(cleanCareText(v)).toBe('');
    }
  });

  it('is insensitive to case, spacing and punctuation in a placeholder', () => {
    for (const v of ['N/A', ' N.A. ', 'NIL', 'None.', 'nothing', 'Nope', '.', '  ']) {
      expect(cleanCareText(v)).toBe('');
    }
    expect(isPlaceholderCareText('none')).toBe(true);
    expect(isPlaceholderCareText('Asthmatic')).toBe(false);
  });

  it('⚠ matches the WHOLE value only — a placeholder word inside real text is not junk', () => {
    // Dropping either of these would delete a genuine medical instruction.
    expect(cleanCareText('none of the above except asthma')).toBe('none of the above except asthma');
    expect(cleanCareText('No nuts')).toBe('No nuts');
    expect(cleanCareText('Nil by mouth after 8pm')).toBe('Nil by mouth after 8pm');
  });

  it('⚠ keeps ambiguous answers — "unknown" is a statement in a medical field, not a blank', () => {
    expect(cleanCareText('unknown')).toBe('unknown');
    expect(cleanCareText('not sure')).toBe('not sure');
  });

  it('preserves every real value seen in the 2026-07-27 export', () => {
    for (const v of ['asthmatic', 'skin allergy', 'anaphylaxis', 'nut allergy',
      'gluten free', 'raw eggs', 'type1 diabetic', 'fluoxetine', 'adhd, asd', 'eczema', 'epipen']) {
      expect(cleanCareText(v)).toBe(v);
    }
  });
});

/* A care column that is ABSENT and one that is EMPTY both read as '' through `field()`.
   Renaming `Medical Conditions` upstream would import every registrant with no medical
   data and report complete success — the same silent-success shape as the snapshot wipe. */
describe('missingColumns', () => {
  const row = (keys: string[]): Record<string, string> =>
    Object.fromEntries(keys.map((k) => [k, '']));

  it('reports nothing when every care column is present', () => {
    expect(missingColumns(row([...CARE_COLUMNS]), CARE_COLUMNS)).toEqual([]);
  });

  it('🔴 names a care column that the export has renamed away', () => {
    const missing = missingColumns(
      row(['Medical Conditions (if any)', 'Dietary Requirements',
        'List Other Medical Conditions or Medication Taken']),
      CARE_COLUMNS,
    );
    expect(missing).toEqual(['Medical Conditions']);
  });

  it('matches headers the same normalised way field() does', () => {
    // Case and spacing drift is already handled by field(), so it must not warn here either.
    expect(missingColumns(row(['MEDICAL  CONDITIONS', 'dietary requirements',
      'List Other Medical Conditions or Medication Taken']), CARE_COLUMNS)).toEqual([]);
  });

  it('handles an empty file without throwing', () => {
    expect(missingColumns(undefined, CARE_COLUMNS)).toEqual([]);
  });
});

describe('elvanto-mapping — dates, grades, consent, names', () => {
  it('normalizes DD/MM/YYYY to ISO and round-trips back to AU', () => {
    expect(normalizeDate('30/09/2009')).toBe('2009-09-30');
    expect(normalizeDate('2009-09-30')).toBe('2009-09-30');
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('rubbish')).toBeNull();
    expect(formatDateAU('2009-09-30')).toBe('30/09/2009');
    expect(formatDateAU('')).toBe('');
  });

  it('detects leaders and youth grades', () => {
    expect(parseGradeOrLeader('18+ Leader')).toEqual({ kind: 'leader', grade: null });
    expect(parseGradeOrLeader('Leader')).toEqual({ kind: 'leader', grade: null });
    expect(parseGradeOrLeader('11')).toEqual({ kind: 'youth', grade: 11 });
    expect(parseGradeOrLeader('')).toEqual({ kind: 'youth', grade: null });
    expect(parseGradeOrLeader('Kindy')).toEqual({ kind: 'youth', grade: null });
  });

  it('parses consent + resolves aliases', () => {
    expect(yesToConsent('Yes')).toBe(true);
    expect(yesToConsent('no')).toBe(false);
    const row = { 'First Name': 'Ada', firstName: '' };
    expect(field(row, 'First Name', 'firstName')).toBe('Ada');
    expect(field(row, 'firstName', 'First Name')).toBe('Ada');
    expect(field(row, 'Missing')).toBe('');
  });

  describe('titleCaseName', () => {
    it('title-cases ALL-CAPS names', () => {
      expect(titleCaseName('JOHN')).toBe('John');
      expect(titleCaseName('SMITH')).toBe('Smith');
    });

    it('title-cases all-lower-case names', () => {
      expect(titleCaseName('john')).toBe('John');
    });

    it('title-cases each part of a hyphenated all-caps name', () => {
      expect(titleCaseName('MARY-JANE')).toBe('Mary-Jane');
    });

    it("title-cases around straight and curly apostrophes", () => {
      expect(titleCaseName("O'BRIEN")).toBe("O'Brien");
      expect(titleCaseName('O’BRIEN')).toBe('O’Brien');
    });

    it('title-cases each word of a space-separated all-caps name', () => {
      expect(titleCaseName('MARY ANNE')).toBe('Mary Anne');
    });

    it('leaves mixed-case names completely unchanged', () => {
      expect(titleCaseName('McDonald')).toBe('McDonald');
      expect(titleCaseName('de Silva')).toBe('de Silva');
      expect(titleCaseName('van Wyk')).toBe('van Wyk');
    });

    it('leaves empty/blank input unchanged', () => {
      expect(titleCaseName('')).toBe('');
      expect(titleCaseName('   ')).toBe('   ');
    });

    it('handles non-ASCII letters', () => {
      expect(titleCaseName('JOSÉ')).toBe('José');
    });
  });

  describe('submissionSortKey — 12-hour times', () => {
    // The real Elvanto export is date-only, so these guard a FORMAT CHANGE. A 12-hour time
    // that silently truncated its meridiem produced a valid-looking key that inverted the
    // "latest submission wins" merge — the exact silent mis-order the sort key exists to stop.
    it('orders an afternoon submission after a morning one on the same day', () => {
      // Keys are compared as STRINGS by the caller's sort, so assert the string ordering.
      const pm = submissionSortKey('04/07/2026 2:32 PM');
      const am = submissionSortKey('04/07/2026 11:00 AM');
      expect(pm > am).toBe(true);
    });

    it('converts pm hours and leaves am hours alone', () => {
      expect(submissionSortKey('04/07/2026 2:32 PM')).toBe('2026-07-04T14:32:00');
      expect(submissionSortKey('04/07/2026 11:00 AM')).toBe('2026-07-04T11:00:00');
    });

    it('handles the 12am/12pm boundary, where naive +12 arithmetic breaks', () => {
      expect(submissionSortKey('04/07/2026 12:15 AM')).toBe('2026-07-04T00:15:00');
      expect(submissionSortKey('04/07/2026 12:15 PM')).toBe('2026-07-04T12:15:00');
    });

    it('leaves a 24-hour time untouched and still parses date-only rows', () => {
      expect(submissionSortKey('04/07/2026 14:32')).toBe('2026-07-04T14:32:00');
      expect(submissionSortKey('04/07/2026')).toBe('2026-07-04T00:00:00');
    });

    it('returns the undated sort-first key for blank or unparseable input', () => {
      expect(submissionSortKey('')).toBe('');
      expect(submissionSortKey('not a date')).toBe('');
    });
  });
});
