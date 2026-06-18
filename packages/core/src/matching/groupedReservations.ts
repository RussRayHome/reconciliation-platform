import type { MatchingConfig, NormalizedTransaction } from '@recon/domain';

import { currencyEquals, dateDifferenceDays, tokenSimilarity } from './similarity';

/** A proposed many-to-many grouped match candidate with its constituent bank and QBO transactions. */
export interface GroupedReservationCandidate {
  category: 'DepositGroupingIssue' | 'LikelySplitCombineIssue' | 'FeeNettingMatch' | 'PartialPaymentMatch' | 'PayrollBatchMatch' | 'BankServiceChargeAmortization' | 'LoanPaymentSplit';
  ruleId: 'grouped-deposit-reserved' | 'grouped-split-combine-reserved' | 'fee-netting-reserved' | 'partial-payment-reserved' | 'payroll-batch-reserved' | 'bank-service-charge-reserved' | 'loan-payment-split-reserved';
  ruleName: 'Grouped Deposit Candidate' | 'Grouped Split/Combine Candidate' | 'Fee Netting Candidate' | 'Partial Payment Candidate' | 'Payroll Batch Candidate' | 'Bank Service Charge Candidate' | 'Loan Payment Split Candidate';
  reason: string;
  evidence: string[];
  dateDifferenceDays: number | null;
  bankTransactions: Array<NormalizedTransaction & { amount: number }>;
  qboTransactions: Array<NormalizedTransaction & { amount: number }>;
  bankTransactionIds: string[];
  qboTransactionIds: string[];
  score: number;
}

const normalizeTransactionType = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const inferTransactionKind = (
  transaction: NormalizedTransaction,
): 'deposit' | 'withdrawal' | 'transfer' | 'journal' | 'check' | 'unknown' => {
  const transactionType = normalizeTransactionType(transaction.transactionType);
  const description = normalizeTransactionType(transaction.description);

  if (transaction.checkNumber || transaction.serialNumber || transactionType.includes('check')) {
    return 'check';
  }

  if (transactionType.includes('journal')) {
    return 'journal';
  }

  if (
    transactionType.includes('transfer') ||
    description.includes('transfer') ||
    description.includes('online from')
  ) {
    return 'transfer';
  }

  if ((transaction.amount ?? 0) > 0 || transactionType.includes('deposit')) {
    return 'deposit';
  }

  if ((transaction.amount ?? 0) < 0 || transactionType.includes('expense') || transactionType.includes('payment')) {
    return 'withdrawal';
  }

  return 'unknown';
};

const areTimingKindsCompatible = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
): boolean => {
  const bankKind = inferTransactionKind(bankTransaction);
  const qboKind = inferTransactionKind(qboTransaction);

  if (bankKind === 'unknown' || qboKind === 'unknown') {
    return true;
  }

  if (bankKind === qboKind) {
    return true;
  }

  return (bankKind === 'transfer' && qboKind === 'journal') || (bankKind === 'deposit' && qboKind === 'transfer');
};

const areGroupedTransactionsCompatible = (
  anchorTransactions: NormalizedTransaction[],
  counterpartTransactions: NormalizedTransaction[],
): boolean =>
  anchorTransactions.every((anchorTransaction) =>
    counterpartTransactions.every((counterpartTransaction) =>
      areTimingKindsCompatible(anchorTransaction, counterpartTransaction),
    ),
  );

const sumTransactionAmounts = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): number => transactions.reduce((total, transaction) => total + transaction.amount, 0);

const formatKinds = (transactions: NormalizedTransaction[]): string =>
  [...new Set(transactions.map((transaction) => inferTransactionKind(transaction)))].join(', ');

const describeTransactionGroup = (transactions: Array<NormalizedTransaction & { amount: number }>): string =>
  transactions
    .map(
      (transaction) =>
        `${transaction.spreadsheetFileName}:L${transaction.lineNumber}:${transaction.amount.toFixed(2)}`,
    )
    .join('; ');

const generateTransactionCombinations = <T>(
  transactions: T[],
  minimumSize: number,
  maximumSize: number,
): T[][] => {
  const combinations: T[][] = [];

  const visit = (startIndex: number, current: T[]): void => {
    if (current.length >= minimumSize) {
      combinations.push([...current]);
    }

    if (current.length === maximumSize) {
      return;
    }

    for (let index = startIndex; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      if (!transaction) {
        continue;
      }

      current.push(transaction);
      visit(index + 1, current);
      current.pop();
    }
  };

  visit(0, []);
  return combinations;
};

const calculateGroupedDateDifference = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
): number | null => {
  let maxDifference: number | null = null;

  for (const bankTransaction of bankTransactions) {
    for (const qboTransaction of qboTransactions) {
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        qboTransaction.transactionDate ?? qboTransaction.postingDate,
      );

      if (dateDifference === null) {
        return null;
      }

      maxDifference = maxDifference === null ? dateDifference : Math.max(maxDifference, dateDifference);
    }
  }

  return maxDifference;
};

const buildGroupedReservationCandidate = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  qboTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): GroupedReservationCandidate | undefined => {
  if (!bankTransactions.length || !qboTransactions.length) {
    return undefined;
  }

  if (bankTransactions.length === 1 && qboTransactions.length === 1) {
    return undefined;
  }

  const bankTotal = sumTransactionAmounts(bankTransactions);
  const qboTotal = sumTransactionAmounts(qboTransactions);

  if (!currencyEquals(bankTotal, qboTotal, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTotal) !== Math.sign(qboTotal)) {
    return undefined;
  }

  if (!areGroupedTransactionsCompatible(bankTransactions, qboTransactions)) {
    return undefined;
  }

  const dateDifference = calculateGroupedDateDifference(bankTransactions, qboTransactions);
  if (dateDifference === null || dateDifference > matching.timingDifferenceDays) {
    return undefined;
  }

  const bankKinds = formatKinds(bankTransactions);
  const qboKinds = formatKinds(qboTransactions);
  const category = bankTotal > 0 && qboTotal > 0 ? 'DepositGroupingIssue' : 'LikelySplitCombineIssue';

  return {
    category,
    ruleId: category === 'DepositGroupingIssue' ? 'grouped-deposit-reserved' : 'grouped-split-combine-reserved',
    ruleName:
      category === 'DepositGroupingIssue'
        ? 'Grouped Deposit Candidate'
        : 'Grouped Split/Combine Candidate',
    reason:
      category === 'DepositGroupingIssue'
        ? 'A balanced grouped deposit candidate was reserved before one-to-one review matching.'
        : 'A balanced grouped split/combine candidate was reserved before one-to-one review matching.',
    evidence: [
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); QBO total is ${qboTotal.toFixed(2)} across ${qboTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and qbo=${qboKinds}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `QBO members: ${describeTransactionGroup(qboTransactions)}.`,
    ],
    dateDifferenceDays: dateDifference,
    bankTransactions,
    qboTransactions,
    bankTransactionIds: bankTransactions.map((transaction) => transaction.id),
    qboTransactionIds: qboTransactions.map((transaction) => transaction.id),
    score: 100 - dateDifference * 2 - (bankTransactions.length + qboTransactions.length),
  };
};

const collectGroupedCounterpartPool = (
  anchorTransaction: NormalizedTransaction & { amount: number },
  counterpartTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): Array<NormalizedTransaction & { amount: number }> =>
  counterpartTransactions
    .filter((counterpartTransaction) => {
      if (Math.sign(counterpartTransaction.amount) !== Math.sign(anchorTransaction.amount)) {
        return false;
      }

      if (Math.abs(counterpartTransaction.amount) > Math.abs(anchorTransaction.amount) + matching.amountTolerance) {
        return false;
      }

      return areGroupedTransactionsCompatible([anchorTransaction], [counterpartTransaction]);
    })
    .sort((left, right) => {
      const leftDateDifference =
        dateDifferenceDays(
          anchorTransaction.transactionDate ?? anchorTransaction.postingDate,
          left.transactionDate ?? left.postingDate,
        ) ?? Number.MAX_SAFE_INTEGER;
      const rightDateDifference =
        dateDifferenceDays(
          anchorTransaction.transactionDate ?? anchorTransaction.postingDate,
          right.transactionDate ?? right.postingDate,
        ) ?? Number.MAX_SAFE_INTEGER;

      if (leftDateDifference !== rightDateDifference) {
        return leftDateDifference - rightDateDifference;
      }

      return Math.abs(anchorTransaction.amount - left.amount) - Math.abs(anchorTransaction.amount - right.amount);
    })
    .slice(0, matching.groupedCandidatePoolSize);

const findGroupedReservationCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );
  const qboResiduals = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, qboResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, matching.groupedMatchMaxSize);

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate([bankTransaction], combination, matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const qboTransaction of qboResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(qboTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, matching.groupedMatchMaxSize);

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate(combination, [qboTransaction], matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const buildFeeNettingCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const bankCredits = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount > 0,
  );
  const qboWithAmount = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );

  for (const bankCredit of bankCredits) {
    const bankDate = bankCredit.transactionDate ?? bankCredit.postingDate;

    for (let i = 0; i < qboWithAmount.length; i += 1) {
      const qboRevenue = qboWithAmount[i];
      if (!qboRevenue || qboRevenue.amount <= 0) {
        continue;
      }

      for (let j = i + 1; j < qboWithAmount.length; j += 1) {
        const qboFee = qboWithAmount[j];
        if (!qboFee || qboFee.amount >= 0) {
          continue;
        }

        const netAmount = qboRevenue.amount + qboFee.amount;
        if (!currencyEquals(bankCredit.amount, netAmount, matching.amountTolerance)) {
          continue;
        }

        const revenueDate = qboRevenue.transactionDate ?? qboRevenue.postingDate;
        const feeDate = qboFee.transactionDate ?? qboFee.postingDate;
        const diffRevenue = dateDifferenceDays(bankDate, revenueDate);
        const diffFee = dateDifferenceDays(bankDate, feeDate);

        if (
          diffRevenue === null ||
          diffFee === null ||
          diffRevenue > matching.timingDifferenceDays ||
          diffFee > matching.timingDifferenceDays
        ) {
          continue;
        }

        const maxDateDiff = Math.max(diffRevenue, diffFee);

        candidates.push({
          category: 'FeeNettingMatch',
          ruleId: 'fee-netting-reserved',
          ruleName: 'Fee Netting Candidate',
          reason:
            'A bank credit matches the net of a QBO revenue entry minus a fee expense, indicating a fee-netted payout.',
          evidence: [
            `Bank credit of ${bankCredit.amount.toFixed(2)} matches QBO revenue ${qboRevenue.amount.toFixed(2)} + fee ${qboFee.amount.toFixed(2)} = ${netAmount.toFixed(2)}.`,
            `Maximum cross-source date difference is ${maxDateDiff} day(s).`,
            `Bank: ${bankCredit.spreadsheetFileName}:L${bankCredit.lineNumber}; QBO revenue: ${qboRevenue.spreadsheetFileName}:L${qboRevenue.lineNumber}; QBO fee: ${qboFee.spreadsheetFileName}:L${qboFee.lineNumber}.`,
          ],
          dateDifferenceDays: maxDateDiff,
          bankTransactions: [bankCredit],
          qboTransactions: [qboRevenue, qboFee],
          bankTransactionIds: [bankCredit.id],
          qboTransactionIds: [qboRevenue.id, qboFee.id],
          score: 100 - maxDateDiff * 2,
        });
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const buildPartialPaymentCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const bankDebits = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount < 0,
  );
  const qboDebits = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount < 0,
  );

  for (const qboDebit of qboDebits) {
    const qboDate = qboDebit.transactionDate ?? qboDebit.postingDate;

    const eligibleBankDebits = bankDebits.filter((bankDebit) => {
      const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;
      const diff = dateDifferenceDays(bankDate, qboDate);
      return diff !== null && diff <= matching.partialPaymentWindowDays;
    });

    const combinations = generateTransactionCombinations(eligibleBankDebits, 2, matching.groupedMatchMaxSize);

    for (const combination of combinations) {
      const bankTotal = combination.reduce((sum, tx) => sum + tx.amount, 0);

      if (!currencyEquals(bankTotal, qboDebit.amount, matching.amountTolerance)) {
        continue;
      }

      if (combination.length < 2) {
        continue;
      }

      let pairwiseSimilaritySum = 0;
      let pairCount = 0;
      for (let i = 0; i < combination.length; i += 1) {
        for (let j = i + 1; j < combination.length; j += 1) {
          const left = combination[i];
          const right = combination[j];
          if (!left || !right) {
            continue;
          }
          pairwiseSimilaritySum += tokenSimilarity(
            left.normalizedComparisonTokens,
            right.normalizedComparisonTokens,
          );
          pairCount += 1;
        }
      }

      const avgSimilarity = pairCount > 0 ? pairwiseSimilaritySum / pairCount : 0;
      if (avgSimilarity < 0.5) {
        continue;
      }

      const maxDateDiff = combination.reduce<number>((max, bankDebit) => {
        const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;
        const diff = dateDifferenceDays(bankDate, qboDate) ?? 0;
        return Math.max(max, diff);
      }, 0);

      candidates.push({
        category: 'PartialPaymentMatch',
        ruleId: 'partial-payment-reserved',
        ruleName: 'Partial Payment Candidate',
        reason:
          'Multiple bank debits with similar payee context accumulate to a single QBO payable, indicating partial payments.',
        evidence: [
          `Bank total of ${bankTotal.toFixed(2)} across ${combination.length} payment(s) matches QBO payable of ${qboDebit.amount.toFixed(2)}.`,
          `Average inter-bank payee similarity is ${avgSimilarity.toFixed(2)}.`,
          `Maximum cross-source date difference is ${maxDateDiff} day(s) (window: ${matching.partialPaymentWindowDays} days).`,
          `Bank members: ${combination.map((tx) => `${tx.spreadsheetFileName}:L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join('; ')}.`,
          `QBO payable: ${qboDebit.spreadsheetFileName}:L${qboDebit.lineNumber}:${qboDebit.amount.toFixed(2)}.`,
        ],
        dateDifferenceDays: maxDateDiff,
        bankTransactions: combination,
        qboTransactions: [qboDebit],
        bankTransactionIds: combination.map((tx) => tx.id),
        qboTransactionIds: [qboDebit.id],
        score: 100 - maxDateDiff + avgSimilarity * 10 - combination.length,
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const PAYROLL_BATCH_MAX_QBO_LINES = 25;

const PAYROLL_BANK_KEYWORDS = [
  'payroll', 'adp', 'paychex', 'gusto', 'rippling', 'trinet', 'justworks',
  'zenefits', 'bamboohr', 'patriot', 'intuit payroll', 'direct pay', 'ach batch',
  'direct deposit', 'dd payroll',
];

const isPayrollBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return PAYROLL_BANK_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildPayrollBatchCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const payrollBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isPayrollBankSignal(tx),
  );

  const qboDebitsWithAmount = qboTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0,
  );

  for (const bankDebit of payrollBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    const pool = qboDebitsWithAmount
      .filter((qboDebit) => {
        const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter((qboDebit) => Math.abs(qboDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance);

    if (pool.length < 2 || pool.length > PAYROLL_BATCH_MAX_QBO_LINES) {
      continue;
    }

    const qboTotal = pool.reduce((sum, tx) => sum + tx.amount, 0);
    if (!currencyEquals(bankDebit.amount, qboTotal, matching.amountTolerance)) {
      continue;
    }

    const maxDateDiff = pool.reduce<number>((max, qboDebit) => {
      const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate) ?? 0;
      return Math.max(max, diff);
    }, 0);

    candidates.push({
      category: 'PayrollBatchMatch',
      ruleId: 'payroll-batch-reserved',
      ruleName: 'Payroll Batch Candidate',
      reason:
        'A bank payroll ACH debit matches the aggregate of multiple QBO payroll expense entries posted on the same payroll date.',
      evidence: [
        `Bank payroll debit of ${bankDebit.amount.toFixed(2)} matches QBO total of ${qboTotal.toFixed(2)} across ${pool.length} expense line(s).`,
        `All QBO entries fall within ${matching.dateToleranceDays} day(s) of the bank payroll date.`,
        `Payroll processor signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
        `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; QBO lines: ${pool.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
      ],
      dateDifferenceDays: maxDateDiff,
      bankTransactions: [bankDebit],
      qboTransactions: pool,
      bankTransactionIds: [bankDebit.id],
      qboTransactionIds: pool.map((tx) => tx.id),
      score: 100 - maxDateDiff * 2 - pool.length,
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const BANK_SERVICE_CHARGE_MAX_QBO_LINES = 5;

const BANK_SERVICE_CHARGE_KEYWORDS = [
  'service charge', 'service fee', 'monthly fee', 'maintenance fee', 'account fee',
  'bank fee', 'processing fee', 'overdraft fee', 'minimum balance fee',
  'annual fee', 'transaction fee', 'sweep fee', 'treasury fee',
];

const isServiceChargeBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return BANK_SERVICE_CHARGE_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildBankServiceChargeAmortizationCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const serviceChargeBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isServiceChargeBankSignal(tx),
  );

  const qboDebitsWithAmount = qboTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0,
  );

  for (const bankDebit of serviceChargeBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    const pool = qboDebitsWithAmount
      .filter((qboDebit) => {
        const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter((qboDebit) => Math.abs(qboDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance);

    if (pool.length < 2 || pool.length > BANK_SERVICE_CHARGE_MAX_QBO_LINES) {
      continue;
    }

    const qboTotal = pool.reduce((sum, tx) => sum + tx.amount, 0);
    if (!currencyEquals(bankDebit.amount, qboTotal, matching.amountTolerance)) {
      continue;
    }

    const maxDateDiff = pool.reduce<number>((max, qboDebit) => {
      const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate) ?? 0;
      return Math.max(max, diff);
    }, 0);

    candidates.push({
      category: 'BankServiceChargeAmortization',
      ruleId: 'bank-service-charge-reserved',
      ruleName: 'Bank Service Charge Candidate',
      reason:
        'A bank service charge debit matches the aggregate of multiple QBO fee expense entries, indicating an amortized or split posting across account categories.',
      evidence: [
        `Bank service charge of ${bankDebit.amount.toFixed(2)} matches QBO total of ${qboTotal.toFixed(2)} across ${pool.length} expense line(s).`,
        `All QBO entries fall within ${matching.dateToleranceDays} day(s) of the bank charge date.`,
        `Service charge signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
        `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; QBO lines: ${pool.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
      ],
      dateDifferenceDays: maxDateDiff,
      bankTransactions: [bankDebit],
      qboTransactions: pool,
      bankTransactionIds: [bankDebit.id],
      qboTransactionIds: pool.map((tx) => tx.id),
      score: 100 - maxDateDiff * 2 - pool.length,
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const LOAN_PAYMENT_MAX_QBO_LINES = 3;

const LOAN_PAYMENT_KEYWORDS = [
  'loan payment', 'mortgage payment', 'mortgage', 'note payable', 'line of credit',
  'loc payment', 'heloc', 'sba loan', 'loan pmt', 'pmt loan', 'debt service',
  'installment loan',
];

const isLoanPaymentBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return LOAN_PAYMENT_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildLoanPaymentSplitCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const loanBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isLoanPaymentBankSignal(tx),
  );

  const qboDebitsWithAmount = qboTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0,
  );

  for (const bankDebit of loanBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    const pool = qboDebitsWithAmount
      .filter((qboDebit) => {
        const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter((qboDebit) => Math.abs(qboDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance);

    if (pool.length < 2) {
      continue;
    }

    const combos = generateTransactionCombinations(pool, 2, LOAN_PAYMENT_MAX_QBO_LINES);
    let matched = false;

    for (const combo of combos) {
      const qboTotal = combo.reduce((sum, tx) => sum + tx.amount, 0);
      if (!currencyEquals(bankDebit.amount, qboTotal, matching.amountTolerance)) {
        continue;
      }

      const maxDateDiff = combo.reduce<number>((max, qboDebit) => {
        const diff = dateDifferenceDays(bankDate, qboDebit.transactionDate ?? qboDebit.postingDate) ?? 0;
        return Math.max(max, diff);
      }, 0);

      candidates.push({
        category: 'LoanPaymentSplit',
        ruleId: 'loan-payment-split-reserved',
        ruleName: 'Loan Payment Split Candidate',
        reason:
          'A bank loan payment debit matches the aggregate of QBO principal and interest expense entries for the same obligation.',
        evidence: [
          `Bank loan payment of ${bankDebit.amount.toFixed(2)} matches QBO total of ${qboTotal.toFixed(2)} across ${combo.length} entry(ies).`,
          `All QBO entries fall within ${matching.dateToleranceDays} day(s) of the bank payment date.`,
          `Loan payment signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
          `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; QBO lines: ${combo.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
        ],
        dateDifferenceDays: maxDateDiff,
        bankTransactions: [bankDebit],
        qboTransactions: combo,
        bankTransactionIds: [bankDebit.id],
        qboTransactionIds: combo.map((tx) => tx.id),
        score: 100 - maxDateDiff * 2 - combo.length,
      });
      matched = true;
      break;
    }

    void matched;
  }

  return candidates.sort((left, right) => right.score - left.score);
};

/** Output of `reserveGroupedTransactionIds`: the selected candidates and the ID sets reserved from further matching. */
export interface GroupedReservationResult {
  reservedBankTransactionIds: Set<string>;
  reservedQboTransactionIds: Set<string>;
  selectedCandidates: GroupedReservationCandidate[];
}

/**
 * Identifies and reserves transaction IDs that participate in grouped (many-to-many) matches.
 * Returns the best non-overlapping set of grouped candidates and the corresponding reserved ID sets,
 * so the standard one-to-one matching phase can skip these transactions.
 */
export const reserveGroupedTransactionIds = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationResult => {
  const reservedBankTransactionIds = new Set<string>();
  const reservedQboTransactionIds = new Set<string>();
  const selectedCandidates: GroupedReservationCandidate[] = [];
  const candidates = [
    ...findGroupedReservationCandidates(bankTransactions, qboTransactions, matching),
    ...buildFeeNettingCandidates(bankTransactions, qboTransactions, matching),
    ...buildPartialPaymentCandidates(bankTransactions, qboTransactions, matching),
    ...buildPayrollBatchCandidates(bankTransactions, qboTransactions, matching),
    ...buildBankServiceChargeAmortizationCandidates(bankTransactions, qboTransactions, matching),
    ...buildLoanPaymentSplitCandidates(bankTransactions, qboTransactions, matching),
  ].sort((left, right) => right.score - left.score);

  candidates.forEach((candidate) => {
    if (
      candidate.bankTransactionIds.some((transactionId) => reservedBankTransactionIds.has(transactionId)) ||
      candidate.qboTransactionIds.some((transactionId) => reservedQboTransactionIds.has(transactionId))
    ) {
      return;
    }

    candidate.bankTransactionIds.forEach((transactionId) => {
      reservedBankTransactionIds.add(transactionId);
    });
    candidate.qboTransactionIds.forEach((transactionId) => {
      reservedQboTransactionIds.add(transactionId);
    });
    selectedCandidates.push(candidate);
  });

  return {
    reservedBankTransactionIds,
    reservedQboTransactionIds,
    selectedCandidates,
  };
};