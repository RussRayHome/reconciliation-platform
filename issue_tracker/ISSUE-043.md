# ISSUE-043: No performance, load, or soak testing — capacity limits are unknown

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Performance
**Location:** repo-wide (no perf test tier)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
There is no k6, Artillery, autocannon, or benchmark tier anywhere in the repo. The test suite covers
correctness only. Nothing establishes how the platform behaves under realistic or adverse load.

For a reconciliation product the buyer's question is concrete and quantitative: what is the largest
workbook successfully processed, how many transactions, how long did the match take, and what
happens at the limit — graceful rejection, timeout, or out-of-memory. Currently there is no answer,
and "we haven't measured" invites the assumption that the ceiling is low.

Two specific unknowns worth naming:

- The matching engine's complexity profile. If any stage is worse than linear in transaction count,
  it will be discovered by a customer rather than by you.
- Upload and parse memory behaviour under large workbooks. ExcelJS is memory-hungry, and this path
  accepts attacker-influenced input size on an authenticated endpoint.

Notably, the sibling project `vs_code_workspace17` maintains a perf test tier — so the practice
exists, it just was not carried into this codebase.

## Fix
Establish a baseline before optimising anything: generate fixtures at several sizes (10k, 100k, 1M
transactions), record wall-clock and peak memory for the match, and document the largest supported
workbook as a stated limit. A soak test over a sustained run would additionally surface leaks. The
documented limit is worth as much in diligence as the performance itself.

Related: ISSUE-038, ISSUE-032.
