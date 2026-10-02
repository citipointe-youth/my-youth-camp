import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const router = readFileSync(resolve(__dirname, 'router.ts'), 'utf8');

describe('router: removed post-camp routes', () => {
  const removed = [
    "path: '/registrants/chase'",
    "path: '/registrants/breakdown'",
    "path: '/registrants/remind'",
    "path: '/accommodation/groups'",
    "path: '/campers/medical'",
    "path: '/notifications/latest'",
    "path: '/import/churches'",
    "path: '/accounts/churches/split'",
  ];
  for (const frag of removed) {
    it(`does not declare ${frag}`, () => {
      expect(router).not.toContain(frag);
    });
  }
  it('keeps /setup and /internal/cron/tick', () => {
    expect(router).toContain("'/setup'");
    expect(router).toContain('/internal/cron/tick');
  });
});
