import type { ErrorCategory } from './enums';

/** Human-readable display label for each exception category used in the UI and workbook export. */
export const errorCategoryDisplayNames: Record<ErrorCategory, string> = {
  MissingFromBank: 'Missing from Bank',
  MissingFromQBO: 'Missing from QBO',
  AmountMismatch: 'Amount Mismatch',
  DuplicateInBank: 'Duplicate in Bank',
  DuplicateInQBO: 'Duplicate in QBO',
  LikelySplitCombineIssue: 'Likely Split/Combine Issue',
  DepositGroupingIssue: 'Deposit Grouping Issue',
  LikelyMiscoding: 'Likely Miscoding',
  DateVariance: 'Date Variance',
  TimingDifference: 'Timing Difference',
  CheckNumberMismatch: 'Check Number Mismatch',
  ReferenceNumberMismatch: 'Reference Number Mismatch',
  DescriptionMerchantVariance: 'Description/Merchant Variance',
  StaleOutstandingCheck: 'Stale Outstanding Check',
  InvalidOrMissingData: 'Invalid or Missing Data',
  AmbiguousMatchRequiringReview: 'Ambiguous Match Requiring Review',
};

/** Full professional explanatory message for each exception category shown in the exception report. */
export const professionalErrorMessages: Record<ErrorCategory, string> = {
  MissingFromBank:
    'Transaction appears in QuickBooks Online activity but no corresponding bank entry was identified within the permitted date and amount tolerance.',
  MissingFromQBO:
    'Transaction appears in bank activity but no corresponding QBO entry was identified within the permitted date and amount tolerance.',
  AmountMismatch:
    'Likely matched transaction found in both sources; however, recorded amounts differ and require review of original source documentation.',
  DuplicateInBank:
    'Bank entry appears duplicated based on same amount, date proximity, and materially similar description.',
  DuplicateInQBO:
    'QBO entry appears duplicated based on same amount, date proximity, and materially similar description.',
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
    'A QBO check or check-like disbursement remains unmatched in bank activity past the stale-date threshold and should be investigated for voiding, reissue, or clearance status.',
  InvalidOrMissingData:
    'Critical matching fields are incomplete, preventing reliable reconciliation.',
  AmbiguousMatchRequiringReview:
    'Multiple plausible counterparts were identified and the system will not force a weak match without reviewer confirmation.',
};

/** Ordered list of recommended next-action steps shown to reviewers for each exception category. */
export const recommendedNextActionsByCategory: Record<ErrorCategory, string[]> = {
  MissingFromBank: [
    'Inspect the bank statement around the transaction date for an omitted, reversed, or delayed posting.',
    'Confirm whether the QBO transaction should be voided, reclassified, or carried as an outstanding item.',
  ],
  MissingFromQBO: [
    'Check whether the bank transaction was recorded to the correct QBO account and period.',
    'Create or correct the QBO entry if source support confirms the bank activity is valid.',
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
    'Review the originating QBO entries and linked source documents for duplicate posting.',
    'Void or reverse the duplicate QBO item once the correct entry is confirmed.',
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
    'Correct the reference in QBO if the transaction is otherwise valid.',
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
  InvalidOrMissingData: [
    'Repair the missing or malformed source fields before relying on automated matching output.',
    'Obtain the original export or source document if the current row cannot be corrected confidently.',
  ],
  AmbiguousMatchRequiringReview: [
    'Compare the candidate counterparts manually and select the correct match before sign-off.',
    'Document the reviewer decision so the final reconciliation trail is explicit.',
  ],
};
