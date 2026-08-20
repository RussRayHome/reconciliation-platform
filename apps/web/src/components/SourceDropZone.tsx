import { type Dispatch, type DragEvent, type SetStateAction, useState } from 'react';

import { parseBankAccountLast4FromFilename } from '@recon/domain';

import { formatFileSize } from '../lib/formatFileSize';
import { ImportUploadCard, type RejectedUploadCode } from './ImportUploadCard';

type SourceKind = 'bank' | 'gl';

/** Issue #153: a run supports 1-4 bank accounts. */
export const MIN_BANK_ACCOUNTS = 1;
export const MAX_BANK_ACCOUNTS = 4;

/** Screen 02's client-side upload gate: `.csv`/`.xlsx` only, 50 MB per file, both enforced before
 * any request -- a rejected file never reaches `setBankFiles`/`setGlFile` and so never becomes
 * part of an `import_file` row. */
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

/** ADR-0003 (Issue #141): a bank file's account is parsed from its ORIGINAL FILENAME, not its
 * content, so this is the same client-side pre-check the server runs authoritatively in
 * `mergeBankFiles` -- catching a misnamed file here saves a full round-trip, but the server call
 * remains the actual enforcement boundary. */
const detectBankAccountRejection = (file: File): RejectedUploadCode | null =>
  parseBankAccountLast4FromFilename(file.name) === null ? 'UPLOAD_BANK_FILENAME_INVALID' : null;

/** Slots 1-2 keep their pre-#153 ids (`bank-workbook-input`, `bank-workbook-b-input`) so existing
 * Playwright fixtures (`#bank-workbook-input`/`#bank-workbook-b-input`) don't break; slots 3-4 get
 * new lettered ids following the same pattern. */
const bankInputId = (index: number): string =>
  index === 0 ? 'bank-workbook-input' : `bank-workbook-${String.fromCharCode(97 + index)}-input`;

const detectSource = (fileName: string): SourceKind | null => {
  const lower = fileName.toLowerCase();

  if (lower.includes('bank')) {
    return 'bank';
  }

  if (lower.includes('gl') || lower.includes('quickbook')) {
    return 'gl';
  }

  return null;
};

/**
 * Single drop zone that accepts every source workbook: 1-4 per-account bank workbooks (Issue
 * #153) plus one GL workbook. Files are auto-assigned by filename signature -- bank files fill
 * the first empty bank slot in drop order, growing a new slot (up to the 4-account cap) if none
 * is empty -- with per-slot inputs for manual override, an "Add another" control, and a per-slot
 * remove control (floored at 1 slot).
 */
export function SourceDropZone({
  bankFiles,
  glFile,
  setBankFiles,
  setGlFile,
}: Readonly<{
  bankFiles: (File | null)[];
  glFile: File | null;
  setBankFiles: Dispatch<SetStateAction<(File | null)[]>>;
  setGlFile: Dispatch<SetStateAction<File | null>>;
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
        const accountRejection = detectBankAccountRejection(file);
        if (accountRejection) {
          rejectFile(file, accountRejection);
          continue;
        }
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

    const accountRejection = detectBankAccountRejection(file);
    if (accountRejection) {
      rejectFile(file, accountRejection);
      return;
    }

    setBankFiles((prev) => prev.map((slotFile, i) => (i === index ? file : slotFile)));
  };

  const onAddBankSlot = (): void => {
    setBankFiles((prev) => (prev.length < MAX_BANK_ACCOUNTS ? [...prev, null] : prev));
  };

  const onRemoveBankSlot = (index: number): void => {
    setBankFiles((prev) =>
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
          Drag your bank and GL workbooks here, or browse
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
        {bankFiles.map((file, index) => (
          <SourceSlot
            key={index}
            kind="bank"
            label={`Bank workbook (Account ${index + 1})`}
            inputId={bankInputId(index)}
            file={file}
            onChange={(nextFile) => onBankFileChange(index, nextFile)}
            onRemove={bankFiles.length > MIN_BANK_ACCOUNTS ? () => onRemoveBankSlot(index) : undefined}
          />
        ))}
        <SourceSlot
          kind="gl"
          label="GL workbook"
          inputId="gl-workbook-input"
          file={glFile}
          onChange={glSlotChange}
        />
      </div>

      {bankFiles.length < MAX_BANK_ACCOUNTS ? (
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
        Bank workbooks fill the first empty slot in drop order (adding a new slot automatically,
        up to {MAX_BANK_ACCOUNTS} accounts), and GL is detected from its file name; use the slot
        pickers to override. Each bank file name must start with its account number (or last 4
        digits) followed by "-" or "_", e.g. "4321_bank-export.csv". Row counts, date range, and
        excluded rows are calculated when the reconciliation runs.
      </p>
    </div>
  );
}

function SourceSlot({
  kind,
  label,
  inputId,
  file,
  onChange,
  onRemove,
}: Readonly<{
  kind: SourceKind;
  label: string;
  inputId: string;
  file: File | null;
  onChange: (file: File | null) => void;
  onRemove?: () => void;
}>) {
  const detected = file ? detectSource(file.name) : null;
  const isOverride = Boolean(file) && detected !== null && detected !== kind;

  return (
    <div className="source-slot">
      <div className="source-slot__header">
        <label htmlFor={inputId}>{label}</label>
        {onRemove ? (
          <button
            type="button"
            className="import-upload-card__ghost-button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
          >
            Remove
          </button>
        ) : null}
      </div>
      <input
        id={inputId}
        type="file"
        accept=".csv,.xlsx"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="source-slot__file">
          <strong>{file.name}</strong>
          <span>{formatFileSize(file.size)}</span>
          {isOverride ? <span className="source-slot__override">Manual override</span> : null}
        </div>
      ) : (
        <p className="source-slot__empty">No file selected</p>
      )}
    </div>
  );
}
