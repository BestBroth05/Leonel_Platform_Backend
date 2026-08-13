import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("users_role_id_idx").on(table.roleId)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("refresh_tokens_user_id_idx").on(table.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_actor_user_id_idx").on(table.actorUserId)],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    rfc: text("rfc"),
    notes: text("notes"),
    /** Preferred weekday when the client's work week usually opens (schedule hint). */
    weekOpensOn: text("week_opens_on"),
    /** Preferred weekday when the client's work week usually closes (schedule hint). */
    weekClosesOn: text("week_closes_on"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    index("clients_name_idx").on(table.name),
    index("clients_is_active_idx").on(table.isActive),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export const pantTypes = pgTable(
  "pant_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export const destinations = pgTable(
  "destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export const productionFormats = pgTable(
  "production_formats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    number: text("number").notNull(),
    /** Nullable only for ambiguous legacy rows pending data correction before NOT NULL. */
    clientId: uuid("client_id").references(() => clients.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("production_formats_number_uidx")
      .on(table.number)
      .where(sql`${table.deletedAt} IS NULL`),
    index("production_formats_number_idx").on(table.number),
    index("production_formats_client_id_idx").on(table.clientId),
  ],
);

/** Manual open/close client weeks. Period is [startDate, endDate] inclusive. */
export const clientWeeks = pgTable(
  "client_weeks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    status: text("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("client_weeks_one_open_uidx")
      .on(table.clientId)
      .where(sql`${table.status} = 'OPEN'`),
    index("client_weeks_client_id_idx").on(table.clientId),
    index("client_weeks_client_status_idx").on(table.clientId, table.status),
  ],
);

export const weeklySettlementSnapshots = pgTable(
  "weekly_settlement_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientWeekId: uuid("client_week_id")
      .notNull()
      .references(() => clientWeeks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("CURRENT"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    closedBy: uuid("closed_by").references(() => users.id),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedBy: uuid("invalidated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_settlement_snapshots_week_version_uidx").on(
      table.clientWeekId,
      table.version,
    ),
    uniqueIndex("weekly_settlement_snapshots_one_current_uidx")
      .on(table.clientWeekId)
      .where(sql`${table.status} = 'CURRENT'`),
    index("weekly_settlement_snapshots_week_id_idx").on(table.clientWeekId),
  ],
);

export const cuts = pgTable(
  "cuts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productionFormatId: uuid("production_format_id")
      .notNull()
      .references(() => productionFormats.id),
    number: text("number").notNull(),
    workPlan: text("work_plan").notNull(),
    style: text("style").notNull(),
    expectedQuantity: integer("expected_quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("cuts_format_number_uidx")
      .on(table.productionFormatId, table.number)
      .where(sql`${table.deletedAt} IS NULL`),
    index("cuts_production_format_id_idx").on(table.productionFormatId),
  ],
);

export const cutReceipts = pgTable(
  "cut_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cutId: uuid("cut_id")
      .notNull()
      .references(() => cuts.id, { onDelete: "cascade" }),
    /** Nullable only for legacy rows; new receipts require an OPEN client week. */
    clientWeekId: uuid("client_week_id").references(() => clientWeeks.id),
    folioNumber: text("folio_number").notNull(),
    partialNumber: integer("partial_number").notNull(),
    quantity: integer("quantity").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("cut_receipts_cut_partial_uidx").on(table.cutId, table.partialNumber),
    index("cut_receipts_cut_id_idx").on(table.cutId),
    index("cut_receipts_client_week_id_idx").on(table.clientWeekId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    number: text("number").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    brandId: uuid("brand_id").references(() => brands.id),
    pantTypeId: uuid("pant_type_id").references(() => pantTypes.id),
    /** @deprecated Legacy compatibility only. New logic uses SUM(order_cuts.assignedQuantity). */
    expectedQuantity: integer("expected_quantity").notNull(),
    productionFormatId: uuid("production_format_id").references(() => productionFormats.id),
    /** @deprecated Prefer order_cuts. Kept for migration safety. */
    cutId: uuid("cut_id").references(() => cuts.id),
    /** @deprecated Prefer order_cuts. Kept for migration safety. */
    assignedQuantity: integer("assigned_quantity"),
    purchaseOrder: text("purchase_order"),
    costPerGarment: numeric("cost_per_garment", { precision: 12, scale: 4 }),
    packagingType: text("packaging_type"),
    packageCount: integer("package_count"),
    unitsPerPackage: integer("units_per_package"),
    /** Week in which the order was created (not necessarily when movements occur). */
    createdInClientWeekId: uuid("created_in_client_week_id").references(() => clientWeeks.id),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("orders_client_number_uidx").on(table.clientId, table.number),
    index("orders_number_idx").on(table.number),
    index("orders_client_status_idx").on(table.clientId, table.status),
    index("orders_status_idx").on(table.status),
    index("orders_production_format_id_idx").on(table.productionFormatId),
    index("orders_cut_id_idx").on(table.cutId),
    index("orders_created_in_client_week_id_idx").on(table.createdInClientWeekId),
  ],
);

export const orderSizeBreakdowns = pgTable(
  "order_size_breakdowns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_size_breakdowns_order_size_uidx").on(table.orderId, table.sizeLabel),
    index("order_size_breakdowns_order_id_idx").on(table.orderId),
  ],
);

export const orderCuts = pgTable(
  "order_cuts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    cutId: uuid("cut_id")
      .notNull()
      .references(() => cuts.id),
    assignedQuantity: integer("assigned_quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_cuts_order_cut_uidx").on(table.orderId, table.cutId),
    index("order_cuts_order_id_idx").on(table.orderId),
    index("order_cuts_cut_id_idx").on(table.cutId),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("order_status_history_order_id_idx").on(table.orderId)],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** Nullable only for legacy rows; new movements require an OPEN client week. */
    clientWeekId: uuid("client_week_id").references(() => clientWeeks.id),
    type: text("type").notNull(),
    quantity: integer("quantity").notNull(),
    packagingType: text("packaging_type"),
    packageCount: integer("package_count"),
    unitsPerPackage: integer("units_per_package"),
    note: text("note"),
    destinationId: uuid("destination_id").references(() => destinations.id),
    cancelsMovementId: uuid("cancels_movement_id"),
    idempotencyKey: text("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [
    index("inventory_movements_order_created_idx").on(table.orderId, table.createdAt),
    index("inventory_movements_type_idx").on(table.type),
    index("inventory_movements_idempotency_idx").on(table.createdBy, table.idempotencyKey),
    index("inventory_movements_client_week_id_idx").on(table.clientWeekId),
  ],
);

export const movementCutAllocations = pgTable(
  "movement_cut_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => inventoryMovements.id, { onDelete: "cascade" }),
    orderCutId: uuid("order_cut_id")
      .notNull()
      .references(() => orderCuts.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("movement_cut_allocations_movement_order_cut_uidx").on(
      table.movementId,
      table.orderCutId,
    ),
    index("movement_cut_allocations_movement_id_idx").on(table.movementId),
    index("movement_cut_allocations_order_cut_id_idx").on(table.orderCutId),
  ],
);

export const movementSizeBreakdowns = pgTable(
  "movement_size_breakdowns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => inventoryMovements.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("movement_size_breakdowns_movement_size_uidx").on(
      table.movementId,
      table.sizeLabel,
    ),
    index("movement_size_breakdowns_movement_id_idx").on(table.movementId),
  ],
);
