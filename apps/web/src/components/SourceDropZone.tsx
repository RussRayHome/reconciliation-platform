import { type Dispatch, type DragEvent, type SetStateAction, useState } from 'react';

import { parseBankAccountLast4FromFilename } from '@recon/domain';

import { formatFileSize } from '../lib/formatFileSize';
import { ImportUploadCard, type RejectedUploadCode } from './ImportUploadCard';

/** Content-based classification from the file name alone -- doesn't distinguish Account A vs B
 * (both are just "a bank file" by keyword), that split happens by slot-fill order instead. */
type SourceKind = 'bank' | 'gl';
type SourceSlotKind = 'bankA' | 'bankB' | 'gl';

/** Screen 02's client-side upload gate: `.csv`/`.xlsx` only, 50 MB per file, both enforced before
 * any request -- a rejected file never reaches `setBankFileA`/`setBankFileB`/`setGlFile` and so
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

/** ADR-0003 (Issue #141): a bank file's account is parsed from its ORIGINAL FILENAME, not its
 * content, so this is the same client-side pre-check the server runs authoritatively in
 * `mergeBankFiles` -- catching a misnamed file here saves a full round-trip, but the server call
 * remains the actual enforcement boundary. */
const detectBankAccountRejection = (file: File): RejectedUploadCode | null =>
  parseBankAccountLast4FromFilename(file.name) === null ? 'UPLOAD_BANK_FILENAME_INVALID' : null;

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
 * Single drop zone that accepts all three source workbooks (two per-account bank workbooks + one
 * GL workbook). Files are auto-assigned by filename signature -- bank files fill Account A then
 * Account B in the order they're dropped/detected -- with per-slot inputs for manual override.
 */
export function SourceDropZone({
  bankFileA,
  bankFileB,
  glFile,
  setBankFileA,
  setBankFileB,
  setGlFile,
}: Readonly<{
  bankFileA: File | null;
  bankFileB: File | null;
  glFile: File | null;
  setBankFileA: Dispatch<SetStateAction<File | null>>;
  setBankFileB: Dispatch<SetStateAction<File | null>>;
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
   * or the merged "Source workbooks" picker) -- `setBankFileA`/`setBankFileB` don't take effect
   * until the next render, so deciding "is slot A taken" from the `bankFileA`/`bankFileB` props
   * would have every file in the batch see the same stale (pre-batch) answer and pile into slot A.
   * These locally-scoped flags track what's already been claimed *within this one call* instead. */
  const assignFiles = (files: FileList | File[]): void => {
    const incoming = Array.from(files);
    const unassigned: File[] = [];
    let bankSlotAFilled = Boolean(bankFileA);
    let bankSlotBFilled = Boolean(bankFileB);
    let glSlotFilled = Boolean(glFile);

    const assignBankSlot = (file: File): void => {
      if (!bankSlotAFilled) {
        setBankFileA(file);
        bankSlotAFilled = true;
      } else {
        setBankFileB(file);
        bankSlotBFilled = true;
      }
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
        assignBankSlot(file);
      } else if (detected === 'gl') {
        setGlFile(file);
        glSlotFilled = true;
      } else {
        unassigned.push(file);
      }
    }

    for (const file of unassigned) {
      if (!bankSlotAFilled || !bankSlotBFilled) {
        assignBankSlot(file);
      } else if (!glSlotFilled) {
        setGlFile(file);
        glSlotFilled = true;
      }
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

  const bankSlotChange = (
    setter: Dispatch<SetStateAction<File | null>>,
    file: File | null,
  ): void => {
    if (file === null) {
      setter(null);
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

    setter(file);
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
        <span className="source-dropzone__prompt">Drag all three workbooks here, or browse</span>
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
        <SourceSlot
          slot="bankA"
          label="Bank workbook (Account A)"
          inputId="bank-workbook-input"
          file={bankFileA}
          onChange={(file) => bankSlotChange(setBankFileA, file)}
        />
        <SourceSlot
          slot="bankB"
          label="Bank workbook (Account B)"
          inputId="bank-workbook-b-input"
          file={bankFileB}
          onChange={(file) => bankSlotChange(setBankFileB, file)}
        />
        <SourceSlot
          slot="gl"
          label="GL workbook"
          inputId="gl-workbook-input"
          file={glFile}
          onChange={glSlotChange}
        />
      </div>

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
        Bank workbooks fill Account A then Account B in drop order, and GL is detected from its
        file name; use the slot pickers to override. Each bank file name must start with its
        account number (or last 4 digits) followed by "-" or "_", e.g. "4321_bank-export.csv". Row
        counts, date range, and excluded rows are calculated when the reconciliation runs.
      </p>
    </div>
  );
}

function SourceSlot({
  slot,
  label,
  inputId,
  file,
  onChange,
}: Readonly<{
  slot: SourceSlotKind;
  label: string;
  inputId: string;
  file: File | null;
  onChange: (file: File | null) => void;
}>) {
  const slotKind: SourceKind = slot === 'gl' ? 'gl' : 'bank';
  const detected = file ? detectSource(file.name) : null;
  const isOverride = Boolean(file) && detected !== null && detected !== slotKind;

  return (
    <div className="source-slot">
      <label htmlFor={inputId}>{label}</label>
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
