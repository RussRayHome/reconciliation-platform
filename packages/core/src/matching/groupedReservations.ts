import type { MatchingConfig, NormalizedTransaction } from '@recon/domain';

import { currencyEquals, dateDifferenceDays, tokenSimilarity } from './similarity';

/** A proposed many-to-many grouped match candidate with its constituent bank and GL transactions. */
export interface GroupedReservationCandidate {
  category:
    | 'DepositGroupingIssue'
    | 'LikelySplitCombineIssue'
    | 'FeeNettingMatch'
    | 'PartialPaymentMatch'
    | 'PayrollBatchMatch'
    | 'BankServiceChargeAmortization'
    | 'LoanPaymentSplit';
  ruleId:
    | 'grouped-deposit-reserved'
    | 'grouped-split-combine-reserved'
    | 'fee-netting-reserved'
    | 'partial-payment-reserved'
    | 'payroll-batch-reserved'
    | 'bank-service-charge-reserved'
    | 'loan-payment-split-reserved';
  ruleName:
    | 'Grouped Deposit Candidate'
    | 'Grouped Split/Combine Candidate'
    | 'Fee Netting Candidate'
    | 'Partial Payment Candidate'
    | 'Payroll Batch Candidate'
    | 'Bank Service Charge Candidate'
    | 'Loan Payment Split Candidate';
  reason: string;
  evidence: string[];
  dateDifferenceDays: number | null;
  bankTransactions: Array<NormalizedTransaction & { amount: number }>;
  glTransactions: Array<NormalizedTransaction & { amount: number }>;
  bankTransactionIds: string[];
  glTransactionIds: string[];
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

  if (
    (transaction.amount ?? 0) < 0 ||
    transactionType.includes('expense') ||
    transactionType.includes('payment')
  ) {
    return 'withdrawal';
  }

  return 'unknown';
};

const areTimingKindsCompatible = (
  bankTransaction: NormalizedTransaction,
  glTransaction: NormalizedTransaction,
): boolean => {
  const bankKind = inferTransactionKind(bankTransaction);
  const glKind = inferTransactionKind(glTransaction);

  if (bankKind === 'unknown' || glKind === 'unknown') {
    return true;
  }

  if (bankKind === glKind) {
    return true;
  }

  return (
    (bankKind === 'transfer' && glKind === 'journal') ||
    (bankKind === 'deposit' && glKind === 'transfer')
  );
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

const describeTransactionGroup = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): string =>
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
  glTransactions: NormalizedTransaction[],
): number | null => {
  let maxDifference: number | null = null;

  for (const bankTransaction of bankTransactions) {
    for (const glTransaction of glTransactions) {
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        glTransaction.transactionDate ?? glTransaction.postingDate,
      );

      if (dateDifference === null) {
        return null;
      }

      maxDifference =
        maxDifference === null ? dateDifference : Math.max(maxDifference, dateDifference);
    }
  }

  return maxDifference;
};

const buildGroupedReservationCandidate = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  glTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): GroupedReservationCandidate | undefined => {
  if (!bankTransactions.length || !glTransactions.length) {
    return undefined;
  }

  if (bankTransactions.length === 1 && glTransactions.length === 1) {
    return undefined;
  }

  const bankTotal = sumTransactionAmounts(bankTransactions);
  const glTotal = sumTransactionAmounts(glTransactions);

  if (!currencyEquals(bankTotal, glTotal, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTotal) !== Math.sign(glTotal)) {
    return undefined;
  }

  if (!areGroupedTransactionsCompatible(bankTransactions, glTransactions)) {
    return undefined;
  }

  const dateDifference = calculateGroupedDateDifference(bankTransactions, glTransactions);
  if (dateDifference === null || dateDifference > matching.timingDifferenceDays) {
    return undefined;
  }

  const bankKinds = formatKinds(bankTransactions);
  const glKinds = formatKinds(glTransactions);
  const category =
    bankTotal > 0 && glTotal > 0 ? 'DepositGroupingIssue' : 'LikelySplitCombineIssue';

  return {
    category,
    ruleId:
      category === 'DepositGroupingIssue'
        ? 'grouped-deposit-reserved'
        : 'grouped-split-combine-reserved',
    ruleName:
      category === 'DepositGroupingIssue'
        ? 'Grouped Deposit Candidate'
        : 'Grouped Split/Combine Candidate',
    reason:
      category === 'DepositGroupingIssue'
        ? 'A balanced grouped deposit candidate was reserved before one-to-one review matching.'
        : 'A balanced grouped split/combine candidate was reserved before one-to-one review matching.',
    evidence: [
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); GL total is ${glTotal.toFixed(2)} across ${glTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and gl=${glKinds}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `GL members: ${describeTransactionGroup(glTransactions)}.`,
    ],
    dateDifferenceDays: dateDifference,
    bankTransactions,
    glTransactions,
    bankTransactionIds: bankTransactions.map((transaction) => transaction.id),
    glTransactionIds: glTransactions.map((transaction) => transaction.id),
    score: 100 - dateDifference * 2 - (bankTransactions.length + glTransactions.length),
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

      if (
        Math.abs(counterpartTransaction.amount) >
        Math.abs(anchorTransaction.amount) + matching.amountTolerance
      ) {
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

      return (
        Math.abs(anchorTransaction.amount - left.amount) -
        Math.abs(anchorTransaction.amount - right.amount)
      );
    })
    .slice(0, matching.groupedCandidatePoolSize);

const findGroupedReservationCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );
  const glResiduals = glTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, glResiduals, matching);
    const combinations = generateTransactionCombinations(
      counterpartPool,
      2,
      matching.groupedMatchMaxSize,
    );

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate([bankTransaction], combination, matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const glTransaction of glResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(glTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(
      counterpartPool,
      2,
      matching.groupedMatchMaxSize,
    );

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate(combination, [glTransaction], matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const FEE_NETTING_KEYWORDS = [
  'merchant fee',
  'processing fee',
  'processor fee',
  'gateway fee',
  'interchange fee',
  'merchant service fee',
  'discount fee',
  'settlement fee',
  'transaction fee',
  'card fee',
];

const isFeeLikeGlTransaction = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return FEE_NETTING_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildFeeNettingCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const bankCredits = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount > 0,
  );
  const glRevenues = glTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount > 0,
  );
  // Narrowing to a description-driven fee signal (mirroring the bank-side keyword gates used by
  // the payroll/service-charge/loan builders above) keeps this to genuine fee-netting pairs —
  // without it, any two GL amounts that happen to sum near a bank credit within the timing
  // window get flagged, producing massive false-positive rates on real-sized datasets.
  const glFees = glTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount < 0 && isFeeLikeGlTransaction(transaction),
  );

  for (const bankCredit of bankCredits) {
    const bankDate = bankCredit.transactionDate ?? bankCredit.postingDate;

    for (const glRevenue of glRevenues) {
      for (const glFee of glFees) {
        const netAmount = glRevenue.amount + glFee.amount;
        if (!currencyEquals(bankCredit.amount, netAmount, matching.amountTolerance)) {
          continue;
        }

        const revenueDate = glRevenue.transactionDate ?? glRevenue.postingDate;
        const feeDate = glFee.transactionDate ?? glFee.postingDate;
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
            'A bank credit matches the net of a GL revenue entry minus a fee expense, indicating a fee-netted payout.',
          evidence: [
            `Bank credit of ${bankCredit.amount.toFixed(2)} matches GL revenue ${glRevenue.amount.toFixed(2)} + fee ${glFee.amount.toFixed(2)} = ${netAmount.toFixed(2)}.`,
            `Maximum cross-source date difference is ${maxDateDiff} day(s).`,
            `Bank: ${bankCredit.spreadsheetFileName}:L${bankCredit.lineNumber}; GL revenue: ${glRevenue.spreadsheetFileName}:L${glRevenue.lineNumber}; GL fee: ${glFee.spreadsheetFileName}:L${glFee.lineNumber}.`,
          ],
          dateDifferenceDays: maxDateDiff,
          bankTransactions: [bankCredit],
          glTransactions: [glRevenue, glFee],
          bankTransactionIds: [bankCredit.id],
          glTransactionIds: [glRevenue.id, glFee.id],
          score: 100 - maxDateDiff * 2,
        });
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const PARTIAL_PAYMENT_POOL_SIZE = 30;

const PARTIAL_PAYMENT_BANK_KEYWORDS = [
  'installment',
  'partial payment',
  'payment plan',
  'split payment',
  'installment pmt',
];

const isPartialPaymentBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return PARTIAL_PAYMENT_BANK_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildPartialPaymentCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  // Without a bank-side signal, any negative-amount bank transaction is eligible, so on a wide
  // 90-day window the closest-N-by-date pool fills with unrelated debits before the real
  // installments are ever considered. Gate on an installment-style description first.
  const bankDebits = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null &&
      transaction.amount < 0 &&
      isPartialPaymentBankSignal(transaction),
  );
  const glDebits = glTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null && transaction.amount < 0,
  );

  for (const glDebit of glDebits) {
    const glDate = glDebit.transactionDate ?? glDebit.postingDate;

    // partialPaymentWindowDays (90 by default) is wide enough that "eligible" can mean most of
    // the dataset's bank debits. generateTransactionCombinations() has no internal size limit,
    // so an uncapped pool here is combinatorially explosive (C(n,2)+C(n,3) blows past a few
    // hundred candidates) — cap to a dedicated pool size, keeping the closest-dated debits, same
    // as collectGroupedCounterpartPool() does for the other grouped rules. This builder gets its
    // own (larger) constant rather than the shared groupedCandidatePoolSize: a 90-day window is
    // wide enough that the true installments are routinely *not* among the 6 closest-dated
    // entries, so a pool sized for a narrow window silently drops the real match.
    const eligibleBankDebits = bankDebits
      .filter((bankDebit) => {
        const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;
        const diff = dateDifferenceDays(bankDate, glDate);
        return diff !== null && diff <= matching.partialPaymentWindowDays;
      })
      .sort((left, right) => {
        const leftDiff =
          dateDifferenceDays(left.transactionDate ?? left.postingDate, glDate) ??
          Number.MAX_SAFE_INTEGER;
        const rightDiff =
          dateDifferenceDays(right.transactionDate ?? right.postingDate, glDate) ??
          Number.MAX_SAFE_INTEGER;
        return leftDiff - rightDiff;
      })
      .slice(0, PARTIAL_PAYMENT_POOL_SIZE);

    const combinations = generateTransactionCombinations(
      eligibleBankDebits,
      2,
      matching.groupedMatchMaxSize,
    );

    for (const combination of combinations) {
      const bankTotal = combination.reduce((sum, tx) => sum + tx.amount, 0);

      if (!currencyEquals(bankTotal, glDebit.amount, matching.amountTolerance)) {
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
        const diff = dateDifferenceDays(bankDate, glDate) ?? 0;
        return Math.max(max, diff);
      }, 0);

      candidates.push({
        category: 'PartialPaymentMatch',
        ruleId: 'partial-payment-reserved',
        ruleName: 'Partial Payment Candidate',
        reason:
          'Multiple bank debits with similar payee context accumulate to a single GL payable, indicating partial payments.',
        evidence: [
          `Bank total of ${bankTotal.toFixed(2)} across ${combination.length} payment(s) matches GL payable of ${glDebit.amount.toFixed(2)}.`,
          `Average inter-bank payee similarity is ${avgSimilarity.toFixed(2)}.`,
          `Maximum cross-source date difference is ${maxDateDiff} day(s) (window: ${matching.partialPaymentWindowDays} days).`,
          `Bank members: ${combination.map((tx) => `${tx.spreadsheetFileName}:L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join('; ')}.`,
          `GL payable: ${glDebit.spreadsheetFileName}:L${glDebit.lineNumber}:${glDebit.amount.toFixed(2)}.`,
        ],
        dateDifferenceDays: maxDateDiff,
        bankTransactions: combination,
        glTransactions: [glDebit],
        bankTransactionIds: combination.map((tx) => tx.id),
        glTransactionIds: [glDebit.id],
        score: 100 - maxDateDiff + avgSimilarity * 10 - combination.length,
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const PAYROLL_BATCH_MAX_GL_LINES = 25;
const PAYROLL_BATCH_POOL_SIZE = 12;

const PAYROLL_BANK_KEYWORDS = [
  'payroll',
  'adp',
  'paychex',
  'gusto',
  'rippling',
  'trinet',
  'justworks',
  'zenefits',
  'bamboohr',
  'patriot',
  'intuit payroll',
  'direct pay',
  'ach batch',
  'direct deposit',
  'dd payroll',
];

const isPayrollBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return PAYROLL_BANK_KEYWORDS.some((keyword) => text.includes(keyword));
};

const PAYROLL_GL_KEYWORDS = [
  'payroll',
  'wages',
  'wage expense',
  'salary',
  'salaries',
  'employee compensation',
  'payroll tax',
  'payroll expense',
];

const isPayrollGlSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return PAYROLL_GL_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildPayrollBatchCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const payrollBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isPayrollBankSignal(tx),
  );

  // Without a GL-side signal too, "closest N by date" is a weak filter on a dense dataset — an
  // 11-day window around a payroll date can hold dozens of unrelated small debits from other
  // scenarios, crowding the real payroll lines out of the pool before the subset search ever
  // runs. Mirror the bank-side keyword gate on the GL description as well.
  const glDebitsWithAmount = glTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isPayrollGlSignal(tx),
  );

  for (const bankDebit of payrollBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    // Summing the *entire* filtered pool (as opposed to searching subsets, like the partial-payment
    // and loan-split builders do) only works if the pool is already exactly the intended group —
    // on a real-sized dataset, other unrelated small debits routinely fall in the same date window
    // and inflate the total past any tolerance, so this never fires. Search subsets instead, over a
    // pool bounded generously (payroll batches run up to PAYROLL_BATCH_MAX_GL_LINES lines) to keep
    // the combinatorial cost in check.
    const pool = glDebitsWithAmount
      .filter((glDebit) => {
        const diff = dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter(
        (glDebit) =>
          Math.abs(glDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance,
      )
      .sort((left, right) => {
        const leftDiff =
          dateDifferenceDays(bankDate, left.transactionDate ?? left.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        const rightDiff =
          dateDifferenceDays(bankDate, right.transactionDate ?? right.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        return leftDiff - rightDiff;
      })
      .slice(0, PAYROLL_BATCH_POOL_SIZE);

    if (pool.length < 2) {
      continue;
    }

    const combos = generateTransactionCombinations(
      pool,
      2,
      Math.min(PAYROLL_BATCH_MAX_GL_LINES, pool.length),
    );
    const combo = combos.find((candidateCombo) =>
      currencyEquals(
        bankDebit.amount,
        candidateCombo.reduce((sum, tx) => sum + tx.amount, 0),
        matching.amountTolerance,
      ),
    );

    if (!combo) {
      continue;
    }

    const glTotal = combo.reduce((sum, tx) => sum + tx.amount, 0);

    const maxDateDiff = combo.reduce<number>((max, glDebit) => {
      const diff =
        dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate) ?? 0;
      return Math.max(max, diff);
    }, 0);

    candidates.push({
      category: 'PayrollBatchMatch',
      ruleId: 'payroll-batch-reserved',
      ruleName: 'Payroll Batch Candidate',
      reason:
        'A bank payroll ACH debit matches the aggregate of multiple GL payroll expense entries posted on the same payroll date.',
      evidence: [
        `Bank payroll debit of ${bankDebit.amount.toFixed(2)} matches GL total of ${glTotal.toFixed(2)} across ${combo.length} expense line(s).`,
        `All GL entries fall within ${matching.dateToleranceDays} day(s) of the bank payroll date.`,
        `Payroll processor signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
        `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; GL lines: ${combo.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
      ],
      dateDifferenceDays: maxDateDiff,
      bankTransactions: [bankDebit],
      glTransactions: combo,
      bankTransactionIds: [bankDebit.id],
      glTransactionIds: combo.map((tx) => tx.id),
      score: 100 - maxDateDiff * 2 - combo.length,
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const BANK_SERVICE_CHARGE_MAX_GL_LINES = 5;
const BANK_SERVICE_CHARGE_POOL_SIZE = 10;

const BANK_SERVICE_CHARGE_KEYWORDS = [
  'service charge',
  'service fee',
  'monthly fee',
  'maintenance fee',
  'account fee',
  'bank fee',
  'processing fee',
  'overdraft fee',
  'minimum balance fee',
  'annual fee',
  'transaction fee',
  'sweep fee',
  'treasury fee',
];

const isServiceChargeBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return BANK_SERVICE_CHARGE_KEYWORDS.some((keyword) => text.includes(keyword));
};

const SERVICE_CHARGE_GL_KEYWORDS = [
  'bank fee',
  'bank charge',
  'service charge',
  'fee expense',
  'bank service',
];

const isServiceChargeGlSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return SERVICE_CHARGE_GL_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildBankServiceChargeAmortizationCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const serviceChargeBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isServiceChargeBankSignal(tx),
  );

  // Same reasoning as buildPayrollBatchCandidates: gate the GL side on a fee-expense keyword too,
  // so the date-proximity pool isn't drowned out by unrelated debits in a dense dataset.
  const glDebitsWithAmount = glTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isServiceChargeGlSignal(tx),
  );

  for (const bankDebit of serviceChargeBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    // Same fix as buildPayrollBatchCandidates: search subsets of the pool for one that sums to the
    // bank total, rather than requiring the entire date/amount-filtered pool to sum exactly.
    const pool = glDebitsWithAmount
      .filter((glDebit) => {
        const diff = dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter(
        (glDebit) =>
          Math.abs(glDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance,
      )
      .sort((left, right) => {
        const leftDiff =
          dateDifferenceDays(bankDate, left.transactionDate ?? left.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        const rightDiff =
          dateDifferenceDays(bankDate, right.transactionDate ?? right.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        return leftDiff - rightDiff;
      })
      .slice(0, BANK_SERVICE_CHARGE_POOL_SIZE);

    if (pool.length < 2) {
      continue;
    }

    const combos = generateTransactionCombinations(
      pool,
      2,
      Math.min(BANK_SERVICE_CHARGE_MAX_GL_LINES, pool.length),
    );
    const combo = combos.find((candidateCombo) =>
      currencyEquals(
        bankDebit.amount,
        candidateCombo.reduce((sum, tx) => sum + tx.amount, 0),
        matching.amountTolerance,
      ),
    );

    if (!combo) {
      continue;
    }

    const glTotal = combo.reduce((sum, tx) => sum + tx.amount, 0);

    const maxDateDiff = combo.reduce<number>((max, glDebit) => {
      const diff =
        dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate) ?? 0;
      return Math.max(max, diff);
    }, 0);

    candidates.push({
      category: 'BankServiceChargeAmortization',
      ruleId: 'bank-service-charge-reserved',
      ruleName: 'Bank Service Charge Candidate',
      reason:
        'A bank service charge debit matches the aggregate of multiple GL fee expense entries, indicating an amortized or split posting across account categories.',
      evidence: [
        `Bank service charge of ${bankDebit.amount.toFixed(2)} matches GL total of ${glTotal.toFixed(2)} across ${combo.length} expense line(s).`,
        `All GL entries fall within ${matching.dateToleranceDays} day(s) of the bank charge date.`,
        `Service charge signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
        `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; GL lines: ${combo.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
      ],
      dateDifferenceDays: maxDateDiff,
      bankTransactions: [bankDebit],
      glTransactions: combo,
      bankTransactionIds: [bankDebit.id],
      glTransactionIds: combo.map((tx) => tx.id),
      score: 100 - maxDateDiff * 2 - combo.length,
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
};

const LOAN_PAYMENT_MAX_GL_LINES = 3;
const LOAN_PAYMENT_POOL_SIZE = 15;

const LOAN_PAYMENT_KEYWORDS = [
  'loan payment',
  'mortgage payment',
  'mortgage',
  'note payable',
  'line of credit',
  'loc payment',
  'heloc',
  'sba loan',
  'loan pmt',
  'pmt loan',
  'debt service',
  'installment loan',
];

const isLoanPaymentBankSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return LOAN_PAYMENT_KEYWORDS.some((keyword) => text.includes(keyword));
};

const LOAN_PAYMENT_GL_KEYWORDS = [
  'loan principal',
  'loan interest',
  'principal reduction',
  'interest expense',
  'note payable',
  'mortgage',
  'loan payment',
  'debt service',
];

const isLoanPaymentGlSignal = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return LOAN_PAYMENT_GL_KEYWORDS.some((keyword) => text.includes(keyword));
};

const buildLoanPaymentSplitCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];

  const loanBankDebits = bankTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isLoanPaymentBankSignal(tx),
  );

  // Same reasoning as buildPayrollBatchCandidates: gate the GL side too, so principal/interest
  // lines aren't crowded out of the date-proximity pool by unrelated debits.
  const glDebitsWithAmount = glTransactions.filter(
    (tx): tx is NormalizedTransaction & { amount: number } =>
      tx.amount !== null && tx.amount < 0 && isLoanPaymentGlSignal(tx),
  );

  for (const bankDebit of loanBankDebits) {
    const bankDate = bankDebit.transactionDate ?? bankDebit.postingDate;

    // Same combinatorial-size concern as buildPartialPaymentCandidates: bound the pool before
    // generateTransactionCombinations() rather than after, keeping the closest-dated entries.
    const pool = glDebitsWithAmount
      .filter((glDebit) => {
        const diff = dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate);
        return diff !== null && diff <= matching.dateToleranceDays;
      })
      .filter(
        (glDebit) =>
          Math.abs(glDebit.amount) < Math.abs(bankDebit.amount) + matching.amountTolerance,
      )
      .sort((left, right) => {
        const leftDiff =
          dateDifferenceDays(bankDate, left.transactionDate ?? left.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        const rightDiff =
          dateDifferenceDays(bankDate, right.transactionDate ?? right.postingDate) ??
          Number.MAX_SAFE_INTEGER;
        return leftDiff - rightDiff;
      })
      .slice(0, LOAN_PAYMENT_POOL_SIZE);

    if (pool.length < 2) {
      continue;
    }

    const combos = generateTransactionCombinations(
      pool,
      2,
      Math.min(LOAN_PAYMENT_MAX_GL_LINES, pool.length),
    );
    let matched = false;

    for (const combo of combos) {
      const glTotal = combo.reduce((sum, tx) => sum + tx.amount, 0);
      if (!currencyEquals(bankDebit.amount, glTotal, matching.amountTolerance)) {
        continue;
      }

      const maxDateDiff = combo.reduce<number>((max, glDebit) => {
        const diff =
          dateDifferenceDays(bankDate, glDebit.transactionDate ?? glDebit.postingDate) ?? 0;
        return Math.max(max, diff);
      }, 0);

      candidates.push({
        category: 'LoanPaymentSplit',
        ruleId: 'loan-payment-split-reserved',
        ruleName: 'Loan Payment Split Candidate',
        reason:
          'A bank loan payment debit matches the aggregate of GL principal and interest expense entries for the same obligation.',
        evidence: [
          `Bank loan payment of ${bankDebit.amount.toFixed(2)} matches GL total of ${glTotal.toFixed(2)} across ${combo.length} entry(ies).`,
          `All GL entries fall within ${matching.dateToleranceDays} day(s) of the bank payment date.`,
          `Loan payment signal detected in bank description: "${bankDebit.description ?? bankDebit.merchantName ?? ''}"`,
          `Bank: ${bankDebit.spreadsheetFileName}:L${bankDebit.lineNumber}; GL lines: ${combo.map((tx) => `L${tx.lineNumber}:${tx.amount.toFixed(2)}`).join(', ')}.`,
        ],
        dateDifferenceDays: maxDateDiff,
        bankTransactions: [bankDebit],
        glTransactions: combo,
        bankTransactionIds: [bankDebit.id],
        glTransactionIds: combo.map((tx) => tx.id),
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
  reservedGlTransactionIds: Set<string>;
  selectedCandidates: GroupedReservationCandidate[];
}

/**
 * Identifies and reserves transaction IDs that participate in grouped (many-to-many) matches.
 * Returns the best non-overlapping set of grouped candidates and the corresponding reserved ID sets,
 * so the standard one-to-one matching phase can skip these transactions.
 */
export const reserveGroupedTransactionIds = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationResult => {
  const reservedBankTransactionIds = new Set<string>();
  const reservedGlTransactionIds = new Set<string>();
  const selectedCandidates: GroupedReservationCandidate[] = [];
  const candidates = [
    ...findGroupedReservationCandidates(bankTransactions, glTransactions, matching),
    ...buildFeeNettingCandidates(bankTransactions, glTransactions, matching),
    ...buildPartialPaymentCandidates(bankTransactions, glTransactions, matching),
    ...buildPayrollBatchCandidates(bankTransactions, glTransactions, matching),
    ...buildBankServiceChargeAmortizationCandidates(bankTransactions, glTransactions, matching),
    ...buildLoanPaymentSplitCandidates(bankTransactions, glTransactions, matching),
  ].sort((left, right) => right.score - left.score);

  candidates.forEach((candidate) => {
    if (
      candidate.bankTransactionIds.some((transactionId) =>
        reservedBankTransactionIds.has(transactionId),
      ) ||
      candidate.glTransactionIds.some((transactionId) =>
        reservedGlTransactionIds.has(transactionId),
      )
    ) {
      return;
    }

    candidate.bankTransactionIds.forEach((transactionId) => {
      reservedBankTransactionIds.add(transactionId);
    });
    candidate.glTransactionIds.forEach((transactionId) => {
      reservedGlTransactionIds.add(transactionId);
    });
    selectedCandidates.push(candidate);
  });

  return {
    reservedBankTransactionIds,
    reservedGlTransactionIds,
    selectedCandidates,
  };
};
