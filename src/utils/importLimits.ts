/**
 * Conservative ingestion ceilings based on the 35,040-interval worker benchmark
 * in docs/performance-budget.md and the measured 318 KB / 8,760-row sample CSV.
 */
export const MAX_LOAD_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_RESOURCE_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_ARCHIVE_BYTES = 12 * 1024 * 1024;
export const MAX_INTERVALS_PER_DATASET = 35_040;
export const MAX_GENERATION_ASSETS = 10;

export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
}
