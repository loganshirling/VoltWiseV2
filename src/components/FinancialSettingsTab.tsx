import React from 'react';
import {
  DollarSign,
  TrendingUp,
  BatteryLow,
  Percent,
  Calculator,
  ShieldCheck,
  Info,
  Clock,
  Landmark,
  Wrench,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { BatteryProfile, MacroFinancials } from '../types/energy';
import { calculateOpportunityCostBenchmark } from '../utils/opportunityCost';

interface FinancialSettingsTabProps {
  financials: MacroFinancials;
  setFinancials: React.Dispatch<React.SetStateAction<MacroFinancials>>;
  activeProfile: BatteryProfile;
}

export const FinancialSettingsTab: React.FC<FinancialSettingsTabProps> = ({
  financials,
  setFinancials,
  activeProfile,
}) => {
  const handleUpdate = <K extends keyof MacroFinancials>(field: K, val: MacroFinancials[K]) => {
    setFinancials((prev) => ({ ...prev, [field]: val }));
  };

  const grossCost = activeProfile.installedCost;
  const flatRebate = Math.max(0, financials.localRebateFlat);
  const immediateRebates = Math.min(grossCost, flatRebate);
  const upfrontNetCost = Math.max(0, grossCost - immediateRebates);
  const taxCreditDollars = Math.round(grossCost * (Math.max(0, financials.federalTaxCreditPercent) / 100));
  const totalIncentives = Math.min(grossCost, immediateRebates + taxCreditDollars);
  const netInstalledCost = Math.max(0, grossCost - totalIncentives);

  // Financing calculation for preview:
  // Loan principal is based on upfront capital needed (upfrontNetCost - downPayment).
  // The deferred tax credit arrives as a future cash flow in Year 1+ and does not reduce loan principal.
  const downPaymentAmount = financials.isFinanced
    ? Math.round(upfrontNetCost * (financials.loanDownPaymentPercent / 100))
    : upfrontNetCost;
  const loanPrincipal = financials.isFinanced ? Math.max(0, upfrontNetCost - downPaymentAmount) : 0;
  const monthlyRate = (financials.loanAprPercent / 100) / 12;
  const numMonths = financials.loanTermYears * 12;
  const monthlyLoanPayment = financials.isFinanced && loanPrincipal > 0
    ? (monthlyRate > 0
        ? Math.round((loanPrincipal * (monthlyRate * Math.pow(1 + monthlyRate, numMonths)) / (Math.pow(1 + monthlyRate, numMonths) - 1)) * 100) / 100
        : Math.round((loanPrincipal / numMonths) * 100) / 100)
    : 0;

  // Degradation projection preview
  const usableKwhInitial = activeProfile.totalCapacityKwh * (activeProfile.usableDodPercent / 100);
  const usableKwhYear1 = usableKwhInitial;
  const usableKwhYear5 = usableKwhInitial * Math.max(0.35, 1 - 4 * (financials.annualBatteryDegradationRate / 100));
  const usableKwhYear10 = usableKwhInitial * Math.max(0.35, 1 - 9 * (financials.annualBatteryDegradationRate / 100));
  const usableKwhYear15 = usableKwhInitial * Math.max(0.35, 1 - 14 * (financials.annualBatteryDegradationRate / 100));
  const usableKwhYear25 = usableKwhInitial * Math.max(0.35, 1 - 24 * (financials.annualBatteryDegradationRate / 100));

  // Autonomy calculations
  const critLoad = Math.max(0.2, financials.criticalLoadPowerKw);
  const autonomyHours = Math.round((usableKwhInitial / critLoad) * 10) / 10;
  const autonomyDays = Math.round((autonomyHours / 24) * 10) / 10;

  // Opportunity cost benchmark calculation preview (unified methodology)
  const oppYears = 15;
  const upfrontContribution = financials.isFinanced ? downPaymentAmount : upfrontNetCost;
  const oppBenchmark = calculateOpportunityCostBenchmark({
    horizonYears: oppYears,
    annualRatePercent: financials.opportunityCostRatePercent ?? 4.5,
    upfrontContribution,
    monthlyLoanPayment,
    loanTermYears: financials.isFinanced ? financials.loanTermYears : 0,
    replacementEnabled: financials.replacementEnabled,
    replacementCost: financials.replacementCost,
    replacementYear: financials.replacementYear,
  });
  const oppFutureVal = Math.round(oppBenchmark.futureValue);
  const oppProfit = Math.round(oppBenchmark.profit);

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="text-emerald-400 font-mono text-base">03.</span>
            Macro Financials, Lifecycle Costs & Resilience
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure clean energy tax credits, loan financing, Time Value of Money (NPV/IRR), mid-life inverter reserves, and outage resilience.
          </p>
        </div>
      </div>

      {/* SECTION 1: UPFRONT INCENTIVES & CAPITAL RECONCILIATION */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
              1. Upfront Capital Incentives & Tax Credits
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">Active Profile: {activeProfile.name}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Federal Tax Credit % */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  Federal Clean Energy Tax Credit (ITC)
                </label>
                <span className="text-[11px] text-slate-400">
                  User-specified percentage (defaults to 0%; e.g., 30% if eligible)
                </span>
              </div>
              <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                {financials.federalTaxCreditPercent}%
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={financials.federalTaxCreditPercent}
              onChange={(e) => handleUpdate('federalTaxCreditPercent', parseFloat(e.target.value) || 0)}
              className="w-full accent-emerald-500 cursor-pointer"
            />

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">Tax Credit Value:</span>
              <span className="font-mono font-bold text-emerald-400">
                -${taxCreditDollars.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">Cash Flow Realization:</span>
              <select
                value={financials.federalTaxCreditRealizationYear ?? 1}
                onChange={(e) => handleUpdate('federalTaxCreditRealizationYear', parseInt(e.target.value, 10) || 1)}
                className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
              >
                <option value={1}>Year 1 (Next tax filing)</option>
                <option value={2}>Year 2</option>
              </select>
            </div>
          </div>

          {/* Flat Local / Utility Rebate */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  State / Utility Flat Cash Rebate
                </label>
                <span className="text-[11px] text-slate-400">
                  e.g., California SGIP or direct utility grant (defaults to $0)
                </span>
              </div>
              <span className="text-sm font-bold text-cyan-400 font-mono tabular-nums">
                ${financials.localRebateFlat.toLocaleString()}
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="6000"
              step="250"
              value={financials.localRebateFlat}
              onChange={(e) => handleUpdate('localRebateFlat', parseFloat(e.target.value) || 0)}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">Flat Grant Value:</span>
              <span className="font-mono font-bold text-cyan-400">
                -${financials.localRebateFlat.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Calculation Bridge Breakdown */}
        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-3">
            Capital Investment & Incentive Reconciliation ({activeProfile.name})
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Gross Installed</span>
              <span className="text-sm font-bold text-slate-200 tabular-nums">
                ${grossCost.toLocaleString()}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Point-of-Sale Rebate</span>
              <span className="text-sm font-bold text-cyan-400 tabular-nums">
                -${immediateRebates.toLocaleString()}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Upfront Net Outlay</span>
              <span className="text-sm font-bold text-slate-100 tabular-nums">
                ${upfrontNetCost.toLocaleString()}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Tax Credit (Yr {financials.federalTaxCreditRealizationYear ?? 1})</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums">
                -${taxCreditDollars.toLocaleString()}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-emerald-300 block font-sans font-bold">Net Installed Cost</span>
              <span className="text-sm font-bold text-emerald-300 tabular-nums">
                ${netInstalledCost.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: FINANCING & CLEAN ENERGY LOAN ENGINE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                2. Financing & Clean Energy Loan Engine
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Model debt service and compute Net Monthly Cash Flow (Monthly Savings - Monthly Loan Payment).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleUpdate('isFinanced', false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                !financials.isFinanced
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              100% Cash Purchase
            </button>
            <button
              onClick={() => handleUpdate('isFinanced', true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                financials.isFinanced
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Clean Energy Loan
            </button>
          </div>
        </div>

        {financials.isFinanced ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Loan APR % */}
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">Loan APR (%)</label>
                  <span className="text-sm font-bold text-indigo-400 font-mono tabular-nums">
                    {financials.loanAprPercent.toFixed(2)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="0.25"
                  value={financials.loanAprPercent}
                  onChange={(e) => handleUpdate('loanAprPercent', parseFloat(e.target.value) || 0)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">
                  Typical solar/battery loans range between 5.99% and 9.99% APR.
                </span>
              </div>

              {/* Loan Term (Years) */}
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">Loan Term (Years)</label>
                  <span className="text-sm font-bold text-indigo-400 font-mono tabular-nums">
                    {financials.loanTermYears} Years
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {[5, 10, 15, 20, 25].map((yr) => (
                    <button
                      key={yr}
                      onClick={() => handleUpdate('loanTermYears', yr)}
                      className={`flex-1 py-1 text-xs font-mono rounded transition-colors ${
                        financials.loanTermYears === yr
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {yr}y
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400 block">
                  Amortized over {financials.loanTermYears * 12} equal monthly installments.
                </span>
              </div>

              {/* Down Payment % */}
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">Down Payment (%)</label>
                  <span className="text-sm font-bold text-indigo-400 font-mono tabular-nums">
                    {financials.loanDownPaymentPercent}% (${downPaymentAmount.toLocaleString()})
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={financials.loanDownPaymentPercent}
                  onChange={(e) => handleUpdate('loanDownPaymentPercent', parseFloat(e.target.value) || 0)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">
                  Upfront cash down payment due at installation.
                </span>
              </div>
            </div>

            {/* Loan Amortization Preview Card */}
            <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-xl p-4 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Financed Principal</span>
                  <span className="text-sm font-bold text-white tabular-nums">
                    ${loanPrincipal.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Monthly Loan Payment</span>
                  <span className="text-sm font-bold text-indigo-300 tabular-nums">
                    ${monthlyLoanPayment.toFixed(2)}/mo
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Upfront Out-of-Pocket</span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">
                    ${downPaymentAmount.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Total Debt Service</span>
                  <span className="text-sm font-bold text-slate-300 tabular-nums">
                    ${(monthlyLoanPayment * numMonths).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
              {taxCreditDollars > 0 && (
                <div className="text-[11px] text-indigo-300/80 pt-1.5 border-t border-indigo-900/50 font-sans">
                  Note: Federal tax credit of ${taxCreditDollars.toLocaleString()} is realized in Year {financials.federalTaxCreditRealizationYear ?? 1} cash flow and does not reduce loan principal.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
            <span>System is evaluated as a 100% upfront cash purchase (${upfrontNetCost.toLocaleString()} initial outlay before deferred tax credits).</span>
            <span className="text-emerald-400 font-semibold font-mono">Zero Debt Service / No Interest</span>
          </div>
        )}
      </div>

      {/* SECTION 3: TIME VALUE OF MONEY & OPPORTUNITY COST */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-cyan-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            3. Time Value of Money (NPV & Opportunity Cost)
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Discount Rate (r) */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  Discount Rate ($r$ for NPV)
                </label>
                <span className="text-[11px] text-slate-400">
                  Cost of capital / required rate of return
                </span>
              </div>
              <span className="text-sm font-bold text-cyan-400 font-mono tabular-nums">
                {financials.discountRatePercent.toFixed(1)}%
              </span>
            </div>

            <input
              type="range"
              min="1.0"
              max="12.0"
              step="0.5"
              value={financials.discountRatePercent}
              onChange={(e) => handleUpdate('discountRatePercent', parseFloat(e.target.value) || 0)}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            <p className="text-[11px] text-slate-400">
              Evaluates whether cumulative electricity savings exceed upfront capital in present-day dollars:
              <span className="block font-mono text-[10px] text-cyan-300/90 pt-1">
                NPV = ∑ [Net Cash Flow_t / (1 + r)^t] - Initial Cost
              </span>
            </p>
          </div>

          {/* Opportunity Cost Benchmark */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  Alternative Opportunity Asset
                </label>
                <span className="text-[11px] text-slate-400">
                  Baseline capital growth comparison
                </span>
              </div>
              <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                {financials.opportunityCostRatePercent.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <button
                onClick={() => {
                  handleUpdate('opportunityCostVehicle', 'hysa');
                  handleUpdate('opportunityCostRatePercent', 4.5);
                }}
                className={`py-1.5 px-2 text-[11px] rounded transition-colors text-center ${
                  financials.opportunityCostVehicle === 'hysa'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                HYSA (4.5%)
              </button>

              <button
                onClick={() => {
                  handleUpdate('opportunityCostVehicle', 'index_fund');
                  handleUpdate('opportunityCostRatePercent', 7.0);
                }}
                className={`py-1.5 px-2 text-[11px] rounded transition-colors text-center ${
                  financials.opportunityCostVehicle === 'index_fund'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                S&P 500 (7.0%)
              </button>

              <button
                onClick={() => handleUpdate('opportunityCostVehicle', 'custom')}
                className={`py-1.5 px-2 text-[11px] rounded transition-colors text-center ${
                  financials.opportunityCostVehicle === 'custom'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Custom Rate
              </button>
            </div>

            {financials.opportunityCostVehicle === 'custom' && (
              <input
                type="range"
                min="1.0"
                max="15.0"
                step="0.5"
                value={financials.opportunityCostRatePercent}
                onChange={(e) => handleUpdate('opportunityCostRatePercent', parseFloat(e.target.value) || 0)}
                className="w-full accent-amber-500 cursor-pointer pt-1"
              />
            )}

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80 font-mono">
              <span className="text-slate-400">{oppYears}-Yr Alternative Future Value:</span>
              <span className="font-bold text-white">${oppFutureVal.toLocaleString()} (+${oppProfit.toLocaleString()})</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed pt-0.5">
              Estimates the return you could have earned by investing the actual cash committed to the battery instead: upfront cash/down payment, debt service, and replacement costs (15-year preview).
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 4: LIFECYCLE MAINTENANCE & INVERTER REPLACEMENT RESERVE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                4. Lifecycle Maintenance & Component Replacement Reserve
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Factor mid-life inverter/controller replacement capital into cash flow, payback, and Levelized Cost of Storage (LCOS).
              </p>
            </div>
          </div>
          <button
            onClick={() => handleUpdate('replacementEnabled', !financials.replacementEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              financials.replacementEnabled
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800'
            }`}
          >
            {financials.replacementEnabled ? '✓ Reserve Enabled' : 'Reserve Disabled'}
          </button>
        </div>

        {financials.replacementEnabled ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Mid-Life Replacement Cost */}
            <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-200 block">
                    Inverter / Component Replacement Cost ($)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Typical hybrid inverter replacement: $1,500 – $2,500
                  </span>
                </div>
                <span className="text-sm font-bold text-amber-400 font-mono tabular-nums">
                  ${financials.replacementCost.toLocaleString()}
                </span>
              </div>

              <input
                type="range"
                min="500"
                max="5000"
                step="250"
                value={financials.replacementCost}
                onChange={(e) => handleUpdate('replacementCost', parseFloat(e.target.value) || 0)}
                className="w-full accent-amber-500 cursor-pointer"
              />

              <span className="text-[10px] text-slate-400 block">
                Deducted directly from Net Cash Flow in target year; discounted into NPV.
              </span>
            </div>

            {/* Target Replacement Year */}
            <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-200 block">
                    Target Replacement Year
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Standard manufacturer warranty expiration: Year 10
                  </span>
                </div>
                <span className="text-sm font-bold text-amber-400 font-mono tabular-nums">
                  Year {financials.replacementYear}
                </span>
              </div>

              <input
                type="range"
                min="5"
                max="15"
                step="1"
                value={financials.replacementYear}
                onChange={(e) => handleUpdate('replacementYear', parseInt(e.target.value, 10) || 10)}
                className="w-full accent-amber-500 cursor-pointer"
              />

              <span className="text-[10px] text-slate-400 block">
                Creates a capital outlay dip in Year {financials.replacementYear}'s cumulative cash flow curve.
              </span>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs text-slate-400">
            No mid-life capital maintenance replacement is reserved. Inverter is modeled to operate throughout the 25-year horizon.
          </div>
        )}
      </div>

      {/* SECTION 5: ESCALATION & DEGRADATION PARAMETERS */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-amber-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            5. Escalation & Electrochemical Degradation Dynamics
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Annual Electricity Inflation Rate */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  Electricity Rate Inflation
                </label>
                <span className="text-[11px] text-slate-400">
                  Annual compounding utility rate escalation
                </span>
              </div>
              <span className="text-sm font-bold text-amber-300 font-mono tabular-nums">
                {financials.annualElectricityInflationRate}%/yr
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              value={financials.annualElectricityInflationRate}
              onChange={(e) => handleUpdate('annualElectricityInflationRate', parseFloat(e.target.value) || 0)}
              className="w-full accent-amber-500 cursor-pointer"
            />

            <span className="text-[10px] text-slate-400 block">
              Historic US electricity inflation averages ~3.0% - 4.5% annually.
            </span>
          </div>

          {/* Annual Battery Degradation Rate */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">
                  Annual Capacity Degradation Rate
                </label>
                <span className="text-[11px] text-slate-400">
                  Electrochemical capacity fade rate
                </span>
              </div>
              <span className="text-sm font-bold text-rose-400 font-mono tabular-nums">
                {financials.annualBatteryDegradationRate}%/yr
              </span>
            </div>

            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.25"
              value={financials.annualBatteryDegradationRate}
              onChange={(e) => handleUpdate('annualBatteryDegradationRate', parseFloat(e.target.value) || 0)}
              className="w-full accent-rose-500 cursor-pointer"
            />

            <span className="text-[10px] text-slate-400 block">
              Tier-1 LFP chemistry typically experiences ~1.8% - 2.2% annual fade.
            </span>
          </div>
        </div>

        {/* Degradation Timeline Preview */}
        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <BatteryLow className="h-4 w-4 text-amber-400" />
              Projected Usable Capacity Retention ({activeProfile.name})
            </span>
            <span className="text-xs font-mono text-slate-400">
              Rate: -{financials.annualBatteryDegradationRate}%/year
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono pt-1">
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Year 1</span>
              <span className="font-bold text-emerald-400 tabular-nums">{usableKwhYear1.toFixed(1)} kWh (100%)</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Year 5</span>
              <span className="font-bold text-slate-200 tabular-nums">{usableKwhYear5.toFixed(1)} kWh ({(usableKwhYear5 / usableKwhInitial * 100).toFixed(0)}%)</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Year 10</span>
              <span className="font-bold text-amber-300 tabular-nums">{usableKwhYear10.toFixed(1)} kWh ({(usableKwhYear10 / usableKwhInitial * 100).toFixed(0)}%)</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Year 15</span>
              <span className="font-bold text-orange-300 tabular-nums">{usableKwhYear15.toFixed(1)} kWh ({(usableKwhYear15 / usableKwhInitial * 100).toFixed(0)}%)</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">Year 25 (End-of-Life)</span>
              <span className="font-bold text-rose-300 tabular-nums">{usableKwhYear25.toFixed(1)} kWh ({(usableKwhYear25 / usableKwhInitial * 100).toFixed(0)}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 6: NON-FINANCIAL & RESILIENCE METRICS (VOLL) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                6. Outage Autonomy & Value of Lost Load (VOLL)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Quantify blackout backup duration and assign soft economic value to food preservation and emergency power.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleUpdate('includeVollInRoi', !financials.includeVollInRoi)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              financials.includeVollInRoi
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800'
            }`}
          >
            {financials.includeVollInRoi ? '✓ VOLL Blended into ROI' : 'VOLL Excluded from Financial ROI'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Critical Backup Load Demand (kW) */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">Critical Backup Load</label>
                <span className="text-[11px] text-slate-400">Continuous load during blackout</span>
              </div>
              <span className="text-sm font-bold text-amber-400 font-mono tabular-nums">
                {financials.criticalLoadPowerKw.toFixed(1)} kW
              </span>
            </div>

            <div className="flex items-center gap-1">
              {[
                { label: '0.6 kW', val: 0.6, desc: 'Standby' },
                { label: '1.2 kW', val: 1.2, desc: 'Essentials' },
                { label: '2.5 kW', val: 2.5, desc: 'High' },
              ].map((p) => (
                <button
                  key={p.val}
                  onClick={() => handleUpdate('criticalLoadPowerKw', p.val)}
                  className={`flex-1 py-1 text-[11px] font-mono rounded transition-colors ${
                    financials.criticalLoadPowerKw === p.val
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <input
              type="range"
              min="0.3"
              max="4.0"
              step="0.1"
              value={financials.criticalLoadPowerKw}
              onChange={(e) => handleUpdate('criticalLoadPowerKw', parseFloat(e.target.value) || 1.2)}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* Average Outage Days per Year */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">Outage Days / Year</label>
                <span className="text-[11px] text-slate-400">Historic grid blackout exposure</span>
              </div>
              <span className="text-sm font-bold text-cyan-400 font-mono tabular-nums">
                {financials.annualOutageDays.toFixed(1)} days/yr
              </span>
            </div>

            <input
              type="range"
              min="0.5"
              max="14.0"
              step="0.5"
              value={financials.annualOutageDays}
              onChange={(e) => handleUpdate('annualOutageDays', parseFloat(e.target.value) || 2.5)}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            <span className="text-[10px] text-slate-400 block">
              {(financials.annualOutageDays * 24).toFixed(0)} hours of blackout protection annually.
            </span>
          </div>

          {/* Value of Lost Load ($/day) */}
          <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-slate-200 block">Value of Lost Load (VOLL)</label>
                <span className="text-[11px] text-slate-400">Assigned outage protection value</span>
              </div>
              <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                ${financials.valueOfLostLoadPerDay}/day
              </span>
            </div>

            <input
              type="range"
              min="25"
              max="300"
              step="25"
              value={financials.valueOfLostLoadPerDay}
              onChange={(e) => handleUpdate('valueOfLostLoadPerDay', parseFloat(e.target.value) || 100)}
              className="w-full accent-emerald-500 cursor-pointer"
            />

            <span className="text-[10px] text-slate-400 block">
              Covers food spoilage ($150-$400), productivity loss, and HVAC comfort.
            </span>
          </div>
        </div>

        {/* Resilience Summary Card */}
        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Blackout Autonomy</span>
              <span className="text-sm font-bold text-amber-300 tabular-nums">
                {autonomyHours} Hours ({autonomyDays} Days)
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Annual Resilience Value</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums">
                ${Math.round(financials.annualOutageDays * financials.valueOfLostLoadPerDay)}/yr
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">25-Yr Cumulative VOLL</span>
              <span className="text-sm font-bold text-cyan-400 tabular-nums">
                ${Math.round(financials.annualOutageDays * financials.valueOfLostLoadPerDay * 25).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Financial ROI Status</span>
              <span className={`text-xs font-bold ${financials.includeVollInRoi ? 'text-emerald-400' : 'text-slate-400'}`}>
                {financials.includeVollInRoi ? 'Blended into Total ROI' : 'Excluded from Cash ROI'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
