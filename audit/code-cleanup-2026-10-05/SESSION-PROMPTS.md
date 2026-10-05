# Session prompts

Paste one prompt per session. Each session starts with no memory of the audit; the prompt and the plan are all it needs. Run the waves in order. Inside a wave, only start sessions in parallel where the plan's "Wave order and parallelism" section says it is safe.

## Wave 0: Safety net

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do Wave 0 in this order: TASK-0.2, TASK-0.3, TASK-0.5, then TASK-0.1. Skip TASK-0.4 (it runs after Wave 1).
Work on branch cleanup/wave-0, one commit per task, commit titles describing the effect, no attribution lines.
Run the verification setup in section 2 before you start and record the baseline (API tests: 14 files, 236 pass).
For TASK-0.1, stop after pushing the branch and tell me to check the "check" workflow in GitHub Actions (owner action 3). Do not fast-forward main until I confirm it is green.
Update the Status column in section 5 as each task lands. Finish with: tasks done, test counts before and after, anything you could not do and why.
```

## Wave 1: Dead code

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do Wave 1: TASK-1.1 and TASK-1.2, then TASK-1.3, TASK-1.4, TASK-1.5, then TASK-0.4 from Wave 0. TASK-1.6 is BLOCKED unless I have given the row counts (owner action 1); skip it if not.
Decisions Q1-Q5 in section 3 are final: apply them exactly as written.
Before deleting any symbol or route, re-run the grep the task gives and confirm 0 callers. If a grep finds a caller the audit missed, keep the symbol and say so in the commit.
Branch cleanup/wave-1, one commit per task, then fast-forward main (section 0 rule 2). Update section 5 statuses.
Finish with: lines removed (git diff --stat main~N), lint warning count before and after, API test count before and after, and every remnant found by TASK-1.4 step 5.
```

## Wave 2: API foundations

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do Wave 2.
TASK-2.1 first, alone, and run the full API suite after it. Then TASK-2.2. Then, in this order: 2.3, 2.9, 2.4, 2.10, 2.5, 2.6, 2.7, 2.8, 2.11.
Every security-relevant task (2.2, 2.3, 2.4, 2.5, 2.8) needs its negative test plus the mutation check described in its Verify. Report the red/green result of each mutation check in the commit body.
Behaviour changes allowed: Q6 (b), (c), (d), (f) only. Anything else that changes an HTTP status or response shape: stop and ask me.
Migrations: next free number at execution time (section 0 rule 5).
Branch cleanup/wave-2, one commit per task, fast-forward main at the end. Update section 5 statuses.
```

## Wave 3: Shared value lists

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do TASK-3.1, then TASK-3.2.
Copy every value exactly from the API file at the current commit (not from the plan text); the domain test in TASK-3.1 must compare against the DB check constraints.
Q7 is final: low priority is grey, labels use .label (weight 500).
For TASK-3.2, take screenshots of Work Orders, Assets (detail panel), Analytics and Scan at desktop width in light and dark, before and after, and save them under audit/code-cleanup-2026-10-05/runtime/wave-3/ (do not commit that folder).
Branch cleanup/wave-3, one commit per task, fast-forward main. Update section 5.
```

## Wave 4: App foundations

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do Wave 4 in this order: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8.
Each task pilots its new hook or component only on the pages it names; do not migrate other pages (Wave 5 does that).
Behaviour change allowed: Q6 (e) (alerts become toasts, confirms become in-app dialogs).
Run npm run lint, npm run build and npm test -w @assetcore/app before every commit. Do each task's manual check in the running app (npm run dev:api + npm run dev) and say what you saw.
Branch cleanup/wave-4, one commit per task, fast-forward main. Update section 5.
```

## Wave 5a: Smoke test and work-order close

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5 and the Wave 5 rule ("move first, then improve"). Do TASK-5.0, then TASK-5.1.
TASK-5.1 touches stock and defects: write tests/workOrderClose.test.ts first, see it fail on the current code for the maintenance-completion and PATCH paths, then implement. Q6(a) is final.
Branch cleanup/wave-5a, fast-forward main. Update section 5.
```

## Wave 5b: API splits (one session per task)

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, the Wave 5 rule, and TASK-5.<N> (one of 5.2, 5.3, 5.4, 5.5, 5.6; 5.3 only after 5.1 has landed).
Line numbers in the task are at baseline 913e934 and have moved; find each block by the route path or symbol.
Commit 1: pure move, no edits beyond imports; API tests and typecheck green. Later commits: adopt parseOr400, send, listQuery and the services the task names.
Branch cleanup/wave-5-<file>, fast-forward main. Update section 5.
```

## Wave 5c: App splits (one session per task)

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, the Wave 5 rule, and TASK-5.<N> (one of 5.7, 5.8, 5.9, 5.10, 5.11; 5.7 first; 5.10 only after 5.9).
Commit 1: pure move (keep the old page file as a one-line re-export so App.jsx imports do not change); lint, build and npm run e2e green. Later commits: adopt useResource, Modal, useConfirm, Field, TableState, lib/domain and lib/dates in the moved files.
Take before/after screenshots of every screen the file renders at 375px and desktop, light and dark, under audit/code-cleanup-2026-10-05/runtime/<task>/ (not committed), and list any visible difference that is not one of Q6(e) or Q7.
Branch cleanup/wave-5-<file>, fast-forward main. Update section 5.
```

## Wave 6: Tidy

```
Repo: AssetCore (cwd). Read audit/code-cleanup-2026-10-05/IMPLEMENTATION-PLAN.md sections 0-5, then do the Wave 6 tasks whose dependencies have landed (check section 5): 6.1, 6.2, 6.3, 6.4.
TASK-6.1 must keep the test count identical; report it before and after. TASK-6.2 must not change either depreciation engine; if they disagree, log the numbers in OUT-OF-SCOPE.md and skip the test as the task says.
Branch cleanup/wave-6, one commit per task, fast-forward main. Update section 5, then list any task still open and why.
```
