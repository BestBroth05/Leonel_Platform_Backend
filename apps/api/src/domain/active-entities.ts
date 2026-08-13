import { and, isNull, ne, type SQL } from "drizzle-orm";
import { inventoryMovements, orders } from "../infrastructure/db/schema.js";

/** Shared filters so balance, settlement, availability and snapshots stay consistent. */
export function activeOrderConditions(): SQL {
  return and(isNull(orders.deletedAt), ne(orders.status, "CANCELLED"))!;
}

export function activeMovementConditions(): SQL {
  return isNull(inventoryMovements.cancelledAt)!;
}

export function isActiveOrder(row: { deletedAt: Date | null; status: string }): boolean {
  return row.deletedAt == null && row.status !== "CANCELLED";
}

export function isActiveMovement(row: { cancelledAt: Date | null }): boolean {
  return row.cancelledAt == null;
}
