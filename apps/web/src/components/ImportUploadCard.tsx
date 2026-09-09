import { formatFileSize } from '../lib/formatFileSize';

export type RejectedUploadCode =
  | 'UPLOAD_EXTENSION_UNSUPPORTED'
  | 'UPLOAD_SIZE_EXCEEDED'
  | 'UPLOAD_BANK_ACCOUNT_LIMIT_REACHED'
  | 'UPLOAD_AP_FILENAME_INVALID'
  | 'UPLOAD_AP_ENTITY_LIMIT_REACHED';

type ImportUploadCardProps =
  | {
      state: 'stored';
      name: string;
      sizeBytes: number;
      slotLabel: string;
    }
  | {
      state: 'uploading';
      name: string;
      sizeBytes: number;
      slotLabel: string;
      percent: number;
      onCancel: () => void;
    }
  | {
      state: 'rejected';
      name: string;
      sizeBytes: number;
      code: RejectedUploadCode;
      onRemove: () => void;
    }
  | {
      state: 'network-failed';
      name: string;
      sizeBytes: number;
      stalledPercent: number;
      onRetry: () => void;
    };

const REJECTION_COPY: Record<RejectedUploadCode, { label: string; body: string }> = {
  UPLOAD_EXTENSION_UNSUPPORTED: {
    label: 'UPLOAD_EXTENSION_UNSUPPORTED',
    body: 'Rejected at upload. Only .csv and .xlsx are accepted — format is detected by extension.',
  },
  UPLOAD_SIZE_EXCEEDED: {
    label: 'UPLOAD_SIZE_EXCEEDED · limit 50 MB',
    body: 'Split the export by period, or switch the run frequency to Annual and import per quarter.',
  },
  UPLOAD_BANK_ACCOUNT_LIMIT_REACHED: {
    label: 'UPLOAD_BANK_ACCOUNT_LIMIT_REACHED',
    body: 'A run supports up to 4 bank accounts. Remove a bank file before adding another.',
  },
  UPLOAD_AP_FILENAME_INVALID: {
    label: 'UPLOAD_AP_FILENAME_INVALID',
    body: 'AP/Billing file names must start with the entity id followed by "-" or "_", e.g. "E100_ap-export.csv".',
  },
  UPLOAD_AP_ENTITY_LIMIT_REACHED: {
    label: 'UPLOAD_AP_ENTITY_LIMIT_REACHED',
    body: 'A run supports up to 4 AP entity ledgers. Remove an AP file before adding another.',
  },
};

/** Screen 02's per-file upload card -- one of five states (README §4 screen 02). Progress and
 * rejection are both client-side only: this build sends both bank workbooks and the GL workbook
 * as a single combined request on Submit (see `useImportUploadTransfer`), so "uploading" reflects
 * that one request's progress, not
 * an independent per-file transfer, and a network failure restarts the request rather than
 * resuming from a stored chunk -- the design's literal "resumes from the last stored chunk" claim
 * assumes a chunked/resumable upload backend that doesn't exist here. */
export function ImportUploadCard(props: Readonly<ImportUploadCardProps>) {
  if (props.state === 'stored') {
    return (
      <div className="import-upload-card import-upload-card--stored">
        <div className="import-upload-card__row">
          <span className="import-upload-card__name">{props.name}</span>
          <span className="import-upload-card__meta">
            {formatFileSize(props.sizeBytes)} · slot {props.slotLabel}
          </span>
          <span className="import-upload-card__right">
            <span className="import-upload-card__percent">100%</span>
            <span className="import-upload-card__status">Stored</span>
          </span>
        </div>
        <div className="import-upload-card__bar">
          <div className="import-upload-card__bar-fill import-upload-card__bar-fill--stored" />
        </div>
      </div>
    );
  }

  if (props.state === 'uploading') {
    const clampedPercent = Math.max(0, Math.min(100, props.percent));
    const remainingBytes = Math.max(0, props.sizeBytes * (1 - clampedPercent / 100));

    return (
      <div className="import-upload-card import-upload-card--uploading">
        <div className="import-upload-card__row">
          <span className="import-upload-card__name">{props.name}</span>
          <span className="import-upload-card__meta">
            {formatFileSize(props.sizeBytes)} · slot {props.slotLabel}
          </span>
          <span className="import-upload-card__right">
            <span className="import-upload-card__percent">
              {Math.round(clampedPercent)}% · {formatFileSize(remainingBytes)} left
            </span>
            <button type="button" className="secondary-button" onClick={props.onCancel}>
              Cancel
            </button>
          </span>
        </div>
        <div className="import-upload-card__bar">
          <div
            className="import-upload-card__bar-fill import-upload-card__bar-fill--uploading"
            style={{ width: `${clampedPercent}%` }}
          />
        </div>
      </div>
    );
  }

  if (props.state === 'rejected') {
    const copy = REJECTION_COPY[props.code];

    return (
      <div className="import-upload-card import-upload-card--rejected" role="alert">
        <div className="import-upload-card__row">
          <span className="import-upload-card__name">{props.name}</span>
          <span className="import-upload-card__meta">{formatFileSize(props.sizeBytes)}</span>
          <span className="import-upload-card__right">
            <span className="import-upload-card__code">{copy.label}</span>
            <button
              type="button"
              className="import-upload-card__ghost-button"
              onClick={props.onRemove}
            >
              Remove
            </button>
          </span>
        </div>
        <p className="import-upload-card__body">{copy.body}</p>
      </div>
    );
  }

  return (
    <div className="import-upload-card import-upload-card--network-failed" role="alert">
      <div className="import-upload-card__row">
        <span className="import-upload-card__name">{props.name}</span>
        <span className="import-upload-card__meta">
          {formatFileSize(props.sizeBytes)} · stalled at {Math.round(props.stalledPercent)}%
        </span>
        <span className="import-upload-card__right">
          <span className="import-upload-card__code">UPLOAD_NETWORK_INTERRUPTED</span>
          <button
            type="button"
            className="import-upload-card__retry-button"
            onClick={props.onRetry}
          >
            Retry upload
          </button>
        </span>
      </div>
      <p className="import-upload-card__body">
        The transfer was interrupted. Nothing was written to the run -- retry resends all files
        from the start.
      </p>
    </div>
  );
}
