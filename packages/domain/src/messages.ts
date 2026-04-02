import type { ErrorCategory } from './enums';

export const professionalErrorMessages: Record<ErrorCategory, string> = {
  MissingFromBank:
    'Transaction appears in QuickBooks Online activity but no corresponding bank entry was identified within the permitted date and amount tolerance.',
  MissingFromQBO:
    'Transaction appears in bank activity but no corresponding QBO entry was identified within the permitted date and amount tolerance.',
  AmountMismatch:
    'Likely matched transaction found in both sources; however, recorded amounts differ and require review of original source documentation.',
  DuplicateTransaction:
    'Entry appears duplicated based on same amount, date proximity, and materially similar description.',
  TimingDifference:
    'Transaction likely represents a timing difference between book entry and bank posting rather than a recording error.',
  CheckNumberMismatch:
    'Transactions likely align on amount and date, but check number details do not agree and require validation.',
  ReferenceNumberMismatch:
    'Transactions likely align on amount and date, but reference number details do not agree and require validation.',
  DescriptionMerchantVariance:
    'Transactions appear related but contain materially different merchant, payee, or description wording and should be reviewed.',
  InvalidOrMissingData:
    'Critical matching fields are incomplete, preventing reliable reconciliation.',
  AmbiguousMatchRequiringReview:
    'Multiple plausible counterparts were identified and the system will not force a weak match without reviewer confirmation.',
};
