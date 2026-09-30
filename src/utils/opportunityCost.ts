/**
 * Pure opportunity-cost benchmark calculation utility.
 *
 * Methodology:
 * Opportunity cost is the investment profit the user could have earned by investing
 * the actual cash outlays committed to the battery instead of spending those cash outlays
 * on the battery (counterfactual alternative investment).
 *
 * Cash outlays included:
 * - Year 0: Actual cash committed at purchase (gross cost minus point-of-sale rebates for cash;
 *   down payment amount for financing). Loan principal is NOT treated as user capital.
 * - Years 1+: Actual debt service (loan payments) and replacement expenses occurring that year.
 *
 * Battery-specific benefits (solar/battery savings, deferred federal tax credits, VOLL/resilience)
 * are NOT benchmark contributions; they remain returns on the battery side of the comparison.
 *
 * Timing convention:
 * - Year 0: Initial cash contribution is invested immediately.
 * - Each later year (1..horizon):
 *   1. Grow existing alternative-investment balance by the annual benchmark rate.
 *   2. Determine battery cash outlays occurring in that year (debt service + replacement).
 *   3. Add those outlays to the alternative investment at the end of that year.
 */

export interface OpportunityCostBenchmarkInput {
  horizonYears: number;
  annualRatePercent: number;

  upfrontContribution: number;

  monthlyLoanPayment: number;
  loanTermYears: number;

  replacementEnabled: boolean;
  replacementCost: number;
  replacementYear: number;

  additionalAnnualContributions?: number[];
}

export interface OpportunityCostYear {
  year: number;

  annualContribution: number;
  cumulativeContributions: number;

  futureValue: number;
  profit: number;
}

export interface OpportunityCostBenchmarkResult {
  horizonYears: number;

  upfrontContribution: number;
  totalContributions: number;

  futureValue: number;
  profit: number;

  yearly: OpportunityCostYear[];
}

/**
 * Calculates the counterfactual opportunity-cost investment benchmark across a specified horizon.
 * Maintains full JavaScript floating-point precision without intermediate rounding.
 */
export function calculateOpportunityCostBenchmark(
  input: OpportunityCostBenchmarkInput
): OpportunityCostBenchmarkResult {
  const {
    horizonYears,
    annualRatePercent,
    upfrontContribution,
    monthlyLoanPayment,
    loanTermYears,
    replacementEnabled,
    replacementCost,
    replacementYear,
    additionalAnnualContributions,
  } = input;

  const safeHorizon = Math.max(0, Math.round(horizonYears || 0));
  // Preserves 0% without defaulting
  const rate = annualRatePercent / 100;
  const safeUpfront = Math.max(0, upfrontContribution || 0);
  const safeMonthlyLoan = Math.max(0, monthlyLoanPayment || 0);
  const safeLoanTermYears = Math.max(0, Math.round(loanTermYears || 0));
  const safeReplacementCost = replacementEnabled ? Math.max(0, replacementCost || 0) : 0;
  const safeReplacementYear = replacementEnabled ? Math.max(1, Math.round(replacementYear || 0)) : 0;

  let balance = safeUpfront;
  let cumulativeContributions = safeUpfront;

  const yearly: OpportunityCostYear[] = [];

  for (let year = 1; year <= safeHorizon; year++) {
    // 1. Grow existing balance by the annual benchmark rate
    balance *= (1 + rate);

    // 2. Determine battery / project cash outlays occurring in that year
    let annualContribution = 0;

    if (year <= safeLoanTermYears) {
      annualContribution += safeMonthlyLoan * 12;
    }

    if (replacementEnabled && year === safeReplacementYear) {
      annualContribution += safeReplacementCost;
    }

    if (additionalAnnualContributions && additionalAnnualContributions.length >= year) {
      const extra = additionalAnnualContributions[year - 1];
      if (typeof extra === 'number' && !isNaN(extra)) {
        annualContribution += Math.max(0, extra);
      }
    }

    // 3. Add outlays to the alternative investment at the end of the year
    balance += annualContribution;
    cumulativeContributions += annualContribution;

    const profit = balance - cumulativeContributions;

    yearly.push({
      year,
      annualContribution,
      cumulativeContributions,
      futureValue: balance,
      profit,
    });
  }

  return {
    horizonYears: safeHorizon,
    upfrontContribution: safeUpfront,
    totalContributions: cumulativeContributions,
    futureValue: balance,
    profit: balance - cumulativeContributions,
    yearly,
  };
}
