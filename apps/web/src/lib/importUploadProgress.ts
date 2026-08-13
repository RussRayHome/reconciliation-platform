import type { ImportUploadTransferState } from '../hooks/useImportUploadTransfer';

/** The combined bank+GL request appends `bankFile` before `glFile` (see `createImportRunRequest`),
 * and browsers serialize `FormData` in append order, so a single `loaded` byte count from the
 * request can be split into per-file progress by comparing it against each file's byte range
 * within that body -- `precedingBytes` is the sum of every file's size appended before this one. */
export const computeFileTransferPercent = (
  loadedBytes: number,
  precedingBytes: number,
  fileSizeBytes: number,
): number => {
  if (fileSizeBytes <= 0) {
    return 100;
  }

  const fileLoadedBytes = Math.max(0, Math.min(loadedBytes - precedingBytes, fileSizeBytes));
  return (fileLoadedBytes / fileSizeBytes) * 100;
};

export type ImportUploadCardTransferProps =
  | { state: 'stored'; name: string; sizeBytes: number; slotLabel: string }
  | {
      state: 'uploading';
      name: string;
      sizeBytes: number;
      slotLabel: string;
      percent: number;
      onCancel: () => void;
    }
  | {
      state: 'network-failed';
      name: string;
      sizeBytes: number;
      stalledPercent: number;
      onRetry: () => void;
    };

/** Maps one file's slice of the in-flight transfer to the `ImportUploadCard` props for it -- once
 * that file's own byte range is fully sent it shows "Stored" even while its sibling file is still
 * transferring, matching the design's mixed-state screenshot. */
export const buildTransferCardProps = (
  transfer: Extract<ImportUploadTransferState, { kind: 'uploading' | 'network-failed' }>,
  file: File,
  slotLabel: string,
  precedingBytes: number,
  onCancel: () => void,
  onRetry: () => void,
): ImportUploadCardTransferProps => {
  const loadedBytes = transfer.kind === 'uploading' ? transfer.loadedBytes : transfer.stalledBytes;
  const percent = computeFileTransferPercent(loadedBytes, precedingBytes, file.size);

  if (transfer.kind === 'network-failed') {
    return {
      state: 'network-failed',
      name: file.name,
      sizeBytes: file.size,
      stalledPercent: percent,
      onRetry,
    };
  }

  if (percent >= 100) {
    return { state: 'stored', name: file.name, sizeBytes: file.size, slotLabel };
  }

  return {
    state: 'uploading',
    name: file.name,
    sizeBytes: file.size,
    slotLabel,
    percent,
    onCancel,
  };
};
