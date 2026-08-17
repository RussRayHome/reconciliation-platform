import { type Dispatch, type DragEvent, type SetStateAction, useState } from 'react';

import { formatFileSize } from '../lib/formatFileSize';
import { ImportUploadCard, type RejectedUploadCode } from './ImportUploadCard';

type SourceKind = 'bank' | 'gl';

/** Screen 02's client-side upload gate: `.csv`/`.xlsx` only, 50 MB per file, both enforced before
 * any request -- a rejected file never reaches `setBankFile`/`setGlFile` and so never becomes part
 * of an `import_file` row. */
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
 * Single drop zone that accepts both source workbooks. Files are auto-assigned to the bank or GL
 * slot by filename signature, with per-slot inputs for manual override.
 */
export function SourceDropZone({
  bankFile,
  glFile,
  setBankFile,
  setGlFile,
}: Readonly<{
  bankFile: File | null;
  glFile: File | null;
  setBankFile: Dispatch<SetStateAction<File | null>>;
  setGlFile: Dispatch<SetStateAction<File | null>>;
}>) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedUpload[]>([]);
  const [nextRejectionId, setNextRejectionId] = useState(0);

  const rejectFile = (file: File, code: RejectedUploadCode): void => {
    setRejectedFiles((prev) => [...prev, { id: `rejected-${nextRejectionId}`, file, code }]);
    setNextRejectionId((id) => id + 1);
  };

  const assignFiles = (files: FileList | File[]): void => {
    const incoming = Array.from(files);
    const unassigned: File[] = [];

    for (const file of incoming) {
      const rejection = detectRejection(file);
      if (rejection) {
        rejectFile(file, rejection);
        continue;
      }

      const detected = detectSource(file.name);

      if (detected === 'bank') {
        setBankFile(file);
      } else if (detected === 'gl') {
        setGlFile(file);
      } else {
        unassigned.push(file);
      }
    }

    for (const file of unassigned) {
      if (!bankFile) {
        setBankFile(file);
      } else if (!glFile) {
        setGlFile(file);
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

  const bankSlotChange = (file: File | null): void => {
    if (file === null) {
      setBankFile(null);
      return;
    }

    const rejection = detectRejection(file);
    if (rejection) {
      rejectFile(file, rejection);
      return;
    }

    setBankFile(file);
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
        <span className="source-dropzone__prompt">Drag both workbooks here, or browse</span>
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
          slot="bank"
          label="Bank workbook"
          inputId="bank-workbook-input"
          file={bankFile}
          onChange={bankSlotChange}
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
        Bank and GL are detected from each file name; use the slot pickers to override. Row counts,
        date range, and excluded rows are calculated when the reconciliation runs.
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
  slot: SourceKind;
  label: string;
  inputId: string;
  file: File | null;
  onChange: (file: File | null) => void;
}>) {
  const detected = file ? detectSource(file.name) : null;
  const isOverride = Boolean(file) && detected !== null && detected !== slot;

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
