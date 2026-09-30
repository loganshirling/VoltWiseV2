import React, { useState } from 'react';
import {
  Battery,
  Plus,
  Copy,
  Trash2,
  Zap,
  Gauge,
  Cpu,
  Layers,
  Check,
  Info,
} from 'lucide-react';
import { BatteryProfile, RateTier } from '../types/energy';

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow((prev) => !prev)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="text-slate-400 hover:text-emerald-400 focus:outline-none transition-colors ml-1 p-0.5"
        aria-label="Metric explanation"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 bg-slate-900 text-slate-200 text-xs rounded-lg shadow-2xl border border-emerald-500/40 z-50 pointer-events-none leading-relaxed text-left font-normal normal-case">
          <div className="relative z-10">{text}</div>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 border-b border-r border-emerald-500/40 rotate-45" />
        </div>
      )}
    </div>
  );
};

interface BatteryProfilesTabProps {
  profiles: BatteryProfile[];
  setProfiles: React.Dispatch<React.SetStateAction<BatteryProfile[]>>;
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  tiers: RateTier[];
}

export const BatteryProfilesTab: React.FC<BatteryProfilesTabProps> = ({
  profiles,
  setProfiles,
  activeProfileId,
  setActiveProfileId,
  tiers,
}) => {
  const currentProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const handleUpdateCurrent = (field: keyof BatteryProfile, value: any) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === currentProfile.id ? { ...p, [field]: value } : p))
    );
  };

  const handleCreateNewProfile = () => {
    const newId = `profile-${Date.now()}`;
    const newProfile: BatteryProfile = {
      id: newId,
      name: `Custom Battery ${profiles.length + 1}`,
      model: 'Custom LFP System',
      totalCapacityKwh: 12.0,
      usableDodPercent: 95,
      maxContinuousOutputKw: 5.0,
      maxContinuousChargeKw: 5.0,
      roundTripEfficiencyPercent: 90.0,
      ratedCycleLife: 4000,
      installedCost: 9500,
      strategy: 'arbitrage',
      chargeTiers: tiers.filter((t) => t.isChargeWindow).map((t) => t.id),
      dischargeTiers: tiers.filter((t) => t.isDischargeWindow).map((t) => t.id),
      allowGridExport: false,
    };
    setProfiles([...profiles, newProfile]);
    setActiveProfileId(newId);
  };

  const handleDuplicateProfile = () => {
    const newId = `profile-${Date.now()}`;
    const duplicated: BatteryProfile = {
      ...currentProfile,
      id: newId,
      name: `${currentProfile.name} (Copy)`,
      allowGridExport: currentProfile.allowGridExport ?? false,
    };
    setProfiles([...profiles, duplicated]);
    setActiveProfileId(newId);
  };

  const handleDeleteProfile = (id: string) => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== id);
    setProfiles(remaining);
    if (activeProfileId === id) {
      setActiveProfileId(remaining[0].id);
    }
  };

  const toggleTierInList = (listKey: 'chargeTiers' | 'dischargeTiers', tierId: string) => {
    const list = currentProfile[listKey] || [];
    const exists = list.includes(tierId);
    const updated = exists ? list.filter((id) => id !== tierId) : [...list, tierId];
    handleUpdateCurrent(listKey, updated);
  };

  // Derived real-time calculations
  const usableKwh = (currentProfile.totalCapacityKwh * (currentProfile.usableDodPercent / 100));
  const dischargeDurationHours = currentProfile.maxContinuousOutputKw > 0
    ? (usableKwh / currentProfile.maxContinuousOutputKw).toFixed(1)
    : '0';
  const cRate = usableKwh > 0 ? (currentProfile.maxContinuousOutputKw / usableKwh).toFixed(2) : '0';
  const costPerKwh = currentProfile.totalCapacityKwh > 0
    ? Math.round(currentProfile.installedCost / currentProfile.totalCapacityKwh)
    : 0;

  return (
    <div className="space-y-8">
      {/* SECTION HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="text-emerald-400 font-mono text-base">02.</span>
            Battery Hardware Profiles & Operational Strategy
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure technical hardware specs, round-trip efficiency, cycle limits, and dispatch algorithms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDuplicateProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            <span>Duplicate Profile</span>
          </button>
          <button
            onClick={handleCreateNewProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            <span>New Custom Profile</span>
          </button>
        </div>
      </div>

      {/* PROFILE SELECTOR TABS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {profiles.map((profile) => {
          const isActive = profile.id === currentProfile.id;
          const usable = (profile.totalCapacityKwh * (profile.usableDodPercent / 100)).toFixed(1);
          return (
            <div
              key={profile.id}
              onClick={() => setActiveProfileId(profile.id)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                isActive
                  ? 'border-emerald-500 bg-slate-900 shadow-md ring-1 ring-emerald-500/40'
                  : 'border-slate-800 bg-slate-900/30 hover:bg-slate-900/70'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 pr-2">
                  <h3 className="text-xs font-bold text-slate-100 truncate">{profile.name}</h3>
                  <span className="text-[11px] text-slate-400 block truncate">{profile.model}</span>
                </div>
                {profiles.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProfile(profile.id);
                    }}
                    className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                    title="Delete profile"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
                <span className="font-mono text-emerald-400 font-semibold">{usable} kWh usable</span>
                <span className="font-mono text-slate-300 font-medium">${profile.installedCost.toLocaleString()}</span>
              </div>

              {isActive && (
                <div className="mt-2 text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  <span>Active Profile for Simulation</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* DETAILED PROFILE EDITOR */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        {/* Name and Model */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Profile Display Name
            </label>
            <input
              type="text"
              value={currentProfile.name}
              onChange={(e) => handleUpdateCurrent('name', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Hardware Architecture / Subtitle
            </label>
            <input
              type="text"
              value={currentProfile.model}
              onChange={(e) => handleUpdateCurrent('model', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Technical Hardware Specs Grid */}
        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            1. Physical Hardware Specifications
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Total Storage Capacity */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Total Storage Capacity</label>
                  <InfoTooltip text="The maximum amount of energy the battery can hold when fully charged." />
                </div>
                <span className="text-[11px] text-slate-500">kWh</span>
              </div>
              <input
                type="number"
                step="0.1"
                min="1"
                max="100"
                value={currentProfile.totalCapacityKwh}
                onChange={(e) => handleUpdateCurrent('totalCapacityKwh', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-emerald-400 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Total physical battery rack / pack size.
              </span>
            </div>

            {/* Usable DoD / Minimum Reserve */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Usable Depth of Discharge (DoD)</label>
                  <InfoTooltip text="The percentage of capacity that can be safely used without degrading the battery. E.g., 90% DoD on a 10kWh battery gives 9kWh usable energy." />
                </div>
                <span className="text-[11px] text-slate-500">%</span>
              </div>
              <input
                type="number"
                step="1"
                min="50"
                max="100"
                value={currentProfile.usableDodPercent}
                onChange={(e) => handleUpdateCurrent('usableDodPercent', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-emerald-400 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Reserve limit: {100 - currentProfile.usableDodPercent}% ({usableKwh.toFixed(1)} kWh usable).
              </span>
            </div>

            {/* Max Continuous Output */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Max Continuous Output Power</label>
                  <InfoTooltip text="The maximum power the battery can discharge at any single instant to power home loads." />
                </div>
                <span className="text-[11px] text-slate-500">kW</span>
              </div>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="50"
                value={currentProfile.maxContinuousOutputKw}
                onChange={(e) => handleUpdateCurrent('maxContinuousOutputKw', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-amber-300 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Continuous discharge power limit to load/grid.
              </span>
            </div>

            {/* Max Continuous Charge */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Max Continuous Charge Power</label>
                  <InfoTooltip text="The maximum speed at which the battery can draw power from the grid or solar." />
                </div>
                <span className="text-[11px] text-slate-500">kW</span>
              </div>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="50"
                value={currentProfile.maxContinuousChargeKw}
                onChange={(e) => handleUpdateCurrent('maxContinuousChargeKw', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-cyan-300 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Maximum grid import rate into the battery pack.
              </span>
            </div>

            {/* Round-Trip Efficiency */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Round-Trip Efficiency / Conversion Loss</label>
                  <InfoTooltip text="The AC-to-DC-to-AC energy efficiency. E.g., 90% efficiency means 10% of energy is lost as heat during charging and discharging." />
                </div>
                <span className="text-[11px] text-slate-500">%</span>
              </div>
              <input
                type="number"
                step="0.5"
                min="70"
                max="98"
                value={currentProfile.roundTripEfficiencyPercent}
                onChange={(e) => handleUpdateCurrent('roundTripEfficiencyPercent', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                AC-to-DC-to-AC total round-trip conversion loss.
              </span>
            </div>

            {/* Manufacturer Rated Cycle Life */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-slate-300">Manufacturer Rated Cycle Life</label>
                  <InfoTooltip text="The number of full charge/discharge cycles the battery is rated to perform before capacity degrades significantly." />
                </div>
                <span className="text-[11px] text-slate-500">Cycles</span>
              </div>
              <input
                type="number"
                step="250"
                min="1000"
                max="15000"
                value={currentProfile.ratedCycleLife}
                onChange={(e) => handleUpdateCurrent('ratedCycleLife', parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Manufacturer warranty cycle threshold.
              </span>
            </div>
          </div>
        </div>

        {/* Financial Specs */}
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            2. Financial Hardware & Installation Cost
          </span>
          <div className="max-w-md bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/90 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-slate-300">Total Installed Hardware & Labor Cost</label>
                <InfoTooltip text="The total turn-key cost including equipment, inverter, permitting, and installation labor." />
              </div>
              <span className="text-[11px] text-slate-500">USD</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2 text-sm font-bold text-slate-400 font-mono">$</span>
              <input
                type="number"
                step="100"
                min="500"
                max="100000"
                value={currentProfile.installedCost}
                onChange={(e) => handleUpdateCurrent('installedCost', parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-sm font-bold text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>
            <span className="text-[10px] text-slate-400 block">
              Unit metric: ~${costPerKwh.toLocaleString()}/kWh installed capital expenditure.
            </span>
          </div>
        </div>

        {/* Operational Strategy Protocols */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            3. Operational Dispatch Strategy Protocol
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Arbitrage Mode */}
            <label
              className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                currentProfile.strategy === 'arbitrage'
                  ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                  : 'border-slate-800 bg-slate-950/40 hover:bg-slate-950/70'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <input
                      type="radio"
                      name="strategy"
                      checked={currentProfile.strategy === 'arbitrage'}
                      onChange={() => handleUpdateCurrent('strategy', 'arbitrage')}
                      className="accent-emerald-500"
                    />
                    Arbitrage Mode (Time-of-Use Optimized)
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed pl-5">
                  Charges battery strictly during the lowest-cost designated TOU tiers. Discharges during on-peak hours to avoid expensive grid imports, exporting excess energy if sell rates are favorable.
                </p>
              </div>
            </label>

            {/* Self-Consumption Mode */}
            <label
              className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                currentProfile.strategy === 'self_consumption'
                  ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                  : 'border-slate-800 bg-slate-950/40 hover:bg-slate-950/70'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <input
                      type="radio"
                      name="strategy"
                      checked={currentProfile.strategy === 'self_consumption'}
                      onChange={() => handleUpdateCurrent('strategy', 'self_consumption')}
                      className="accent-emerald-500"
                    />
                    Self-Consumption Mode (Load Maximizer)
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed pl-5">
                  Discharges battery whenever home load exists to minimize overall grid consumption. Recharges to full during designated off-peak periods.
                </p>
              </div>
            </label>
          </div>

          {/* Tier Assignment Checkboxes */}
          <div className="pt-3 border-t border-slate-800/50 space-y-3">
            <span className="text-xs font-semibold text-slate-300 block">
              Active Strategy Tier Dispatch Windows
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Charge Windows */}
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 space-y-2">
                <span className="font-semibold text-cyan-400 block">Charge Windows (Allowed to import)</span>
                <div className="space-y-1.5">
                  {tiers.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={currentProfile.chargeTiers.includes(t.id)}
                        onChange={() => toggleTierInList('chargeTiers', t.id)}
                        className="rounded accent-cyan-500"
                      />
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      <span>{t.name} (${t.buyRate.toFixed(2)}/kWh)</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Discharge Windows */}
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 space-y-2">
                <span className="font-semibold text-amber-400 block">Discharge Windows (Peak Shaving)</span>
                <div className="space-y-1.5">
                  {tiers.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={currentProfile.dischargeTiers.includes(t.id)}
                        onChange={() => toggleTierInList('dischargeTiers', t.id)}
                        className="rounded accent-amber-500"
                      />
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      <span>{t.name} (${t.buyRate.toFixed(2)}/kWh)</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Authoritative Dispatch Notice */}
            <p className="text-[11px] text-slate-400 italic">
              Note: The tier selections above are authoritative. The battery will only charge or discharge in these selected tiers, overriding any default tariff tier flags.
            </p>

            {/* Grid Export Control */}
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-200 block">
                    Permit Grid Energy Export
                  </label>
                  <span className="text-[11px] text-slate-400">
                    When enabled, excess discharged battery power can be exported to the grid if the utility sell rate exceeds the battery stored energy cost (accounting for round-trip efficiency).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateCurrent('allowGridExport', !currentProfile.allowGridExport)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    currentProfile.allowGridExport ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      currentProfile.allowGridExport ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-[11px]">
                Status:{' '}
                <span className={currentProfile.allowGridExport ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {currentProfile.allowGridExport
                    ? 'Export Allowed (Discharges to grid when sell rate exceeds stored acquisition cost)'
                    : 'Export Prohibited (Battery discharges strictly to serve home load)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Real-Time Hardware Synthesis Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-xs font-mono">
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-sans">Usable Energy Buffer</span>
            <span className="font-bold text-emerald-400 tabular-nums">{usableKwh.toFixed(1)} kWh</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-sans">Discharge Duration @ Max</span>
            <span className="font-bold text-slate-200 tabular-nums">{dischargeDurationHours} Hours</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-sans">System Continuous C-Rate</span>
            <span className="font-bold text-slate-200 tabular-nums">{cRate} C</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-sans">Capital Density</span>
            <span className="font-bold text-slate-200 tabular-nums">${costPerKwh}/kWh</span>
          </div>
        </div>
      </div>
    </div>
  );
};
