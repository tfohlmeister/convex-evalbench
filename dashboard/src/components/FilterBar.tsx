import { Search } from "lucide-react";
import type { FilterState } from "../lib/filter";

interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  statuses: { value: string; label: string }[];
  placeholder?: string;
}

/**
 * The shared filter control: a status dropdown plus a free-text search,
 * both operating client-side over the currently loaded rows.
 */
export function FilterBar({
  value,
  onChange,
  statuses,
  placeholder = "Search…",
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="relative flex-1 max-w-xs">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-soft)] pointer-events-none"
        />
        <input
          className="input pl-9"
          placeholder={placeholder}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          aria-label="Search"
        />
      </div>
      <select
        className="input w-auto"
        value={value.status ?? ""}
        onChange={(e) =>
          onChange({ ...value, status: e.target.value || null })
        }
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
