# ISSUE-041: No data inventory, retention schedule, or privacy documentation

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Privacy
**Location:** repo-wide (no privacy, GDPR, retention, or DPA documentation)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
A search for privacy, GDPR, retention, or DPA documentation returns nothing. There is no record of
what personal or financial data the platform holds, where it lives, how long it is kept, or on what
lawful basis.

The platform ingests bank statements and general-ledger extracts. Depending on the customer's data,
that can include account identifiers, counterparty names, and transaction narratives — which are
personal data under GDPR when they relate to identifiable individuals, and are sensitive commercial
data in every case.

Diligence asks for four things here, none of which currently exist: a data inventory and flow map, a
retention schedule that is actually enforced in code, subject access and deletion mechanisms, and
data processing agreements with any subprocessor. The retention point is the one most often failed
in practice — a documented schedule that nothing implements is worse than no schedule, because it
becomes a demonstrable compliance gap rather than an absence.

## Fix
Start with the inventory, since everything else derives from it: enumerate every table and file
store holding customer-originated data, classify each field, and note the retention intent. Then
check what the code actually does with expiry — uploaded workbooks in particular. Formal policy
documents can follow; the inventory is the artifact with real engineering content.

Related: ISSUE-040, ISSUE-046, ISSUE-047.
