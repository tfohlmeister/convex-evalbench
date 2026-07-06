export interface FilterState {
  text: string;
  status: string | null;
}

export const EMPTY_FILTER: FilterState = { text: "", status: null };

/**
 * Narrow a list of rows client-side, over the currently loaded window:
 * keep a row when its status matches the selected one (or no status is
 * selected) and any of its searchable fields contains the query text
 * (case-insensitive). Pure, so it is unit-tested directly.
 */
export function filterList<T>(
  rows: T[],
  { text, status }: FilterState,
  getSearchable: (row: T) => (string | undefined)[],
  getStatus: (row: T) => string,
): T[] {
  const q = text.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== null && getStatus(row) !== status) return false;
    if (q === "") return true;
    return getSearchable(row).some(
      (field) => field !== undefined && field.toLowerCase().includes(q),
    );
  });
}
