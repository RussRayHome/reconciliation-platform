import {
  downloadImportRunErrorReportRequest,
  type ImportFailureGateSequenceEntry,
  type ImportFileFailureDetail,
  type ImportRunSummary,
} from '../lib/api';
import { useImportFileFailureDetail } from '../hooks/useImportFileFailureDetail';

const GATE_LABELS: Record<ImportFailureGateSequenceEntry['gate'], string> = {
  HEADER: 'Step 1 · Header row',
  COLUMN_ORDER: 'Step 2 · Column order',
  CELL_VALUES: 'Step 3 · Cell values',
};

/**
 * Renders Screens 05/07 (README §4) for a run that failed validation -- one card per invalid
 * file, each fetching its own failure detail. `run` comes straight from
 * `ImportValidationFailedError.run` (useImportRunSubmit.ts), the same summary
 * `POST /api/imports/runs/:id/submit` already returned inline, so no extra round trip is needed
 * to know which file(s) failed.
 */
export function ImportValidationFailureView({
  run,
  onRetryUpload,
}: Readonly<{
  run: ImportRunSummary;
  onRetryUpload: () => void;
}>) {
  const invalidFiles = run.files.filter((file) => file.validationStatus === 'INVALID');

  if (invalidFiles.length === 0) {
    // Shouldn't happen (the mutation only throws ImportValidationFailedError when the run
    // actually failed), but fall back to a plain message rather than rendering nothing.
    return (
      <p className="error-banner import-screen__status" role="alert">
        Import run failed validation.
      </p>
    );
  }

  return (
    <div className="import-screen__status import-failure-stack">
      {invalidFiles.map((file) => (
        <ImportFileFailureCard
          key={file.importFileId}
          runId={run.id}
          file={file}
          onRetryUpload={onRetryUpload}
        />
      ))}
    </div>
  );
}

function ImportFileFailureCard({
  runId,
  file,
  onRetryUpload,
}: Readonly<{
  runId: string;
  file: ImportRunSummary['files'][number];
  onRetryUpload: () => void;
}>) {
  const { detail, isLoading, error } = useImportFileFailureDetail(runId, file.importFileId);

  if (isLoading) {
    return (
      <p className="status-banner" role="status" aria-live="polite">
        Loading validation results for {file.originalFilename}…
      </p>
    );
  }

  if (error || !detail) {
    return (
      <p className="error-banner" role="alert">
        {error ?? `Couldn't load validation results for ${file.originalFilename}.`}
      </p>
    );
  }

  const handleDownloadErrorReport = (): void => {
    void downloadImportRunErrorReportRequest(runId);
  };

  if (detail.headerComparison) {
    return (
      <StructureFailurePanel
        detail={detail}
        onDownloadErrorReport={handleDownloadErrorReport}
        onRetryUpload={onRetryUpload}
      />
    );
  }

  if (detail.importableRowCount === 0) {
    return (
      <AllRowsInvalidPanel
        detail={detail}
        onDownloadErrorReport={handleDownloadErrorReport}
        onRetryUpload={onRetryUpload}
      />
    );
  }

  return (
    <PartialFailurePanel
      detail={detail}
      onDownloadErrorReport={handleDownloadErrorReport}
      onRetryUpload={onRetryUpload}
    />
  );
}

/** Screen 05 -- a structural (HEADER or COLUMN_ORDER) gate failure. */
function StructureFailurePanel({
  detail,
  onDownloadErrorReport,
  onRetryUpload,
}: Readonly<{
  detail: ImportFileFailureDetail;
  onDownloadErrorReport: () => void;
  onRetryUpload: () => void;
}>) {
  const failedGateIndex = detail.gateSequence.findIndex((entry) => entry.state === 'FAILED');
  const structuralIssues = detail.issues.filter(
    (issue) => issue.severity === 'ERROR' && (issue.code.startsWith('STRUCT_HEADER') || issue.code.startsWith('STRUCT_COLUMN')),
  );

  return (
    <div className="import-failure-panel">
      <div className="import-failure-panel__header">
        <p className="import-failure-panel__eyebrow">Validation failed · rejected tab</p>
        <div className="import-failure-panel__header-row">
          <h3 className="import-failure-panel__title">
            {detail.originalFilename} — Step {failedGateIndex + 1} of 3
          </h3>
          <div className="import-failure-panel__actions">
            <button type="button" className="secondary-button" onClick={onDownloadErrorReport}>
              Download error report
            </button>
            <button type="button" className="accent-button" onClick={onRetryUpload}>
              Fix &amp; re-upload
            </button>
          </div>
        </div>
      </div>

      <div className="import-failure-panel__body">
        <div className="import-failure-panel__left">
          {structuralIssues.map((issue) => (
            <div key={`${issue.code}-${issue.field ?? 'file'}`} className="import-failure-error-card">
              <p className="import-failure-error-card__code">
                {issue.code} · {issue.severity}
              </p>
              <p className="import-failure-error-card__message">{issue.message}</p>
            </div>
          ))}

          {detail.headerComparison ? (
            <div className="import-failure-header-table">
              <div className="import-failure-header-table__caption">
                <span>Header comparison · row 1</span>
                <span>
                  expected {detail.headerComparison.filter((row) => row.expected !== null).length} · found{' '}
                  {detail.headerComparison.filter((row) => row.found !== null).length}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Expected</th>
                    <th>Found in file</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.headerComparison.map((row) => (
                    <tr key={row.position}>
                      <td>{row.position}</td>
                      <td className={row.matches ? 'import-failure-header-table__match' : ''}>
                        {row.expected ?? '— absent —'}
                      </td>
                      <td
                        className={
                          row.matches
                            ? 'import-failure-header-table__match'
                            : 'import-failure-header-table__mismatch'
                        }
                      >
                        {row.found ?? '— absent —'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <aside className="import-failure-gate-panel">
          <h4 className="import-failure-gate-panel__title">Gate sequence</h4>
          {detail.gateSequence.map((entry) => (
            <div
              key={entry.gate}
              className={`import-failure-gate-panel__row import-failure-gate-panel__row--${entry.state.toLowerCase()}`}
            >
              <span>{GATE_LABELS[entry.gate]}</span>
              <span>{entry.state.replace('_', ' ')}</span>
            </div>
          ))}
          <p className="import-failure-gate-panel__note">
            A failed gate stops later checks for this file only -- the run's other file keeps its
            own result and stays stored. Re-upload replaces just this side.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Screen 07 -- every row failed Step 3 (cell values), zero rows importable. */
function AllRowsInvalidPanel({
  detail,
  onDownloadErrorReport,
  onRetryUpload,
}: Readonly<{
  detail: ImportFileFailureDetail;
  onDownloadErrorReport: () => void;
  onRetryUpload: () => void;
}>) {
  const dominant = detail.issuesByCode[0];

  return (
    <div className="import-failure-panel import-failure-panel--empty">
      <div className="import-failure-empty-badge" aria-hidden="true">
        !
      </div>
      <h3 className="import-failure-empty-title">
        0 of {detail.rowCount ?? 0} {detail.sourceType} lines passed validation
      </h3>
      <p className="import-failure-empty-body">
        {dominant
          ? `Every entry failed ${dominant.code}. Partial import is unavailable because no row is importable.`
          : 'No rows in this file passed validation. Partial import is unavailable because no row is importable.'}
      </p>
      {dominant ? (
        <div className="import-failure-empty-pills">
          <span className="import-failure-empty-pill">
            {dominant.code} · {dominant.count}
          </span>
          <span className="import-failure-empty-pill">tolerance {detail.amountTolerance}</span>
        </div>
      ) : null}
      <div className="import-failure-panel__actions">
        <button type="button" className="secondary-button" onClick={onDownloadErrorReport}>
          Download error report
        </button>
        <button type="button" className="accent-button" onClick={onRetryUpload}>
          Fix &amp; re-upload {detail.sourceType === 'BANK' ? 'bank' : 'GL'} workbook
        </button>
      </div>
      <p className="import-failure-empty-footnote">
        Run stays in the Rejected tab. Raw files and the run configuration are preserved.
      </p>
    </div>
  );
}

/** Neither Screen 05 nor 07: Step 3 ran and at least one row passed, but the file still has
 * ERROR-severity issues. The design's partial-import review (Screen 06) isn't built yet (Phase
 * 12), so this is an honest placeholder rather than a silent dead end. */
function PartialFailurePanel({
  detail,
  onDownloadErrorReport,
  onRetryUpload,
}: Readonly<{
  detail: ImportFileFailureDetail;
  onDownloadErrorReport: () => void;
  onRetryUpload: () => void;
}>) {
  return (
    <div className="import-failure-panel">
      <div className="import-failure-panel__header">
        <p className="import-failure-panel__eyebrow">Validation failed · rejected tab</p>
        <div className="import-failure-panel__header-row">
          <h3 className="import-failure-panel__title">
            {detail.originalFilename} — {detail.importableRowCount} of {detail.rowCount ?? 0} rows
            passed
          </h3>
          <div className="import-failure-panel__actions">
            <button type="button" className="secondary-button" onClick={onDownloadErrorReport}>
              Download error report
            </button>
            <button type="button" className="accent-button" onClick={onRetryUpload}>
              Fix &amp; re-upload
            </button>
          </div>
        </div>
      </div>
      <div className="import-failure-panel__left">
        <p className="import-failure-panel__note">
          {detail.errorCount ?? 0} row(s) failed validation and {detail.importableRowCount} would be
          importable. Reviewing and importing the valid rows individually isn't available in this
          view yet -- download the error report for the full row-by-row breakdown, or fix the
          source file and re-upload.
        </p>
        {detail.issuesByCode.map((entry) => (
          <p key={entry.code} className="import-failure-panel__code-line">
            {entry.code} · {entry.severity} · {entry.count}
          </p>
        ))}
      </div>
    </div>
  );
}
