import {
  useEffect,
  useState,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { parseSubledgerEntityIdFromFilename } from '@recon/domain';
import type { CanonicalField, ReconciliationAccount } from '@recon/domain';

import { suggestAccountIdForFilename } from '../lib/bankAccountSuggestion';
import { BankAccountAssignment } from './BankAccountAssignment';

import { useHeaderPreviewWarning } from '../hooks/useHeaderPreviewWarning';
import { formatFileSize } from '../lib/formatFileSize';
import { ImportUploadCard, type RejectedUploadCode } from './ImportUploadCard';

type SourceKind = 'bank' | 'gl' | 'billing';

/** Issue #153: a run supports 1-4 bank accounts. */
export const MIN_BANK_ACCOUNTS = 1;
export const MAX_BANK_ACCOUNTS = 4;

/** R1 WP4: an AP/Billing run supports 1-4 entity ledgers, mirroring the bank-account cardinality. */
export const MIN_AP_ENTITIES = 1;
export const MAX_AP_ENTITIES = 4;

/** Screen 02's client-side upload gate: `.csv`/`.xlsx` only, 50 MB per file, both enforced before
 * any request -- a rejected file never reaches `setBankFiles`/`setGlFile`/`setApFiles` and so
 * never becomes part of an `import_file` row. */
const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];

interface RejectedUpload {
  id: string;
  file: File;
  code: RejectedUploadCode;
}

const detectRejection = (file: File): RejectedUploadCode | null => {
  const lower = file.name.toLowerCase();

  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'UPLOAD_EXTENSION_UNSUPPORTED';
  }

  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return 'UPLOAD_SIZE_EXCEEDED';
  }

  return null;
};

/** A-D1 (Issue #338) removed the bank equivalent of this check. A bank file used to be rejected
 * outright unless its name began with an account number, because the name was the only thing that
 * said which account the statement belonged to. The account is now chosen explicitly per slot, so
 * a filename carries no authority and any name is acceptable -- it only feeds the suggestion and
 * the disagreement warning in `BankAccountAssignment`. The subledgers keep their own convention.
 *
 * The caller supplies the code because AP and AR share this check and must not share its wording
 * (Phase 2 ruling on #401). */
const detectSubledgerEntityRejection = (
  file: File,
  code: 'UPLOAD_AP_FILENAME_INVALID' | 'UPLOAD_AR_FILENAME_INVALID',
): RejectedUploadCode | null =>
  parseSubledgerEntityIdFromFilename(file.name) === null ? code : null;

/** Slots 1-2 keep their pre-#153 ids (`bank-workbook-input`, `bank-workbook-b-input`) so existing
 * Playwright fixtures (`#bank-workbook-input`/`#bank-workbook-b-input`) don't break; slots 3-4 get
 * new lettered ids following the same pattern. */
const bankInputId = (index: number): string =>
  index === 0 ? 'bank-workbook-input' : `bank-workbook-${String.fromCharCode(97 + index)}-input`;

/** Same lettered-slot id convention as `bankInputId`, one namespace per subledger. AP keeps its
 * pre-existing unprefixed ids so the e2e fixtures that target `#ap-workbook-input` still resolve. */
const subledgerInputId = (subledger: 'ap' | 'ar', index: number): string =>
  index === 0
    ? `${subledger}-workbook-input`
    : `${subledger}-workbook-${String.fromCharCode(97 + index)}-input`;

const detectSource = (fileName: string): 'bank' | 'gl' | null => {
  const lower = fileName.toLowerCase();

  if (lower.includes('bank')) {
    return 'bank';
  }

  if (lower.includes('gl') || lower.includes('quickbook')) {
    return 'gl';
  }

  return null;
};

type SourceDropZoneProps = (
  | {
      mode: 'bank-gl';
      /** Which half of the pair this panel renders (Phase 2, #401). Bank and GL are separate tabs
       * on 1a, but they stay one component: dropped files are routed by filename signature, so a
       * GL export dropped on the Bank tab still lands in the GL slot rather than being rejected.
       * Splitting the component would mean splitting that detection, and a file would go nowhere
       * on whichever tab the user guessed wrong. */
      only: 'bank' | 'gl';
      bankFiles: (File | null)[];
      glFile: File | null;
      setBankFiles: Dispatch<SetStateAction<(File | null)[]>>;
      setGlFile: Dispatch<SetStateAction<File | null>>;
      /** A-D1 (Issue #338): the organization's registered accounts, and the explicit per-slot
       * assignment each staged statement carries. Positional -- `bankAccountIds[i]` belongs to
       * `bankFiles[i]` -- so adding or removing a slot must move both together. */
      accounts: readonly ReconciliationAccount[];
      bankAccountIds: (string | null)[];
      setBankAccountIds: Dispatch<SetStateAction<(string | null)[]>>;
      /** The registry could not be read. Distinct from an empty registry: one is a failure to
       * report, the other is a prompt to register the first account. */
      accountsUnavailable?: boolean;
    }
  | {
      mode: 'subledger';
      subledger: 'ap' | 'ar';
      apFiles: (File | null)[];
      setApFiles: Dispatch<SetStateAction<(File | null)[]>>;
    }
) & {
  /** R2 V6 (warn-only, Issue #250): the canonical schema, for the per-slot fuzzy header preview.
   * Empty while `getCanonicalFieldsRequest` is still loading -- `SourceSlot` treats that the same
   * as "nothing to check yet" and shows no warning. */
  canonicalFields: CanonicalField[];
};

/** Dispatches to the Bank/GL or AP/Billing drop zone by `mode` -- kept as one exported component
 * so callers don't need to know there are two internal implementations, while each mode's own
 * logic/render stays independent (no shared mutable state to reason about across modes) since
 * only one is ever mounted at a time (R1 WP3's tab strip). */
export function SourceDropZone(props: Readonly<SourceDropZoneProps>) {
  if (props.mode === 'subledger') {
    return (
      <SubledgerDropZone
        subledger={props.subledger}
        apFiles={props.apFiles}
        setApFiles={props.setApFiles}
        canonicalFields={props.canonicalFields}
      />
    );
  }
  return (
    <BankGlDropZone
      only={props.only}
      bankFiles={props.bankFiles}
      glFile={props.glFile}
      setBankFiles={props.setBankFiles}
      setGlFile={props.setGlFile}
      accounts={props.accounts}
      bankAccountIds={props.bankAccountIds}
      setBankAccountIds={props.setBankAccountIds}
      accountsUnavailable={props.accountsUnavailable}
      canonicalFields={props.canonicalFields}
    />
  );
}

/**
 * Single drop zone that accepts every source workbook: 1-4 per-account bank workbooks (Issue
 * #153) plus one GL workbook. Files are auto-assigned by filename signature -- bank files fill
 * the first empty bank slot in drop order, growing a new slot (up to the 4-account cap) if none
 * is empty -- with per-slot inputs for manual override, an "Add another" control, and a per-slot
 * remove control (floored at 1 slot).
 */
function BankGlDropZone({
  only,
  bankFiles,
  glFile,
  setBankFiles,
  setGlFile,
  accounts,
  bankAccountIds,
  setBankAccountIds,
  accountsUnavailable = false,
  canonicalFields,
}: Readonly<{
  only: 'bank' | 'gl';
  bankFiles: (File | null)[];
  glFile: File | null;
  setBankFiles: Dispatch<SetStateAction<(File | null)[]>>;
  setGlFile: Dispatch<SetStateAction<File | null>>;
  accounts: readonly ReconciliationAccount[];
  bankAccountIds: (string | null)[];
  setBankAccountIds: Dispatch<SetStateAction<(string | null)[]>>;
  accountsUnavailable?: boolean;
  canonicalFields: CanonicalField[];
}>) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedUpload[]>([]);
  const [nextRejectionId, setNextRejectionId] = useState(0);

  const rejectFile = (file: File, code: RejectedUploadCode): void => {
    setRejectedFiles((prev) => [...prev, { id: `rejected-${nextRejectionId}`, file, code }]);
    setNextRejectionId((id) => id + 1);
  };

  /** One `assignFiles` call can see several bank-shaped files in the same batch (a multi-file drop
   * or the merged "Source workbooks" picker) -- `setBankFiles`/`setGlFile` don't take effect until
   * the next render, so deciding "which slots are already taken" from the `bankFiles`/`glFile`
   * props would have every file in the batch see the same stale (pre-batch) answer. Building the
   * next `bankFiles` array locally and committing it once at the end avoids that -- no per-file
   * setter calls, no stale-closure tracking needed. */
  const assignFiles = (files: FileList | File[]): void => {
    const incoming = Array.from(files);
    const unassigned: File[] = [];
    const nextBankFiles = [...bankFiles];
    let nextGlFile = glFile;

    const assignBankSlot = (file: File): boolean => {
      const emptyIndex = nextBankFiles.findIndex((slotFile) => slotFile === null);
      if (emptyIndex !== -1) {
        nextBankFiles[emptyIndex] = file;
        return true;
      }
      if (nextBankFiles.length < MAX_BANK_ACCOUNTS) {
        nextBankFiles.push(file);
        return true;
      }
      return false;
    };

    for (const file of incoming) {
      const rejection = detectRejection(file);
      if (rejection) {
        rejectFile(file, rejection);
        continue;
      }

      const detected = detectSource(file.name);

      if (detected === 'bank') {
        if (!assignBankSlot(file)) {
          rejectFile(file, 'UPLOAD_BANK_ACCOUNT_LIMIT_REACHED');
        }
      } else if (detected === 'gl') {
        nextGlFile = file;
      } else {
        unassigned.push(file);
      }
    }

    for (const file of unassigned) {
      const hasEmptyBankSlot = nextBankFiles.some((slotFile) => slotFile === null);
      if (hasEmptyBankSlot || nextBankFiles.length < MAX_BANK_ACCOUNTS) {
        assignBankSlot(file);
      } else if (nextGlFile === null) {
        nextGlFile = file;
      }
    }

    setBankFiles(nextBankFiles);
    // No suggestion pass here -- the effect above picks the new files up on the next render, and
    // covers the case where the registry has not loaded yet as well.
    if (nextGlFile !== glFile) {
      setGlFile(nextGlFile);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDragging(false);

    if (event.dataTransfer?.files?.length) {
      assignFiles(event.dataTransfer.files);
    }
  };

  const removeRejected = (id: string): void => {
    setRejectedFiles((prev) => prev.filter((entry) => entry.id !== id));
  };

  const onBankFileChange = (index: number, file: File | null): void => {
    if (file === null) {
      setBankFiles((prev) => prev.map((slotFile, i) => (i === index ? null : slotFile)));
      return;
    }

    const rejection = detectRejection(file);
    if (rejection) {
      rejectFile(file, rejection);
      return;
    }

    setBankFiles((prev) => prev.map((slotFile, i) => (i === index ? file : slotFile)));
  };

  /**
   * Pre-selects an account for any staged file whose name points at exactly one (A-D1 forbids
   * picking the first of several).
   *
   * Reactive rather than fired at drop time, because the registry loads asynchronously: a file
   * staged before the accounts arrive would otherwise get no suggestion at all and never get one
   * afterwards. Depending on `accounts` means the suggestion appears as soon as there is something
   * to suggest from, whichever order the two happen in.
   *
   * Only ever fills an empty slot. An operator's explicit choice is never overwritten -- including
   * by a re-render, a slot reorder, or the registry reloading.
   */
  useEffect(() => {
    setBankAccountIds((prev) => {
      const next = [...prev];
      while (next.length < bankFiles.length) next.push(null);
      next.length = bankFiles.length;

      let changed = next.length !== prev.length;
      for (let index = 0; index < bankFiles.length; index += 1) {
        const file = bankFiles[index];
        if (!file || next[index] !== null) continue;
        const suggested = suggestAccountIdForFilename(file.name, accounts);
        if (suggested !== null) {
          next[index] = suggested;
          changed = true;
        }
      }
      // Returning `prev` unchanged keeps this from scheduling a render on every accounts/file
      // update, which would re-run the effect and loop.
      return changed ? next : prev;
    });
  }, [bankFiles, accounts, setBankAccountIds]);

  const onAssignmentChange = (index: number, accountId: string | null): void => {
    setBankAccountIds((prev) => prev.map((current, i) => (i === index ? accountId : current)));
  };

  const onAddBankSlot = (): void => {
    setBankFiles((prev) => (prev.length < MAX_BANK_ACCOUNTS ? [...prev, null] : prev));
    // Growth is also handled by the effect above, but doing it here keeps the two arrays the same
    // length within a single render rather than for one frame's difference.
    setBankAccountIds((prev) => (prev.length < MAX_BANK_ACCOUNTS ? [...prev, null] : prev));
  };

  const onRemoveBankSlot = (index: number): void => {
    setBankFiles((prev) =>
      prev.length > MIN_BANK_ACCOUNTS ? prev.filter((_, i) => i !== index) : prev,
    );
    setBankAccountIds((prev) =>
      prev.length > MIN_BANK_ACCOUNTS ? prev.filter((_, i) => i !== index) : prev,
    );
  };

  const glSlotChange = (file: File | null): void => {
    if (file === null) {
      setGlFile(null);
      return;
    }

    const rejection = detectRejection(file);
    if (rejection) {
      rejectFile(file, rejection);
      return;
    }

    setGlFile(file);
  };

  return (
    <div className="source-dropzone">
      <label
        className={
          isDragging
            ? 'source-dropzone__drop source-dropzone__drop--active'
            : 'source-dropzone__drop'
        }
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <span className="source-dropzone__prompt">
          {only === 'bank'
            ? 'Drag your bank statements here, or browse'
            : 'Drag your GL export here, or browse'}
        </span>
        <span className="source-dropzone__hint">.csv · .xlsx — max 50 MB per file</span>
        <span className="source-dropzone__browse-button">Choose files</span>
        <input
          type="file"
          accept=".csv,.xlsx"
          multiple
          aria-label="Source workbooks"
          onChange={(event) => {
            if (event.target.files?.length) {
              assignFiles(event.target.files);
            }
          }}
        />
      </label>

      <div className="source-dropzone__slots">
        {only === 'bank' &&
          bankFiles.map((file, index) => (
            <SourceSlot
              key={index}
              kind="bank"
              tag="BANK"
              label={`Bank workbook (Account ${index + 1})`}
              inputId={bankInputId(index)}
              file={file}
              onChange={(nextFile) => onBankFileChange(index, nextFile)}
              onRemove={
                bankFiles.length > MIN_BANK_ACCOUNTS ? () => onRemoveBankSlot(index) : undefined
              }
              canonicalFields={canonicalFields}
              footer={
                <BankAccountAssignment
                  file={file}
                  accounts={accounts}
                  accountId={bankAccountIds[index] ?? null}
                  onChange={(accountId) => onAssignmentChange(index, accountId)}
                  controlId={`${bankInputId(index)}-account`}
                  accountsUnavailable={accountsUnavailable}
                />
              }
            />
          ))}
        {only === 'gl' ? (
          <SourceSlot
            kind="gl"
            tag="GL"
            label="GL workbook"
            inputId="gl-workbook-input"
            file={glFile}
            onChange={glSlotChange}
            canonicalFields={canonicalFields}
          />
        ) : null}
      </div>

      {only === 'bank' && bankFiles.length < MAX_BANK_ACCOUNTS ? (
        <button type="button" className="secondary-button" onClick={onAddBankSlot}>
          Add another bank statement
        </button>
      ) : null}

      {rejectedFiles.length > 0 ? (
        <div className="source-dropzone__rejected-list">
          {rejectedFiles.map((entry) => (
            <ImportUploadCard
              key={entry.id}
              state="rejected"
              name={entry.file.name}
              sizeBytes={entry.file.size}
              code={entry.code}
              onRemove={() => removeRejected(entry.id)}
            />
          ))}
        </div>
      ) : null}

      <p className="source-dropzone__note">
        Bank workbooks fill the first empty slot in drop order (adding a new slot automatically, up
        to {MAX_BANK_ACCOUNTS} accounts), and GL is detected from its file name; use the slot
        pickers to override. Each bank file name must start with its account number (or last 4
        digits) followed by "-" or "_", e.g. "4321_bank-export.csv". Row counts, date range, and
        excluded rows are calculated when the reconciliation runs.
      </p>
    </div>
  );
}

/**
 * R1 WP4: drop zone for a combined AP/Billing subledger export -- invoices and payments
 * interleaved, separated downstream by Doc Type (WP0.1's file-validation engine). 1-4
 * entity-ledger slots, filling the first empty slot in drop order (mirroring
 * `BankGlDropZone`'s `assignBankSlot`), auto-adding a slot up to the cap. One slot type only
 * (no GL-style second slot), since every file here is the same AP_SUBLEDGER-shaped source.
 */
function SubledgerDropZone({
  subledger,
  apFiles,
  setApFiles,
  canonicalFields,
}: Readonly<{
  /** Which subledger this panel serves. AP and AR share this component because they share a
   * filename convention and a slot model -- but never a rejection code, so an AR file can never
   * surface AP-worded copy (the Phase 2 ruling on #401; screen 1b quotes these strings verbatim). */
  subledger: 'ap' | 'ar';
  apFiles: (File | null)[];
  setApFiles: Dispatch<SetStateAction<(File | null)[]>>;
  canonicalFields: CanonicalField[];
}>) {
  const codes =
    subledger === 'ap'
      ? {
          filename: 'UPLOAD_AP_FILENAME_INVALID' as const,
          limit: 'UPLOAD_AP_ENTITY_LIMIT_REACHED' as const,
        }
      : {
          filename: 'UPLOAD_AR_FILENAME_INVALID' as const,
          limit: 'UPLOAD_AR_ENTITY_LIMIT_REACHED' as const,
        };
  const noun = subledger === 'ap' ? 'AP' : 'AR';
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedUpload[]>([]);
  const [nextRejectionId, setNextRejectionId] = useState(0);

  const rejectFile = (file: File, code: RejectedUploadCode): void => {
    setRejectedFiles((prev) => [...prev, { id: `rejected-${nextRejectionId}`, file, code }]);
    setNextRejectionId((id) => id + 1);
  };

  const assignFiles = (files: FileList | File[]): void => {
    const incoming = Array.from(files);
    const nextApFiles = [...apFiles];

    const assignApSlot = (file: File): boolean => {
      const emptyIndex = nextApFiles.findIndex((slotFile) => slotFile === null);
      if (emptyIndex !== -1) {
        nextApFiles[emptyIndex] = file;
        return true;
      }
      if (nextApFiles.length < MAX_AP_ENTITIES) {
        nextApFiles.push(file);
        return true;
      }
      return false;
    };

    for (const file of incoming) {
      const rejection = detectRejection(file);
      if (rejection) {
        rejectFile(file, rejection);
        continue;
      }

      const entityRejection = detectSubledgerEntityRejection(file, codes.filename);
      if (entityRejection) {
        rejectFile(file, entityRejection);
        continue;
      }

      if (!assignApSlot(file)) {
        rejectFile(file, codes.limit);
      }
    }

    setApFiles(nextApFiles);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDragging(false);

    if (event.dataTransfer?.files?.length) {
      assignFiles(event.dataTransfer.files);
    }
  };

  const removeRejected = (id: string): void => {
    setRejectedFiles((prev) => prev.filter((entry) => entry.id !== id));
  };

  const onApFileChange = (index: number, file: File | null): void => {
    if (file === null) {
      setApFiles((prev) => prev.map((slotFile, i) => (i === index ? null : slotFile)));
      return;
    }

    const rejection = detectRejection(file);
    if (rejection) {
      rejectFile(file, rejection);
      return;
    }

    const entityRejection = detectSubledgerEntityRejection(file, codes.filename);
    if (entityRejection) {
      rejectFile(file, entityRejection);
      return;
    }

    setApFiles((prev) => prev.map((slotFile, i) => (i === index ? file : slotFile)));
  };

  const onAddApSlot = (): void => {
    setApFiles((prev) => (prev.length < MAX_AP_ENTITIES ? [...prev, null] : prev));
  };

  const onRemoveApSlot = (index: number): void => {
    setApFiles((prev) =>
      prev.length > MIN_AP_ENTITIES ? prev.filter((_, i) => i !== index) : prev,
    );
  };

  return (
    <div className="source-dropzone">
      <label
        className={
          isDragging
            ? 'source-dropzone__drop source-dropzone__drop--active'
            : 'source-dropzone__drop'
        }
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <span className="source-dropzone__prompt">
          Drag your AP/Billing subledger export here, or browse
        </span>
        <span className="source-dropzone__hint">.csv · .xlsx — max 50 MB per file</span>
        <span className="source-dropzone__browse-button">Choose files</span>
        <input
          type="file"
          accept=".csv,.xlsx"
          multiple
          aria-label="AP/Billing subledger workbooks"
          onChange={(event) => {
            if (event.target.files?.length) {
              assignFiles(event.target.files);
            }
          }}
        />
      </label>

      <div className="source-dropzone__slots">
        {apFiles.map((file, index) => (
          <SourceSlot
            key={index}
            kind="billing"
            tag={noun}
            label={`${noun} workbook (Entity ${index + 1})`}
            inputId={subledgerInputId(subledger, index)}
            file={file}
            onChange={(nextFile) => onApFileChange(index, nextFile)}
            onRemove={apFiles.length > MIN_AP_ENTITIES ? () => onRemoveApSlot(index) : undefined}
            canonicalFields={canonicalFields}
          />
        ))}
      </div>

      {apFiles.length < MAX_AP_ENTITIES ? (
        <button type="button" className="secondary-button" onClick={onAddApSlot}>
          {`Add another ${noun} entity ledger`}
        </button>
      ) : null}

      {rejectedFiles.length > 0 ? (
        <div className="source-dropzone__rejected-list">
          {rejectedFiles.map((entry) => (
            <ImportUploadCard
              key={entry.id}
              state="rejected"
              name={entry.file.name}
              sizeBytes={entry.file.size}
              code={entry.code}
              onRemove={() => removeRejected(entry.id)}
            />
          ))}
        </div>
      ) : null}

      <p className="source-dropzone__note">
        AP/Billing workbooks fill the first empty slot in drop order (adding a new slot
        automatically, up to {MAX_AP_ENTITIES} entities); use the slot pickers to override. Each
        file name must start with its entity id followed by "-" or "_", e.g. "E100_ap-export.csv".
        Invoices and payments are separated downstream by Doc Type. Row counts, date range, and
        excluded rows are calculated when the reconciliation runs.
      </p>
    </div>
  );
}

/** The mono tag, prompt and one-line hint each slot kind shows in its 48px row (README 1a). Keyed
 * by kind so a caller cannot give a bank slot AP's filename rule by mistake. The subledger entry
 * is shared by AP and AR: they have the same convention, and the tag that distinguishes them is
 * passed per call. */
const SLOT_COPY: Record<SourceKind, { prompt: string; hint: string }> = {
  bank: {
    prompt: 'Drop statement here',
    hint: 'Name starts with the account number, or its last four — e.g. 4321_bank-statement.csv',
  },
  gl: {
    prompt: 'Drop ledger export here',
    hint: 'One workbook covering every account in the run',
  },
  billing: {
    prompt: 'Drop subledger here',
    hint: 'Name starts with the entity id — e.g. E100_ap-payments.csv',
  },
};

function SourceSlot({
  kind,
  tag,
  label,
  inputId,
  file,
  onChange,
  onRemove,
  canonicalFields,
  footer,
}: Readonly<{
  kind: SourceKind;
  /** The mono source tag in the row's first cell — BANK, GL, AP, AR. */
  tag: string;
  label: string;
  inputId: string;
  file: File | null;
  onChange: (file: File | null) => void;
  onRemove?: () => void;
  canonicalFields: CanonicalField[];
  /** Rendered below the slot's own contents. Bank slots pass their account-assignment control
   * here so the choice sits with the file it belongs to; GL and AP slots pass nothing. */
  footer?: ReactNode;
}>) {
  const { prompt, hint } = SLOT_COPY[kind];
  const detected = kind === 'billing' ? null : file ? detectSource(file.name) : null;
  const isOverride = kind !== 'billing' && Boolean(file) && detected !== null && detected !== kind;
  const headerWarning = useHeaderPreviewWarning(file, canonicalFields);

  // README 1a: the file line is a 48px row -- mono tag, prompt, one-line hint, Browse, remove. The
  // spec's four-column grid has no cell for the per-slot account picker, and #401 says A-D1's
  // assignment control is unchanged; the reading that satisfies both is that 48px describes the
  // FILE row, with the assignment staying beneath as the slot's footer. A single row containing a
  // select cannot be 48px, so the alternative would mean dropping a control A-D1 requires.
  return (
    <div
      className={[
        'source-slot',
        // The hue is per source type, not per slot kind: AP and AR share `kind: 'billing'` but
        // must not share a colour, since the whole point of five distinct hues is that a glance
        // at the strip tells them apart.
        `source-slot--${tag.toLowerCase()}`,
        file ? 'source-slot--filled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="source-slot__row">
        <span className="source-slot__tag">{tag}</span>
        {file ? (
          <>
            <span className="source-slot__name">{file.name}</span>
            <span className="source-slot__size">{formatFileSize(file.size)}</span>
            <span className="source-slot__stored">Stored</span>
          </>
        ) : (
          <>
            <label className="source-slot__prompt" htmlFor={inputId}>
              {prompt}
            </label>
            <span className="source-slot__hint">{hint}</span>
          </>
        )}
        <span className="source-slot__actions">
          <label className="source-slot__browse" htmlFor={inputId}>
            Browse
          </label>
          {onRemove ? (
            <button
              type="button"
              className="source-slot__remove"
              onClick={onRemove}
              aria-label={`Remove ${label}`}
            >
              ×
            </button>
          ) : null}
        </span>
      </div>
      {/* The visible label moved into the row above; this keeps the input's accessible name, which
          every e2e fixture and unit test locates the slot by. */}
      <label className="visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".csv,.xlsx"
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          if (selected === null) {
            // Issue #291. A `change` carrying no files is not a user clearing this slot: there is
            // no clear affordance (Remove deletes the whole slot), and cancelling the picker fires
            // no event at all. Passing the `null` through took `onBankFileChange`'s
            // `file === null` branch, which emptied the slot and returned -- no rejection
            // recorded, and the slot still showing its empty prompt -- indistinguishable from the
            // file never having been offered. Both multi-file inputs above already ignore this case
            // (`if (event.target.files?.length)`); this makes the per-slot input agree with them.
            //
            // Not a proven fix for #291 -- the mechanism there is still unknown and it no longer
            // reproduces. This removes the one path in this component that can lose a file
            // without leaving a trace, and warns if it is ever taken.
            console.warn(
              `Ignored a file input change carrying no files (slot "${inputId}"). See issue #291.`,
            );
            return;
          }
          onChange(selected);
        }}
      />
      {file && isOverride ? <span className="source-slot__override">Manual override</span> : null}

      {headerWarning && headerWarning.unmatchedRequiredFields.length > 0 ? (
        <p className="source-slot__header-warning">
          We couldn&apos;t confidently match a column to{' '}
          {headerWarning.unmatchedRequiredFields.map((field, index) => (
            <span key={field.id}>
              {index > 0 ? ', ' : ''}
              <strong>{field.id}</strong>
            </span>
          ))}{' '}
          in this file&apos;s header. This is just a heads-up -- you can still submit, and the real
          check happens then.
        </p>
      ) : null}
      {footer}
    </div>
  );
}
