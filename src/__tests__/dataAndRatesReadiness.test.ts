import { describe, expect, it } from 'vitest';
import { isLifecycleProjectionReady, isSimulationReady } from '../components/DataAndRatesTab';

describe('Data and Rates simulation readiness', () => {
  it('requires exact positive site alignment eligibility', () => {
    expect(isSimulationReady(true, null)).toBe(false);
    expect(isSimulationReady(true, { operationallySimulatable: false })).toBe(false);
    expect(isSimulationReady(true, { operationallySimulatable: true })).toBe(true);
    expect(isSimulationReady(false, { operationallySimulatable: true })).toBe(false);
  });
});

describe('Data and Rates lifecycle readiness', () => {
  it('requires canonical annual eligibility and valid site alignment', () => {
    expect(isLifecycleProjectionReady(undefined, { operationallySimulatable: true })).toBe(false);
    expect(isLifecycleProjectionReady(true, null)).toBe(false);
    expect(isLifecycleProjectionReady(true, { operationallySimulatable: false })).toBe(false);
    expect(isLifecycleProjectionReady(true, { operationallySimulatable: true })).toBe(true);
  });
});
