# Measured solar and wind data

VoltWise accepts measured generation resources as CSV files in the Power Generation step. CSVs must contain a header row, at least two data rows, and the required column names below (header matching is case-insensitive).

| Resource | Required columns | Units |
| --- | --- | --- |
| Solar irradiance | `timestamp`, `ghi_wm2`, `dni_wm2`, `dhi_wm2` | W/m² |
| Wind speed | `timestamp`, `wind_speed_mps` | m/s |

Measurements must be finite and non-negative. Timestamps must be valid, unique, strictly increasing, and evenly spaced. The parser accepts ISO timestamps with `Z` or an explicit UTC offset, and local wall-clock timestamps when a valid IANA source time zone is selected. Explicit offsets identify an absolute instant; zone-free timestamps are interpreted in the selected source zone. The parser converts all records to UTC and reports invalid or ambiguous time handling instead of dropping rows.

The measured resource interval must match the load interval exactly. Every load timestamp in the simulated period must have a matching resource record; the resource file may cover a larger period. VoltWise does not interpolate or resample missing intervals. Imported data is attached to the selected solar array or wind turbine and shows its interval, covered UTC dates, and source time zone. Removing the resource returns that asset to its modeled resource mode. Resetting generation defaults clears generation assets and their imported resource datasets.

Measured solar uses solar position and panel orientation to estimate plane-of-array irradiance from GHI, DNI, and DHI, then applies array losses, inverter efficiency, and inverter clipping. The ground-reflection term uses a fixed albedo assumption of 0.2. Treat this as an engineering estimate, not a site-calibrated forecast. Measured wind applies hub-height shear and elevation-based air-density corrections to each interval, then the configured turbine power curve, availability, and system loss.

Measured resources support simulation over the imported period. If the load and resource series cover one exact, continuous calendar year with a matching record at every load interval, lifecycle projections replay that same measured year for each projection year. Solar hardware capacity degrades, while the irradiance observations stay unchanged; wind measurements and configuration stay unchanged. This is a representative-year scenario, not a weather forecast. Partial-period results remain period totals and are not annualized. See the [G7 measured-resource projection decision](g7-measured-resource-projection-decision.md).

Generation-aware runs provide a separate **Export Period Results (.json)** action. It includes the exact UTC period, generation assets, measured resource records and metadata, battery/tariff/financial settings, interval results, and period cost and energy totals. Lifecycle JSON exports include projection rows only after a complete, exact-year load and resource series passes simulation and finance validation; those rows represent the same measured year under configured assumptions, not future observed weather.
