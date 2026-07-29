import { type Dispatch, type DragEvent, type SetStateAction, useState } from 'react';

type SourceKind = 'bank' | 'qbo';

const detectSource = (fileName: string): SourceKind | null => {
  const lower = fileName.toLowerCase();

  if (lower.includes('bank')) {
    return 'bank';
  }

  if (lower.includes('qbo') || lower.includes('quickbook')) {
    return 'qbo';
  }

  return null;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  return kilobytes < 1024 ? `${kilobytes.toFixed(1)} KB` : `${(kilobytes / 1024).toFixed(1)} MB`;
};

/**
 * Single drop zone that accepts both source workbooks. Files are auto-assigned to the bank or QBO
 * slot by filename signature, with per-slot inputs for manual override.
 */
export function SourceDropZone({
  bankFile,
  qboFile,
  setBankFile,
  setQboFile,
}: Readonly<{
  bankFile: File | null;
  qboFile: File | null;
  setBankFile: Dispatch<SetStateAction<File | null>>;
  setQboFile: Dispatch<SetStateAction<File | null>>;
}>) {
  const [isDragging, setIsDragging] = useState(false);

  const assignFiles = (files: FileList | File[]): void => {
    const incoming = Array.from(files);
    const unassigned: File[] = [];

    for (const file of incoming) {
      const detected = detectSource(file.name);

      if (detected === 'bank') {
        setBankFile(file);
      } else if (detected === 'qbo') {
        setQboFile(file);
      } else {
        unassigned.push(file);
      }
    }

    for (const file of unassigned) {
      if (!bankFile) {
        setBankFile(file);
      } else if (!qboFile) {
        setQboFile(file);
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
        <span className="source-dropzone__prompt">Drag both XLSX workbooks here, or browse</span>
        <input
          type="file"
          accept=".xlsx"
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
          onChange={(file) => setBankFile(file)}
        />
        <SourceSlot
          slot="qbo"
          label="QBO workbook"
          inputId="qbo-workbook-input"
          file={qboFile}
          onChange={(file) => setQboFile(file)}
        />
      </div>

      <p className="source-dropzone__note">
        Bank and QBO are detected from each file name; use the slot pickers to override. Row counts,
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
        accept=".xlsx"
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
