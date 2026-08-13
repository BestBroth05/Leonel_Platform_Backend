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
    details?: unknown;
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
  "SOBRANTE_LINEA",
  "CORRECTION",
  "CANCELLATION",
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CUT_STATUSES = ["PENDING", "PARTIAL", "COMPLETE", "SURPLUS"] as const;
export type CutStatus = (typeof CUT_STATUSES)[number];

export const CLIENT_WEEK_STATUSES = ["OPEN", "CLOSED"] as const;
export type ClientWeekStatus = (typeof CLIENT_WEEK_STATUSES)[number];

export const SNAPSHOT_STATUSES = ["CURRENT", "INVALIDATED"] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const PACKAGING_TYPES = ["BOX", "DOZEN", "UNIT"] as const;
export type PackagingType = (typeof PACKAGING_TYPES)[number];

/** Preferred weekdays for client week open/close schedule (not operational locks). */
export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type OrderBalance = {
  /** Source of truth for new orders */
  assignedQuantity: number;
  /** @deprecated Legacy mirror; equals assignedQuantity for new flow */
  expectedQuantity: number;
  /** Equals assignedQuantity in the new cut-based flow */
  received: number;
  inRepair: number;
  shrinkage: number;
  shipped: number;
  lineSurplus: number;
  available: number;
  shortage: number;
  pendingToAccount: number;
  warnings: string[];
};

export type CutSettlementMetrics = {
  cutId: string;
  cutNumber: string;
  totalReceivedByCut: number;
  deliveredByCut: number;
  shrinkageByCut: number;
  lineSurplusByCut: number;
  finalizedByCut: number;
  sentToRepairByCut: number;
  returnedFromRepairByCut: number;
  inRepairByCut: number;
  totalAssignedByCut: number;
  unassignedByCut: number;
  pendingByCut: number;
  squared: boolean;
  reasons: string[];
};
