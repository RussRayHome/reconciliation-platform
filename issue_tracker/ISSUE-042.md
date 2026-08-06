# ISSUE-042: Backup and restore are scripted but never drilled; no RTO/RPO or DR plan

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Operations
**Location:** `scripts/pre-flight/backup.sh`, `scripts/pre-flight/restore.sh`
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
Both `backup.sh` (compressed `pg_dump`, dev and stage) and `restore.sh` exist and are wired to npm
scripts. **The tooling is in better shape than most sellers at this stage** — the gap is evidence,
not capability.

What diligence asks is not "do you have backups" but:

- When was a restore last performed from a backup, into a clean environment, and verified?
- What is the measured recovery time objective, and the recovery point objective?
- What happens if the primary database or region is lost entirely?

None of these have a recorded answer. An untested backup is scored as no backup, because the failure
modes (truncated dumps, missing roles/extensions, unrestorable custom-format files, absent
`pgaudit`/RLS state) only surface on restore. This system has non-trivial database state — RLS
policies, a least-privilege `app_user` role, extensions — which makes a naive dump/restore more
likely to omit something than a plain schema would be.

## Fix
Perform a restore drill into a clean environment, time it, and record the result with a date —
including confirmation that RLS policies, roles, and extensions all came back intact. Then set
stated RTO/RPO targets, and write a short DR plan covering total loss of the primary database.
Repeat the drill on a schedule so the evidence stays current.

Related: ISSUE-040, ISSUE-019, ISSUE-045.
