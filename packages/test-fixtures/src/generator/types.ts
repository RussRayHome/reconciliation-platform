/**
 * Scenario generator types -- the contract between a scenario, the composer, and the scorer.
 *
 * Design rule that governs everything here: **the answer key is derived from construction, never
 * from running the engine.** A scenario knows that payment P settled bills B1..B3 because it
 * built them that way. If the generator and the engine ever shared a grouping helper, a bug in
 * that helper would make both agree and the test would pass wrongly.
 *
 * Second design rule: **multi-period is the default, not an extension.** Outstanding checks,
 * open-item carry-forward (changesets 0063-0065), and AP aging are all inherently cross-period.
 * Every row carries a `period` index; a single-period dataset is just the degenerate case.
 */
import type { NaturalKeyTier } from '@recon/core';
import type { ErrorCategory } from '@recon/domain';

/** Zero-based period index. Period 0 is the earliest period a dataset covers. */
export type PeriodIndex = number;

/** A bank statement row, in the Banking file's own column vocabulary (`REQUIRED_BANKING_HEADERS`
 *  plus the optional columns): Date, Description, Sequence Number, Check Number, Debit, Credit,
 *  Balance. `Sequence Number` and `Balance` are assigned by the emitter, not by scenarios --
 *  sequence must be unique and ascending within a file, and balance is a running total, so
 *  neither is knowable until every fragment has been composed. */
export interface BankRowSpec {
  /** Generator-stable handle used by expectations to name this row. Unique across the dataset. */
  key: string;
  period: PeriodIndex;
  /** Day offset within the period, 0-based. The composer turns this into a real date. */
  dayOffset: number;
  description: string;
  checkNumber?: string;
  reference?: string;
  /** Positive magnitude of a withdrawal. Exactly one of debit/credit must be set. */
  debit?: number;
  /** Positive magnitude of a deposit. Exactly one of debit/credit must be set. */
  credit?: number;
}

/** A general-ledger row, in the GL file's own column vocabulary (`REQUIRED_GL_HEADERS` plus the
 *  optional columns): Date, Type, Num, Name, Memo, Amount. `Amount` is signed in the cash-impact
 *  frame -- negative reduces the bank balance -- matching `NormalizedRecord.signedAmount`, so a
 *  matched bank line and its GL counterpart carry the SAME sign. */
export interface GlRowSpec {
  key: string;
  period: PeriodIndex;
  dayOffset: number;
  /** The GL Type column verbatim. The engine's `inferTransactionKind` reads this, so it must
   *  carry realistic text ("Check", "Journal Entry", "Deposit", "Bill Payment", "Expense"). */
  type: string;
  /** The Num column -- document or check number. */
  num?: string;
  /** The Name column -- payee or vendor. */
  name?: string;
  memo: string;
  /** Signed, cash-impact frame. Negative = cash out. */
  amount: number;
}

/** Cardinality of an expected match, so the scorer can tell a group apart from a pair.
 *  Read left-to-right as **bank:gl** -- `'1:N'` is one bank line against many GL lines (one
 *  payment clearing several bills), `'N:1'` is many bank lines against one GL line (several
 *  partial payments against one payable). The convention is fixed here so scenarios never have
 *  to guess which side the numeral refers to. */
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

/**
 * One assertion about what a correct engine must do with the rows a scenario built.
 *
 * `noAutoClear` is the most important variant and has no counterpart in a normal fixture: it
 * asserts that an item must NOT reach an auto-cleared disposition, whatever else happens to it.
 * Under plan invariant 2 a missed match is a review-queue item, but a wrong auto-clear is an
 * audit failure -- so the scorer treats a violated `noAutoClear` as a hard failure while recall
 * misses only move a percentage.
 */
export type Expectation =
  | {
      kind: 'match';
      /** Bank row keys participating in the match. */
      bank: string[];
      /** GL row keys participating in the match. */
      gl: string[];
      cardinality: Cardinality;
      /** Why this is the right answer -- surfaced in scorer output on failure. */
      note: string;
    }
  | {
      kind: 'exception';
      /** The row key the exception should be raised against. */
      row: string;
      category: ErrorCategory;
      /** Which side owns the correction. `bank` = timing, no entry. `book` = needs an entry.
       *  Named `book` rather than `gl` to match the plan's reconciling-side vocabulary. */
      side: 'bank' | 'book';
      note: string;
    }
  | {
      kind: 'openItem';
      row: string;
      category: ErrorCategory;
      opensInPeriod: PeriodIndex;
      /** Omitted when the item is still open at the end of the dataset. */
      clearsInPeriod?: PeriodIndex;
      /** Which tier of `deriveNaturalKey` this item must re-identify on. Lets a scenario assert
       *  not just that carry-forward worked but that it worked for the *right reason* -- a tier-3
       *  `contextFingerprint` match where a check number was available is a defect, and one that
       *  a plain "did it carry?" assertion cannot see. */
      naturalKeyTier: NaturalKeyTier;
      note: string;
    }
  | {
      kind: 'noAutoClear';
      row: string;
      reason: string;
    };

/** What one scenario contributes to a dataset: its rows, and its own ground truth. */
export interface Fragment {
  bank: BankRowSpec[];
  gl: GlRowSpec[];
  expect: Expectation[];
}

/** Inputs every scenario receives. `keyPrefix` namespaces the scenario's row keys so two
 *  instances of the same scenario in one dataset never collide. */
export interface ScenarioContext {
  keyPrefix: string;
  /** This scenario's own RNG stream -- forked per scenario so adding one scenario never shifts
   *  another's numbers. */
  seedLabel: string;
  /** How many periods the dataset spans, so a scenario can place a carry-forward correctly. */
  periodCount: number;
}

/** A named, deterministic dataset contributor. */
export interface Scenario {
  /** Stable identifier, used as the default key prefix and in scorer output. */
  id: string;
  /** One line: what defect or behaviour this scenario exercises. */
  description: string;
  /** Minimum periods this scenario needs. The composer refuses to run it in a shorter dataset
   *  rather than silently emitting a broken carry-forward. */
  minPeriods: number;
  build(context: ScenarioContext, rngSeed: number): Fragment;
}
