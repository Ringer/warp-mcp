// Tool annotation presets (spec 2025-11-25). Defaults assume the worst case
// (destructive, non-idempotent, open-world), so every tool sets them explicitly.

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Additive writes: creates/submits that don't overwrite or delete existing data.
export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

// Updates that replace existing state; safe to retry with the same arguments.
export const IDEMPOTENT_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Deletes, cancels, disconnects — anything that removes or irreversibly changes data.
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
