# Model scope and data contract

VoltWise is a deterministic scenario model for household interval energy, configurable battery/generation assets, energy-rate schedules, and user-entered financial assumptions. Its outputs describe the selected inputs. They are estimates; they are not a utility bill, a site-certified engineering study, a weather forecast, investment advice, or a guarantee of equipment performance or savings.

## Tariff scope for v1

V1 is a bounded **interval energy-rate model**, not a complete utility-bill engine. A tariff consists of import ($/kWh) and export-credit ($/kWh) values assigned to a weekly 168-hour schedule, with optional calendar-month seasons that override tier prices. The cost calculation applies the resolved rate to energy in each interval and totals the modeled import charges and export credits.

The model does not calculate demand charges, fixed monthly/customer charges, taxes, minimum bills, tiered cumulative consumption charges, utility riders, ratchets, net-metering true-ups, or other bill-specific adjustments. Do not present a saved tariff profile as a verified provider bill. Users should compare and update each entered rate against their current tariff document. No specific utility plan is claimed as bill-accurate, so there is no known-bill golden fixture for a named plan.

## Load CSV

The standard header, in this order (header matching is case-insensitive), is:

```csv
Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement
```

Provide at least two data rows. `Day` accepts common month/day/year and year-month-day calendar dates; `Hour of Day` accepts 12-hour AM/PM or 24-hour times. `Hourly Total` is the energy for that interval, not a power reading. Supported energy units are Wh, kWh, and MWh. `Daily Total` is a reported daily context value; simulation uses each interval's converted energy value. A legacy two-column `timestamp,usage_kwh` format is also accepted, with a parser warning. Power values in kW are not accepted as interval energy.

Load timestamps are interpreted in the site's explicitly selected IANA time zone. VoltWise does not infer a time zone. Nonexistent or ambiguous wall-clock times at daylight-saving transitions are rejected; records must be valid, strictly chronological and evenly spaced. Gaps and partial periods are reported rather than silently filled. A continuous, valid period with at least two intervals can be used for period dispatch. Lifecycle projections require one exact, gap-free calendar year at the detected interval cadence, including the full leap-year length when applicable. A partial period is not annualized.

## Measured solar and wind CSV

Measured resource inputs use canonical headers and units:

| Resource | Required header | Unit |
| --- | --- | --- |
| Solar irradiance | `timestamp,ghi_wm2,dni_wm2,dhi_wm2` | W/m² |
| Wind speed | `timestamp,wind_speed_mps` | m/s |

Resource timestamps may use ISO UTC (`Z`) or an explicit UTC offset. Zone-free wall-clock timestamps require a valid source IANA time zone. Values must be finite and non-negative; records must be unique, chronological, evenly spaced, and contain at least two rows. The converted UTC instants must match every load interval being simulated exactly. VoltWise does not interpolate, resample, or silently discard missing intervals.

Measured solar estimates plane-of-array irradiance and AC generation from GHI/DNI/DHI, site and panel geometry, a fixed ground albedo, configured losses, inverter efficiency, and clipping. Measured wind applies configured shear, elevation-based air-density adjustment, the turbine power curve, availability, and losses. These are modeled generation estimates, not a site-calibrated forecast.

Measured generation is supported only for its imported period. Do not use it as future weather. Lifecycle projections are disabled for measured-resource assets; they require modeled resource modes. VoltWise does not fetch weather services and does not import TMY3 or EPW files. For the detailed parser behavior, see [measured-resource data](measured-resource-data.md).

## Generation and dispatch

- **Solar:** deterministic clear-sky geometry or user-entered monthly peak-sun-hour assumptions; alternatively, measured irradiance CSV for period-only analysis. The clear-sky estimate does not model cloud cover or observed weather.
- **Wind:** deterministic output from entered annual or monthly mean wind speeds, using a Rayleigh-distribution estimate and turbine power curve; alternatively, measured wind-speed CSV for period-only analysis. A mean speed cannot represent site-specific wind chronology.
- **Scheduled generator:** follows the configured weekly operating windows and load-following constraints.
- **Economic generator:** compares a single interval's avoided import value with the modeled marginal fuel, maintenance, and startup costs. It does not optimize the whole day/year, anticipate future intervals, or dispatch for battery charging/export unless the independent settings permit the resulting surplus.
- **Standby generator:** capital cost and fixed maintenance can be included, but grid-connected runs do not start it. There is no chronological grid-availability input, so it produces no simulated outage energy or outage savings.
- **Battery:** modeled dispatch, energy flows, state of charge, efficiency, capacity fade, and configured replacement/finance assumptions follow the displayed settings and deterministic engine rules. The controller is not a whole-system global optimizer.

## Lifecycle and resilience assumptions

Lifecycle projections require a valid full-year load dataset. The representative annual input profile and configured modeled generation assumptions are used for the projection years while the selected escalation, degradation, maintenance, financing, and replacement assumptions are applied. Actual use, tariff changes, weather, degradation, maintenance, availability, and equipment condition can differ from these inputs. A measured solar/wind period is not repeated into future years.

Battery backup autonomy is a capacity-to-user-entered-critical-load estimate. Annual value of lost load uses the user-entered expected outage days and value per day. These are not calculated from historical outage events, and VoltWise does not simulate a chronological outage sequence or establish that a particular circuit will remain powered.

## Troubleshooting

- **Header rejected:** use the documented header spelling/order or the supported legacy two-column load schema.
- **Rows rejected or results unavailable:** check finite non-negative energy/resource values, units, required columns, dates, and row lengths. Do not convert kW to kWh without a validated interval duration.
- **Timeline rejected:** provide a valid IANA time zone for local timestamps, resolve daylight-saving ambiguity, sort records, and restore missing intervals in the source. VoltWise will not infer or interpolate them.
- **Measured resource will not attach:** verify that the correct resource type is selected and that all load timestamps have exact matching UTC resource records.
- **Lifecycle projection unavailable:** upload one complete, continuous calendar year and use modeled solar/wind resources for future-year projections.
- **Results differ from a provider bill:** check each rate and export credit, then account separately for bill components outside the v1 energy-rate model.
- **High memory or slow lifecycle run:** review the reference-machine limits in [performance budget](performance-budget.md); they are not guarantees for every device.
