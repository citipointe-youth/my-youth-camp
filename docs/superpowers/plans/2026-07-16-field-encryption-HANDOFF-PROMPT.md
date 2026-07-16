# Sonnet implementer handoff prompt

Paste everything below the line into a fresh Claude Code (Sonnet) session opened in the repo
`youth-camp-platform-masterv2`. It is self-contained: it points at the plan as the single source of
truth so the implementer spends tokens executing, not re-deriving.

---

You are implementing an **already-approved, fully-specified plan**. Do not redesign, re-explore, or
second-guess it — the analysis is done. Your job is disciplined execution.

**Working directory:** `C:\Users\thoma\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2`
(git repo `citipointe-youth/my-youth-camp`, public).

**The plan is the single source of truth. Read it fully first and follow it verbatim:**
`docs/superpowers/plans/2026-07-16-field-encryption.md`
(Background/rationale, if you need it, is in `docs/superpowers/specs/2026-07-16-field-encryption-design.md` — but the plan is complete; only open the spec if a step is ambiguous.)

**What you are building:** application-level AES-256-GCM encryption at rest for sensitive `people`
and `notes` columns, applied only inside the Supabase row↔entity mappers. Tasks 1–7 in the plan.

## How to work

1. **First:** `git checkout -b feat/field-encryption` so nothing lands on `master` (this repo
   auto-deploys on push to `master` — you will **not** push; the human controls deployment).
2. Use the **superpowers:executing-plans** skill and work **task-by-task, step-by-step**. Each task
   is a TDD cycle: write the failing test → run it and confirm it fails → implement → run and confirm
   it passes → commit. Check off each `- [ ]` as you go.
3. Use the **exact code, file paths, and commands in the plan.** They are correct for this codebase —
   don't substitute your own patterns.
4. **Commit after each task** with the message given in the plan. Commit only — **do not push**.

## Hard rules (from the plan's Global Constraints — do not violate)

- **Backend only.** Do **not** edit `public/index.html`, and do **not** bump `sw.js`. Do **not**
  start a dev server or drive a browser. Verify with `npm run typecheck`, `npm run test`, and
  reasoning only.
- **TypeScript is strict** (`strict` + `noUncheckedIndexedAccess`). Guard every indexed access.
  Keep **CommonJS** emit and extensionless ESM imports — don't touch `tsconfig`.
- Tests are **vitest** with explicit imports (`import { describe, it, expect } from 'vitest'`).
  Run one file with `npx vitest run <path>`; run everything with `npm run test`.
- Preserve **null/empty** exactly (the plan's tests enforce this) — never store ciphertext for
  `null`/`''`/`[]`.
- The four migrations/script are **files you create**; you do **not** run them against the
  database. Applying migration `022`/`023`, running the backfill, and `VACUUM FULL` are
  **operator-gated prod steps** in the plan's Deployment Runbook — leave them for the human. Your
  deliverable is code + migrations + script + docs, all committed on the branch.

## Definition of done

- All of Tasks 1–7 implemented, each step checked off, each task committed on `feat/field-encryption`.
- `npm run typecheck` is clean.
- `npm run test` is fully green — the pre-existing ~465 tests (which run in `memory` mode and never
  touch the codec) must still pass unchanged, plus the new `field-crypto` (7), people-mapper (4),
  and notes-mapper (3) tests.
- Nothing pushed; no prod DB or Vercel changes made.

When done, report: the final `npm run test` summary line, the list of commits on the branch, and any
step where reality diverged from the plan (there should be none — flag it if so rather than
improvising).
