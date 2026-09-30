import React from 'react';
import { BatteryCharging, RefreshCw, FileSpreadsheet } from 'lucide-react';

interface NavbarProps {
  activeTab: 'data' | 'profiles' | 'generation' | 'financials' | 'results';
  setActiveTab: (tab: 'data' | 'profiles' | 'generation' | 'financials' | 'results') => void;
  onLoadSampleData: () => void;
  onResetData: () => void;
  hasData: boolean;
  totalKwh: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onLoadSampleData,
  onResetData,
  hasData,
  totalKwh,
}) => {
  const tabs = [
    { id: 'data', label: '1. Data & TOU Rates' },
    { id: 'profiles', label: '2. Battery Profiles' },
    { id: 'generation', label: '3. Power Generation' },
    { id: 'financials', label: '4. Financials & Settings' },
    { id: 'results', label: '5. Results & Analytics' },
  ] as const;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single text element Brand Zone */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <BatteryCharging className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white">
              VoltWise
            </span>
            <span className="text-[11px] text-slate-400 font-medium -mt-0.5">
              Home Energy Storage Simulation
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links / Tab Controls */}
        <nav className="hidden md:flex items-center gap-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800" aria-label="Main Navigation">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary Action Controls */}
        <div className="flex items-center gap-2.5">
          {!hasData ? (
            <button
              onClick={onLoadSampleData}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors whitespace-nowrap shadow-sm shadow-emerald-950/40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Load 8,760h Sample</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 border border-slate-800 rounded-lg px-2.5 py-1 bg-slate-900/50">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="font-mono tabular-nums text-slate-200 font-medium">
                  {totalKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
                </span>
              </div>
              <button
                onClick={onResetData}
                title="Reset simulation data"
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors whitespace-nowrap"
              >
                <RefreshCw className="h-3 w-3" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex overflow-x-auto border-t border-slate-800/80 px-4 py-2 gap-1.5 bg-slate-950">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs font-semibold rounded-md whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-slate-800 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
};
