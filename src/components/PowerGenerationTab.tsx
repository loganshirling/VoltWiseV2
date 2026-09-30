import React, { useState } from 'react';
import {
  Sun,
  Wind,
  Zap,
  Plus,
  Trash2,
  Copy,
  Info,
  MapPin,
  Clock,
  ShieldAlert,
  Sliders,
  DollarSign,
  Activity,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  GenerationConfig,
  GenerationSite,
  GenerationAsset,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
  SolarResourceMode,
  WindResourceMode,
  GeneratorFuelType,
  GeneratorFuelUnit,
  GeneratorDispatchMode,
  WindPowerCurvePoint,
  GeneratorFuelCurvePoint,
} from '../types/energy';
import {
  createDefaultAsset,
  DEFAULT_GENERATION_CONFIG,
  createDefaultGenerationConfig,
} from '../utils/generationDefaults';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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
        aria-label="Configuration info"
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

function createAssetId(type: 'solar' | 'wind' | 'generator'): string {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 9);
  return `${type}-${uuid}`;
}

interface PowerGenerationTabProps {
  generationConfig: GenerationConfig;
  setGenerationConfig: React.Dispatch<React.SetStateAction<GenerationConfig>>;
  allowSolarExport: boolean;
  setAllowSolarExport: React.Dispatch<React.SetStateAction<boolean>>;
}

export const PowerGenerationTab: React.FC<PowerGenerationTabProps> = ({
  generationConfig,
  setGenerationConfig,
  allowSolarExport,
  setAllowSolarExport,
}) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    generationConfig.assets[0]?.id || ''
  );

  const activeAsset =
    generationConfig.assets.find((a) => a.id === selectedAssetId) ||
    generationConfig.assets[0] ||
    null;

  // Site update handler
  const handleUpdateSite = (field: keyof GenerationSite, value: any) => {
    setGenerationConfig((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        [field]: value,
      },
    }));
  };

  // Asset update handler
  const handleUpdateAsset = (id: string, updates: Partial<GenerationAsset>) => {
    setGenerationConfig((prev) => ({
      ...prev,
      assets: prev.assets.map((asset) =>
        asset.id === id ? ({ ...asset, ...updates } as GenerationAsset) : asset
      ),
    }));
  };

  // Add asset
  const handleAddAsset = (type: 'solar' | 'wind' | 'generator') => {
    const id = createAssetId(type);
    const newAsset = createDefaultAsset(type, id);
    setGenerationConfig((prev) => ({
      ...prev,
      assets: [...prev.assets, newAsset],
    }));
    setSelectedAssetId(newAsset.id);
  };

  // Duplicate asset
  const handleDuplicateAsset = (asset: GenerationAsset) => {
    const newId = createAssetId(asset.type);
    const duplicate: GenerationAsset = {
      ...asset,
      id: newId,
      name: `${asset.name} (Copy)`,
      ...(asset.type === 'solar'
        ? { monthlyPeakSunHoursPerDay: [...asset.monthlyPeakSunHoursPerDay] }
        : {}),
      ...(asset.type === 'wind'
        ? {
            monthlyAverageWindSpeedMps: [...asset.monthlyAverageWindSpeedMps],
            powerCurve: asset.powerCurve.map((pt) => ({ ...pt })),
          }
        : {}),
      ...(asset.type === 'generator'
        ? {
            fuelCurve: asset.fuelCurve.map((pt) => ({ ...pt })),
            scheduledHours: asset.scheduledHours.map((row) => [...row]),
          }
        : {}),
    } as GenerationAsset;

    setGenerationConfig((prev) => ({
      ...prev,
      assets: [...prev.assets, duplicate],
    }));
    setSelectedAssetId(duplicate.id);
  };

  // Delete asset
  const handleDeleteAsset = (id: string) => {
    setGenerationConfig((prev) => {
      const filtered = prev.assets.filter((a) => a.id !== id);
      if (selectedAssetId === id) {
        setSelectedAssetId(filtered[0]?.id || '');
      }
      return {
        ...prev,
        assets: filtered,
      };
    });
  };

  // Reset to default
  const handleResetToDefault = () => {
    setGenerationConfig(createDefaultGenerationConfig());
    setSelectedAssetId('');
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Informational Callout: Active Solar Simulation */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 sm:p-5 flex items-start gap-3 sm:gap-4 shadow-sm">
        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex-1 text-xs text-emerald-200/90 leading-relaxed">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-emerald-100 text-sm">
              Active Solar Modeling & Dispatch Simulation
            </span>
            <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Active Simulation
            </span>
          </div>
          <p>
            On-site photovoltaic solar generation is actively integrated into the dispatch and financial engine. Enabled solar arrays directly offset home load and charge battery storage. Surplus solar export to the utility grid is governed independently by the toggle below. Wind turbine and generator hardware configurations remain persisted contracts.
          </p>
        </div>
      </div>

      {/* Section 1: Geographic Site & Coordinate Parameters */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Installation Site & Solar Geometry
              </h2>
              <p className="text-[11px] text-slate-400">
                Geographic coordinates for solar zenith calculation and wind air density adjustment.
              </p>
            </div>
          </div>
          <button
            onClick={handleResetToDefault}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors self-start sm:self-auto"
          >
            Reset Generation Defaults
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Latitude (°N)
              <InfoTooltip text="Site latitude in decimal degrees (-90° to +90°). Used for solar declination and sun path geometry." />
            </label>
            <input
              type="number"
              step="0.0001"
              min="-90"
              max="90"
              value={generationConfig.site.latitude ?? ''}
              onChange={(e) =>
                handleUpdateSite(
                  'latitude',
                  e.target.value === '' ? null : parseFloat(e.target.value)
                )
              }
              placeholder="37.7749"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Longitude (°E)
              <InfoTooltip text="Site longitude in decimal degrees (-180° to +180°). Used for solar noon equation of time." />
            </label>
            <input
              type="number"
              step="0.0001"
              min="-180"
              max="180"
              value={generationConfig.site.longitude ?? ''}
              onChange={(e) =>
                handleUpdateSite(
                  'longitude',
                  e.target.value === '' ? null : parseFloat(e.target.value)
                )
              }
              placeholder="-122.4194"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Timezone (IANA)
              <InfoTooltip text="Standard IANA timezone identifier matching interval meter data (e.g., America/Los_Angeles, America/New_York)." />
            </label>
            <input
              type="text"
              value={generationConfig.site.timeZone}
              onChange={(e) => handleUpdateSite('timeZone', e.target.value)}
              placeholder="America/Los_Angeles"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Elevation (meters MSL)
              <InfoTooltip text="Site elevation above mean sea level in meters. Affects barometric pressure and atmospheric air density." />
            </label>
            <input
              type="number"
              step="1"
              value={generationConfig.site.elevationM ?? ''}
              onChange={(e) =>
                handleUpdateSite(
                  'elevationM',
                  e.target.value === '' ? null : parseFloat(e.target.value)
                )
              }
              placeholder="16"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Grid Interconnection & Solar Export Policy */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Sun className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  Allow surplus solar export to grid
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Grid Interconnection
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Controls export of unused solar generation to the utility grid and is independent of the battery&apos;s grid-export permission. When disabled, excess solar generation beyond load and battery charging capacity is curtailed.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
            <span className="text-xs font-mono text-slate-400">
              {allowSolarExport ? 'Export Allowed' : 'Curtailed (Default)'}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={allowSolarExport}
                onChange={(e) => setAllowSolarExport(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Section 2: Generation Assets Manager */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Asset List & Add Actions */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
              <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Configured Assets ({generationConfig.assets.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleAddAsset('solar')}
                  title="Add Solar Array"
                  className="px-2 py-1 text-[11px] font-medium rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1 transition-colors"
                >
                  <Sun className="h-3 w-3" />
                  +Solar
                </button>
                <button
                  onClick={() => handleAddAsset('wind')}
                  title="Add Wind Turbine"
                  className="px-2 py-1 text-[11px] font-medium rounded bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 border border-sky-500/30 flex items-center gap-1 transition-colors"
                >
                  <Wind className="h-3 w-3" />
                  +Wind
                </button>
                <button
                  onClick={() => handleAddAsset('generator')}
                  title="Add Generator"
                  className="px-2 py-1 text-[11px] font-medium rounded bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 border border-purple-500/30 flex items-center gap-1 transition-colors"
                >
                  <Zap className="h-3 w-3" />
                  +Gen
                </button>
              </div>
            </div>

            {generationConfig.assets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No generation assets configured. Add a solar, wind, or generator asset above.
              </div>
            ) : (
              <div className="space-y-2">
                {generationConfig.assets.map((asset) => {
                  const isSelected = activeAsset?.id === asset.id;
                  return (
                    <div
                      key={asset.id}
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-slate-800 border-emerald-500/60 shadow-md ring-1 ring-emerald-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`p-1 rounded ${
                              asset.type === 'solar'
                                ? 'bg-amber-500/20 text-amber-400'
                                : asset.type === 'wind'
                                ? 'bg-sky-500/20 text-sky-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {asset.type === 'solar' && <Sun className="h-3.5 w-3.5" />}
                            {asset.type === 'wind' && <Wind className="h-3.5 w-3.5" />}
                            {asset.type === 'generator' && <Zap className="h-3.5 w-3.5" />}
                          </span>
                          <span className="text-xs font-medium text-slate-200 truncate">
                            {asset.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label
                            className="relative inline-flex items-center cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={asset.enabled}
                              onChange={(e) =>
                                handleUpdateAsset(asset.id, { enabled: e.target.checked })
                              }
                              className="sr-only peer"
                            />
                            <div className="w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>
                          {asset.type === 'solar' && `${asset.dcCapacityKw} kW DC`}
                          {asset.type === 'wind' && `${asset.ratedPowerKw} kW Rated`}
                          {asset.type === 'generator' && `${asset.ratedContinuousKw} kW Continuous`}
                        </span>
                        <span>${asset.installedCostUsd.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Detail Pane: Active Asset Configurator */}
        <div className="lg:col-span-8">
          {activeAsset ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-6">
              {/* Asset Header & Action Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg border ${
                      activeAsset.type === 'solar'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : activeAsset.type === 'wind'
                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                        : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    }`}
                  >
                    {activeAsset.type === 'solar' && <Sun className="h-5 w-5" />}
                    {activeAsset.type === 'wind' && <Wind className="h-5 w-5" />}
                    {activeAsset.type === 'generator' && <Zap className="h-5 w-5" />}
                  </div>
                  <div>
                    <input
                      type="text"
                      value={activeAsset.name}
                      onChange={(e) =>
                        handleUpdateAsset(activeAsset.id, { name: e.target.value })
                      }
                      className="bg-transparent text-base font-semibold text-slate-100 border-b border-transparent hover:border-slate-700 focus:border-emerald-500 focus:outline-none transition-colors px-1"
                    />
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-mono">
                      <span className="uppercase">{activeAsset.type} Asset</span>
                      <span>·</span>
                      <span>ID: {activeAsset.id}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDuplicateAsset(activeAsset)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Duplicate</span>
                  </button>
                  <button
                    onClick={() => handleDeleteAsset(activeAsset.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-950/50 rounded-lg border border-rose-900/40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Shared Asset Base Properties */}
              <div>
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                  Capex & Opex Parameters
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
                      Installed Cost ($ USD)
                      <InfoTooltip text="Total turnkey hardware, balance-of-system, permit, and labor installation cost in USD." />
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={activeAsset.installedCostUsd}
                        onChange={(e) =>
                          handleUpdateAsset(activeAsset.id, {
                            installedCostUsd: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
                      Annual Maintenance Cost ($ USD / yr)
                      <InfoTooltip text="Ongoing annual maintenance, filter changes, servicing, and inspection costs." />
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="25"
                        value={activeAsset.annualMaintenanceCostUsd}
                        onChange={(e) =>
                          handleUpdateAsset(activeAsset.id, {
                            annualMaintenanceCostUsd: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Type-Specific Configurations */}
              {activeAsset.type === 'solar' && (
                <SolarAssetConfigurator
                  asset={activeAsset}
                  onUpdate={(updates) => handleUpdateAsset(activeAsset.id, updates)}
                />
              )}

              {activeAsset.type === 'wind' && (
                <WindAssetConfigurator
                  asset={activeAsset}
                  onUpdate={(updates) => handleUpdateAsset(activeAsset.id, updates)}
                />
              )}

              {activeAsset.type === 'generator' && (
                <GeneratorAssetConfigurator
                  asset={activeAsset}
                  onUpdate={(updates) => handleUpdateAsset(activeAsset.id, updates)}
                />
              )}
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-xs">
              Select or add a generation asset on the left to configure parameters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Solar Asset Configurator Subcomponent
// ============================================================================

interface SolarConfiguratorProps {
  asset: SolarGenerationAsset;
  onUpdate: (updates: Partial<SolarGenerationAsset>) => void;
}

const SolarAssetConfigurator: React.FC<SolarConfiguratorProps> = ({ asset, onUpdate }) => {
  return (
    <div className="space-y-6 pt-4 border-t border-slate-800/80">
      <div>
        <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
          PV Array & Inverter Specifications
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Nameplate DC Capacity (kW)
              <InfoTooltip text="Total rated STC capacity of photovoltaic modules in kilowatts (e.g. 8.0 kW)." />
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={asset.dcCapacityKw}
              onChange={(e) =>
                onUpdate({ dcCapacityKw: Math.max(0, parseFloat(e.target.value) || 0) })
              }
              placeholder="0.0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Inverter AC Capacity (kW)
              <InfoTooltip text="Maximum continuous AC power rating of the grid-interactive solar inverter (clips DC overproduction above this threshold)." />
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={asset.inverterAcCapacityKw}
              onChange={(e) =>
                onUpdate({ inverterAcCapacityKw: Math.max(0, parseFloat(e.target.value) || 0) })
              }
              placeholder="0.0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Inverter Efficiency (%)
              <InfoTooltip text="Nominal weighted CEC inverter conversion efficiency from DC to AC." />
            </label>
            <input
              type="number"
              min="50"
              max="100"
              step="0.1"
              value={asset.inverterEfficiencyPercent}
              onChange={(e) =>
                onUpdate({
                  inverterEfficiencyPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Tilt Angle (0–90°)
              <InfoTooltip text="Array tilt angle measured from horizontal ground plane (0° = flat roof/ground, 90° = vertical wall)." />
            </label>
            <input
              type="number"
              min="0"
              max="90"
              step="1"
              value={asset.tiltDegrees}
              onChange={(e) =>
                onUpdate({
                  tiltDegrees: Math.min(90, Math.max(0, parseFloat(e.target.value) || 0)),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Azimuth Angle (0–359°)
              <InfoTooltip text="Compass orientation facing angle: 0° = North, 90° = East, 180° = South (optimal in Northern hemisphere), 270° = West." />
            </label>
            <input
              type="number"
              min="0"
              max="359"
              step="1"
              value={asset.azimuthDegrees}
              onChange={(e) =>
                onUpdate({
                  azimuthDegrees: Math.min(359, Math.max(0, parseFloat(e.target.value) || 0)),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Annual PV Degradation (%/yr)
              <InfoTooltip text="Annual compound reduction in photovoltaic module conversion efficiency (typically 0.4% - 0.7% per year)." />
            </label>
            <input
              type="number"
              min="0"
              max="10"
              step="0.05"
              value={asset.annualDegradationPercent}
              onChange={(e) =>
                onUpdate({
                  annualDegradationPercent: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              System Loss (% excluding shading)
              <InfoTooltip text="Soiling, wiring, mismatch, diode, and temperature coefficient losses." />
            </label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={asset.systemLossPercent}
              onChange={(e) =>
                onUpdate({
                  systemLossPercent: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Shading Loss (%)
              <InfoTooltip text="Obstruction losses from nearby trees, parapets, chimneys, or neighboring structures." />
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={asset.shadingLossPercent}
              onChange={(e) =>
                onUpdate({
                  shadingLossPercent: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Solar Resource Model Selection */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Solar Resource Modeling Mode
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[
            {
              id: 'monthly_peak_sun_hours' as SolarResourceMode,
              title: 'Monthly Peak Sun Hours',
              desc: 'Configurable 12-month average peak sun hours (kWh/m²/day).',
            },
            {
              id: 'clear_sky' as SolarResourceMode,
              title: 'Clear-Sky Geometric Model',
              desc: 'Calculated from solar geometry equations & site latitude.',
            },
            {
              id: 'weather_file' as SolarResourceMode,
              title: 'TMY3 / Weather Data File',
              desc: 'Hourly historical meteorological solar irradiance file.',
            },
          ].map((mode) => {
            const isSelected = asset.resourceMode === mode.id;
            return (
              <div
                key={mode.id}
                onClick={() => onUpdate({ resourceMode: mode.id })}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/60 shadow-sm ring-1 ring-amber-500/30'
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200">{mode.title}</span>
                  <input
                    type="radio"
                    name={`solar-resource-mode-${asset.id}`}
                    checked={isSelected}
                    onChange={() => onUpdate({ resourceMode: mode.id })}
                    className="accent-amber-500"
                  />
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">{mode.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Monthly Peak Sun Hours 12-Month Grid */}
        {asset.resourceMode === 'monthly_peak_sun_hours' && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-300">
                Monthly Average Peak Sun Hours (kWh / m² / day)
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                12 Monthly Inputs (Jan–Dec)
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
              {MONTH_NAMES.map((name, idx) => (
                <div key={name} className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-medium text-center mb-1">
                    {name}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="14"
                    step="0.1"
                    value={asset.monthlyPeakSunHoursPerDay[idx] ?? 0}
                    onChange={(e) => {
                      const updated = [...asset.monthlyPeakSunHoursPerDay];
                      updated[idx] = Math.max(0, parseFloat(e.target.value) || 0);
                      onUpdate({ monthlyPeakSunHoursPerDay: updated });
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-center text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {asset.resourceMode === 'clear_sky' && (
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-200">Clear-Sky Geometric Mode:</strong> Clear-sky solar geometry will be implemented in the solar modeling milestone. Weather/cloud attenuation is not yet modeled.
          </div>
        )}

        {asset.resourceMode === 'weather_file' && (
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-200">Weather File Mode:</strong> Hourly solar/weather-file ingestion will be implemented in the solar modeling milestone.
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Wind Asset Configurator Subcomponent
// ============================================================================

interface WindConfiguratorProps {
  asset: WindGenerationAsset;
  onUpdate: (updates: Partial<WindGenerationAsset>) => void;
}

const WindAssetConfigurator: React.FC<WindConfiguratorProps> = ({ asset, onUpdate }) => {
  // Add power curve point
  const handleAddCurvePoint = () => {
    const lastPoint = asset.powerCurve[asset.powerCurve.length - 1];
    const newSpeed = lastPoint ? lastPoint.windSpeedMps + 2 : 2.0;
    const newPoint: WindPowerCurvePoint = {
      windSpeedMps: newSpeed,
      outputKw: lastPoint ? lastPoint.outputKw : 1.0,
    };
    onUpdate({
      powerCurve: [...asset.powerCurve, newPoint].sort(
        (a, b) => a.windSpeedMps - b.windSpeedMps
      ),
    });
  };

  // Update curve point
  const handleUpdateCurvePoint = (
    index: number,
    field: keyof WindPowerCurvePoint,
    val: number
  ) => {
    const updated = asset.powerCurve.map((pt, i) =>
      i === index ? { ...pt, [field]: val } : pt
    );
    onUpdate({ powerCurve: updated });
  };

  // Delete curve point
  const handleDeleteCurvePoint = (index: number) => {
    onUpdate({
      powerCurve: asset.powerCurve.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-6 pt-4 border-t border-slate-800/80">
      <div>
        <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-3">
          Turbine Aerodynamic & Hardware Specifications
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Rated Power (kW)
              <InfoTooltip text="Maximum rated electrical output capacity of the wind turbine generator." />
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={asset.ratedPowerKw}
              onChange={(e) =>
                onUpdate({ ratedPowerKw: Math.max(0, parseFloat(e.target.value) || 0) })
              }
              placeholder="0.0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Hub Height (meters)
              <InfoTooltip text="Tower elevation above ground level to the rotor hub centerline." />
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={asset.hubHeightM}
              onChange={(e) =>
                onUpdate({ hubHeightM: Math.max(1, parseFloat(e.target.value) || 0) })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Rotor Diameter (meters)
              <InfoTooltip text="Total diameter of the swept blade path area." />
            </label>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={asset.rotorDiameterM}
              onChange={(e) =>
                onUpdate({ rotorDiameterM: Math.max(0.5, parseFloat(e.target.value) || 0) })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Cut-in Wind Speed (m/s)
              <InfoTooltip text="Minimum wind speed at which turbine starts generating net power." />
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={asset.cutInWindSpeedMps}
              onChange={(e) =>
                onUpdate({ cutInWindSpeedMps: Math.max(0, parseFloat(e.target.value) || 0) })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Rated Wind Speed (m/s)
              <InfoTooltip text="Wind speed at which the generator reaches its full rated output capacity." />
            </label>
            <input
              type="number"
              min="1"
              step="0.1"
              value={asset.ratedWindSpeedMps}
              onChange={(e) =>
                onUpdate({ ratedWindSpeedMps: Math.max(1, parseFloat(e.target.value) || 0) })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Cut-out Wind Speed (m/s)
              <InfoTooltip text="High wind threshold where turbine feathers or applies mechanical braking for safety." />
            </label>
            <input
              type="number"
              min="1"
              step="0.5"
              value={asset.cutOutWindSpeedMps}
              onChange={(e) =>
                onUpdate({ cutOutWindSpeedMps: Math.max(1, parseFloat(e.target.value) || 0) })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Operational Availability (%)
              <InfoTooltip text="Turbine uptime availability accounting for planned maintenance and grid disconnection." />
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={asset.availabilityPercent}
              onChange={(e) =>
                onUpdate({
                  availabilityPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              System Loss (%)
              <InfoTooltip text="Cable collection loss, transformer loss, and blade icing/fouling losses." />
            </label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={asset.systemLossPercent}
              onChange={(e) =>
                onUpdate({
                  systemLossPercent: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Wind Shear Exponent (α)
              <InfoTooltip text="Power law wind profile exponent α (e.g. 0.14 for open terrain, 0.20 for suburbs/trees)." />
            </label>
            <input
              type="number"
              min="0.05"
              max="0.5"
              step="0.01"
              value={asset.windShearExponent}
              onChange={(e) =>
                onUpdate({
                  windShearExponent: Math.max(0.01, parseFloat(e.target.value) || 0),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      </div>

      {/* Wind Resource Mode */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Wind Resource Modeling Mode
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[
            {
              id: 'annual_average' as WindResourceMode,
              title: 'Annual Average Wind Speed',
              desc: 'Single mean wind speed with standard Rayleigh/Weibull distribution.',
            },
            {
              id: 'monthly_average' as WindResourceMode,
              title: 'Monthly Average Wind Speed',
              desc: '12 distinct monthly mean wind speed values (m/s).',
            },
            {
              id: 'interval_file' as WindResourceMode,
              title: 'Hourly Interval Wind File',
              desc: 'Explicit 8,760h anemometer time-series wind velocities.',
            },
          ].map((mode) => {
            const isSelected = asset.resourceMode === mode.id;
            return (
              <div
                key={mode.id}
                onClick={() => onUpdate({ resourceMode: mode.id })}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-sky-500/10 border-sky-500/60 shadow-sm ring-1 ring-sky-500/30'
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200">{mode.title}</span>
                  <input
                    type="radio"
                    name={`wind-resource-mode-${asset.id}`}
                    checked={isSelected}
                    onChange={() => onUpdate({ resourceMode: mode.id })}
                    className="accent-sky-500"
                  />
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">{mode.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Annual Average Input */}
        {asset.resourceMode === 'annual_average' && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
            <div className="max-w-xs">
              <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
                Annual Average Wind Speed (m/s)
                <InfoTooltip text="Yearly mean anemometer wind speed in meters per second." />
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={asset.annualAverageWindSpeedMps ?? ''}
                onChange={(e) =>
                  onUpdate({
                    annualAverageWindSpeedMps:
                      e.target.value === '' ? null : Math.max(0, parseFloat(e.target.value)),
                  })
                }
                placeholder="4.8"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        )}

        {/* Monthly Average Grid */}
        {asset.resourceMode === 'monthly_average' && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-300">
                Monthly Average Wind Speed (m/s at measurement height)
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                12 Monthly Inputs (Jan–Dec)
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
              {MONTH_NAMES.map((name, idx) => (
                <div key={name} className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-medium text-center mb-1">
                    {name}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={asset.monthlyAverageWindSpeedMps[idx] ?? 0}
                    onChange={(e) => {
                      const updated = [...asset.monthlyAverageWindSpeedMps];
                      updated[idx] = Math.max(0, parseFloat(e.target.value) || 0);
                      onUpdate({ monthlyAverageWindSpeedMps: updated });
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-center text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {asset.resourceMode === 'interval_file' && (
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-200">Interval File Mode:</strong> Interval wind-resource file ingestion will be implemented in the wind modeling milestone.
          </div>
        )}
      </div>

      {/* Turbine Power Curve Table */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
          <div>
            <h4 className="text-xs font-semibold text-slate-200">
              Manufacturer Power Curve Table
            </h4>
            <p className="text-[11px] text-slate-400">
              Discrete power output mapping at calibrated wind velocities.
            </p>
          </div>
          <button
            onClick={handleAddCurvePoint}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add Point</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2 font-medium">Wind Speed (m/s)</th>
                <th className="pb-2 font-medium">Output Power (kW)</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850">
              {asset.powerCurve.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500 font-sans text-xs">
                    No power curve points configured. Click &ldquo;Add Point&rdquo; to enter wind speed vs. output power data.
                  </td>
                </tr>
              ) : (
                asset.powerCurve.map((point, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/50">
                    <td className="py-1.5 pr-4">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={point.windSpeedMps}
                        onChange={(e) =>
                          handleUpdateCurvePoint(
                            idx,
                            'windSpeedMps',
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        }
                        className="w-28 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="py-1.5 pr-4">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={point.outputKw}
                        onChange={(e) =>
                          handleUpdateCurvePoint(
                            idx,
                            'outputKw',
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        }
                        className="w-28 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => handleDeleteCurvePoint(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                        title="Remove point"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Generator Asset Configurator Subcomponent
// ============================================================================

interface GeneratorConfiguratorProps {
  asset: GeneratorGenerationAsset;
  onUpdate: (updates: Partial<GeneratorGenerationAsset>) => void;
}

const GeneratorAssetConfigurator: React.FC<GeneratorConfiguratorProps> = ({ asset, onUpdate }) => {
  // Add fuel curve point
  const handleAddFuelPoint = () => {
    const lastPoint = asset.fuelCurve[asset.fuelCurve.length - 1];
    const newLoad = lastPoint ? Math.min(100, lastPoint.loadPercent + 25) : 25;
    const newPoint: GeneratorFuelCurvePoint = {
      loadPercent: newLoad,
      fuelUnitsPerHour: lastPoint ? lastPoint.fuelUnitsPerHour + 0.5 : 1.0,
    };
    onUpdate({
      fuelCurve: [...asset.fuelCurve, newPoint].sort(
        (a, b) => a.loadPercent - b.loadPercent
      ),
    });
  };

  // Update fuel curve point
  const handleUpdateFuelPoint = (
    index: number,
    field: keyof GeneratorFuelCurvePoint,
    val: number
  ) => {
    const updated = asset.fuelCurve.map((pt, i) =>
      i === index ? { ...pt, [field]: val } : pt
    );
    onUpdate({ fuelCurve: updated });
  };

  // Delete fuel curve point
  const handleDeleteFuelPoint = (index: number) => {
    onUpdate({
      fuelCurve: asset.fuelCurve.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-6 pt-4 border-t border-slate-800/80">
      <div>
        <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
          Generator Technical & Dispatch Controls
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Rated Continuous Power (kW)
              <InfoTooltip text="Continuous electrical prime/standby power output capacity." />
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={asset.ratedContinuousKw}
              onChange={(e) =>
                onUpdate({
                  ratedContinuousKw: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              placeholder="0.0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Minimum Stable Load (%)
              <InfoTooltip text="Minimum engine load percent to avoid wet-stacking and incomplete combustion (typically 20% - 30%)." />
            </label>
            <input
              type="number"
              min="0"
              max="90"
              step="5"
              value={asset.minimumStableLoadPercent}
              onChange={(e) =>
                onUpdate({
                  minimumStableLoadPercent: Math.min(
                    90,
                    Math.max(0, parseFloat(e.target.value) || 0)
                  ),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Fuel Type
              <InfoTooltip text="Primary consumable energy source for the combustion engine." />
            </label>
            <select
              value={asset.fuelType}
              onChange={(e) =>
                onUpdate({ fuelType: e.target.value as GeneratorFuelType })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="natural_gas">Natural Gas</option>
              <option value="propane">Propane (LPG)</option>
              <option value="gasoline">Gasoline</option>
              <option value="diesel">Diesel</option>
              <option value="custom">Custom Fuel</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Fuel Unit
              <InfoTooltip text="Volumetric or thermal unit of fuel measure." />
            </label>
            <select
              value={asset.fuelUnit}
              onChange={(e) =>
                onUpdate({ fuelUnit: e.target.value as GeneratorFuelUnit })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="therm">Therm</option>
              <option value="gallon">Gallon</option>
              <option value="ccf">CCF (100 cu ft)</option>
              <option value="mmbtu">MMBtu</option>
              <option value="custom">Custom Unit</option>
            </select>
          </div>

          {asset.fuelUnit === 'custom' && (
            <div>
              <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
                Custom Fuel Unit
                <InfoTooltip text="Label for user-defined fuel measure (e.g. liters, cords, kg)." />
              </label>
              <input
                type="text"
                value={asset.customFuelUnitLabel}
                onChange={(e) => onUpdate({ customFuelUnitLabel: e.target.value })}
                placeholder="e.g. liter"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500 font-mono"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Fuel Price ($ / {asset.fuelUnit === 'custom' && asset.customFuelUnitLabel ? asset.customFuelUnitLabel : asset.fuelUnit})
              <InfoTooltip text="Delivered cost per fuel unit for marginal generation calculations." />
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.05"
                value={asset.fuelPricePerUnit}
                onChange={(e) =>
                  onUpdate({
                    fuelPricePerUnit: Math.max(0, parseFloat(e.target.value) || 0),
                  })
                }
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Variable Maintenance ($ / operating hour)
              <InfoTooltip text="Variable servicing and overhaul expense incurred per hour of generator runtime." />
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={asset.variableMaintenanceCostPerHourUsd}
                onChange={(e) =>
                  onUpdate({
                    variableMaintenanceCostPerHourUsd: Math.max(0, parseFloat(e.target.value) || 0),
                  })
                }
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 font-medium flex items-center mb-1.5">
              Dispatch Mode
              <InfoTooltip text="Standby: run only during grid outages. Scheduled: run during designated peak windows. Economic: run whenever grid buy rate exceeds marginal generation cost." />
            </label>
            <select
              value={asset.dispatchMode}
              onChange={(e) =>
                onUpdate({ dispatchMode: e.target.value as GeneratorDispatchMode })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="standby">Standby (Outages Only)</option>
              <option value="scheduled">Scheduled Windows</option>
              <option value="economic">Economic Price Arbitrage</option>
            </select>
          </div>
        </div>
      </div>

      {/* Scheduled Generator Editor (when dispatchMode === 'scheduled') */}
      {asset.dispatchMode === 'scheduled' && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
            <div>
              <h4 className="text-xs font-semibold text-slate-200">
                Generator Run Schedule (7 × 24 Matrix)
              </h4>
              <p className="text-[11px] text-slate-400">
                Click cells to schedule operating hours (canonical 0=Sunday to 6=Saturday).
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-purple-600 inline-block" /> Run
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-slate-900 border border-slate-800 inline-block" /> Off
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[620px]">
              {/* Hour Numbers Header */}
              <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-1 mb-1.5 text-[10px] text-slate-500 font-mono text-center">
                <div></div>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h}>{h}</div>
                ))}
              </div>

              {/* Day Rows: Mon-Sun display, canonical indices */}
              <div className="space-y-1">
                {[
                  { dayIndex: 1, label: 'Mon' },
                  { dayIndex: 2, label: 'Tue' },
                  { dayIndex: 3, label: 'Wed' },
                  { dayIndex: 4, label: 'Thu' },
                  { dayIndex: 5, label: 'Fri' },
                  { dayIndex: 6, label: 'Sat' },
                  { dayIndex: 0, label: 'Sun' },
                ].map(({ dayIndex, label }) => {
                  const row =
                    (asset.scheduledHours && asset.scheduledHours[dayIndex]) ||
                    Array(24).fill(false);
                  return (
                    <div
                      key={dayIndex}
                      className="grid grid-cols-[40px_repeat(24,1fr)] gap-1 items-center"
                    >
                      <span className="text-[11px] font-medium text-slate-400 font-mono">
                        {label}
                      </span>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const isScheduled = !!row[hour];
                        return (
                          <button
                            key={hour}
                            type="button"
                            onClick={() => {
                              const currentSchedule =
                                asset.scheduledHours && asset.scheduledHours.length === 7
                                  ? asset.scheduledHours
                                  : Array.from({ length: 7 }, () => Array(24).fill(false));
                              const updated = currentSchedule.map((r, d) =>
                                d === dayIndex
                                  ? r.map((val, h) => (h === hour ? !val : val))
                                  : [...r]
                              );
                              onUpdate({ scheduledHours: updated });
                            }}
                            title={`${label} ${hour}:00 - ${isScheduled ? 'Scheduled Run' : 'Off'}`}
                            className={`h-6 rounded text-[10px] font-mono flex items-center justify-center transition-all ${
                              isScheduled
                                ? 'bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-sm'
                                : 'bg-slate-900 hover:bg-slate-800 text-slate-600 border border-slate-850'
                            }`}
                          >
                            {isScheduled ? '✓' : ''}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interconnection & Routing Permissions */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-slate-200 mb-3">
          Generator Routing & Interconnection Policies
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900">
            <input
              type="checkbox"
              checked={asset.allowBatteryCharging}
              onChange={(e) =>
                onUpdate({ allowBatteryCharging: e.target.checked })
              }
              className="mt-0.5 rounded border-slate-700 text-purple-600 focus:ring-purple-500"
            />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                Allow Battery Charging
              </span>
              <span className="text-[11px] text-slate-400">
                Reserved for future generator-to-battery dispatch modeling. This setting does not affect current Results.
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900">
            <input
              type="checkbox"
              checked={asset.allowGridExport}
              onChange={(e) => onUpdate({ allowGridExport: e.target.checked })}
              className="mt-0.5 rounded border-slate-700 text-purple-600 focus:ring-purple-500"
            />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                Allow Grid Export
              </span>
              <span className="text-[11px] text-slate-400">
                Generator grid-parallel export is not modeled yet. This setting is reserved for a future dispatch milestone.
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* Fuel Consumption Curve Table */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
          <div>
            <h4 className="text-xs font-semibold text-slate-200">
              Fuel Consumption Curve ({asset.fuelUnit === 'custom' && asset.customFuelUnitLabel ? asset.customFuelUnitLabel : asset.fuelUnit}/hr vs % Load)
            </h4>
            <p className="text-[11px] text-slate-400">
              Non-linear engine consumption profile across part-load operating regimes.
            </p>
          </div>
          <button
            onClick={handleAddFuelPoint}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add Point</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2 font-medium">Load Level (% of Rated)</th>
                <th className="pb-2 font-medium">Consumption ({asset.fuelUnit === 'custom' && asset.customFuelUnitLabel ? asset.customFuelUnitLabel : asset.fuelUnit}/hr)</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850">
              {asset.fuelCurve.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500 font-sans text-xs">
                    No fuel consumption curve points configured. Click &ldquo;Add Point&rdquo; to define load vs. fuel burn.
                  </td>
                </tr>
              ) : (
                asset.fuelCurve.map((point, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/50">
                    <td className="py-1.5 pr-4">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="5"
                        value={point.loadPercent}
                        onChange={(e) =>
                          handleUpdateFuelPoint(
                            idx,
                            'loadPercent',
                            Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                          )
                        }
                        className="w-28 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-purple-500"
                      />
                    </td>
                    <td className="py-1.5 pr-4">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={point.fuelUnitsPerHour}
                        onChange={(e) =>
                          handleUpdateFuelPoint(
                            idx,
                            'fuelUnitsPerHour',
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        }
                        className="w-28 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-purple-500"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => handleDeleteFuelPoint(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                        title="Remove point"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
