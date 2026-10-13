import { GenerationAsset, GenerationConfig } from '../types/energy';

const GENERATION_LABELS = {
  solar: 'Solar',
  wind: 'Wind',
  generator: 'Generator',
} as const;

/** Display technologies from configuration, so enabled zero-output assets remain visible. */
export function getEnabledGenerationLabels(
  config?: GenerationConfig | GenerationAsset[] | null
): string[] {
  const assets = Array.isArray(config) ? config : config?.assets ?? [];
  const enabledTypes = new Set(assets.filter((asset) => asset?.enabled).map((asset) => asset.type));
  return (['solar', 'wind', 'generator'] as const)
    .filter((type) => enabledTypes.has(type))
    .map((type) => GENERATION_LABELS[type]);
}

export function formatEnabledGenerationLabels(
  config?: GenerationConfig | GenerationAsset[] | null
): string {
  return getEnabledGenerationLabels(config).join(' + ') || 'No generation';
}

/** Utility bill reduction less generator variable operating costs. */
export function calculateNetOperationalSavingsUsd(
  utilityElectricitySavingsUsd: number,
  generatorOperatingCostUsd: number
): number {
  return Math.round((utilityElectricitySavingsUsd - generatorOperatingCostUsd) * 100) / 100;
}

export function formatUsdAmount(amount: number): string {
  return `${amount < 0 ? '-$' : '$'}${Math.abs(amount).toLocaleString()}`;
}
