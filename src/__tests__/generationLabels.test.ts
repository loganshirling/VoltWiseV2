import { describe, expect, it } from 'vitest';
import { formatEnabledGenerationLabels, getEnabledGenerationLabels, calculateNetOperationalSavingsUsd, formatUsdAmount } from '../utils/generationLabels';
import { GenerationAsset } from '../types/energy';

const asset = (type: GenerationAsset['type'], enabled = true): GenerationAsset => ({
  id: type,
  name: type,
  type,
  enabled,
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,
} as GenerationAsset);

describe('enabled generation labels', () => {
  it.each([
    [['solar'], 'Solar'],
    [['generator'], 'Generator'],
    [['solar', 'generator'], 'Solar + Generator'],
    [['wind', 'generator'], 'Wind + Generator'],
    [['solar', 'wind', 'generator'], 'Solar + Wind + Generator'],
  ] as const)('labels %j from configured enabled assets', (types, expected) => {
    expect(formatEnabledGenerationLabels(types.map((type) => asset(type)))).toBe(expected);
  });

  it('keeps an enabled standby generator visible when it has zero output', () => {
    const standby = { ...asset('generator'), dispatchMode: 'standby' as const } as GenerationAsset;
    expect(getEnabledGenerationLabels([standby])).toEqual(['Generator']);
    expect(getEnabledGenerationLabels([asset('solar', false), standby])).toEqual(['Generator']);
  });
});

describe('generator operating economics', () => {
  it('can produce negative net operational value when costs exceed avoided imports', () => {
    expect(calculateNetOperationalSavingsUsd(120, 175)).toBe(-55);
    expect(formatUsdAmount(calculateNetOperationalSavingsUsd(120, 175))).toBe('-$55');
  });
});
