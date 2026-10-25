export const PERFORMANCE_EXPORT_HORIZON_YEARS = 25;
export const PERFORMANCE_EXPORT_HORIZON_PRESET = '25Y';
export const PERFORMANCE_EXPORT_HORIZON_SLIDER = 'Projection horizon (years)';
export const PERFORMANCE_EXPORT_HORIZON_MEASURED = false;

export type PerformanceHorizonSelectionAdapter = {
  clickPreset: (label: string) => Promise<void>;
  readSliderValue: (accessibleName: string) => Promise<string>;
  assertImportedRunStable: () => Promise<void>;
};

export async function selectPerformanceExportHorizon(adapter: PerformanceHorizonSelectionAdapter): Promise<void> {
  await adapter.assertImportedRunStable();
  await adapter.clickPreset(PERFORMANCE_EXPORT_HORIZON_PRESET);
  const selectedHorizon = await adapter.readSliderValue(PERFORMANCE_EXPORT_HORIZON_SLIDER);
  if (selectedHorizon !== String(PERFORMANCE_EXPORT_HORIZON_YEARS)) {
    throw new Error(`The Results projection horizon slider selected ${selectedHorizon}; expected ${PERFORMANCE_EXPORT_HORIZON_YEARS}.`);
  }
  await adapter.assertImportedRunStable();
}
