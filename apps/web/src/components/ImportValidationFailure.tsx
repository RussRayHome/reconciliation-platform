import { useState } from 'react';

import {
  downloadImportRunErrorReportRequest,
  type ImportFailureGateSequenceEntry,
  type ImportFileFailureDetail,
  type ImportRowGridFlag,
  type ImportRunSummary,
} from '../lib/api';
import { useImportFileFailureDetail } from '../hooks/useImportFileFailureDetail';
import { useImportFileRows } from '../hooks/useImportFileRows';
import type { useImportPartialAccept } from '../hooks/useImportPartialAccept';

type PartialAcceptModel = ReturnType<typeof useImportPartialAccept>;

const GATE_LABELS: Record<ImportFailureGateSequenceEntry['gate'], string> = {
  HEADER: 'Step 1 · Header row',
  COLUMN_ORDER: 'Step 2 · Column order',
  CELL_VALUES: 'Step 3 · Cell values',
};

/**
 * Renders Screens 05/06/07 (README §4) for a run that failed validation -- one card per invalid
 * file, each fetching its own failure detail. `run` comes straight from
 * `ImportValidationFailedError.run` (useImportRunSubmit.ts), the same summary
 * `POST /api/imports/runs/:id/submit` already returned inline, so no extra round trip is needed
 * to know which file(s) failed.
 */
export function ImportValidationFailureView({
  run,
  onRetryUpload,
  partialAccept,
}: Readonly<{
  run: ImportRunSummary;
  onRetryUpload: () => void;
  partialAccept: PartialAcceptModel;
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
          partialAccept={partialAccept}
        />
      ))}
    </div>
  );
}

function ImportFileFailureCard({
  runId,
  file,
  onRetryUpload,
  partialAccept,
}: Readonly<{
  runId: string;
  file: ImportRunSummary['files'][number];
  onRetryUpload: () => void;
  partialAccept: PartialAcceptModel;
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
    <RowGridPanel
      runId={runId}
      detail={detail}
      onDownloadErrorReport={handleDownloadErrorReport}
      onRetryUpload={onRetryUpload}
      partialAccept={partialAccept}
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

/** Screen 06 -- the row-level grid + partial import. Step 3 ran and at least one row passed.
 * Matching still processes the full original file when "Import N rows & submit" is used (see
 * POST /api/imports/runs/:id/import's own comment) -- the toggle/copy here says so rather than
 * implying skipped rows are removed from reconciliation. */
function RowGridPanel({
  runId,
  detail,
  onDownloadErrorReport,
  onRetryUpload,
  partialAccept,
}: Readonly<{
  runId: string;
  detail: ImportFileFailureDetail;
  onDownloadErrorReport: () => void;
  onRetryUpload: () => void;
  partialAccept: PartialAcceptModel;
}>) {
  const { grid, isLoading, error } = useImportFileRows(runId, detail.importFileId);
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);

  if (isLoading) {
    return (
      <p className="status-banner" role="status" aria-live="polite">
        Loading row-level detail for {detail.originalFilename}…
      </p>
    );
  }

  if (error || !grid) {
    return (
      <p className="error-banner" role="alert">
        {error ?? `Couldn't load row-level detail for ${detail.originalFilename}.`}
      </p>
    );
  }

  const importCount = grid.warningRowCount + grid.cleanRowCount;
  const skipCount = grid.errorRowCount;

  const filteredRows = grid.rows.filter((row) => {
    if (filter === 'errors') return row.status === 'SKIP';
    if (filter === 'warnings') {
      return (
        Object.values(row.flaggedFields).some((flag) => flag.severity === 'WARNING') ||
        row.rowLevelIssues.some((issue) => issue.severity === 'WARNING')
      );
    }
    return true;
  });

  const issuesByCode = new Map<string, { code: string; severity: string; count: number }>();
  const bumpCode = (flag: ImportRowGridFlag): void => {
    const existing = issuesByCode.get(flag.code);
    if (existing) {
      existing.count += 1;
    } else {
      issuesByCode.set(flag.code, { code: flag.code, severity: flag.severity, count: 1 });
    }
  };
  for (const row of grid.rows) {
    Object.values(row.flaggedFields).forEach(bumpCode);
    row.rowLevelIssues.forEach(bumpCode);
  }
  const sortedCodes = [...issuesByCode.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="import-failure-panel">
      <div className="import-failure-panel__header">
        <p className="import-failure-panel__eyebrow">
          {detail.originalFilename} · {grid.totalRows} rows read
        </p>
        <div className="import-failure-panel__header-row">
          <h3 className="import-failure-panel__title">Cell validation results</h3>
          <div className="row-grid__count-pills">
            <span className="row-grid__count-pill row-grid__count-pill--error">
              {grid.errorRowCount} ERROR
            </span>
            <span className="row-grid__count-pill row-grid__count-pill--warning">
              {grid.warningRowCount} WARNING
            </span>
            <span className="row-grid__count-pill row-grid__count-pill--clean">
              {grid.cleanRowCount} CLEAN
            </span>
          </div>
        </div>
      </div>

      <div className="row-grid__toolbar">
        <fieldset className="row-grid__filter-pills">
          <legend className="visually-hidden">Filter rows</legend>
          <button
            type="button"
            className={
              filter === 'all' ? 'row-grid__filter-pill row-grid__filter-pill--active' : 'row-grid__filter-pill'
            }
            onClick={() => setFilter('all')}
          >
            All rows · {grid.totalRows}
          </button>
          <button
            type="button"
            className={
              filter === 'errors'
                ? 'row-grid__filter-pill row-grid__filter-pill--active'
                : 'row-grid__filter-pill'
            }
            onClick={() => setFilter('errors')}
          >
            Errors only · {grid.errorRowCount}
          </button>
          <button
            type="button"
            className={
              filter === 'warnings'
                ? 'row-grid__filter-pill row-grid__filter-pill--active'
                : 'row-grid__filter-pill'
            }
            onClick={() => setFilter('warnings')}
          >
            Warnings · {grid.warningRowCount}
          </button>
        </fieldset>
        <label className="row-grid__skip-toggle">
          <input
            type="checkbox"
            checked={skipInvalidRows}
            onChange={(event) => setSkipInvalidRows(event.target.checked)}
          />
          Skip invalid rows and import the remaining {importCount}
        </label>
      </div>

      <div className="row-grid__table-scroll">
        <table className="row-grid__table">
          <thead>
            <tr>
              <th>Line</th>
              {grid.headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={row.lineNumber} className={index % 2 === 1 ? 'row-grid__row--odd' : undefined}>
                <td className="row-grid__line-cell">{row.lineNumber}</td>
                {grid.headers.map((header) => {
                  const flag = row.flaggedFields[header];
                  const value = row.values[header];
                  let cellText = value;
                  if (!value) {
                    cellText = flag ? '— required, empty —' : '';
                  }
                  return (
                    <td
                      key={header}
                      className={flag ? 'row-grid__cell--flagged' : undefined}
                      title={flag ? `${flag.code}: ${flag.message}` : undefined}
                    >
                      {cellText}
                    </td>
                  );
                })}
                <td
                  className={
                    row.status === 'IMPORT' ? 'row-grid__status row-grid__status--import' : 'row-grid__status row-grid__status--skip'
                  }
                >
                  {row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid.truncated ? (
        <p className="row-grid__truncated-note">
          Showing the first {grid.rows.length} of {grid.totalRows} rows.
        </p>
      ) : null}

      <div className="row-grid__footer">
        <div className="row-grid__footer-codes">
          <p className="row-grid__footer-codes-title">Errors by code</p>
          <div className="import-failure-empty-pills">
            {sortedCodes.map((entry) => (
              <span key={entry.code} className="import-failure-empty-pill">
                {entry.code} · {entry.count}
              </span>
            ))}
          </div>
        </div>
        <div className="row-grid__footer-actions">
          <div className="row-grid__tallies">
            <div className="row-grid__tally">
              <strong>{importCount}</strong>
              <span>will import</span>
            </div>
            <div className="row-grid__tally">
              <strong>{skipCount}</strong>
              <span>will skip</span>
            </div>
            <div className="row-grid__tally">
              <strong>{grid.warningRowCount}</strong>
              <span>warnings</span>
            </div>
          </div>
          <p className="row-grid__matching-note">
            Skipped rows are audited (source line + code) but the reconciliation match still runs
            against the full original file.
          </p>
          <div className="import-failure-panel__actions">
            <button type="button" className="secondary-button" onClick={onDownloadErrorReport}>
              Download error report
            </button>
            <button type="button" className="secondary-button" onClick={onRetryUpload}>
              Fix &amp; re-upload
            </button>
            <button
              type="button"
              className="accent-button"
              disabled={!skipInvalidRows || importCount === 0 || partialAccept.isPending}
              onClick={() => partialAccept.mutate({ runId })}
            >
              {partialAccept.isPending ? 'Importing…' : `Import ${importCount} rows & submit`}
            </button>
          </div>
          {partialAccept.error ? (
            <p className="error-banner" role="alert">
              {partialAccept.error.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
