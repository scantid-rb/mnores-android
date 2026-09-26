// Role-based UI capabilities. The server remains the final authority (a
// forbidden result is still handled); this only decides which controls the
// UI shows. Admin/inspector are read-only on mobile until explicitly enabled.

import { Role } from "@/src/types";

export function canCreatePart(role: Role | undefined): boolean {
  return role === "chief_engineer";
}

export function canDeletePart(role: Role | undefined): boolean {
  return role === "chief_engineer";
}

// Edit all descriptive fields (name, reference, category, location, notes).
export function canEditFields(role: Role | undefined): boolean {
  return role === "chief_engineer";
}

// Change quantity (chief_engineer and mechanic).
export function canEditQuantity(role: Role | undefined): boolean {
  return role === "chief_engineer" || role === "mechanic";
}
