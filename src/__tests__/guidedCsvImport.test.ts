import { describe, expect, it } from 'vitest';
import {
  buildAcceptedDteImport,
  inspectDteImport,
  invalidateStaleEstimateCorrections,
  previewDteImport,
  proposeGuidedEstimate,
} from '../utils/guidedCsvImport';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';
import { alignLoadTimestampsToSite } from '../utils/loadTimeAlignment';

const DST_CSV = [
  'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
  '11/02/2025,12:00 AM,1.25,20,kWh',
  '11/02/2025,1:00 AM,2.75,20,kWh',
  '11/02/2025,2:00 AM,3.5,20,kWh',
].join('\n');

const TWO_FOLD_ROWS = [
  'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
  '11/02/2025,12:00 AM,1.25,20,kWh',
  '11/02/2025,1:00 AM,2.25,20,kWh',
  '11/02/2025,1:00 AM,3.25,20,kWh',
  '11/02/2025,2:00 AM,4.5,20,kWh',
].join('\n');

describe('guided DTE CSV import', () => {
  it('stages parser-valid ambiguous DTE data when no site timezone is configured', () => {
    const parsed = parseAndValidateEnergyCsv(DST_CSV);
    const review = inspectDteImport(DST_CSV, '', 'dte.csv');

    expect(parsed.schemaValid && parsed.chronologicallyValid).toBe(true);
    expect(review.status).toBe('needs-correction');
    expect(review.formatRecognized).toBe(true);
    expect(review.error).toMatch(/valid site timezone/i);
    expect(review.rows).toHaveLength(0);
  });

  it('preserves a single fall-back measurement and exposes both UTC interpretations without choosing', () => {
    const review = inspectDteImport(DST_CSV, 'America/Detroit', 'dte.csv');
    const fold = review.rows.find((row) => row.localTimestamp === '2025-11-02 01:00');

    expect(fold?.originalUsageKwh).toBe(2.75);
    expect(fold?.candidates.map((candidate) => candidate.offsetLabel)).toEqual(['UTC−04:00', 'UTC−05:00']);
    expect(fold?.requiresTimeConfirmation).toBe(true);
    expect(fold?.selectedInstantUtc).toBeNull();
    expect(fold?.candidates.map((candidate) => candidate.possibleMissingUtcInstants)).toEqual([
      ['2025-11-02T06:00:00.000Z'], ['2025-11-02T05:00:00.000Z'],
    ]);

    const firstOccurrence = previewDteImport(review, { 3: '2025-11-02T05:00:00.000Z' });
    const secondOccurrence = previewDteImport(review, { 3: '2025-11-02T06:00:00.000Z' });
    expect(firstOccurrence.missingIntervals.map((interval) => interval.instantUtc)).toEqual(['2025-11-02T06:00:00.000Z']);
    expect(secondOccurrence.missingIntervals.map((interval) => interval.instantUtc)).toEqual(['2025-11-02T05:00:00.000Z']);
  });

  it('preserves the full recorded kWh precision in the accepted UTC simulation data', () => {
    const csv = DST_CSV.replace('1:00 AM,2.75', '1:00 AM,2.7546');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');
    const accepted = buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z' },
      sourceRowCorrections: {},
      missingIntervalCorrections: { '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true } },
    });
    const parsed = parseAndValidateEnergyCsv(accepted.normalizedCsv);

    expect(parsed.data[1]?.usageKwh).toBe(2.7546);
  });

  it('proposes source-order assignment for two fall-back rows but requires explicit confirmation of both', () => {
    const review = inspectDteImport(TWO_FOLD_ROWS, 'America/Detroit', 'dte.csv');
    const foldRows = review.rows.filter((row) => row.localTimestamp === '2025-11-02 01:00');

    expect(foldRows.map((row) => row.originalUsageKwh)).toEqual([2.25, 3.25]);
    expect(foldRows.map((row) => row.proposedInstantUtc)).toEqual([
      '2025-11-02T05:00:00.000Z', '2025-11-02T06:00:00.000Z',
    ]);
    expect(foldRows.every((row) => row.requiresTimeConfirmation)).toBe(true);
    expect(previewDteImport(review, {}).unconfirmedRows.map((row) => row.sourceRow)).toEqual([3, 4]);
    const accepted = buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z', 4: '2025-11-02T06:00:00.000Z' },
      sourceRowCorrections: {},
      missingIntervalCorrections: {},
    });
    const parsed = parseAndValidateEnergyCsv(accepted.normalizedCsv);
    expect(parsed.operationallySimulatable).toBe(true);
    expect(parsed.data.map((point) => point.usageKwh)).toEqual([1.25, 2.25, 3.25, 4.5]);
    expect(accepted.provenance.timeAssignments.map((entry) => entry.offsetLabel)).toEqual(['UTC−04:00', 'UTC−05:00']);
  });

  it('invalidates an estimate when fall-back UTC choices change its measured neighbors and preserves manual corrections', () => {
    const csv = TWO_FOLD_ROWS.replace('1:00 AM,3.25', '1:00 AM,No Data');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');
    const firstChoices = { 3: '2025-11-02T05:00:00.000Z', 4: '2025-11-02T06:00:00.000Z' };
    const secondChoices = { 3: '2025-11-02T06:00:00.000Z', 4: '2025-11-02T05:00:00.000Z' };
    const firstPreview = previewDteImport(review, firstChoices);
    const secondPreview = previewDteImport(review, secondChoices);
    const firstEstimate = proposeGuidedEstimate(firstPreview, { sourceRow: 4 });
    const secondEstimate = proposeGuidedEstimate(secondPreview, { sourceRow: 4 });

    expect(firstEstimate).not.toBeNull();
    expect(secondEstimate).not.toBeNull();
    expect(firstEstimate?.contextKey).not.toBe(secondEstimate?.contextKey);
    const nextCorrections = invalidateStaleEstimateCorrections(
      firstPreview,
      secondPreview,
      {
        4: {
          usageKwh: firstEstimate!.usageKwh, method: 'estimate', approved: true,
          estimateContextKey: firstEstimate!.contextKey,
        },
        9: { usageKwh: 8, method: 'manual', approved: true },
      },
      {},
    );

    expect(nextCorrections.sourceRowCorrections[4]).toBeUndefined();
    expect(nextCorrections.sourceRowCorrections[9]).toEqual({ usageKwh: 8, method: 'manual', approved: true });
  });

  it('keeps a measured fall-back value when the other source row is No Data', () => {
    const csv = TWO_FOLD_ROWS.replace('1:00 AM,3.25', '1:00 AM,No Data');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');
    const foldRows = review.rows.filter((row) => row.localTimestamp === '2025-11-02 01:00');

    expect(foldRows.map((row) => row.originalUsageKwh)).toEqual([2.25, null]);
    expect(review.missingMeasurements.map((row) => row.sourceRow)).toEqual([4]);
    expect(review.rows.find((row) => row.sourceRow === 3)?.originalUsageKwh).toBe(2.25);
  });

  it('preserves the measured occurrence and separately records a corrected No Data occurrence', () => {
    const csv = TWO_FOLD_ROWS.replace('1:00 AM,3.25', '1:00 AM,No Data');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');
    const accepted = buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z', 4: '2025-11-02T06:00:00.000Z' },
      sourceRowCorrections: { 4: { usageKwh: 3.1, method: 'manual', approved: true } },
      missingIntervalCorrections: {},
    });
    const parsed = parseAndValidateEnergyCsv(accepted.normalizedCsv);

    expect(parsed.data.map((point) => point.usageKwh)).toEqual([1.25, 2.25, 3.1, 4.5]);
    expect(accepted.provenance.timeAssignments).toHaveLength(2);
    expect(accepted.provenance.corrections).toEqual([
      expect.objectContaining({ sourceRow: 4, originalValue: 'No Data', correctedKwh: 3.1, method: 'manual' }),
    ]);
  });

  it('classifies an unrelated No Data row by its actual source row rather than as a DST artifact', () => {
    const csv = [
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '10/31/2025,12:00 AM,1.25,20,kWh',
      '10/31/2025,1:00 AM,No Data,20,kWh',
      '10/31/2025,2:00 AM,3.5,20,kWh',
    ].join('\n');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');

    expect(review.missingMeasurements).toEqual([
      expect.objectContaining({ sourceRow: 3, sourceDate: '10/31/2025', sourceTime: '1:00 AM', isAmbiguousTime: false }),
    ]);
    const accepted = buildAcceptedDteImport(review, {
      timeChoices: {},
      sourceRowCorrections: { 3: { usageKwh: 2.2, method: 'manual', approved: true } },
      missingIntervalCorrections: {},
    });
    expect(parseAndValidateEnergyCsv(accepted.normalizedCsv).operationallySimulatable).toBe(true);
    expect(accepted.provenance.corrections).toEqual([
      expect.objectContaining({ sourceRow: 3, sourceDate: '10/31/2025', sourceTime: '1:00 AM', originalValue: 'No Data', correctedKwh: 2.2, method: 'manual' }),
    ]);
  });

  it('rejects duplicate non-DST source timestamps instead of presenting an unresolvable review', () => {
    const csv = [
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '10/31/2025,12:00 AM,1,20,kWh',
      '10/31/2025,1:00 AM,2,20,kWh',
      '10/31/2025,1:00 AM,3,20,kWh',
      '10/31/2025,2:00 AM,4,20,kWh',
    ].join('\n');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');

    expect(review.status).toBe('rejected');
    expect(review.error).toMatch(/duplicate.*source/i);
  });

  it('rejects arbitrary out-of-order source rows instead of sorting them into UTC chronology', () => {
    const csv = [
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '10/31/2025,2:00 AM,2,20,kWh',
      '10/31/2025,1:00 AM,1,20,kWh',
      '10/31/2025,3:00 AM,3,20,kWh',
    ].join('\n');
    const review = inspectDteImport(csv, 'America/Detroit', 'dte.csv');

    expect(review.status).toBe('rejected');
    expect(review.error).toMatch(/out of chronological source order/i);
  });

  it('accepts only confirmed complete UTC cadence and returns original CSV plus correction provenance', () => {
    const review = inspectDteImport(DST_CSV, 'America/Detroit', 'dte.csv');
    expect(() => buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z' },
      sourceRowCorrections: {},
      missingIntervalCorrections: {},
    })).toThrow(/missing interval 2025-11-02 01:00/i);
    const result = buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z' },
      sourceRowCorrections: {},
      missingIntervalCorrections: {
        '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true },
      },
    });
    const parsed = parseAndValidateEnergyCsv(result.normalizedCsv);

    expect(result.originalCsv).toBe(DST_CSV);
    expect(parsed.schemaValid && parsed.chronologicallyValid && parsed.operationallySimulatable).toBe(true);
    expect(parsed.data.map((point) => point.usageKwh)).toEqual([1.25, 2.75, 2.9, 3.5]);
    expect(alignLoadTimestampsToSite(parsed.data, parsed.intervalHours, 'America/Detroit')).toHaveLength(4);
    expect(result.provenance.timeAssignments).toEqual([
      expect.objectContaining({ sourceRow: 3, offsetLabel: 'UTC−04:00', confirmed: true }),
    ]);
    expect(result.provenance.corrections).toEqual([
      expect.objectContaining({ sourceRow: null, originalValue: null, correctedKwh: 2.9, method: 'manual' }),
    ]);
  });

  it('requires explicit approval for estimates and discloses the estimate method in provenance', () => {
    const review = inspectDteImport(DST_CSV.replace('1:00 AM,2.75', '1:00 AM,No Data'), 'America/Detroit', 'dte.csv');
    const timeChoices = { 3: '2025-11-02T05:00:00.000Z' };
    const preview = previewDteImport(review, timeChoices);
    const proposal = proposeGuidedEstimate(preview, { sourceRow: 3 })!;
    expect(proposal.disclosure).toMatch(/no value is filled automatically/i);
    expect(() => buildAcceptedDteImport(review, {
      timeChoices,
      sourceRowCorrections: { 3: { usageKwh: 2.4, method: 'estimate', approved: false } },
      missingIntervalCorrections: { '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true } },
    })).toThrow(/approve the disclosed estimate/i);
    expect(() => buildAcceptedDteImport(review, {
      timeChoices,
      sourceRowCorrections: {
        3: {
          usageKwh: 2.4, method: 'estimate', approved: true,
          estimateContextKey: proposal.contextKey,
        },
      },
      missingIntervalCorrections: { '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true } },
    })).toThrow(/must match the disclosed value of 2\.375 kWh/i);
    const accepted = buildAcceptedDteImport(review, {
      timeChoices,
      sourceRowCorrections: {
        3: {
          usageKwh: proposal.usageKwh, method: 'estimate', approved: true,
          estimateContextKey: proposal.contextKey,
        },
      },
      missingIntervalCorrections: { '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true } },
    });
    expect(accepted.provenance.corrections[0]).toEqual(expect.objectContaining({ method: 'estimate', disclosure: expect.stringMatching(/nearest measured interval/i) }));
    expect(accepted.provenance.corrections[0].correctedKwh).toBe(2.375);
    expect(preview.unconfirmedRows).toHaveLength(0);
  });
});
