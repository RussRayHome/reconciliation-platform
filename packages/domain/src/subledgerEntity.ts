/**
 * Subledger entity identity (UI-9, Issue #448, designs 5a/5b).
 *
 * An AP or AR entity is the same kind of object as a registered bank account: a stable identity a
 * file is attributed to, which outlives any one run. The parallel is deliberate — the design says
 * 5a is "built on 3a's pattern" — so this mirrors `reconciliationAccount.ts` rather than inventing
 * a second vocabulary for the same idea.
 *
 * Lives in `@recon/domain` because `apps/web` needs the same label formatting and the same
 * immutability rule the API enforces, and has no dependency on `@recon/core`.
 */

/** Which registry an entity belongs to. AP and AR are separate registries with identical
 * structure; a single legal entity may legitimately appear in both (Northwind can be a vendor and
 * a customer), which is why this is part of the identity rather than a filter over one list. */
export const subledgerKinds = ['ap', 'ar'] as const;
export type SubledgerKind = (typeof subledgerKinds)[number];

/** One registered subledger entity. */
export interface SubledgerEntity {
  /** Stable identity, generated once at registration. Never shown to an operator. */
  id: string;
  organizationId: string;
  kind: SubledgerKind;
  /**
   * The prefix this entity's filenames carry — `E100` in `E100_ap-payments.csv`.
   *
   * **Immutable once created.** Screen 5a states the reason: the id is what a filename claims, so
   * changing it would silently re-point every file, run and open item already attributed to it.
   * Rename `displayName` instead. Enforced by omission — `UpdateSubledgerEntityInput` has no field
   * for it, the same way `UpdateReconciliationAccountInput` omits `accountIdentifier`.
   */
  entityId: string;
  /** The human-facing name. The mutable half of the pair above. */
  displayName: string;
  /**
   * Where this entity's ledger comes from — "Files (CSV or XLSX)", "QuickBooks". Free text and
   * nullable on purpose: 5a shows an accounting-system option that does not exist yet (#464), and
   * a fixed vocabulary would encode a design nobody has settled.
   */
  ledgerSource: string | null;
  currencyCode: string;
  /** Deactivated entities keep every file, run and open item already attributed to them and stop
   * being offered for new assignments. There is no delete — the same rule bank accounts follow. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields supplied when opening a new entity. The organization comes from the authenticated
 * principal, never the request body. */
export interface RegisterSubledgerEntityInput {
  kind: SubledgerKind;
  entityId: string;
  displayName: string;
  ledgerSource?: string | null;
  currencyCode?: string;
}

/** Fields an admin may change afterwards. `entityId` and `kind` are absent deliberately: the first
 * is what filenames claim, the second is which registry the row lives in — changing either would
 * re-point history rather than edit it. */
export interface UpdateSubledgerEntityInput {
  displayName?: string;
  ledgerSource?: string | null;
  currencyCode?: string;
  isActive?: boolean;
}

/**
 * How an entity reads wherever it is named — the New run AP tab, exception evidence, the audit
 * workbook. Screen 5a renders this as a live PREVIEW row so an operator sees the real output
 * rather than a mocked string.
 */
export const formatSubledgerEntityLabel = (entity: SubledgerEntity): string =>
  `${entity.displayName} · ${entity.entityId}`;
