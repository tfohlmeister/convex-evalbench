export interface ParsedItems {
  items: { input: unknown; expectedOutput?: unknown }[];
  error: string | null;
}

/**
 * Parse the create-dataset items textarea: an empty string is valid (no
 * items), otherwise the input must be a JSON array whose elements each
 * carry an `input` field. Returns the parsed items or a user-facing
 * error message; never throws.
 */
export function parseItems(raw: string): ParsedItems {
  const trimmed = raw.trim();
  if (trimmed === "") return { items: [], error: null };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { items: [], error: "Items must be valid JSON." };
  }
  if (!Array.isArray(value)) {
    return { items: [], error: "Items must be a JSON array." };
  }
  for (const el of value) {
    if (el === null || typeof el !== "object" || !("input" in el)) {
      return { items: [], error: "Each item needs an `input` field." };
    }
  }
  return { items: value as ParsedItems["items"], error: null };
}
