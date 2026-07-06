// Shared validators derived from WARP API parameter constraints.
// Only validators reused across multiple tool files live here; one-off
// constraints are expressed inline with Zod in the tool definitions.

// 10-digit NANP telephone number (WARP TNs are US/CA 10-digit).
export function isValidTn(value: string): boolean {
  return /^\d{10}$/.test(value);
}

// UUID (customer ids, key ids, trunk ids, request ids).
export function isValidUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value
  );
}

// YYYY-MM-DD date strings used by CDR/analytics endpoints.
export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
