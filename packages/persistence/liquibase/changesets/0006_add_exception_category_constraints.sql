--liquibase formatted sql

--changeset recon:0006-add_exception_category_constraints
ALTER TABLE reconciliation_exception
  ADD CONSTRAINT reconciliation_exception_category_check
  CHECK (category IN ('MissingFromBank', 'MissingFromQBO', 'AmountMismatch', 'DuplicateInBank', 'DuplicateInQBO', 'LikelySplitCombineIssue', 'DepositGroupingIssue', 'LikelyMiscoding', 'DateVariance', 'TimingDifference', 'CheckNumberMismatch', 'ReferenceNumberMismatch', 'DescriptionMerchantVariance', 'StaleOutstandingCheck', 'OutstandingCheck', 'FeeNettingMatch', 'PartialPaymentMatch', 'PayrollBatchMatch', 'BankServiceChargeAmortization', 'LoanPaymentSplit', 'NSFReturnedDeposit', 'VoidedCheckCleared', 'InvalidOrMissingData', 'AmbiguousMatchRequiringReview', 'ReversalVoid', 'ACHReturn', 'DepositInTransit', 'ChargebackReturn', 'InterestIncome', 'IntercompanyMismatch'));

ALTER TABLE reconciliation_match_result
  ADD CONSTRAINT reconciliation_match_result_exception_category_check
  CHECK (exception_category IS NULL OR exception_category IN ('MissingFromBank', 'MissingFromQBO', 'AmountMismatch', 'DuplicateInBank', 'DuplicateInQBO', 'LikelySplitCombineIssue', 'DepositGroupingIssue', 'LikelyMiscoding', 'DateVariance', 'TimingDifference', 'CheckNumberMismatch', 'ReferenceNumberMismatch', 'DescriptionMerchantVariance', 'StaleOutstandingCheck', 'OutstandingCheck', 'FeeNettingMatch', 'PartialPaymentMatch', 'PayrollBatchMatch', 'BankServiceChargeAmortization', 'LoanPaymentSplit', 'NSFReturnedDeposit', 'VoidedCheckCleared', 'InvalidOrMissingData', 'AmbiguousMatchRequiringReview', 'ReversalVoid', 'ACHReturn', 'DepositInTransit', 'ChargebackReturn', 'InterestIncome', 'IntercompanyMismatch'));

--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT IF EXISTS reconciliation_match_result_exception_category_check;
--rollback ALTER TABLE reconciliation_exception DROP CONSTRAINT IF EXISTS reconciliation_exception_category_check;
