import type { ErrorCategory } from './enums';

/** Human-readable display label for each exception category used in the UI and workbook export. */
export const errorCategoryDisplayNames: Record<ErrorCategory, string> = {
  MissingFromBank: 'Missing from Bank',
  MissingFromQBO: 'Missing from GL',
  AmountMismatch: 'Amount Mismatch',
  DuplicateInBank: 'Duplicate in Bank',
  DuplicateInQBO: 'Duplicate in GL',
  LikelySplitCombineIssue: 'Likely Split/Combine Issue',
  DepositGroupingIssue: 'Deposit Grouping Issue',
  LikelyMiscoding: 'Likely Miscoding',
  DateVariance: 'Date Variance',
  TimingDifference: 'Timing Difference',
  CheckNumberMismatch: 'Check Number Mismatch',
  ReferenceNumberMismatch: 'Reference Number Mismatch',
  DescriptionMerchantVariance: 'Description/Merchant Variance',
  StaleOutstandingCheck: 'Stale Outstanding Check',
  OutstandingCheck: 'Outstanding Check',
  FeeNettingMatch: 'Fee Netting Match',
  PartialPaymentMatch: 'Partial Payment Match',
  PayrollBatchMatch: 'Payroll Batch Match',
  BankServiceChargeAmortization: 'Bank Service Charge (Amortized)',
  LoanPaymentSplit: 'Loan Payment Split',
  NSFReturnedDeposit: 'NSF / Returned Deposit',
  VoidedCheckCleared: 'Voided Check Cleared',
  InvalidOrMissingData: 'Invalid or Missing Data',
  AmbiguousMatchRequiringReview: 'Ambiguous Match Requiring Review',
  ReversalVoid: 'Reversal / Void Pair',
  ACHReturn: 'ACH Return / NSF',
  DepositInTransit: 'Deposit in Transit',
  ChargebackReturn: 'Chargeback / Returned Item',
  InterestIncome: 'Interest Income',
  IntercompanyMismatch: 'Intercompany / Entity Mismatch',
};

/** Full professional explanatory message for each exception category shown in the exception report. */
export const professionalErrorMessages: Record<ErrorCategory, string> = {
  MissingFromBank:
    'Transaction appears in GL activity but no corresponding bank entry was identified within the permitted date and amount tolerance.',
  MissingFromQBO:
    'Transaction appears in bank activity but no corresponding GL entry was identified within the permitted date and amount tolerance.',
  AmountMismatch:
    'Likely matched transaction found in both sources; however, recorded amounts differ and require review of original source documentation.',
  DuplicateInBank:
    'Bank entry appears duplicated based on same amount, date proximity, and materially similar description.',
  DuplicateInQBO:
    'GL entry appears duplicated based on same amount, date proximity, and materially similar description.',
  LikelySplitCombineIssue:
    'Transaction appears to participate in a one-to-many or many-to-one relationship that the current one-to-one matcher cannot resolve automatically.',
  DepositGroupingIssue:
    'Transaction likely belongs to a grouped deposit or batched bank receipt pattern that requires grouped review rather than one-to-one matching.',
  LikelyMiscoding:
    'A same-amount, near-date counterpart exists, but the descriptive or reference context conflicts strongly enough to suggest miscoding rather than a clean match.',
  DateVariance:
    'Transactions likely relate to the same activity, but the recorded dates differ beyond the primary tolerance and should be validated.',
  TimingDifference:
    'Transaction likely represents a timing difference between book entry and bank posting rather than a recording error.',
  CheckNumberMismatch:
    'Transactions likely align on amount and date, but check number details do not agree and require validation.',
  ReferenceNumberMismatch:
    'Transactions likely align on amount and date, but reference number details do not agree and require validation.',
  DescriptionMerchantVariance:
    'Transactions appear related but contain materially different merchant, payee, or description wording and should be reviewed.',
  StaleOutstandingCheck:
    'A GL check or check-like disbursement remains unmatched in bank activity past the stale-date threshold and should be investigated for voiding, reissue, or clearance status.',
  OutstandingCheck:
    'A GL check or check-like disbursement has not yet cleared the bank within the current statement period. This is a normal reconciling item; carry it forward and confirm clearance in the next cycle.',
  FeeNettingMatch:
    'A bank credit matches the net of a GL revenue entry and a fee expense entry, indicating a payment processor or merchant aggregator deducted its fee before remitting. The net amount reconciles correctly; no action is required unless the gross amounts need to be restated.',
  PartialPaymentMatch:
    'Multiple bank debits together equal a single GL disbursement, indicating a single invoice was paid in installments or split across separate bank runs. Review to confirm all installments are accounted for and no partial payment remains outstanding.',
  PayrollBatchMatch:
    'A single bank payroll ACH debit matches the aggregate of multiple GL individual payroll expense entries. This is expected behavior for batch payroll processing; confirm the GL entries cover all employees in the pay run.',
  BankServiceChargeAmortization:
    'A bank service charge is split across multiple GL fee expense lines, indicating the charge was amortized or allocated across account categories. Confirm the GL allocation totals match the bank charge and that all categories are correct.',
  LoanPaymentSplit:
    'A single bank loan payment debit corresponds to multiple GL entries recording principal reduction and interest expense for the same obligation. This is expected for amortizing loans but requires confirmation that the allocations are correct.',
  NSFReturnedDeposit:
    'A bank debit contains indicators of a non-sufficient-funds (NSF) return or returned deposited check. The corresponding customer payment recorded in GL may need to be reversed.',
  VoidedCheckCleared:
    'A bank check debit has no corresponding GL entry. This may indicate the check was voided in GL but still cleared the bank, or it was issued but never recorded. Either scenario requires immediate review.',
  InvalidOrMissingData:
    'Critical matching fields are incomplete, preventing reliable reconciliation.',
  AmbiguousMatchRequiringReview:
    'Multiple plausible counterparts were identified and the system will not force a weak match without reviewer confirmation.',
  ReversalVoid:
    'Bank records show a matched debit and credit that net to zero, indicating a reversal or void. Confirm whether a corresponding GL void entry exists.',
  ACHReturn:
    'An ACH debit was returned by the bank (NSF or other return code). The original GL expense remains unreverted and requires a correcting entry.',
  DepositInTransit:
    'A GL deposit is recorded near the statement period end with no corresponding bank entry, consistent with a deposit in transit that will clear in the next cycle.',
  ChargebackReturn:
    'A bank debit with chargeback or return keywords offsets a previously reconciled bank credit of the same amount. A corresponding GL reversal entry is likely missing.',
  InterestIncome:
    'A bank interest credit has no corresponding GL entry. Interest income earned during the period should be recorded to the appropriate income account.',
  IntercompanyMismatch:
    'Transaction contains intercompany or entity-transfer indicators but has no counterpart in the other source. Confirm whether this belongs to a different entity or account.',
};

/** Ordered list of recommended next-action steps shown to reviewers for each exception category. */
export const recommendedNextActionsByCategory: Record<ErrorCategory, string[]> = {
  MissingFromBank: [
    'Inspect the bank statement around the transaction date for an omitted, reversed, or delayed posting.',
    'Confirm whether the GL transaction should be voided, reclassified, or carried as an outstanding item.',
  ],
  MissingFromQBO: [
    'Check whether the bank transaction was recorded to the correct GL account and period.',
    'Create or correct the GL entry if source support confirms the bank activity is valid.',
  ],
  AmountMismatch: [
    'Compare source documents and settlement detail to determine which amount is authoritative.',
    'Post an adjusting entry or correct the recorded amount after support is confirmed.',
  ],
  DuplicateInBank: [
    'Review bank posting detail to determine whether the item is an actual duplicate or a reversal pattern.',
    'If duplicated, document the bank-side resolution and remove the extra item from reconciliation support.',
  ],
  DuplicateInQBO: [
    'Review the originating GL entries and linked source documents for duplicate posting.',
    'Void or reverse the duplicate GL item once the correct entry is confirmed.',
  ],
  LikelySplitCombineIssue: [
    'Review nearby transactions for one-to-many or many-to-one combinations that sum to the same net activity.',
    'Document the grouped relationship and retain support until grouped matching logic is implemented.',
  ],
  DepositGroupingIssue: [
    'Compare the bank deposit to underlying receipts or batch detail to confirm whether multiple book entries roll into one deposit.',
    'Retain the deposit support package and document the grouped components for reviewer sign-off.',
  ],
  LikelyMiscoding: [
    'Review both source lines to determine whether the transaction was posted to the wrong vendor, customer, or account.',
    'Prepare a reclassification entry if the amount is correct but the accounting context is wrong.',
  ],
  DateVariance: [
    'Verify whether the date difference is an acceptable posting lag or a cut-off issue.',
    'Retain support for the timing if no correction is required.',
  ],
  TimingDifference: [
    'Confirm the item represents a valid clearing or posting delay between book and bank timing.',
    'Carry the item as timing support and monitor it in the next reconciliation cycle.',
  ],
  CheckNumberMismatch: [
    'Compare the original check support and posting details to identify which reference is correct.',
    'Correct the reference in GL if the transaction is otherwise valid.',
  ],
  ReferenceNumberMismatch: [
    'Review supporting documents to determine whether the reference difference is clerical or substantive.',
    'Correct the stored reference value if the transaction is otherwise valid.',
  ],
  DescriptionMerchantVariance: [
    'Review merchant, payee, and memo fields against source support to verify the counterpart relationship.',
    'Add reviewer notes before approving or rejecting the proposed relationship.',
  ],
  StaleOutstandingCheck: [
    'Determine whether the check should be voided, reissued, or left outstanding based on current status.',
    'Update the books and reconciliation support for stale-dated check treatment.',
  ],
  OutstandingCheck: [
    'Verify the check has not been lost, stopped, or returned.',
    'Carry as an outstanding item on the reconciliation support schedule and confirm clearance in the next cycle.',
  ],
  FeeNettingMatch: [
    'Confirm the gross revenue and fee amounts in GL agree with the payment processor remittance detail.',
    'If gross amounts need to be restated, reclassify the fee to a dedicated bank charge account and record the full revenue separately.',
  ],
  PartialPaymentMatch: [
    'Verify all installment bank debits are recorded in GL and that the total equals the invoice amount.',
    'Confirm no remaining balance is outstanding on the original GL payable.',
  ],
  PayrollBatchMatch: [
    'Cross-reference the GL payroll line items against the payroll processor run report to confirm every employee is included.',
    'If any employees are missing from GL, post the correcting entries and rerun the payroll reconciliation.',
  ],
  BankServiceChargeAmortization: [
    'Verify the sum of all GL fee expense lines equals the bank service charge amount.',
    'Confirm each GL line is allocated to the correct account or cost center.',
  ],
  LoanPaymentSplit: [
    'Confirm that the GL principal and interest allocation matches the lender\'s amortization schedule for the period.',
    'Verify the outstanding loan balance on the balance sheet reflects the correct principal reduction.',
  ],
  NSFReturnedDeposit: [
    'Void or reverse the original customer payment in GL to remove the credit from accounts receivable.',
    'Contact the customer to arrange re-payment or reissuance of the returned check.',
  ],
  VoidedCheckCleared: [
    'Verify whether this check number was voided in GL; if so, restore the disbursement entry because the bank honored it.',
    'If the check was never recorded, create the GL expense entry and allocate it to the appropriate account.',
  ],
  InvalidOrMissingData: [
    'Repair the missing or malformed source fields before relying on automated matching output.',
    'Obtain the original export or source document if the current row cannot be corrected confidently.',
  ],
  AmbiguousMatchRequiringReview: [
    'Compare the candidate counterparts manually and select the correct match before sign-off.',
    'Document the reviewer decision so the final reconciliation trail is explicit.',
  ],
  ReversalVoid: [
    'Confirm whether a GL void or reversal entry was posted for the matched bank pair.',
    'If no GL entry exists, post a reversing journal entry and document the bank-side resolution.',
  ],
  ACHReturn: [
    'Verify the ACH return reason code and determine whether to re-submit or write off the expense.',
    'Post a reversal entry in GL to offset the original expense and update cash records.',
  ],
  DepositInTransit: [
    'Confirm the deposit clears in the bank statement for the next reconciliation period.',
    'Carry forward as a deposit-in-transit on the reconciliation support schedule.',
  ],
  ChargebackReturn: [
    'Confirm whether a chargeback reversal entry was recorded in GL to offset the original income.',
    'Post a reversing journal entry in GL if the chargeback has not yet been recorded.',
  ],
  InterestIncome: [
    'Record the interest income in GL to the appropriate interest income account.',
    'Confirm the amount matches the bank statement interest credit and attach the source detail.',
  ],
  IntercompanyMismatch: [
    'Verify whether this transaction belongs to a different legal entity or general ledger file.',
    'If intercompany, record the due-to/due-from entry in both entity files to balance the intercompany accounts.',
  ],
};
