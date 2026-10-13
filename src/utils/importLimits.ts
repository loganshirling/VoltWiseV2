/**
 * File ceilings bound browser reads; interval ceilings include a complete UTC leap year
 * at 15-minute cadence. Both are measured independently in docs/performance-budget.md.
 */
export const MAX_LOAD_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_RESOURCE_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_ARCHIVE_BYTES = 12 * 1024 * 1024;
export const MAX_PROJECT_ACCEPTED_ARCHIVE_BYTES = MAX_PROJECT_ARCHIVE_BYTES - 1024 * 1024;
export const MAX_PROJECT_PERSISTED_DATA_BYTES = 9 * 1024 * 1024;
export const MAX_INTERVALS_PER_DATASET = 35_136;
export const MAX_GENERATION_ASSETS = 10;

export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
}
