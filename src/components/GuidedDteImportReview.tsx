import { useMemo, useState } from 'react';
import {
  AcceptedGuidedDteImport,
  GuidedDteCorrection,
  GuidedDteReview,
  buildAcceptedDteImport,
  previewDteImport,
  proposeGuidedEstimate,
} from '../utils/guidedCsvImport';

interface Props {
  review: GuidedDteReview;
  onAccept: (accepted: AcceptedGuidedDteImport) => void;
  onCancel: () => void;
  onConfigureTimezone: () => void;
}

function updateCorrection<K extends string | number>(
  current: Record<K, GuidedDteCorrection>,
  key: K,
  value: string,
): Record<K, GuidedDteCorrection> {
  if (value.trim() === '') {
    const next = { ...current };
    delete next[key];
    return next;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? { ...current, [key]: { usageKwh: parsed, method: 'manual', approved: true } }
    : current;
}

export default function GuidedDteImportReview({ review, onAccept, onCancel, onConfigureTimezone }: Props) {
  const [timeChoices, setTimeChoices] = useState<Record<number, string>>({});
  const [sourceRowCorrections, setSourceRowCorrections] = useState<Record<number, GuidedDteCorrection>>({});
  const [missingIntervalCorrections, setMissingIntervalCorrections] = useState<Record<string, GuidedDteCorrection>>({});
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const preview = useMemo(() => previewDteImport(review, timeChoices), [review, timeChoices]);
  const unresolvedSourceValues = review.missingMeasurements.some((row) => !sourceRowCorrections[row.sourceRow]);
  const unresolvedIntervals = preview.missingIntervals.some((row) => !missingIntervalCorrections[row.instantUtc]);
  const readyToAccept = review.rows.length > 0 && !review.error && preview.unconfirmedRows.length === 0 &&
    preview.errors.length === 0 && !unresolvedSourceValues && !unresolvedIntervals;

  const setEstimate = (key: string, target: { sourceRow?: number; instantUtc?: string }, scope: 'source' | 'missing') => {
    const proposal = proposeGuidedEstimate(preview, target);
    if (!proposal) return;
    const correction: GuidedDteCorrection = { usageKwh: proposal.usageKwh, method: 'estimate', approved: true };
    if (scope === 'source') setSourceRowCorrections((current) => ({ ...current, [Number(key)]: correction }));
    else setMissingIntervalCorrections((current) => ({ ...current, [key]: correction }));
  };

  const accept = () => {
    try {
      const accepted = buildAcceptedDteImport(review, { timeChoices, sourceRowCorrections, missingIntervalCorrections });
      onAccept(accepted);
    } catch (error) {
      setAcceptError(error instanceof Error ? error.message : 'The corrected dataset did not pass validation.');
    }
  };

  return (
    <section aria-labelledby="guided-import-title" className={`mt-3 rounded-xl border p-4 ${review.status === 'ready' ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-50' : review.status === 'rejected' ? 'border-rose-500/40 bg-rose-950/20 text-rose-50' : 'border-amber-500/40 bg-amber-950/25 text-amber-50'}`}>
      <div className="mb-3">
        <p className={`text-xs font-bold uppercase tracking-wider ${review.status === 'ready' ? 'text-emerald-300' : review.status === 'rejected' ? 'text-rose-300' : 'text-amber-300'}`}>
          {review.status === 'ready' ? 'File received · ready for validation' : review.status === 'rejected' ? 'Import rejected' : 'File received · correction required'}
        </p>
        <h4 id="guided-import-title" className="mt-1 text-sm font-semibold">Review {review.fileName}</h4>
        <p className="mt-1 text-xs opacity-90">
          {review.status === 'ready'
            ? 'The source CSV will remain unchanged. All rows have unique UTC instants and complete cadence; accept to validate with the strict simulation parser.'
            : 'The uploaded CSV remains unchanged. No measured value is duplicated or replaced automatically. The active dataset stays in use until this corrected sequence passes strict UTC validation and you accept it.'}
        </p>
      </div>

      {!review.rows.length && review.error && (
        <div role={review.status === 'rejected' ? 'alert' : 'status'} aria-live={review.status === 'rejected' ? 'assertive' : 'polite'} className="rounded-lg border border-amber-400/30 bg-slate-950/50 p-3 text-sm">
          <p>{review.error}</p>
          <button type="button" onClick={onConfigureTimezone} className="mt-2 rounded border border-amber-300/50 px-3 py-1.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Set site timezone
          </button>
        </div>
      )}

      {review.rows.length > 0 && (
        <div className="space-y-4">
          {review.rows.some((row) => row.requiresTimeConfirmation) && (
            <fieldset className="space-y-3 rounded-lg border border-amber-400/20 bg-slate-950/40 p-3">
              <legend className="px-1 text-xs font-semibold">Repeated local times</legend>
              <p className="text-xs text-amber-100/80">A fall-back clock time can represent two UTC instants. Confirm each row’s offset. Surrounding timestamps may expose a missing interval, but they cannot establish which reading DTE intended.</p>
              {review.rows.filter((row) => row.requiresTimeConfirmation).map((row) => (
                <div key={row.sourceRow} className="grid gap-2 border-t border-amber-400/15 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]">
                  <div className="text-xs">
                    <p><strong>Source row {row.sourceRow}:</strong> {row.sourceDate}, {row.sourceTime} — measured {row.originalUsageKwh === null ? 'No Data' : `${row.originalUsageKwh} kWh`}</p>
                    {row.proposedInstantUtc && <p className="mt-1 text-amber-200">Source-order proposal: {row.proposedInstantUtc}. Select and confirm it explicitly.</p>}
                    {row.candidates.map((candidate) => candidate.possibleMissingUtcInstants.map((missing) => (
                      <p key={`${candidate.instantUtc}-${missing}`} className="mt-1 text-amber-200">If {candidate.offsetLabel} ({candidate.instantUtc}) is selected, surrounding rows leave {missing} uncovered.</p>
                    )))}
                  </div>
                  <label className="text-xs font-medium" htmlFor={`fold-row-${row.sourceRow}`}>
                    Confirm the UTC occurrence for source row {row.sourceRow}
                    <select
                      id={`fold-row-${row.sourceRow}`}
                      value={timeChoices[row.sourceRow] ?? ''}
                      onChange={(event) => setTimeChoices((current) => ({ ...current, [row.sourceRow]: event.target.value }))}
                      className="mt-1 block min-h-10 w-full rounded-md border border-amber-300/40 bg-slate-950 px-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                    >
                      <option value="">Choose an occurrence</option>
                      {row.candidates.map((candidate) => (
                        <option key={candidate.instantUtc} value={candidate.instantUtc}>{candidate.offsetLabel} — {candidate.instantUtc}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </fieldset>
          )}

          {review.missingMeasurements.length > 0 && (
            <fieldset className="space-y-3 rounded-lg border border-amber-400/20 bg-slate-950/40 p-3">
              <legend className="px-1 text-xs font-semibold">Source rows marked No Data</legend>
              <p className="text-xs text-amber-100/80">Each entry is tied to its actual CSV row. A missing value is not assumed to be caused by daylight saving time.</p>
              {review.missingMeasurements.map((missing) => {
                const key = String(missing.sourceRow);
                const proposal = proposeGuidedEstimate(preview, { sourceRow: missing.sourceRow });
                const correction = sourceRowCorrections[missing.sourceRow];
                return (
                  <div key={missing.sourceRow} className="grid gap-2 border-t border-amber-400/15 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]">
                    <p className="text-xs"><strong>Source row {missing.sourceRow}:</strong> {missing.sourceDate}, {missing.sourceTime}; original value “{missing.rawUsage}”. {missing.isAmbiguousTime && 'This row also needs a separate UTC occurrence choice.'}</p>
                    <div>
                    <label className="text-xs font-medium" htmlFor={`missing-source-${key}`}>Enter corrected usage (kWh)
                        <input id={`missing-source-${key}`} type="number" min="0" step="any" value={correction?.method === 'manual' ? correction.usageKwh : ''} onChange={(event) => setSourceRowCorrections((current) => updateCorrection(current, missing.sourceRow, event.target.value))} className="mt-1 block min-h-10 w-full rounded-md border border-amber-300/40 bg-slate-950 px-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300" />
                      </label>
                      {proposal && <>
                        <p className="mt-2 text-xs text-amber-100/80">{proposal.disclosure}</p>
                        <button type="button" onClick={() => setEstimate(key, { sourceRow: missing.sourceRow }, 'source')} className="mt-2 min-h-9 rounded border border-amber-300/40 px-2 text-xs font-semibold hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Apply and approve {proposal.usageKwh} kWh estimate</button>
                      </>}
                      {correction?.method === 'estimate' && <p role="status" className="mt-1 text-xs">User-approved estimate: {correction.usageKwh} kWh, the mean of the nearest measured interval before and after, rounded to 0.001 kWh.</p>}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          )}

          {preview.unconfirmedRows.length === 0 && preview.errors.length === 0 && preview.missingIntervals.length > 0 && (
            <fieldset className="space-y-3 rounded-lg border border-amber-400/20 bg-slate-950/40 p-3">
              <legend className="px-1 text-xs font-semibold">UTC intervals with no source row</legend>
              <p className="text-xs text-amber-100/80">The chosen timestamps leave actual UTC intervals uncovered. Add a measured correction or explicitly approve a disclosed estimate for each one.</p>
              {preview.missingIntervals.map((missing) => {
                const key = missing.instantUtc;
                const proposal = proposeGuidedEstimate(preview, { instantUtc: key });
                const correction = missingIntervalCorrections[key];
                return (
                  <div key={key} className="grid gap-2 border-t border-amber-400/15 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]">
                    <p className="text-xs"><strong>No CSV row:</strong> {missing.localTimestamp} ({missing.offsetLabel}), UTC {missing.instantUtc}. No value has been duplicated or set to zero.</p>
                    <div>
                      <label className="text-xs font-medium" htmlFor={`missing-interval-${key}`}>Enter usage (kWh)
                        <input id={`missing-interval-${key}`} type="number" min="0" step="any" value={correction?.method === 'manual' ? correction.usageKwh : ''} onChange={(event) => setMissingIntervalCorrections((current) => updateCorrection(current, key, event.target.value))} className="mt-1 block min-h-10 w-full rounded-md border border-amber-300/40 bg-slate-950 px-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300" />
                      </label>
                      {proposal && <>
                        <p className="mt-2 text-xs text-amber-100/80">{proposal.disclosure}</p>
                        <button type="button" onClick={() => setEstimate(key, { instantUtc: key }, 'missing')} className="mt-2 min-h-9 rounded border border-amber-300/40 px-2 text-xs font-semibold hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Apply and approve {proposal.usageKwh} kWh estimate</button>
                      </>}
                      {correction?.method === 'estimate' && <p role="status" className="mt-1 text-xs">User-approved estimate: {correction.usageKwh} kWh, the mean of the nearest measured interval before and after, rounded to 0.001 kWh.</p>}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          )}

          {preview.unconfirmedRows.length > 0 && <p role="status" className="text-xs">Choose a UTC occurrence for each ambiguous row to validate actual UTC cadence and identify any missing interval.</p>}
          {preview.errors.map((error) => <p key={error} role="alert" className="text-xs text-rose-200">{error}</p>)}
          {acceptError && <p role="alert" className="text-xs text-rose-200">{acceptError}</p>}
          <div className="flex flex-wrap gap-2 border-t border-amber-300/20 pt-3">
            <button type="button" onClick={accept} disabled={!readyToAccept} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">{review.status === 'ready' ? 'Validate and accept file' : 'Validate and accept corrected data'}</button>
            <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-slate-400/40 px-4 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Cancel import</button>
          </div>
        </div>
      )}
    </section>
  );
}
