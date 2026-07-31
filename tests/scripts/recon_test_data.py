"""
Mock GAAP Bank Reconciliation Dataset Generator
================================================
Generates two cross-referenced XLSX files for testing a bank-to-GL
reconciliation application against every exception category the engine
can assign:

  company_gl.xlsx       (File A - Company General Ledger)
  bank_statement.xlsx   (File B - Bank Statement)

Both files are written to tests/data/, resolved relative to this script's
own location (see OUTPUT_DIR below) so the output path doesn't depend on
the working directory the script is run from.

Column schema
-------------
company_gl.xlsx (Company_GL sheet):
    transaction_id    unique row id, e.g. "GL-10001"
    transaction_date  date the transaction occurred (YYYY-MM-DD)
    post_date         date the GL posted it (0-3 days later)
    document_number   the reconciliation reference (e.g. "CHK-100001") —
                       this is the join key against bank_reference below
    check_number      populated only for check-like rows; blank otherwise
    description       human-readable GL description
    debit_amount      populated for debits, NaN otherwise
    credit_amount     populated for credits, NaN otherwise
    balance_impact     "DR" or "CR"

bank_statement.xlsx (Bank_Statement sheet):
    bank_statement_id  unique row id, e.g. "BNK-50001"
    value_date         date the bank posted/cleared the item
    bank_reference     the reconciliation reference — joins to
                        company_gl.document_number for matched transactions
    check_number       populated only for check-like rows; blank otherwise
    transaction_text   bank's clearing text (terser/different wording than
                        the GL description, as in real bank feeds)
    deposit_amount     populated for deposits, NaN otherwise
    withdrawal_amount  populated for withdrawals, NaN otherwise

Scenario mix
------------
Each section below is tagged with the exact ErrorCategory (or match
disposition) it's built to trigger in packages/core's matching + reporting
engine. Row counts trade the original single 80/5/8/4/3 split for full
28-category coverage (MissingFromBank/MissingFromQBO are covered
incidentally by every one-sided scenario, so aren't a section of their own).

Dependencies:
    pip install pandas numpy openpyxl

Run:
    python recon_test_data.py
"""

import itertools
import random
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import load_workbook

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

START_DATE = pd.Timestamp("2026-10-01")
END_DATE = pd.Timestamp("2026-10-31")
# StaleOutstandingCheck needs items 45+ days older than the reconciliation
# anchor (the latest transaction date across the dataset), so this scenario
# alone reaches back into a prior month.
STALE_START_DATE = pd.Timestamp("2026-08-01")
STALE_END_DATE = pd.Timestamp("2026-08-15")

# Business days only (banks/GL don't typically post on weekends).
BUSINESS_DAYS = list(pd.bdate_range(START_DATE, END_DATE))
STALE_BUSINESS_DAYS = list(pd.bdate_range(STALE_START_DATE, STALE_END_DATE))
LAST_DAYS = BUSINESS_DAYS[-4:]  # "near the end of the month" pool for DIT

# Mirrors packages/config/src/default-config.ts matching config, so every
# scenario below is built against the thresholds the engine actually uses.
DATE_TOLERANCE_DAYS = 5  # matching.dateToleranceDays
TIMING_DIFFERENCE_DAYS = 21  # matching.timingDifferenceDays
STALE_OUTSTANDING_CHECK_DAYS = 45  # matching.staleOutstandingCheckDays
DUPLICATE_DATE_WINDOW_DAYS = 3  # matching.duplicateDateWindowDays
REVERSAL_WINDOW_DAYS = 7  # matching.reversalWindowDays
CHARGEBACK_WINDOW_DAYS = 120  # hard-coded in exceptionClassifierStages.ts

# ---------------------------------------------------------------------------
# CORE GAAP SCENARIO COUNTS
# ---------------------------------------------------------------------------
N_PERFECT_MATCH = 1800  # Exact Match
N_DEPOSITS_IN_TRANSIT = 150  # DepositInTransit — File A only, late-month
N_OUTSTANDING_CHECKS = 150  # OutstandingCheck — File A only, check-like
N_STALE_OUTSTANDING_CHECKS = 20  # StaleOutstandingCheck — File A only, 45+ days old
N_SERVICE_CHARGE = 60  # bank-only, no dedicated category (falls to MissingFromQBO)
N_INTEREST = 50  # InterestIncome — bank-only
N_NSF = 50  # NSFReturnedDeposit — bank-only
N_MISMATCH = 90  # AmountMismatch — same reference, different amount
N_DATE_VARIANCE = 40  # DateVariance — same (non-distinctive) amount, 6-21 days apart
N_TIMING_DIFFERENCE = 40  # TimingDifference — same distinctive amount, 6-21 days apart
N_LIKELY_MISCODING = 30  # LikelyMiscoding — same distinctive amount, conflicting context
N_REFERENCE_MISMATCH = 30  # ReferenceNumberMismatch — same amount/date, mismatched reference
N_CHECK_NUMBER_MISMATCH = 20  # CheckNumberMismatch — matching check #, amount or date off
N_DESCRIPTION_VARIANCE = 30  # DescriptionMerchantVariance — same amount/date, so-so text match
N_DUPLICATE_BANK = 20  # DuplicateInBank — same-side accidental double-post
N_DUPLICATE_GL = 20  # DuplicateInQBO — same-side accidental double-post
N_INTERCOMPANY = 15  # IntercompanyMismatch — one-sided, per side
N_INVALID_DATA = 15  # InvalidOrMissingData — malformed/blank critical fields
N_AMBIGUOUS = 15  # AmbiguousMatchRequiringReview — 1 bank candidate, 2 GL rows
N_ACH_RETURN = 20  # ACHReturn — bank-only offsetting debit/credit pair
N_REVERSAL_VOID = 20  # ReversalVoid — bank-only offsetting debit/credit pair
N_CHARGEBACK = 15  # ChargebackReturn — bank-only debit vs. an already-matched credit
N_FEE_NETTING = 15  # FeeNettingMatch — 1 bank credit = GL revenue - GL fee
N_PARTIAL_PAYMENT = 15  # PartialPaymentMatch — 1 GL payable = 2-3 bank installments
N_PAYROLL_BATCH = 8  # PayrollBatchMatch — 1 bank payroll debit = N GL expense lines
N_SERVICE_CHARGE_AMORTIZATION = 10  # BankServiceChargeAmortization — 1 bank fee = N GL lines
N_LOAN_PAYMENT_SPLIT = 10  # LoanPaymentSplit — 1 bank payment = principal + interest
N_SPLIT_COMBINE = 10  # LikelySplitCombineIssue — balanced grouped residual, mixed kind
N_DEPOSIT_GROUPING = 10  # DepositGroupingIssue — balanced grouped residual, deposit-like

# ---------------------------------------------------------------------------
# ID / REFERENCE GENERATORS
# ---------------------------------------------------------------------------
gl_ids = (f"GL-{i}" for i in itertools.count(10001))
bank_ids = (f"BNK-{i}" for i in itertools.count(50001))

_ref_counters = {
    "CHK": 100001, "ACH": 700001, "WIRE": 900001, "DEP": 800001, "JE": 1,
    "MISC": 500001, "PAY": 600001, "SVC": 400001, "LOAN": 300001, "ICO": 200001,
}
_check_counter = itertools.count(3001)


def next_ref(prefix):
    """Return the next sequential reference for `prefix` (e.g. "CHK-100002"),
    advancing that prefix's counter in _ref_counters. This is the shared
    document_number/bank_reference used to join a GL row to its bank row."""
    n = _ref_counters[prefix]
    _ref_counters[prefix] += 1
    if prefix == "JE":
        return f"JE-{n:05d}"
    return f"{prefix}-{n}"


def next_check_number():
    """Sequential check number, shared between a GL and bank row to signal
    isCheckLikeQboTransaction / isCheckLikeBankTransaction unambiguously."""
    return str(next(_check_counter))


# ---------------------------------------------------------------------------
# DATE HELPERS
# ---------------------------------------------------------------------------
def random_date(pool=None):
    """Uniformly random business day, or from `pool` if given (e.g. LAST_DAYS)."""
    return random.choice(pool or BUSINESS_DAYS)


# Bias outstanding-check dates toward the back half of the month — a check
# is more plausibly still uncashed at period-end if it was written later.
_late_weights = np.linspace(1, 3, len(BUSINESS_DAYS)).tolist()


def biased_late_date():
    """Random business day, weighted ~3x toward the end of the month (see
    _late_weights) for transactions that should plausibly still be pending."""
    return random.choices(BUSINESS_DAYS, weights=_late_weights, k=1)[0]


def post_date_for(tdate):
    """GL post date: 0-3 days after the transaction date, clamped to month end."""
    lag = random.randint(0, 3)
    return min(tdate + timedelta(days=lag), END_DATE)


def offset_business_day(tdate, days):
    """`tdate` shifted forward by `days` business days (approximated as
    calendar days, clamped to the dataset's date range)."""
    shifted = tdate + timedelta(days=days)
    return min(max(shifted, START_DATE), END_DATE)


# ---------------------------------------------------------------------------
# AMOUNT HELPERS
# ---------------------------------------------------------------------------
_used_amounts = set()


def random_amount(low=20.0, high=25000.0, mode=None):
    """Triangular distribution: skews toward realistic small/mid transactions
    while still allowing an occasional large one."""
    if mode is None:
        mode = low + (high - low) * 0.12
    return round(random.triangular(low, high, mode), 2)


def distinctive_amount(low=20.0, high=25000.0):
    """A random_amount() guaranteed not to collide with a previously issued
    distinctive_amount() — required for scenarios (TimingDifference,
    LikelyMiscoding) whose detection depends on the amount occurring exactly
    once per side."""
    while True:
        amount = random_amount(low, high)
        if amount not in _used_amounts:
            _used_amounts.add(amount)
            return amount


def transpose_amount(amount):
    """Introduce a classic digit-transposition error (e.g. $1,234.00 ->
    $1,243.00). Transposition errors always produce a difference that is a
    multiple of 9 — a real GAAP audit signature — which this preserves by
    construction. Falls back to a $0.09/$0.90/$9.00 nudge (still a multiple
    of 9) if the two chosen digits happen to be identical."""
    cents = int(round(amount * 100))
    digits = list(str(cents))
    if len(digits) >= 2:
        positions = list(range(len(digits) - 1))
        random.shuffle(positions)
        for i in positions:
            if digits[i] != digits[i + 1]:
                digits[i], digits[i + 1] = digits[i + 1], digits[i]
                return round(int("".join(digits)) / 100, 2)
    nudge_cents = random.choice([9, 90, 900]) * random.choice([-1, 1])
    return round(amount + nudge_cents / 100, 2)


def split_amount(total, parts):
    """Split `total` into `parts` positive pieces (rounded to cents) that sum
    back to exactly `total` — used by every grouped (N:1) scenario below."""
    if parts == 1:
        return [round(total, 2)]
    weights = [random.uniform(0.6, 1.4) for _ in range(parts)]
    weight_sum = sum(weights)
    pieces = [round(total * (w / weight_sum), 2) for w in weights[:-1]]
    pieces.append(round(total - sum(pieces), 2))
    return pieces


# ---------------------------------------------------------------------------
# DESCRIPTION POOLS
# ---------------------------------------------------------------------------
VENDOR_NAMES = [
    "Acme Supply Co", "Northwind Logistics", "Cascade Manufacturing", "Summit Office Solutions",
    "Meridian Freight Systems", "Union Business Services", "Pioneer Equipment Rentals",
    "Harborline Industrial Supply", "Redstone Facilities Group", "Vantage Point Consulting",
    "City Power & Light", "Sterling Insurance Group", "Brightpath Telecom", "Granite Peak Leasing",
    "Ironwood Building Services",
]
CUSTOMER_NAMES = [
    "Smith Industries", "Johnson & Co", "Whitmore Holdings", "Fairview Retail Group",
    "Harper Logistics", "Delacroix Manufacturing", "Bluepeak Retail", "Global Traders LLC",
    "Lakeshore Distributors", "Ashford Consumer Goods", "Riverton Wholesale", "Crestline Partners",
    "Overlook Commercial Group", "Silverton Enterprises", "Whitfield & Sons",
]

# (GL description template, corresponding bank clearing text, reference prefix)
# — the bank's wording is deliberately terser/different from the GL
# description, as in real bank feeds. The prefix is tied to the template so a
# row's reference number always matches its transaction type (e.g. a "Wire
# Receipt" row always gets a WIRE-* reference, never DEP-* or ACH-*).
DEPOSIT_DESCRIPTIONS = [
    ("Customer Check Deposit - {n}", "DEPOSIT - LOCKBOX SETTLEMENT", "DEP"),
    ("Customer ACH Receipt - {n}", "ACH CREDIT - CUSTOMER PMT", "ACH"),
    ("Customer Wire Receipt - {n}", "WIRE TRANSFER IN", "WIRE"),
    ("Lockbox Settlement - {n}", "DEPOSIT - LOCKBOX SETTLEMENT", "DEP"),
]
WITHDRAWAL_DESCRIPTIONS = [
    ("Vendor Invoice Payment - {n}", "ACH DEBIT - VENDOR PAYMENT", "ACH"),
    ("Payroll ACH - Biweekly", "ACH DEBIT - PAYROLL", "ACH"),
    ("Rent Expense - Corporate HQ", "ACH DEBIT - RENT", "ACH"),
    ("Utility Payment - {n}", "ACH DEBIT - UTILITY PMT", "ACH"),
    ("Insurance Premium Payment - {n}", "ACH DEBIT - INSURANCE", "ACH"),
    ("Equipment Lease Payment - {n}", "ACH DEBIT - LEASE PMT", "ACH"),
    ("Vendor Check Payment - {n}", "CHECK PAID", "CHK"),
]

# ---------------------------------------------------------------------------
# ROW BUILDERS
# ---------------------------------------------------------------------------
gl_rows = []
bank_rows = []
_matched_deposit_pool = []  # (ref, amount) of perfect-match deposits, for Chargeback


def add_gl(tdate, docnum, desc, amount, kind, check_number="", post_date=None):
    """Append one row to gl_rows. `docnum` is the reconciliation reference —
    pass the same value to add_bank() to create a matched pair.
    kind: 'DR' (debit) or 'CR' (credit)."""
    gl_rows.append(
        {
            "transaction_id": next(gl_ids),
            "transaction_date": tdate.strftime("%Y-%m-%d"),
            "post_date": (post_date or post_date_for(tdate)).strftime("%Y-%m-%d"),
            "document_number": docnum,
            "check_number": check_number,
            "description": desc,
            "debit_amount": amount if kind == "DR" else np.nan,
            "credit_amount": amount if kind == "CR" else np.nan,
            "balance_impact": kind,
        }
    )
    return gl_rows[-1]


def add_bank(vdate, ref, text, amount, kind, check_number=""):
    """Append one row to bank_rows. `ref` is the reconciliation reference —
    pass the same value used in the corresponding add_gl() call to create a
    matched pair; leave it File-B-only for bank-only scenarios.
    kind: 'DEP' (deposit) or 'WD' (withdrawal)."""
    bank_rows.append(
        {
            "bank_statement_id": next(bank_ids),
            "value_date": vdate.strftime("%Y-%m-%d"),
            "bank_reference": ref,
            "check_number": check_number,
            "transaction_text": text,
            "deposit_amount": amount if kind == "DEP" else np.nan,
            "withdrawal_amount": amount if kind == "WD" else np.nan,
        }
    )
    return bank_rows[-1]


def add_matched_pair(tdate, amount, deposit=True, ref_prefix=None):
    """Convenience: one GL row + one matching bank row, same ref/date/amount.

    GL kind follows the app's own column-alias convention (debit=outflow,
    credit=inflow — see the `debit`/`credit` alias lists in
    packages/config/src/default-config.ts, which map 'debit' to
    'withdrawal'/'money out' and 'credit' to 'deposit'/'money in' for BOTH
    sources uniformly), not strict T-account GAAP directionality. A deposit
    is an inflow on both sides, so GL uses "CR" here, matching bank's "DEP";
    a withdrawal is an outflow on both sides, so GL uses "DR", matching
    bank's "WD". Using the opposite (GAAP cash-account) convention makes the
    GL and bank amounts land on opposite signs for the same event, which is
    exactly the bug this comment is here to prevent reintroducing.
    """
    if deposit:
        gl_tmpl, bank_text, prefix = random.choice(DEPOSIT_DESCRIPTIONS)
        name = random.choice(CUSTOMER_NAMES)
        ref = next_ref(ref_prefix or prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), amount, "CR")
        add_bank(tdate, ref, bank_text, amount, "DEP")
    else:
        gl_tmpl, bank_text, prefix = random.choice(WITHDRAWAL_DESCRIPTIONS)
        name = random.choice(VENDOR_NAMES)
        ref = next_ref(ref_prefix or prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), amount, "DR")
        add_bank(tdate, ref, bank_text, amount, "WD")
    return ref


# ---------------------------------------------------------------------------
# 1. PERFECT MATCHES — Exact Match. Same date, amount, and reference.
# ---------------------------------------------------------------------------
for _ in range(N_PERFECT_MATCH):
    tdate = random_date()
    amount = random_amount()
    is_deposit = random.random() < 0.5
    ref = add_matched_pair(tdate, amount, deposit=is_deposit)
    if is_deposit and len(_matched_deposit_pool) < 200:
        _matched_deposit_pool.append((ref, amount, tdate))

# ---------------------------------------------------------------------------
# 2. DEPOSITS IN TRANSIT — DepositInTransit. File A only, late in the month.
# ---------------------------------------------------------------------------
for _ in range(N_DEPOSITS_IN_TRANSIT):
    tdate = random_date(LAST_DAYS)
    amount = random_amount()
    name = random.choice(CUSTOMER_NAMES)
    ref = next_ref(random.choice(["DEP", "ACH", "WIRE"]))
    desc = random.choice(
        ["Customer Check Deposit - {n}", "Customer ACH Receipt - {n}", "Lockbox Settlement - {n}"]
    ).format(n=name)
    add_gl(tdate, ref, desc, amount, "CR")  # inflow, no bank counterpart yet

# ---------------------------------------------------------------------------
# 3. OUTSTANDING CHECKS — OutstandingCheck. File A only, outflow, uncashed.
#    check_number is populated so isCheckLikeQboTransaction matches on the
#    dedicated field (its primary signal) as well as the description fallback.
# ---------------------------------------------------------------------------
for _ in range(N_OUTSTANDING_CHECKS):
    tdate = biased_late_date()
    amount = random_amount()
    name = random.choice(VENDOR_NAMES)
    ref = next_ref("CHK")
    add_gl(tdate, ref, f"Vendor Check Payment - {name}", amount, "DR", check_number=next_check_number())

# ---------------------------------------------------------------------------
# 3b. STALE OUTSTANDING CHECKS — StaleOutstandingCheck. File A only, 45+ days
#     older than the reconciliation anchor (dated in August against an
#     October anchor date).
# ---------------------------------------------------------------------------
for _ in range(N_STALE_OUTSTANDING_CHECKS):
    tdate = random_date(STALE_BUSINESS_DAYS)
    amount = random_amount()
    name = random.choice(VENDOR_NAMES)
    ref = next_ref("CHK")
    add_gl(
        tdate, ref, f"Vendor Check Payment - {name}", amount, "DR",
        check_number=next_check_number(), post_date=tdate + timedelta(days=1),
    )

# ---------------------------------------------------------------------------
# 4. BANK-ONLY TRANSACTIONS — File B only.
# ---------------------------------------------------------------------------
for _ in range(N_SERVICE_CHARGE):
    vdate = random_date()
    amount = random_amount(low=10, high=75, mode=25)
    ref = next_ref("MISC")
    text = random.choice(
        ["MISC DEBIT - MONTHLY SERVICE CHARGE", "MISC DEBIT - ACCOUNT MAINTENANCE FEE", "MISC DEBIT - WIRE SERVICE FEE"]
    )
    add_bank(vdate, ref, text, amount, "WD")

# InterestIncome
for _ in range(N_INTEREST):
    vdate = random_date()
    amount = random_amount(low=5, high=250, mode=40)
    ref = next_ref("MISC")
    add_bank(vdate, ref, "INTEREST EARNED - CREDIT", amount, "DEP")

# NSFReturnedDeposit
for _ in range(N_NSF):
    vdate = random_date()
    amount = random_amount(low=50, high=3000, mode=400)
    ref = next_ref("MISC")
    add_bank(vdate, ref, "RETURNED ITEM - NSF CHECK", amount, "WD")

# ---------------------------------------------------------------------------
# 5. AMOUNT MISMATCHES — AmountMismatch. Same reference both files, transposed
#    amount. Detected via the reference-similarity path (engine.ts), so the
#    deliberately different bank/GL wording doesn't block it.
# ---------------------------------------------------------------------------
for _ in range(N_MISMATCH):
    tdate = random_date()
    base_amount = random_amount()
    error_amount = transpose_amount(base_amount)
    gl_amount, bank_amount = (
        (base_amount, error_amount) if random.random() < 0.5 else (error_amount, base_amount)
    )
    if random.random() < 0.5:
        gl_tmpl, bank_text, ref_prefix = random.choice(DEPOSIT_DESCRIPTIONS)
        name = random.choice(CUSTOMER_NAMES)
        ref = next_ref(ref_prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), gl_amount, "CR")
        add_bank(tdate, ref, bank_text, bank_amount, "DEP")
    else:
        gl_tmpl, bank_text, ref_prefix = random.choice(WITHDRAWAL_DESCRIPTIONS)
        name = random.choice(VENDOR_NAMES)
        ref = next_ref(ref_prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), gl_amount, "DR")
        add_bank(tdate, ref, bank_text, bank_amount, "WD")

# ---------------------------------------------------------------------------
# 6. DATE VARIANCE — DateVariance. Same NON-distinctive amount (reused from
#    the perfect-match pool so it occurs more than once), matching reference,
#    dated 6-21 days apart (outside the primary 5-day tolerance, inside the
#    21-day extended window).
# ---------------------------------------------------------------------------
for _ in range(N_DATE_VARIANCE):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(DATE_TOLERANCE_DAYS + 1, TIMING_DIFFERENCE_DAYS))
    amount = round(random.choice([49.99, 99.5, 125.0, 250.0, 500.0]), 2)  # reused across pairs -> non-distinctive
    if random.random() < 0.5:
        gl_tmpl, bank_text, ref_prefix = random.choice(DEPOSIT_DESCRIPTIONS)
        name = random.choice(CUSTOMER_NAMES)
        ref = next_ref(ref_prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), amount, "CR")
        add_bank(bank_date, next_ref("MISC"), bank_text, amount, "DEP")
    else:
        gl_tmpl, bank_text, ref_prefix = random.choice(WITHDRAWAL_DESCRIPTIONS)
        name = random.choice(VENDOR_NAMES)
        ref = next_ref(ref_prefix)
        add_gl(tdate, ref, gl_tmpl.format(n=name), amount, "DR")
        add_bank(bank_date, next_ref("MISC"), bank_text, amount, "WD")

# ---------------------------------------------------------------------------
# 7. TIMING DIFFERENCE — TimingDifference. Same DISTINCTIVE amount (unique
#    across the whole dataset), weak reference match, dated 6-21 days apart.
# ---------------------------------------------------------------------------
for _ in range(N_TIMING_DIFFERENCE):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(DATE_TOLERANCE_DAYS + 1, TIMING_DIFFERENCE_DAYS))
    amount = distinctive_amount()
    if random.random() < 0.5:
        gl_tmpl, bank_text, ref_prefix = random.choice(DEPOSIT_DESCRIPTIONS)
        name = random.choice(CUSTOMER_NAMES)
        add_gl(tdate, next_ref(ref_prefix), gl_tmpl.format(n=name), amount, "CR")
        add_bank(bank_date, next_ref("MISC"), bank_text, amount, "DEP")
    else:
        gl_tmpl, bank_text, ref_prefix = random.choice(WITHDRAWAL_DESCRIPTIONS)
        name = random.choice(VENDOR_NAMES)
        add_gl(tdate, next_ref(ref_prefix), gl_tmpl.format(n=name), amount, "DR")
        add_bank(bank_date, next_ref("MISC"), bank_text, amount, "WD")

# ---------------------------------------------------------------------------
# 8. LIKELY MISCODING — LikelyMiscoding. Same DISTINCTIVE amount, close date
#    (within the primary 5-day window), but conflicting reference AND
#    narrative — looks like the same event booked to the wrong context.
# ---------------------------------------------------------------------------
for _ in range(N_LIKELY_MISCODING):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS))
    amount = distinctive_amount()
    # GL and bank kind must agree on direction (both inflow or both outflow) — the whole point
    # of this scenario is a same-amount, same-direction event with conflicting *context*, not a
    # sign mismatch (that's AmountMismatch's job).
    is_inflow = random.random() < 0.5
    gl_kind = "CR" if is_inflow else "DR"
    bank_kind = "DEP" if is_inflow else "WD"
    bank_text = "MISC CREDIT - UNIDENTIFIED ITEM" if is_inflow else "MISC DEBIT - UNIDENTIFIED ITEM"
    add_gl(tdate, next_ref("JE"), "Reclassification Entry - Journal Entry", amount, gl_kind)
    add_bank(bank_date, next_ref("MISC"), bank_text, amount, bank_kind)

# ---------------------------------------------------------------------------
# 9. REFERENCE NUMBER MISMATCH — ReferenceNumberMismatch. Same amount, close
#    date, strongly matching narrative, but the reference numbers don't
#    align (a clerical transposition on one side).
# ---------------------------------------------------------------------------
for _ in range(N_REFERENCE_MISMATCH):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS))
    amount = random_amount()
    gl_tmpl, bank_text, ref_prefix = random.choice(WITHDRAWAL_DESCRIPTIONS)
    name = random.choice(VENDOR_NAMES)
    gl_ref = next_ref(ref_prefix)
    bank_ref = next_ref(ref_prefix)  # different sequential ref -> low reference similarity
    add_gl(tdate, gl_ref, gl_tmpl.format(n=name), amount, "DR")
    add_bank(bank_date, bank_ref, bank_text, amount, "WD")

# ---------------------------------------------------------------------------
# 10. CHECK NUMBER MISMATCH — CheckNumberMismatch. Same check number on both
#     sides; either the amount is off (posting error) or the date variance
#     exceeds the primary window — both are handled by the engine's
#     checkNumber-specific branch.
# ---------------------------------------------------------------------------
for _ in range(N_CHECK_NUMBER_MISMATCH // 2):
    tdate = random_date()
    check_no = next_check_number()
    ref = next_ref("CHK")
    name = random.choice(VENDOR_NAMES)
    base_amount = random_amount()
    error_amount = transpose_amount(base_amount)
    add_gl(tdate, ref, f"Vendor Check Payment - {name}", base_amount, "DR", check_number=check_no)
    add_bank(tdate, ref, "CHECK PAID", error_amount, "WD", check_number=check_no)

for _ in range(N_CHECK_NUMBER_MISMATCH - N_CHECK_NUMBER_MISMATCH // 2):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(DATE_TOLERANCE_DAYS + 1, TIMING_DIFFERENCE_DAYS))
    check_no = next_check_number()
    ref = next_ref("CHK")
    name = random.choice(VENDOR_NAMES)
    amount = random_amount()
    add_gl(tdate, ref, f"Vendor Check Payment - {name}", amount, "DR", check_number=check_no)
    add_bank(bank_date, ref, "CHECK PAID", amount, "WD", check_number=check_no)

# ---------------------------------------------------------------------------
# 11. DESCRIPTION / MERCHANT VARIANCE — DescriptionMerchantVariance. Same
#     amount and close date, but narrative similarity lands in the
#     "materially different, still plausibly related" band rather than a
#     confident match — modeled with a vague, low-signal bank description.
# ---------------------------------------------------------------------------
for _ in range(N_DESCRIPTION_VARIANCE):
    tdate = random_date()
    bank_date = offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS))
    amount = random_amount()
    name = random.choice(VENDOR_NAMES)
    ref = next_ref("MISC")
    add_gl(tdate, ref, f"Vendor Invoice Payment - {name}", amount, "DR")
    add_bank(bank_date, next_ref("MISC"), "MISC DEBIT - MERCHANT SETTLEMENT", amount, "WD")

# ---------------------------------------------------------------------------
# 12. DUPLICATES — DuplicateInBank / DuplicateInQBO. An accidental same-side
#     double-post: identical amount and description, dated within the
#     3-day duplicate window, with no counterpart on the other side.
# ---------------------------------------------------------------------------
for _ in range(N_DUPLICATE_BANK):
    tdate = random_date()
    amount = random_amount()
    text = random.choice(["MISC DEBIT - CARD TRANSACTION FEE", "ACH DEBIT - MISC VENDOR"])
    add_bank(tdate, next_ref("MISC"), text, amount, "WD")
    add_bank(offset_business_day(tdate, random.randint(0, DUPLICATE_DATE_WINDOW_DAYS)), next_ref("MISC"), text, amount, "WD")

for _ in range(N_DUPLICATE_GL):
    tdate = random_date()
    amount = random_amount()
    desc = "Book Adjustment - Journal Entry"
    add_gl(tdate, next_ref("JE"), desc, amount, "DR")
    add_gl(offset_business_day(tdate, random.randint(0, DUPLICATE_DATE_WINDOW_DAYS)), next_ref("JE"), desc, amount, "DR")

# ---------------------------------------------------------------------------
# 13. INTERCOMPANY MISMATCH — IntercompanyMismatch. One-sided, keyword-driven.
# ---------------------------------------------------------------------------
for _ in range(N_INTERCOMPANY):
    vdate = random_date()
    amount = random_amount(low=500, high=15000)
    add_bank(vdate, next_ref("ICO"), "ACH DEBIT - DUE TO AFFILIATE", amount, "WD")

for _ in range(N_INTERCOMPANY):
    tdate = random_date()
    amount = random_amount(low=500, high=15000)
    add_gl(tdate, next_ref("ICO"), "Intercompany Transfer - Due From Subsidiary", amount, "DR")

# ---------------------------------------------------------------------------
# 14. INVALID OR MISSING DATA — InvalidOrMissingData. Malformed/blank
#     critical fields (amount or date), split across both files.
# ---------------------------------------------------------------------------
for _ in range(N_INVALID_DATA // 3):
    tdate = random_date()
    add_gl(tdate, next_ref("JE"), "Reclassification Entry - Journal Entry", np.nan, "DR")

for _ in range(N_INVALID_DATA // 3):
    vdate = random_date()
    add_bank(vdate, next_ref("MISC"), "MISC DEBIT - CARD TRANSACTION FEE", 0.0, "WD")

for _ in range(N_INVALID_DATA - 2 * (N_INVALID_DATA // 3)):
    tdate = random_date()
    row = add_gl(tdate, next_ref("JE"), "Accrual Reversal - Journal Entry", random_amount(), "CR")
    row["transaction_date"] = ""  # missing date -> dataQualityIssues

# ---------------------------------------------------------------------------
# 15. AMBIGUOUS MATCH REQUIRING REVIEW — AmbiguousMatchRequiringReview. One
#     bank transaction with two equally-plausible GL candidates (same amount,
#     similar-but-not-identical description, close dates, weak reference).
# ---------------------------------------------------------------------------
for _ in range(N_AMBIGUOUS):
    tdate = random_date()
    amount = random_amount()
    name = random.choice(VENDOR_NAMES)
    add_bank(tdate, next_ref("MISC"), "ACH DEBIT - MISC VENDOR", amount, "WD")
    for _dup in range(2):
        add_gl(
            offset_business_day(tdate, random.randint(0, 2)),
            next_ref("JE"),
            f"Vendor Invoice Payment - {name}",
            amount,
            "DR",
        )

# ---------------------------------------------------------------------------
# 16. ACH RETURN — ACHReturn. Bank-only debit + credit netting to zero within
#     the 7-day reversal window, carrying an ACH-return keyword.
# ---------------------------------------------------------------------------
for _ in range(N_ACH_RETURN):
    vdate = random_date()
    amount = random_amount(low=100, high=5000)
    add_bank(vdate, next_ref("MISC"), "ACH DEBIT - VENDOR PAYMENT", amount, "WD")
    add_bank(
        offset_business_day(vdate, random.randint(1, REVERSAL_WINDOW_DAYS)),
        next_ref("MISC"),
        "ACH RETURN R01 - INSUFFICIENT FUNDS",
        amount,
        "DEP",
    )

# ---------------------------------------------------------------------------
# 17. REVERSAL / VOID — ReversalVoid. Bank-only debit + credit netting to
#     zero within the reversal window, with similar (but not ACH-return)
#     narrative — a plain reversal rather than a returned item.
# ---------------------------------------------------------------------------
for _ in range(N_REVERSAL_VOID):
    vdate = random_date()
    amount = random_amount(low=100, high=5000)
    add_bank(vdate, next_ref("MISC"), "MISC DEBIT - CORRECTION ENTRY", amount, "WD")
    add_bank(
        offset_business_day(vdate, random.randint(1, REVERSAL_WINDOW_DAYS)),
        next_ref("MISC"),
        "MISC CREDIT - CORRECTION ENTRY",
        amount,
        "DEP",
    )

# ---------------------------------------------------------------------------
# 18. CHARGEBACK RETURN — ChargebackReturn. Bank-only debit with chargeback
#     keywords, whose amount mirrors an already-matched perfect-match
#     deposit from section 1 (so an "already reconciled bank credit" exists
#     for it to offset), within the 120-day chargeback window.
# ---------------------------------------------------------------------------
for _ in range(min(N_CHARGEBACK, len(_matched_deposit_pool))):
    _ref, amount, matched_date = _matched_deposit_pool[_]
    vdate = offset_business_day(matched_date, random.randint(1, 30))
    add_bank(vdate, next_ref("MISC"), "MISC DEBIT - CHARGEBACK RECEIVED", amount, "WD")

# ---------------------------------------------------------------------------
# 19. FEE NETTING MATCH — FeeNettingMatch. 1 bank credit = 1 GL revenue line
#     minus 1 GL fee line (payment-processor style net settlement).
# ---------------------------------------------------------------------------
for _ in range(N_FEE_NETTING):
    tdate = random_date()
    gross = random_amount(low=200, high=8000)
    fee = round(gross * random.uniform(0.02, 0.06), 2)
    net = round(gross - fee, 2)
    name = random.choice(CUSTOMER_NAMES)
    add_bank(tdate, next_ref("MISC"), "DEPOSIT - PROCESSOR SETTLEMENT", net, "DEP")
    add_gl(tdate, next_ref("MISC"), f"Merchant Revenue - {name}", gross, "CR")
    add_gl(tdate, next_ref("MISC"), "Merchant Processing Fee", fee, "DR")

# ---------------------------------------------------------------------------
# 20. PARTIAL PAYMENT MATCH — PartialPaymentMatch. 1 GL payable = 2-3 bank
#     installment debits with similar payee context.
# ---------------------------------------------------------------------------
for _ in range(N_PARTIAL_PAYMENT):
    tdate = random_date()
    total = random_amount(low=1000, high=20000)
    parts = split_amount(total, random.choice([2, 3]))
    name = random.choice(VENDOR_NAMES)
    add_gl(tdate, next_ref("MISC"), f"Vendor Invoice Payment - {name}", total, "DR")
    for i, part in enumerate(parts):
        add_bank(
            offset_business_day(tdate, random.randint(0, 30) * (i + 1)),
            next_ref("MISC"),
            f"ACH DEBIT - INSTALLMENT PMT {name.upper()}",
            part,
            "WD",
        )

# ---------------------------------------------------------------------------
# 21. PAYROLL BATCH MATCH — PayrollBatchMatch. 1 bank payroll debit = 3-5 GL
#     individual payroll expense lines, all within the primary date window.
# ---------------------------------------------------------------------------
for _ in range(N_PAYROLL_BATCH):
    tdate = random_date()
    lines = random.randint(3, 5)
    total = random_amount(low=8000, high=60000)
    parts = split_amount(total, lines)
    add_bank(tdate, next_ref("PAY"), "ACH DEBIT - PAYROLL BATCH ADP", total, "WD")
    for part in parts:
        add_gl(
            offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS - 1)),
            next_ref("PAY"),
            "Payroll Expense - Individual",
            part,
            "DR",
        )

# ---------------------------------------------------------------------------
# 22. BANK SERVICE CHARGE AMORTIZATION — BankServiceChargeAmortization. 1 bank
#     service-charge debit = 2-3 GL fee-expense lines.
# ---------------------------------------------------------------------------
for _ in range(N_SERVICE_CHARGE_AMORTIZATION):
    tdate = random_date()
    lines = random.randint(2, 3)
    total = random_amount(low=50, high=600)
    parts = split_amount(total, lines)
    add_bank(tdate, next_ref("SVC"), "MISC DEBIT - MONTHLY SERVICE CHARGE", total, "WD")
    for part in parts:
        add_gl(
            offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS - 1)),
            next_ref("SVC"),
            "Bank Fee Expense - Allocated",
            part,
            "DR",
        )

# ---------------------------------------------------------------------------
# 23. LOAN PAYMENT SPLIT — LoanPaymentSplit. 1 bank loan-payment debit =
#     principal + interest GL entries for the same obligation.
# ---------------------------------------------------------------------------
for _ in range(N_LOAN_PAYMENT_SPLIT):
    tdate = random_date()
    total = random_amount(low=1500, high=12000)
    interest = round(total * random.uniform(0.15, 0.35), 2)
    principal = round(total - interest, 2)
    add_bank(tdate, next_ref("LOAN"), "ACH DEBIT - LOAN PAYMENT", total, "WD")
    add_gl(
        offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS - 1)),
        next_ref("LOAN"), "Loan Principal Reduction", principal, "DR",
    )
    add_gl(
        offset_business_day(tdate, random.randint(0, DATE_TOLERANCE_DAYS - 1)),
        next_ref("LOAN"), "Loan Interest Expense", interest, "DR",
    )

# ---------------------------------------------------------------------------
# 24. LIKELY SPLIT/COMBINE ISSUE — LikelySplitCombineIssue. Residual grouped
#     mismatch: 2 bank withdrawals balance against 2 GL debits with the same
#     (negative) total — same outflow direction on both sides, as required by
#     buildGroupedResidualCandidate's Math.sign(bankTotal)===Math.sign(qboTotal)
#     check — but no 1:1 pairing resolves cleanly.
# ---------------------------------------------------------------------------
for _ in range(N_SPLIT_COMBINE):
    tdate = random_date()
    total = random_amount(low=500, high=6000)
    parts = split_amount(total, 2)
    name = random.choice(VENDOR_NAMES)
    for part in parts:
        add_bank(tdate, next_ref("MISC"), f"ACH DEBIT - {name.upper()} SPLIT", part, "WD")
    gl_parts = split_amount(total, 2)
    for part in gl_parts:
        add_gl(tdate, next_ref("MISC"), f"Vendor Payment Split - {name}", part, "DR")

# ---------------------------------------------------------------------------
# 25. DEPOSIT GROUPING ISSUE — DepositGroupingIssue. Residual grouped
#     mismatch where every line on both sides is deposit-like (positive):
#     2 bank deposits balance against 2 GL credits with the same total.
# ---------------------------------------------------------------------------
for _ in range(N_DEPOSIT_GROUPING):
    tdate = random_date()
    total = random_amount(low=500, high=6000)
    name = random.choice(CUSTOMER_NAMES)
    for part in split_amount(total, 2):
        add_bank(tdate, next_ref("MISC"), "DEPOSIT - BATCH SETTLEMENT", part, "DEP")
    for part in split_amount(total, 2):
        add_gl(tdate, next_ref("MISC"), f"Lockbox Settlement - {name}", part, "CR")

# ---------------------------------------------------------------------------
# 26. PADDING — one-sided filler so both files land at a similar, realistic
#     size. Not part of any GAAP test category.
# ---------------------------------------------------------------------------
PAD_GL_ONLY = 200
PAD_BANK_ONLY = 200

for _ in range(PAD_GL_ONLY):
    tdate = random_date()
    kind = random.choice(["DR", "CR"])
    amount = random_amount()
    ref = next_ref("JE")
    desc = random.choice(
        [
            "Book Adjustment - Journal Entry",
            "Accrual Reversal - Journal Entry",
            "Reclassification Entry - Journal Entry",
            "Depreciation Adjustment - Journal Entry",
        ]
    )
    add_gl(tdate, ref, desc, amount, kind)

for _ in range(PAD_BANK_ONLY):
    vdate = random_date()
    kind = random.choice(["DEP", "WD"])
    amount = random_amount(low=10, high=2000, mode=150)
    ref = next_ref("MISC")
    if kind == "WD":
        text = random.choice(
            ["MISC DEBIT - CARD TRANSACTION FEE", "MISC DEBIT - ATM WITHDRAWAL", "MISC DEBIT - OVERDRAFT FEE", "ACH DEBIT - MISC VENDOR"]
        )
    else:
        text = random.choice(["MISC CREDIT - MERCHANT DEPOSIT", "ACH CREDIT - MISC RECEIPT", "MISC CREDIT - REFUND"])
    add_bank(vdate, ref, text, amount, kind)

# ---------------------------------------------------------------------------
# ASSEMBLE, VALIDATE, AND WRITE
# ---------------------------------------------------------------------------
gl_df = pd.DataFrame(
    gl_rows,
    columns=[
        "transaction_id", "transaction_date", "post_date", "document_number",
        "check_number", "description", "debit_amount", "credit_amount", "balance_impact",
    ],
)
bank_df = pd.DataFrame(
    bank_rows,
    columns=[
        "bank_statement_id", "value_date", "bank_reference", "check_number",
        "transaction_text", "deposit_amount", "withdrawal_amount",
    ],
)

# Chronological order, like a real ledger/statement export.
gl_df = gl_df.sort_values("transaction_date", kind="stable").reset_index(drop=True)
bank_df = bank_df.sort_values("value_date", kind="stable").reset_index(drop=True)

gl_df["debit_amount"] = gl_df["debit_amount"].round(2)
gl_df["credit_amount"] = gl_df["credit_amount"].round(2)
bank_df["deposit_amount"] = bank_df["deposit_amount"].round(2)
bank_df["withdrawal_amount"] = bank_df["withdrawal_amount"].round(2)

assert gl_df["transaction_id"].is_unique, "Duplicate transaction_id detected"
assert bank_df["bank_statement_id"].is_unique, "Duplicate bank_statement_id detected"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

GL_PATH = OUTPUT_DIR / "company_gl.xlsx"
BANK_PATH = OUTPUT_DIR / "bank_statement.xlsx"

gl_df.to_excel(GL_PATH, index=False, sheet_name="Company_GL")
bank_df.to_excel(BANK_PATH, index=False, sheet_name="Bank_Statement")


def format_currency_columns(path, sheet_name, columns):
    """Apply proper 2-decimal accounting number format to the amount columns."""
    wb = load_workbook(path)
    ws = wb[sheet_name]
    header = [c.value for c in ws[1]]
    col_idxs = [header.index(c) + 1 for c in columns if c in header]
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for idx in col_idxs:
            cell = row[idx - 1]
            if cell.value is not None:
                cell.number_format = "#,##0.00"
    wb.save(path)


format_currency_columns(GL_PATH, "Company_GL", ["debit_amount", "credit_amount"])
format_currency_columns(BANK_PATH, "Bank_Statement", ["deposit_amount", "withdrawal_amount"])

# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------
print("=== Reconciliation Test Dataset Generated ===")
print(f"{GL_PATH}:   {len(gl_df)} rows")
print(f"{BANK_PATH}: {len(bank_df)} rows")
print("-" * 50)
print(f"  Perfect Matches (Exact Match):          {N_PERFECT_MATCH}")
print(f"  Deposits in Transit:                    {N_DEPOSITS_IN_TRANSIT}")
print(f"  Outstanding Checks:                     {N_OUTSTANDING_CHECKS}")
print(f"  Stale Outstanding Checks:                {N_STALE_OUTSTANDING_CHECKS}")
print(f"  Bank-Only (Service/Interest/NSF):        {N_SERVICE_CHARGE}/{N_INTEREST}/{N_NSF}")
print(f"  Amount Mismatches:                       {N_MISMATCH}")
print(f"  Date Variance:                           {N_DATE_VARIANCE}")
print(f"  Timing Difference:                       {N_TIMING_DIFFERENCE}")
print(f"  Likely Miscoding:                        {N_LIKELY_MISCODING}")
print(f"  Reference Number Mismatch:               {N_REFERENCE_MISMATCH}")
print(f"  Check Number Mismatch:                   {N_CHECK_NUMBER_MISMATCH}")
print(f"  Description/Merchant Variance:           {N_DESCRIPTION_VARIANCE}")
print(f"  Duplicates (Bank/GL):                    {N_DUPLICATE_BANK}/{N_DUPLICATE_GL}")
print(f"  Intercompany Mismatch (per side):        {N_INTERCOMPANY}")
print(f"  Invalid or Missing Data:                 {N_INVALID_DATA}")
print(f"  Ambiguous Match Requiring Review:        {N_AMBIGUOUS}")
print(f"  ACH Return:                              {N_ACH_RETURN}")
print(f"  Reversal/Void:                           {N_REVERSAL_VOID}")
print(f"  Chargeback Return:                       {N_CHARGEBACK}")
print(f"  Fee Netting Match:                       {N_FEE_NETTING}")
print(f"  Partial Payment Match:                   {N_PARTIAL_PAYMENT}")
print(f"  Payroll Batch Match:                     {N_PAYROLL_BATCH}")
print(f"  Bank Service Charge Amortization:        {N_SERVICE_CHARGE_AMORTIZATION}")
print(f"  Loan Payment Split:                      {N_LOAN_PAYMENT_SPLIT}")
print(f"  Likely Split/Combine Issue:              {N_SPLIT_COMBINE}")
print(f"  Deposit Grouping Issue:                  {N_DEPOSIT_GROUPING}")
print(f"  Padding (GL-only / Bank-only):           {PAD_GL_ONLY}/{PAD_BANK_ONLY}")
