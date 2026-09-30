import { describe, it, expect } from 'vitest';
import {
  calculateSolarPosition,
  calculatePanelIncidenceCosine,
  calculateClearSkySolarInterval,
} from '../utils/solarModel';
import { GenerationSite, SolarGenerationAsset } from '../types/energy';
import { createDefaultSolarAsset } from '../utils/generationDefaults';

describe('G2A Milestone — Solar Geometry & Clear-Sky Physics Model', () => {
  const baseAsset: SolarGenerationAsset = {
    ...createDefaultSolarAsset('solar-test', 'Test Array'),
    dcCapacityKw: 10.0,
    inverterAcCapacityKw: 9.0,
    inverterEfficiencyPercent: 96.0,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    systemLossPercent: 14.0,
    shadingLossPercent: 2.0,
  };

  // --------------------------------------------------------------------------
  // A. Equator near equinox solar noon
  // --------------------------------------------------------------------------
  it('A. calculates very high solar elevation (> 85°) at equator solar noon near equinox', () => {
    const site: GenerationSite = {
      latitude: 0,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    // 2026-03-20 12:07 UTC accounts for minor equation of time (~ -7 min)
    const equinoxNoon = new Date('2026-03-20T12:07:00Z');
    const position = calculateSolarPosition(equinoxNoon, site);

    expect(position.isDaylight).toBe(true);
    expect(position.elevationDegrees).toBeGreaterThan(85);
    expect(position.zenithDegrees).toBeLessThan(5);
    expect(position.elevationDegrees + position.zenithDegrees).toBeCloseTo(90, 5);
  });

  // --------------------------------------------------------------------------
  // B. Nighttime
  // --------------------------------------------------------------------------
  it('B. returns daylight false, zero DNI/GHI, and zero AC power/energy at midnight', () => {
    const site: GenerationSite = {
      latitude: 0,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    const midnight = new Date('2026-03-20T00:00:00Z');
    const result = calculateClearSkySolarInterval(midnight, 1.0, site, baseAsset);

    expect(result.position.isDaylight).toBe(false);
    expect(result.position.elevationDegrees).toBeLessThan(0);
    expect(result.clearSkyDniKwPerM2).toBe(0);
    expect(result.clearSkyGhiKwPerM2).toBe(0);
    expect(result.planeOfArrayIrradianceKwPerM2).toBe(0);
    expect(result.rawDcPowerKw).toBe(0);
    expect(result.dcPowerAfterLossesKw).toBe(0);
    expect(result.acPowerKw).toBe(0);
    expect(result.acEnergyKwh).toBe(0);
    expect(result.clippedEnergyKwh).toBe(0);
  });

  // --------------------------------------------------------------------------
  // C. Seasonal solar elevation
  // --------------------------------------------------------------------------
  it('C. calculates substantially higher solar elevation in June than in December at mid-latitudes', () => {
    const site: GenerationSite = {
      latitude: 42,
      longitude: 0,
      timeZone: '',
      elevationM: 100,
    };
    const juneNoon = new Date('2026-06-21T12:00:00Z');
    const decNoon = new Date('2026-12-21T12:00:00Z');

    const junePos = calculateSolarPosition(juneNoon, site);
    const decPos = calculateSolarPosition(decNoon, site);

    expect(junePos.isDaylight).toBe(true);
    expect(decPos.isDaylight).toBe(true);
    // Northern mid-latitude (42°N) solar noon elevation: ~71° in June vs ~24° in Dec (diff ~47°)
    expect(junePos.elevationDegrees).toBeGreaterThan(decPos.elevationDegrees);
    expect(junePos.elevationDegrees - decPos.elevationDegrees).toBeGreaterThan(40);
  });

  // --------------------------------------------------------------------------
  // D. Morning / afternoon azimuth
  // --------------------------------------------------------------------------
  it('D. calculates morning sun generally eastward and afternoon sun generally westward', () => {
    const site: GenerationSite = {
      latitude: 35,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    // 08:30 UTC morning, 15:30 UTC afternoon on equinox
    const morning = new Date('2026-03-20T08:30:00Z');
    const afternoon = new Date('2026-03-20T15:30:00Z');

    const morningPos = calculateSolarPosition(morning, site);
    const afternoonPos = calculateSolarPosition(afternoon, site);

    expect(morningPos.isDaylight).toBe(true);
    expect(afternoonPos.isDaylight).toBe(true);

    // Morning azimuth generally East (45° to 135°)
    expect(morningPos.azimuthDegrees).toBeGreaterThan(45);
    expect(morningPos.azimuthDegrees).toBeLessThan(135);

    // Afternoon azimuth generally West (225° to 315°)
    expect(afternoonPos.azimuthDegrees).toBeGreaterThan(225);
    expect(afternoonPos.azimuthDegrees).toBeLessThan(315);
  });

  // --------------------------------------------------------------------------
  // E. South-facing vs north-facing panel
  // --------------------------------------------------------------------------
  it('E. gives higher incidence cosine for south-facing panel than north-facing panel at northern midday', () => {
    const site: GenerationSite = {
      latitude: 38,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    const midday = new Date('2026-03-20T12:00:00Z');
    const pos = calculateSolarPosition(midday, site);

    const southIncidence = calculatePanelIncidenceCosine(pos, 30, 180); // South
    const northIncidence = calculatePanelIncidenceCosine(pos, 30, 0);   // North

    expect(southIncidence).toBeGreaterThan(northIncidence);
    expect(southIncidence).toBeGreaterThan(0.7);
  });

  // --------------------------------------------------------------------------
  // F. Nighttime panel incidence
  // --------------------------------------------------------------------------
  it('F. returns 0 incidence cosine when sun is below the horizon', () => {
    const nightPos = {
      elevationDegrees: -15,
      zenithDegrees: 105,
      azimuthDegrees: 0,
      isDaylight: false,
    };

    expect(calculatePanelIncidenceCosine(nightPos, 30, 180)).toBe(0);
    expect(calculatePanelIncidenceCosine(nightPos, 0, 0)).toBe(0);
  });

  // --------------------------------------------------------------------------
  // G. Inverter clipping
  // --------------------------------------------------------------------------
  it('G. clips AC output to inverterAcCapacityKw and records positive clipped energy', () => {
    const site: GenerationSite = {
      latitude: 0,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    // Large DC capacity (25 kW) with small inverter AC capacity (5 kW) under strong sun
    const oversizedDcAsset: SolarGenerationAsset = {
      ...baseAsset,
      dcCapacityKw: 25.0,
      inverterAcCapacityKw: 5.0,
      tiltDegrees: 0,
      azimuthDegrees: 180,
      systemLossPercent: 0,
      shadingLossPercent: 0,
      inverterEfficiencyPercent: 100,
    };

    const noon = new Date('2026-03-20T12:07:00Z');
    const result = calculateClearSkySolarInterval(noon, 1.0, site, oversizedDcAsset);

    expect(result.unclippedAcPowerKw).toBeGreaterThan(5.0);
    expect(result.acPowerKw).toBe(5.0);
    expect(result.clippedEnergyKwh).toBeGreaterThan(0);
    expect(result.clippedEnergyKwh).toBeCloseTo(result.unclippedAcPowerKw - 5.0, 5);
  });

  // --------------------------------------------------------------------------
  // H. Losses reduce output
  // --------------------------------------------------------------------------
  it('H. produces less AC energy when system and shading losses are applied', () => {
    const site: GenerationSite = {
      latitude: 35,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    const noon = new Date('2026-06-21T12:00:00Z');

    const zeroLossAsset: SolarGenerationAsset = {
      ...baseAsset,
      systemLossPercent: 0,
      shadingLossPercent: 0,
    };

    const realisticLossAsset: SolarGenerationAsset = {
      ...baseAsset,
      systemLossPercent: 14.0,
      shadingLossPercent: 5.0,
    };

    const resZero = calculateClearSkySolarInterval(noon, 1.0, site, zeroLossAsset);
    const resLoss = calculateClearSkySolarInterval(noon, 1.0, site, realisticLossAsset);

    expect(resZero.acEnergyKwh).toBeGreaterThan(0);
    expect(resLoss.acEnergyKwh).toBeGreaterThan(0);
    expect(resLoss.acEnergyKwh).toBeLessThan(resZero.acEnergyKwh);
    expect(resLoss.dcPowerAfterLossesKw).toBeLessThan(resZero.dcPowerAfterLossesKw);
  });

  // --------------------------------------------------------------------------
  // I. Sub-hourly energy scaling
  // --------------------------------------------------------------------------
  it('I. maintains identical power rate and scales energy linearly for 15-minute intervals', () => {
    const site: GenerationSite = {
      latitude: 35,
      longitude: 0,
      timeZone: '',
      elevationM: 50,
    };
    const time = new Date('2026-06-21T11:00:00Z');

    const res1Hour = calculateClearSkySolarInterval(time, 1.0, site, baseAsset);
    const res15Min = calculateClearSkySolarInterval(time, 0.25, site, baseAsset);

    expect(res1Hour.acPowerKw).toBe(res15Min.acPowerKw);
    expect(res1Hour.rawDcPowerKw).toBe(res15Min.rawDcPowerKw);
    expect(res15Min.acEnergyKwh).toBeCloseTo(0.25 * res1Hour.acEnergyKwh, 6);
    expect(res15Min.dcEnergyKwh).toBeCloseTo(0.25 * res1Hour.dcEnergyKwh, 6);
  });

  // --------------------------------------------------------------------------
  // J. Unconfigured location rejected
  // --------------------------------------------------------------------------
  it('J. throws clear error when site coordinates are null or unconfigured', () => {
    const nullLatSite: GenerationSite = {
      latitude: null,
      longitude: -122.4,
      timeZone: '',
      elevationM: null,
    };
    const nullLngSite: GenerationSite = {
      latitude: 37.7,
      longitude: null,
      timeZone: '',
      elevationM: null,
    };

    const time = new Date('2026-06-21T12:00:00Z');
    expect(() => calculateSolarPosition(time, nullLatSite)).toThrow(/unconfigured/i);
    expect(() => calculateSolarPosition(time, nullLngSite)).toThrow(/unconfigured/i);
    expect(() => calculateClearSkySolarInterval(time, 1.0, nullLatSite, baseAsset)).toThrow(
      /unconfigured/i
    );
  });

  // --------------------------------------------------------------------------
  // K. Invalid coordinate rejected
  // --------------------------------------------------------------------------
  it('K. throws clear error for out-of-range latitude or longitude values', () => {
    const invalidLatSite: GenerationSite = {
      latitude: 91.5,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    const invalidLngSite: GenerationSite = {
      latitude: 45,
      longitude: -185,
      timeZone: '',
      elevationM: 0,
    };

    const time = new Date('2026-06-21T12:00:00Z');
    expect(() => calculateSolarPosition(time, invalidLatSite)).toThrow(/latitude/i);
    expect(() => calculateSolarPosition(time, invalidLngSite)).toThrow(/longitude/i);
  });

  // --------------------------------------------------------------------------
  // Additional Edge Cases & Invariants
  // --------------------------------------------------------------------------
  it('rejects non-positive intervalHours', () => {
    const site: GenerationSite = { latitude: 35, longitude: 0, timeZone: '', elevationM: 0 };
    const time = new Date('2026-06-21T12:00:00Z');

    expect(() => calculateClearSkySolarInterval(time, 0, site, baseAsset)).toThrow(/intervalHours/i);
    expect(() => calculateClearSkySolarInterval(time, -0.5, site, baseAsset)).toThrow(
      /intervalHours/i
    );
  });

  it('preserves purity by not mutating input site or asset', () => {
    const site: GenerationSite = { latitude: 35, longitude: 10, timeZone: 'UTC', elevationM: 50 };
    const siteSnapshot = JSON.stringify(site);
    const assetSnapshot = JSON.stringify(baseAsset);

    const time = new Date('2026-06-21T12:00:00Z');
    calculateClearSkySolarInterval(time, 1.0, site, baseAsset);

    expect(JSON.stringify(site)).toBe(siteSnapshot);
    expect(JSON.stringify(baseAsset)).toBe(assetSnapshot);
  });

  // --------------------------------------------------------------------------
  // Southern Hemisphere regression
  // --------------------------------------------------------------------------
  it('gives higher incidence for north-facing panel than south-facing panel in southern hemisphere', () => {
    const southernSite: GenerationSite = {
      latitude: -35,
      longitude: 0,
      timeZone: '',
      elevationM: 0,
    };
    const midday = new Date('2026-03-20T12:07:00Z');
    const pos = calculateSolarPosition(midday, southernSite);

    const northIncidence = calculatePanelIncidenceCosine(pos, 30, 0);   // North
    const southIncidence = calculatePanelIncidenceCosine(pos, 30, 180); // South

    expect(northIncidence).toBeGreaterThan(southIncidence);
    expect(northIncidence).toBeGreaterThan(0.7);
  });
});
