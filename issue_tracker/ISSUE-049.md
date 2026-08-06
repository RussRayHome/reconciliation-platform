# ISSUE-049: Scope and execute JWT_SECRET rotation + history remediation for ISSUE-022

**Status:** Open · **Severity:** Blocker · **Area:** Security / Secrets
**Location:** commit `7aafa45`; `.env.docker.dev.fallback`, `.env.docker.stage.fallback`,
`issue_tracker/ISSUE-022.md`
**Source:** History forensics for ISSUE-022, 2026-08-06.

## Why this is separate from ISSUE-022
ISSUE-022 scopes removing the values from the working tree. That does not remediate the leak:
deleting a secret in a new commit leaves it fully readable in history, and secret scanners
(gitleaks, trufflehog) read full history, not the checkout. This issue covers rotation and the
history decision.

## Findings

**Blast radius is small and well-bounded.**

| Fact | Value |
|---|---|
| Commits that ever introduced either value | **1** — `7aafa45` |
| Still present at `dev` HEAD | Yes — never removed |
| Tracked files carrying a value at HEAD | **3** (see below) |
| Local branches containing `7aafa45` | 4 — `dev`, `stage`, `feature/create-account`, `security-hardening` |
| Remote branches containing it | 6 — the above plus `origin/HEAD` and a dependabot branch |
| Commits on `dev` after `7aafa45` | 25 |
| Repository visibility | **Private** |

**The third affected file is this tracker.** `issue_tracker/ISSUE-022.md:13-14` reproduces both
64-character values verbatim in order to document them. The document describing the leak is itself
a copy of the leak, and it was committed in the same commit that introduced it. Any remediation that
scrubs the two `.fallback` files and not `ISSUE-022.md` leaves the secrets fully recoverable.

**Only `JWT_SECRET` is a real secret.** Both fallback files were audited key by key: every other
value is a placeholder or a port/timeout (`POSTGRES_PASSWORD` is `change-*-password`,
`API_DATABASE_URL` embeds that same placeholder). Rotation scope is two values, not two files.

**Exposure is dev/stage only.** Per ISSUE-022, `resolveJwtSecret` in `authService.ts` hard-requires
an explicit `JWT_SECRET` in production and throws if unset, so no production deployment can be
running on a fallback-file value. The realistic risk is token forgery against a dev or stage
deployment started from a fallback file.

## Rotation — do this regardless of the history decision

1. Replace the `JWT_SECRET` line in both `.fallback` files with an obvious placeholder, or delete it
   so the app's ephemeral-secret path takes over (ISSUE-022's fix).
2. Redact the values in `ISSUE-022.md`, leaving the description intact.
3. Generate fresh secrets for any real `.env.docker.dev` / `.env.docker.stage` currently in use, and
   restart those stacks. Existing sessions signed with the old key become invalid — expected.
4. Confirm no deployed environment is still reading a fallback file for `JWT_SECRET`.

After step 3 the leaked values are dead keys, and everything below is about hygiene and audit
optics rather than live risk.

## History rewrite — decision needed

The rewrite is cheap by rewrite standards (single commit, 25 descendants on `dev`) but not free:
`git filter-repo` rewrites every commit from `7aafa45` forward, all 4 local and 6 remote branches
need coordinated force-pushes, the dependabot branch must be deleted and regenerated, and any clone
must be re-made rather than pulled.

Two defensible positions:

- **Rotate only.** Justified by: repo is private, prod was never exposed, keys are dead after
  rotation. Record the decision and its date so the history hit is a documented accepted risk rather
  than an oversight.
- **Rotate and rewrite.** Justified by: the private-repo mitigation is exactly what disappears when
  an acquirer, auditor, or pen-test firm is granted read access — which is the point of
  ISSUE-039/040. A scanner run by a buyer's team reports "hardcoded JWT signing key in history"
  without weighing that it was dev-only and rotated.

**Recommendation:** rotate now, and complete the rewrite before granting any external party
repository access. That ties the expensive step to the moment its justification becomes real, and
doing it while the branch count is 4 is far cheaper than after a buyer's engineers hold clones.

## Prevention

- Add gitleaks or trufflehog to CI scanning **full history**, not just the diff. The existing
  preflight secret scan classifies the whole `.fallback` file family as expected-safe
  (`WARN-4`) and by design would not have caught this.
- Add the same as a pre-commit hook so the next one is stopped before it is committed.
- Adopt the rule this issue follows: **incident and issue documentation records the key name,
  location, and length — never the value.** ISSUE-022 is the case study.

## Note — unrelated but adjacent
`apps/developer-dashboard-api/.env` exists on disk with a live GitHub PAT and OAuth client secret.
It is correctly gitignored and is **not** in history (verified). Flagged only because it is one
`git add -f` away from becoming this issue again, and it is not covered by any scan that reads
tracked files.

Related: ISSUE-022 (working-tree fix), ISSUE-039, ISSUE-040, ISSUE-006.
