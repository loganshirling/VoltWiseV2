import { describe, expect, it } from 'vitest';
import { isLifecycleProjectionReady } from '../components/DataAndRatesTab';

describe('Data and Rates lifecycle readiness', () => {
  it('requires canonical annual eligibility and valid site alignment', () => {
    expect(isLifecycleProjectionReady(undefined, { operationallySimulatable: true })).toBe(false);
    expect(isLifecycleProjectionReady(true, null)).toBe(false);
    expect(isLifecycleProjectionReady(true, { operationallySimulatable: false })).toBe(false);
    expect(isLifecycleProjectionReady(true, { operationallySimulatable: true })).toBe(true);
  });
});
