import { describe, it, expect } from 'vitest';
import { alignExternalResourceToLoad } from '../utils/externalResourceAlignment';
import {
  SolarIrradianceDataset,
  WindSpeedDataset,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

describe('G7A — External Resource Exact Load Alignment', () => {
  const solarDataset: SolarIrradianceDataset = {
    id: 'solar-1',
    name: 'Solar Test Dataset',
    kind: 'solar_irradiance',
    sourceTimeZone: 'UTC',
    intervalHours: 1.0,
    rowCount: 4,
    startTimestampUtc: '2026-06-01T12:00:00.000Z',
    endTimestampUtc: '2026-06-01T15:00:00.000Z',
    records: [
      {
        timestampUtc: '2026-06-01T12:00:00.000Z',
        ghiWm2: 800,
        dniWm2: 650,
        dhiWm2: 150,
      },
      {
        timestampUtc: '2026-06-01T13:00:00.000Z',
        ghiWm2: 900,
        dniWm2: 750,
        dhiWm2: 150,
      },
      {
        timestampUtc: '2026-06-01T14:00:00.000Z',
        ghiWm2: 850,
        dniWm2: 700,
        dhiWm2: 150,
      },
      {
        timestampUtc: '2026-06-01T15:00:00.000Z',
        ghiWm2: 700,
        dniWm2: 550,
        dhiWm2: 150,
      },
    ],
  };

  const windDataset: WindSpeedDataset = {
    id: 'wind-1',
    name: 'Wind Test Dataset',
    kind: 'wind_speed',
    sourceTimeZone: 'UTC',
    intervalHours: 1.0,
    rowCount: 3,
    startTimestampUtc: '2026-06-01T12:00:00.000Z',
    endTimestampUtc: '2026-06-01T14:00:00.000Z',
    records: [
      {
        timestampUtc: '2026-06-01T12:00:00.000Z',
        windSpeedMps: 6.2,
      },
      {
        timestampUtc: '2026-06-01T13:00:00.000Z',
        windSpeedMps: 7.5,
      },
      {
        timestampUtc: '2026-06-01T14:00:00.000Z',
        windSpeedMps: 8.1,
      },
    ],
  };

  it('performs exact one-to-one alignment for solar irradiance', () => {
    const alignedLoad: AlignedLoadTimestamp[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2026-06-01 12:00',
        instantUtc: new Date('2026-06-01T12:00:00.000Z'),
        timestampUtc: '2026-06-01T12:00:00.000Z',
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2026-06-01 13:00',
        instantUtc: new Date('2026-06-01T13:00:00.000Z'),
        timestampUtc: '2026-06-01T13:00:00.000Z',
      },
    ];

    const aligned = alignExternalResourceToLoad(solarDataset, alignedLoad, 1.0);

    expect(aligned).toHaveLength(2);
    expect(aligned[0]).toEqual(solarDataset.records[0]);
    expect(aligned[1]).toEqual(solarDataset.records[1]);
  });

  it('performs exact one-to-one alignment for wind speed', () => {
    const alignedLoad: AlignedLoadTimestamp[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2026-06-01 12:00',
        instantUtc: new Date('2026-06-01T12:00:00.000Z'),
        timestampUtc: '2026-06-01T12:00:00.000Z',
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2026-06-01 13:00',
        instantUtc: new Date('2026-06-01T13:00:00.000Z'),
        timestampUtc: '2026-06-01T13:00:00.000Z',
      },
      {
        sourceIndex: 2,
        sourceTimestamp: '2026-06-01 14:00',
        instantUtc: new Date('2026-06-01T14:00:00.000Z'),
        timestampUtc: '2026-06-01T14:00:00.000Z',
      },
    ];

    const aligned = alignExternalResourceToLoad(windDataset, alignedLoad, 1.0);

    expect(aligned).toHaveLength(3);
    expect(aligned[0].windSpeedMps).toBe(6.2);
    expect(aligned[1].windSpeedMps).toBe(7.5);
    expect(aligned[2].windSpeedMps).toBe(8.1);
  });

  it('returns records strictly in load order even if load order differs from resource storage order', () => {
    // Modeled load order: 13:00 then 12:00
    const alignedLoad = [
      '2026-06-01T13:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
    ];

    const aligned = alignExternalResourceToLoad(solarDataset, alignedLoad, 1.0);

    expect(aligned).toHaveLength(2);
    expect(aligned[0].timestampUtc).toBe('2026-06-01T13:00:00.000Z');
    expect(aligned[1].timestampUtc).toBe('2026-06-01T12:00:00.000Z');
  });

  it('accepts resource superset (resource covers extra intervals outside modeled load period)', () => {
    // Modeled load is only 1 hour (13:00), dataset has 4 hours (12:00 - 15:00)
    const alignedLoad = ['2026-06-01T13:00:00.000Z'];

    const aligned = alignExternalResourceToLoad(solarDataset, alignedLoad, 1.0);

    expect(aligned).toHaveLength(1);
    expect(aligned[0].timestampUtc).toBe('2026-06-01T13:00:00.000Z');
  });

  it('rejects when a required load instant is missing from the resource dataset', () => {
    // 16:00 is not in solarDataset (which ends at 15:00)
    const alignedLoad = [
      '2026-06-01T14:00:00.000Z',
      '2026-06-01T15:00:00.000Z',
      '2026-06-01T16:00:00.000Z',
    ];

    expect(() => {
      alignExternalResourceToLoad(solarDataset, alignedLoad, 1.0);
    }).toThrowError(/Missing required resource record for load timestamp "2026-06-01T16:00:00.000Z"/);
  });

  it('rejects when interval duration does not match load interval duration', () => {
    // Solar dataset interval is 1.0h, load interval is 0.25h
    const alignedLoad = ['2026-06-01T12:00:00.000Z'];

    expect(() => {
      alignExternalResourceToLoad(solarDataset, alignedLoad, 0.25);
    }).toThrowError(/Interval duration mismatch/);
  });

  it('does not mutate caller resource dataset or load array (input immutability)', () => {
    const recordsSnapshot = [...solarDataset.records];
    const alignedLoad = Object.freeze(['2026-06-01T12:00:00.000Z', '2026-06-01T13:00:00.000Z']);

    const aligned = alignExternalResourceToLoad(solarDataset, alignedLoad, 1.0);

    expect(solarDataset.records).toEqual(recordsSnapshot);
    expect(aligned).not.toBe(solarDataset.records); // Returns a new aligned array
  });

  it('supports options object signature', () => {
    const alignedLoad = ['2026-06-01T12:00:00.000Z'];
    const aligned = alignExternalResourceToLoad({
      dataset: solarDataset,
      alignedLoad,
      loadIntervalHours: 1.0,
    });
    expect(aligned).toHaveLength(1);
    expect(aligned[0].ghiWm2).toBe(800);
  });
});
