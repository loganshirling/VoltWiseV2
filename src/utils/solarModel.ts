/**
 * Pure, Deterministic Solar Geometry and Clear-Sky Interval Generation Model (Milestone G2A)
 *
 * Implements NOAA-style solar position approximation and screening-grade clear-sky
 * irradiance modeling (Kasten-Young air mass, empirical DNI, isotropic diffuse POA,
 * STC module DC rating, multiplicative losses, and inverter AC clipping).
 */

import {
  GenerationSite,
  SolarGenerationAsset,
  SolarPosition,
  SolarIntervalGenerationResult,
} from '../types/energy';

/**
 * Calculates deterministic NOAA-style solar position for a given UTC instant and site coordinates.
 *
 * Coordinates convention:
 * - Latitude: North positive, South negative [-90, +90]
 * - Longitude: East positive, West negative [-180, +180]
 *
 * Azimuth convention:
 * - 0° = North, 90° = East, 180° = South, 270° = West (clockwise from North)
 */
export function calculateSolarPosition(
  instantUtc: Date,
  site: GenerationSite
): SolarPosition {
  if (!instantUtc || isNaN(instantUtc.getTime())) {
    throw new Error('Invalid instantUtc: must be a valid Date object.');
  }

  if (
    site.latitude === null ||
    site.latitude === undefined ||
    site.longitude === null ||
    site.longitude === undefined
  ) {
    throw new Error('Site coordinates unconfigured: latitude and longitude must not be null.');
  }

  if (site.latitude < -90 || site.latitude > 90) {
    throw new Error(`Invalid latitude: ${site.latitude}. Must be between -90 and 90 degrees.`);
  }

  if (site.longitude < -180 || site.longitude > 180) {
    throw new Error(`Invalid longitude: ${site.longitude}. Must be between -180 and 180 degrees.`);
  }

  const year = instantUtc.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const currentDay = Date.UTC(year, instantUtc.getUTCMonth(), instantUtc.getUTCDate());
  const N = Math.floor((currentDay - startOfYear) / (24 * 3600 * 1000)) + 1;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeapYear ? 366 : 365;

  const hour =
    instantUtc.getUTCHours() +
    instantUtc.getUTCMinutes() / 60 +
    instantUtc.getUTCSeconds() / 3600 +
    instantUtc.getUTCMilliseconds() / 3600000;

  const gamma = ((2 * Math.PI) / daysInYear) * (N - 1 + (hour - 12) / 24);

  const E =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const delta =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const utcMinutes =
    instantUtc.getUTCHours() * 60 +
    instantUtc.getUTCMinutes() +
    instantUtc.getUTCSeconds() / 60 +
    instantUtc.getUTCMilliseconds() / 60000;

  let TST = utcMinutes + E + 4 * site.longitude;
  TST = ((TST % 1440) + 1440) % 1440;

  const H_deg = TST / 4 - 180;
  const H_rad = H_deg * (Math.PI / 180);

  const latRad = site.latitude * (Math.PI / 180);

  const cosZenith =
    Math.sin(latRad) * Math.sin(delta) +
    Math.cos(latRad) * Math.cos(delta) * Math.cos(H_rad);

  const clampedCosZenith = Math.max(-1, Math.min(1, cosZenith));
  const zenithRad = Math.acos(clampedCosZenith);
  const zenithDegrees = zenithRad * (180 / Math.PI);
  const elevationDegrees = 90 - zenithDegrees;
  const isDaylight = elevationDegrees > 0;

  const azimuthFromSouthRad = Math.atan2(
    Math.sin(H_rad),
    Math.cos(H_rad) * Math.sin(latRad) - Math.tan(delta) * Math.cos(latRad)
  );
  const azimuthFromSouthDeg = azimuthFromSouthRad * (180 / Math.PI);
  const azimuthDegrees = ((azimuthFromSouthDeg + 180) % 360 + 360) % 360;

  return {
    elevationDegrees,
    zenithDegrees,
    azimuthDegrees,
    isDaylight,
  };
}

/**
 * Calculates panel incidence cosine between sun vector and panel normal vector.
 *
 * Returns 0 if sun is below horizon or behind the plane of the array.
 */
export function calculatePanelIncidenceCosine(
  position: SolarPosition,
  tiltDegrees: number,
  azimuthDegrees: number
): number {
  if (!position.isDaylight || position.elevationDegrees <= 0) {
    return 0;
  }

  const e = position.elevationDegrees * (Math.PI / 180);
  const a = position.azimuthDegrees * (Math.PI / 180);

  const sunEast = Math.cos(e) * Math.sin(a);
  const sunNorth = Math.cos(e) * Math.cos(a);
  const sunUp = Math.sin(e);

  const beta = tiltDegrees * (Math.PI / 180);
  const gamma = azimuthDegrees * (Math.PI / 180);

  const panelEast = Math.sin(beta) * Math.sin(gamma);
  const panelNorth = Math.sin(beta) * Math.cos(gamma);
  const panelUp = Math.cos(beta);

  const cosIncidence = sunEast * panelEast + sunNorth * panelNorth + sunUp * panelUp;

  return Math.max(0, cosIncidence);
}

export interface SolarPvOutput {
  rawDcPowerKw: number;
  dcPowerAfterLossesKw: number;
  unclippedAcPowerKw: number;
  acPowerKw: number;
  dcEnergyKwh: number;
  acEnergyKwh: number;
  clippedEnergyKwh: number;
}

/**
 * Calculates raw DC power, post-loss DC power, inverter clipping, and interval energy
 * from plane-of-array (POA) irradiance.
 */
export function calculatePvOutputFromPoa(
  poaIrradianceKwPerM2: number,
  intervalHours: number,
  asset: SolarGenerationAsset
): SolarPvOutput {
  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  if (!asset.enabled) {
    return {
      rawDcPowerKw: 0,
      dcPowerAfterLossesKw: 0,
      unclippedAcPowerKw: 0,
      acPowerKw: 0,
      dcEnergyKwh: 0,
      acEnergyKwh: 0,
      clippedEnergyKwh: 0,
    };
  }

  const rawDcPowerKw = Math.max(0, asset.dcCapacityKw * Math.max(0, poaIrradianceKwPerM2));

  const systemLoss = Math.max(0, Math.min(100, asset.systemLossPercent));
  const shadingLoss = Math.max(0, Math.min(100, asset.shadingLossPercent));

  const dcPowerAfterLossesKw = Math.max(
    0,
    rawDcPowerKw * (1 - systemLoss / 100) * (1 - shadingLoss / 100)
  );

  const inverterEff = Math.max(0, Math.min(100, asset.inverterEfficiencyPercent));
  const unclippedAcPowerKw = Math.max(0, dcPowerAfterLossesKw * (inverterEff / 100));

  const acPowerKw = Math.min(unclippedAcPowerKw, Math.max(0, asset.inverterAcCapacityKw));
  const clippedPowerKw = Math.max(0, unclippedAcPowerKw - acPowerKw);

  const dcEnergyKwh = dcPowerAfterLossesKw * intervalHours;
  const acEnergyKwh = acPowerKw * intervalHours;
  const clippedEnergyKwh = clippedPowerKw * intervalHours;

  return {
    rawDcPowerKw,
    dcPowerAfterLossesKw,
    unclippedAcPowerKw,
    acPowerKw,
    dcEnergyKwh,
    acEnergyKwh,
    clippedEnergyKwh,
  };
}

/**
 * Calculates clear-sky solar irradiance, DC power after losses, and AC power/energy for an interval.
 *
 * Implements:
 * - Kasten-Young air mass with barometric elevation correction
 * - Empirical clear-sky DNI and diffuse GHI
 * - Plane-of-array (POA) beam + isotropic diffuse irradiance
 * - STC DC capacity scaling
 * - Multiplicative system and shading losses
 * - Inverter AC clipping and conversion efficiency
 */
export function calculateClearSkySolarInterval(
  instantUtc: Date,
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset
): SolarIntervalGenerationResult {
  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  const position = calculateSolarPosition(instantUtc, site);
  const incidenceCosine = calculatePanelIncidenceCosine(
    position,
    asset.tiltDegrees,
    asset.azimuthDegrees
  );

  let clearSkyDniKwPerM2 = 0;
  let clearSkyGhiKwPerM2 = 0;
  let planeOfArrayIrradianceKwPerM2 = 0;

  if (position.isDaylight && position.elevationDegrees > 0) {
    const elevDeg = position.elevationDegrees;
    const elevRad = elevDeg * (Math.PI / 180);

    const airMass =
      1 /
      (Math.sin(elevRad) +
        0.50572 * Math.pow(elevDeg + 6.07995, -1.6364));

    const elevationM = site.elevationM ?? 0;
    const pressureRatio = Math.exp(-elevationM / 8434.5);
    const correctedAirMass = airMass * pressureRatio;

    clearSkyDniKwPerM2 = Math.max(
      0,
      1.353 * Math.pow(0.7, Math.pow(correctedAirMass, 0.678))
    );

    const beamHorizontal = clearSkyDniKwPerM2 * Math.sin(elevRad);
    const diffuseHorizontal = 0.1 * beamHorizontal;
    clearSkyGhiKwPerM2 = beamHorizontal + diffuseHorizontal;

    const poaBeam = clearSkyDniKwPerM2 * incidenceCosine;
    const panelTiltRad = asset.tiltDegrees * (Math.PI / 180);
    const poaDiffuse = diffuseHorizontal * ((1 + Math.cos(panelTiltRad)) / 2);
    planeOfArrayIrradianceKwPerM2 = Math.max(0, poaBeam + poaDiffuse);
  }

  const pvOutput = calculatePvOutputFromPoa(planeOfArrayIrradianceKwPerM2, intervalHours, asset);

  return {
    timestampUtc: instantUtc.toISOString(),
    position,
    clearSkyGhiKwPerM2,
    clearSkyDniKwPerM2,
    planeOfArrayIrradianceKwPerM2,
    ...pvOutput,
  };
}
