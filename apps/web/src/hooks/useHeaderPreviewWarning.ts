import { useEffect, useState } from 'react';

import type { CanonicalField } from '@recon/domain';

import { readHeaderOnly } from '../lib/csvHeader';
import { computeHeaderPreview, type HeaderPreviewWarning } from '../lib/importHeaderPreview';

const isCsv = (file: File): boolean => file.name.toLowerCase().endsWith('.csv');

/**
 * R2 V6 (warn-only design, Issue #250): computes a header preview warning for a staged file at
 * selection time, client-side, before any upload happens. CSV only for v1 -- XLSX has no
 * client-side header reader today (it's a binary ZIP format; `readHeaderOnly`'s cheap 64KB-prefix
 * read only works for CSV's sequential text), so an XLSX file always resolves to `null` (no
 * warning, unchanged from today's behavior). A header that fails to parse also resolves to `null`
 * rather than surfacing an error here -- the normal upload/validation flow is what reports a
 * genuinely broken file; this hook's only job is an early, best-effort heads-up.
 */
export const useHeaderPreviewWarning = (
  file: File | null,
  canonicalFields: CanonicalField[],
): HeaderPreviewWarning | null => {
  const [warning, setWarning] = useState<HeaderPreviewWarning | null>(null);

  useEffect(() => {
    if (!file || !isCsv(file) || canonicalFields.length === 0) {
      setWarning(null);
      return undefined;
    }

    let cancelled = false;

    readHeaderOnly(file)
      .then((columns) => {
        if (!cancelled) {
          setWarning(computeHeaderPreview(columns.map((column) => column.id), canonicalFields));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWarning(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file, canonicalFields]);

  return warning;
};
