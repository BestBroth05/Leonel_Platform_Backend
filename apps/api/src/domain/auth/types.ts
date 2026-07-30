import type { RoleSlug } from "@leonel-platform/shared";

/** Domain user — not a Drizzle model */
export type DomainUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  roleSlug: RoleSlug;
  permissions: string[];
  isActive: boolean;
};
