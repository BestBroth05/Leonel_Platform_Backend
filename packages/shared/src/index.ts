export type RoleSlug = "admin" | "manager" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roleSlug: RoleSlug;
  permissions: string[];
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

export type LoginResponse = {
  user: AuthUser;
  tokens: TokenPair;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export const PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_WRITE: "users.write",
  AUDIT_READ: "audit.read",
  CLIENTS_READ: "clients.read",
  CLIENTS_WRITE: "clients.write",
  CATALOGS_READ: "catalogs.read",
  CATALOGS_WRITE: "catalogs.write",
  ORDERS_READ: "orders.read",
  ORDERS_WRITE: "orders.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_WRITE: "inventory.write",
  INVENTORY_CORRECT: "inventory.correct",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Provisional order statuses — confirm with workshop */
export const ORDER_STATUSES = [
  "DRAFT",
  "RECEIVING",
  "IN_PROCESS",
  "PARTIALLY_SHIPPED",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Provisional inventory movement types — confirm with workshop */
export const MOVEMENT_TYPES = [
  "RECEPTION",
  "ADDITIONAL_ENTRY",
  "RECEPTION_SHORTAGE",
  "SEND_TO_REPAIR",
  "RETURN_FROM_REPAIR",
  "SHRINKAGE",
  "PARTIAL_EXIT",
  "FINAL_EXIT",
  "CORRECTION",
  "CANCELLATION",
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type OrderBalance = {
  expectedQuantity: number;
  received: number;
  inRepair: number;
  shrinkage: number;
  shipped: number;
  available: number;
  shortage: number;
};
