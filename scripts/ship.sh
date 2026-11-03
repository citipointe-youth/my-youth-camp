#!/usr/bin/env bash
# Ship <branch> to master (master is the Vercel deploy): clean tree, fast-forward only, tests green, plain push.
# Usage: bash scripts/ship.sh [--dry-run] <branch>   (run from a worktree with <branch> checked out)
set -euo pipefail
DRY= BR=
for a in "$@"; do case $a in --dry-run) DRY=1;; -*) echo "unknown option: $a"; exit 2;; *) BR=$a;; esac; done
[ -n "$BR" ] || { echo "usage: ship.sh [--dry-run] <branch>"; exit 2; }
cd "$(git rev-parse --show-toplevel)"

git fetch -q origin
SHA=$(git rev-parse "$BR")
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "FAIL: check out $BR here first"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: working tree not clean"; exit 1; }
git merge-base --is-ancestor origin/master "$SHA" || { echo "FAIL: $BR is not a fast-forward of origin/master (rebase first)"; exit 1; }

# SW cache rule (CLAUDE.md "Service worker"): anything under public/ other than sw.js changed => CACHE must be bumped.
# Capture first, then match: `grep -q` exits early and, under pipefail, the writer's SIGPIPE can turn a match into a miss.
PUB=$(git diff --name-only origin/master "$SHA" -- public/)
SWD=$(git diff origin/master "$SHA" -- public/sw.js)
if [ -n "$(printf '%s\n' "$PUB" | grep -v '^public/sw\.js$' || true)" ]; then
  [ -n "$(printf '%s\n' "$SWD" | grep '^+const CACHE = ' || true)" ] \
    || { echo "FAIL: public/ changed but public/sw.js CACHE (camp-vN) was not bumped"; exit 1; }
fi

LOG=$(mktemp)
npm test >"$LOG" 2>&1 || { echo "FAIL tests (log $LOG):"; tail -15 "$LOG"; exit 1; }
echo "tests: $(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E '^\s*Tests ' | tr -s ' ' | tail -1)"

if [ -n "$DRY" ]; then echo "dry: would push ${SHA:0:7} to master"; exit 0; fi
git push origin "$SHA:refs/heads/master"
echo "pushed ${SHA:0:7} to master; Vercel deploys it"
