/**
 * The five source types a run can carry, and what each tab's panel does (Phase 2, #401).
 *
 * The strip shows what a **run** can carry; each panel states what is **checked today**. Those two
 * are allowed to differ — what is not allowed is a screen implying validator parity that does not
 * exist. Payroll is the visible case: it belongs in a run (it is imported exactly like bank and GL
 * — same validate → normalize → match pipeline, no separate ingestion path), but its rules ship
 * with #408, so its panel carries a reason instead of a drop zone.
 *
 * That shape is a discriminated union rather than a `disabled` flag on one config type, because of
 * [OBJECT] rule 27 — but only half of it. **Rule 27 covers two situations and this union models
 * exactly one.** Do not generalise it into "no disabled controls anywhere":
 *
 *   NOT AVAILABLE — no user action makes it work. Payroll before #408: there is nothing to attach
 *   and no sequence of steps that changes that. The control is *removed and replaced by a reason*.
 *   This is `ReasonSourceTab`, and it is the case that generalises — the Mapping return path on
 *   13a and 5a/5b's registry validation before #448 are the same family.
 *
 *   NOT YET VALID — the user can resolve it. Submit run before bank and GL are attached; 3a's
 *   opening panel before an account number is entered. The control *stays, disabled, with a reason
 *   line beside it*, which is approved on 1a. Refactoring one of these into a reason-only variant
 *   would delete a control the user is meant to see themselves earn.
 *
 * The compiler enforces the first: a reason tab has no slot fields, so a greyed-out drop zone is
 * unrepresentable rather than merely discouraged. It says nothing about the second, which is why
 * this comment does.
 */

/** URL-facing tab id. Reflected as `?source=` so a tab is linkable without being a route. */
export const sourceTabIds = ['bank', 'gl', 'ap', 'ar', 'payroll'] as const;
export type SourceTabId = (typeof sourceTabIds)[number];

/** Shared by both panel kinds: what the tab itself looks like and says. */
interface SourceTabBase {
  id: SourceTabId;
  /** Tab label. Sentence case per the copy rules — "AP / Payments", not "AP / PAYMENTS". */
  label: string;
  /** CSS custom property holding this type's hue. All five are distinct (Phase 0b); AP was
   * byte-identical to GL until they had to share one strip. */
  hueToken: string;
}

/** A tab whose panel accepts files. */
export interface DroppableSourceTab extends SourceTabBase {
  kind: 'droppable';
  /** Slot count bounds. GL is exactly one; the subledgers and bank mirror each other at 1–4. */
  min: number;
  max: number;
  /** Whether a run may be submitted with none of this type attached. */
  optional: boolean;
  /** One-line hint under the slot prompt, naming the filename convention where there is one. */
  hint: string;
  /** Sample filename shown in the hint and used by the rejection copy. */
  sampleName: string;
  /** The panel's standing note (README 1a) — what this source type does to a run, stated once
   * rather than repeated per slot. */
  note?: string;
}

/** A tab whose panel is a reason, because the capability is not built yet (rule 27). */
export interface ReasonSourceTab extends SourceTabBase {
  kind: 'reason';
  /** The panel's headline. States what to do now, not what is missing — a reader who cannot attach
   * the file still has this month's reconciliation to finish. */
  headline: string;
  /** Why this source type cannot be attached yet, and what to do meanwhile. Rendered in place of
   * the drop zone — never as a tooltip on a disabled control. */
  reason: string;
  /** The issue that delivers it, so the reason names something a reader can look up. */
  trackingIssue: string;
}

export type SourceTab = DroppableSourceTab | ReasonSourceTab;

/** Bank and the subledgers share the 1–4 cardinality; GL is a single workbook per run. */
export const MAX_SLOTS_PER_SUBLEDGER = 4;

/** Declared on its own, and referenced by the array below, so its type is statically
 * `ReasonSourceTab`. Looking it up by id would hand callers a `SourceTab` they must narrow before
 * reading `reason` — which is correct but pushes a runtime "what if it is missing" branch into
 * every consumer for a value that is a compile-time constant. */
export const payrollTab: ReasonSourceTab = {
  kind: 'reason',
  id: 'payroll',
  label: 'Payroll',
  hueToken: '--payroll',
  // 07's wording, deliberately not 1a's. Screen 1a's payroll panel shows drop rows, an "Add
  // payroll provider" control and provider-file guidance -- that panel depicts the POST-#408
  // state and is #408's acceptance target. Lifting its copy here would ship provider
  // instructions for an ingestion path that does not exist.
  headline: 'Bring payroll in as a GL-side journal entry',
  // 07's substance, reordered to lead with the action. Both of its facts survive: what to do this
  // period, and that the register as its own source in a run arrives with #408. Deliberately not
  // 1a's copy, which shows provider rows for the post-#408 state.
  reason:
    'Post the payroll register to the ledger as a journal entry and reconcile it there, as you do today. Attaching the register itself as a source in the run — matched line by line rather than in total — is what ships with the payroll track.',
  trackingIssue: '#408',
};

export const sourceTabs: readonly SourceTab[] = [
  {
    kind: 'droppable',
    id: 'bank',
    label: 'Bank statements',
    hueToken: '--bank',
    min: 1,
    max: MAX_SLOTS_PER_SUBLEDGER,
    optional: false,
    hint: 'Bulk import: drop up to 4 statements at once. Each name must start with its account number (or last 4 digits).',
    sampleName: '4321_bank-statement.csv',
  },
  {
    kind: 'droppable',
    id: 'gl',
    label: 'General ledger',
    hueToken: '--gl',
    min: 1,
    max: 1,
    optional: false,
    hint: 'One ledger export per run.',
    sampleName: 'gl-jan.csv',
    note: 'Header differences are reported but never block the run.',
  },
  {
    kind: 'reason',
    id: 'ap',
    label: 'AP / Payments',
    hueToken: '--ap',
    headline: 'Reconcile AP through the ledger this period',
    reason:
      'The control-account totals in your ledger export already carry the month’s payables activity: the control-account totals in your ledger export already carry the month’s payables activity. What this tab adds is the invoice-level detail behind those totals — matching a payment to the document it settles — and that needs the AP registry to check entity ids against.',
    trackingIssue: '#448',
  },
  {
    kind: 'reason',
    id: 'ar',
    label: 'AR / Invoices',
    hueToken: '--ar',
    headline: 'Reconcile AR through the ledger this period',
    reason:
      'Same as AP — the ledger export carries the receivables control-account totals. This tab adds the invoice-level detail, and unpaid invoices flowing to the open-items schedule rather than to exceptions, once the AR registry exists.',
    trackingIssue: '#448',
  },
  payrollTab,
];

const tabsById = new Map(sourceTabs.map((tab) => [tab.id, tab]));

/** Looks a tab up by an arbitrary string. Returns undefined for anything not in `sourceTabIds`,
 * which is what lets an unrecognised `?source=` fall back rather than render an empty panel. */
export const findSourceTab = (id: string): SourceTab | undefined => tabsById.get(id as SourceTabId);

/** Total lookup for an id already known to be valid — every `SourceTabId` has a tab by
 * construction, so callers that went through `resolveSourceTab` need no undefined branch and no
 * non-null assertion. */
export const getSourceTab = (id: SourceTabId): SourceTab => tabsById.get(id)!;

/** The tab a bare visit lands on. */
export const DEFAULT_SOURCE_TAB: SourceTabId = 'bank';

/** Reads `?source=` into a tab id, falling back to the default for anything unrecognised — an
 * old or hand-edited link must not strand the user on a blank panel. */
export const resolveSourceTab = (raw: string | null): SourceTabId =>
  raw && findSourceTab(raw) ? (raw as SourceTabId) : DEFAULT_SOURCE_TAB;

/** Type guard, so callers can narrow without repeating the discriminant string. */
export const isDroppable = (tab: SourceTab): tab is DroppableSourceTab => tab.kind === 'droppable';

/**
 * The tab's second line (README 1a): what this source type currently contributes to the run.
 *
 * An optional type with nothing attached reads "optional" rather than "0 of 4" — a zero count
 * would imply the run is short of something it is not. This is the same instinct as the rail's
 * badge rule (absent, not zero) applied to a strip that has no badges.
 */
export const sourceTabMeta = (tab: SourceTab, attached: number): string => {
  if (tab.kind === 'reason') return 'optional';
  if (tab.id === 'gl') return attached > 0 ? '1 workbook' : 'required';
  const unit = tab.id === 'bank' ? 'accounts' : 'entities';
  if (attached === 0) return tab.optional ? 'optional' : `0 of ${tab.max} ${unit}`;
  return `${attached} of ${tab.max} ${unit}`;
};
