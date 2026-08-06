# ISSUE-045: Incident history is undocumented — no postmortems on file

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Operations
**Location:** repo-wide (no postmortem or incident records)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
No incident records or postmortems exist. Diligence reads an empty incident history as one of three
things — no traffic, no detection, or no discipline — and none of those is the impression to leave.

At least one incident worth writing up has already occurred and been fully resolved: the original
Developer Dashboard's `tools` container wedged, took the dashboard down, and had no self-healing or
alerting. The response was not a patch but an architectural change — checks moved to GitHub Actions,
the Docker-socket-mounted container removed entirely, and the dashboard reduced to a passive reader
of published results.

**That is a strong story that currently exists only in commit messages and memory.** A written
postmortem demonstrates detection, root-cause analysis, and a systemic fix — which is exactly what
buyers are trying to establish, and it is worth more than an unblemished record.

## Fix
Write it up in a standard blameless format: timeline, impact, root cause, contributing factors, what
was changed, and what would catch it faster next time. Note honestly that the absence of alerting
was itself a contributing factor — the failure was found by a person noticing, not by a monitor.
Then adopt the template so future incidents are recorded as they happen.

Related: ISSUE-038, ISSUE-042, ISSUE-009.
