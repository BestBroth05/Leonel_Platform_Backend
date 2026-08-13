import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type {
  ClientWeekStatus,
  CutSettlementMetrics,
  MovementType,
  SnapshotStatus,
} from "@leonel-platform/shared";
import { computeCutSettlementMetrics } from "../../domain/cuts/cut-settlement.js";
import {
  rangesOverlap,
  toBusinessDateString,
} from "../../domain/weeks/business-dates.js";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  clientWeeks,
  clients,
  cutReceipts,
  cuts,
  inventoryMovements,
  movementCutAllocations,
  orderCuts,
  orders,
  productionFormats,
  weeklySettlementSnapshots,
} from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { lockOpenClientWeek, type Tx } from "./week-lock.js";

export type ClientWeekDto = {
  id: string;
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string | null;
  openedAt: string;
  closedAt: string | null;
  status: ClientWeekStatus;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotDto = {
  id: string;
  clientWeekId: string;
  version: number;
  status: SnapshotStatus;
  payload: Record<string, unknown>;
  closedAt: string;
  closedBy: string | null;
  invalidatedAt: string | null;
  invalidatedBy: string | null;
  createdAt: string;
};

export type WeekClosePreview = {
  clientWeekId: string;
  canClose: boolean;
  cuts: CutSettlementMetrics[];
  unsquaredCuts: CutSettlementMetrics[];
  weeklyBillableQuantity: number;
  weeklyBillableAmount: string;
};

export class ClientWeeksService {
  constructor(private readonly db: AppDb) {}

  async listByClient(clientId: string): Promise<ClientWeekDto[]> {
    await this.requireClient(clientId);
    const rows = await this.db
      .select({
        week: clientWeeks,
        clientName: clients.name,
      })
      .from(clientWeeks)
      .innerJoin(clients, eq(clientWeeks.clientId, clients.id))
      .where(eq(clientWeeks.clientId, clientId))
      .orderBy(desc(clientWeeks.openedAt));
    return rows.map((r) => this.toDto(r.week, r.clientName));
  }

  async getById(id: string): Promise<ClientWeekDto> {
    const row = await this.db
      .select({
        week: clientWeeks,
        clientName: clients.name,
      })
      .from(clientWeeks)
      .innerJoin(clients, eq(clientWeeks.clientId, clients.id))
      .where(eq(clientWeeks.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!row) throw new NotFoundError("Semana no encontrada");
    return this.toDto(row.week, row.clientName);
  }

  async getOpenWeek(clientId: string): Promise<ClientWeekDto | null> {
    await this.requireClient(clientId);
    const row = await this.db
      .select({
        week: clientWeeks,
        clientName: clients.name,
      })
      .from(clientWeeks)
      .innerJoin(clients, eq(clientWeeks.clientId, clients.id))
      .where(and(eq(clientWeeks.clientId, clientId), eq(clientWeeks.status, "OPEN")))
      .limit(1)
      .then((r) => r[0] ?? null);
    return row ? this.toDto(row.week, row.clientName) : null;
  }

  async openWeek(
    clientId: string,
    actorUserId: string,
    input?: { startDate?: string },
  ): Promise<ClientWeekDto> {
    await this.requireClient(clientId);
    const startDate = input?.startDate ?? toBusinessDateString(new Date());

    return this.db.transaction(async (tx) => {
      const existingOpen = await tx.query.clientWeeks.findFirst({
        where: and(eq(clientWeeks.clientId, clientId), eq(clientWeeks.status, "OPEN")),
      });
      if (existingOpen) {
        throw new ConflictError("El cliente ya tiene una semana OPEN");
      }

      const others = await tx
        .select()
        .from(clientWeeks)
        .where(eq(clientWeeks.clientId, clientId));
      for (const other of others) {
        if (rangesOverlap(startDate, null, other.startDate, other.endDate)) {
          throw new ConflictError(
            `El periodo se solapa con la semana ${other.startDate}${other.endDate ? `–${other.endDate}` : ""}.`,
          );
        }
      }

      const [created] = await tx
        .insert(clientWeeks)
        .values({
          clientId,
          startDate,
          endDate: null,
          openedAt: new Date(),
          status: "OPEN",
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "client_weeks.open",
        entityType: "client_week",
        entityId: created.id,
        metadata: { clientId, startDate },
      });

      const client = await this.requireClient(clientId);
      return this.toDto(created, client.name);
    });
  }

  async previewClose(weekId: string): Promise<WeekClosePreview> {
    const week = await this.db.query.clientWeeks.findFirst({
      where: eq(clientWeeks.id, weekId),
    });
    if (!week) throw new NotFoundError("Semana no encontrada");
    if (week.status !== "OPEN") {
      throw new ConflictError("Solo se puede previsualizar el cierre de una semana OPEN");
    }
    return this.buildClosePreview(this.db, week);
  }

  async closeWeek(weekId: string, actorUserId: string): Promise<{
    week: ClientWeekDto;
    snapshot: SnapshotDto;
    preview: WeekClosePreview;
  }> {
    return this.db.transaction(async (tx) => {
      const week = await lockOpenClientWeek(tx, weekId);

      // Lock participating cuts so settlement metrics cannot change mid-close.
      const participantIds = await this.listParticipantCutIds(tx, week.id);
      const sortedIds = [...participantIds].sort();
      for (const cutId of sortedIds) {
        await tx.execute(
          sql`select id from cuts where id = ${cutId} and deleted_at is null for update`,
        );
      }

      const preview = await this.buildClosePreview(tx, week);
      if (!preview.canClose) {
        throw new ConflictError(
          "No se puede cerrar la semana: hay cortes sin cuadrar.",
          {
            cuts: preview.cuts,
            unsquaredCuts: preview.unsquaredCuts,
          },
        );
      }

      const endDate = toBusinessDateString(new Date());
      const closedAt = new Date();

      const maxVersion = await tx
        .select({
          max: sql<number>`coalesce(max(${weeklySettlementSnapshots.version}), 0)`,
        })
        .from(weeklySettlementSnapshots)
        .where(eq(weeklySettlementSnapshots.clientWeekId, week.id))
        .then((r) => Number(r[0]?.max ?? 0));

      const payload = {
        clientWeekId: week.id,
        clientId: week.clientId,
        startDate: week.startDate,
        endDate,
        cuts: preview.cuts,
        weeklyBillableQuantity: preview.weeklyBillableQuantity,
        weeklyBillableAmount: preview.weeklyBillableAmount,
        closedAt: closedAt.toISOString(),
      };

      const [snapshot] = await tx
        .insert(weeklySettlementSnapshots)
        .values({
          clientWeekId: week.id,
          version: maxVersion + 1,
          status: "CURRENT",
          payload,
          closedAt,
          closedBy: actorUserId,
        })
        .returning();

      const [closed] = await tx
        .update(clientWeeks)
        .set({
          status: "CLOSED",
          endDate,
          closedAt,
          updatedAt: new Date(),
          updatedBy: actorUserId,
        })
        .where(eq(clientWeeks.id, week.id))
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "client_weeks.close",
        entityType: "client_week",
        entityId: week.id,
        metadata: {
          version: snapshot.version,
          weeklyBillableAmount: preview.weeklyBillableAmount,
        },
      });

      const client = await this.requireClient(week.clientId);
      return {
        week: this.toDto(closed, client.name),
        snapshot: this.toSnapshotDto(snapshot),
        preview,
      };
    });
  }

  async reopenWeek(weekId: string, actorUserId: string): Promise<ClientWeekDto> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from client_weeks where id = ${weekId} for update`);
      const week = await tx.query.clientWeeks.findFirst({
        where: eq(clientWeeks.id, weekId),
      });
      if (!week) throw new NotFoundError("Semana no encontrada");
      if (week.status !== "CLOSED") {
        throw new ConflictError("Solo se puede reabrir una semana CLOSED");
      }

      const openExists = await tx.query.clientWeeks.findFirst({
        where: and(
          eq(clientWeeks.clientId, week.clientId),
          eq(clientWeeks.status, "OPEN"),
        ),
      });
      if (openExists) {
        throw new ConflictError(
          "No se puede reabrir: el cliente ya tiene otra semana OPEN.",
        );
      }

      const later = await tx.query.clientWeeks.findFirst({
        where: and(
          eq(clientWeeks.clientId, week.clientId),
          ne(clientWeeks.id, week.id),
          sql`${clientWeeks.startDate} > ${week.startDate}`,
        ),
      });
      if (later) {
        throw new ConflictError(
          "Solo se puede reabrir la semana cerrada más reciente. Existe una semana posterior.",
          { laterWeekId: later.id, laterStartDate: later.startDate },
        );
      }

      // Preferentially only the most recent CLOSED week.
      const mostRecentClosed = await tx
        .select()
        .from(clientWeeks)
        .where(
          and(eq(clientWeeks.clientId, week.clientId), eq(clientWeeks.status, "CLOSED")),
        )
        .orderBy(desc(clientWeeks.startDate), desc(clientWeeks.closedAt))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (mostRecentClosed && mostRecentClosed.id !== week.id) {
        throw new ConflictError(
          "Solo se puede reabrir la semana cerrada más reciente.",
          { mostRecentClosedWeekId: mostRecentClosed.id },
        );
      }

      await tx
        .update(weeklySettlementSnapshots)
        .set({
          status: "INVALIDATED",
          invalidatedAt: new Date(),
          invalidatedBy: actorUserId,
        })
        .where(
          and(
            eq(weeklySettlementSnapshots.clientWeekId, week.id),
            eq(weeklySettlementSnapshots.status, "CURRENT"),
          ),
        );

      const [reopened] = await tx
        .update(clientWeeks)
        .set({
          status: "OPEN",
          endDate: null,
          closedAt: null,
          updatedAt: new Date(),
          updatedBy: actorUserId,
        })
        .where(eq(clientWeeks.id, week.id))
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "client_weeks.reopen",
        entityType: "client_week",
        entityId: week.id,
      });

      const client = await this.requireClient(week.clientId);
      return this.toDto(reopened, client.name);
    });
  }

  async getCurrentSnapshot(weekId: string): Promise<SnapshotDto | null> {
    const row = await this.db.query.weeklySettlementSnapshots.findFirst({
      where: and(
        eq(weeklySettlementSnapshots.clientWeekId, weekId),
        eq(weeklySettlementSnapshots.status, "CURRENT"),
      ),
    });
    return row ? this.toSnapshotDto(row) : null;
  }

  async listSnapshots(weekId: string): Promise<SnapshotDto[]> {
    const rows = await this.db
      .select()
      .from(weeklySettlementSnapshots)
      .where(eq(weeklySettlementSnapshots.clientWeekId, weekId))
      .orderBy(desc(weeklySettlementSnapshots.version));
    return rows.map(this.toSnapshotDto);
  }

  private async buildClosePreview(
    db: Tx | AppDb,
    week: typeof clientWeeks.$inferSelect,
  ): Promise<WeekClosePreview> {
    const participantIds = await this.listParticipantCutIds(db, week.id);
    const cutsMetrics: CutSettlementMetrics[] = [];

    for (const cutId of participantIds) {
      const cut = await db.query.cuts.findFirst({
        where: and(eq(cuts.id, cutId), isNull(cuts.deletedAt)),
      });
      if (!cut) continue;

      const totalReceived = await db
        .select({
          total: sql<number>`coalesce(sum(${cutReceipts.quantity}), 0)::int`,
        })
        .from(cutReceipts)
        .where(eq(cutReceipts.cutId, cutId))
        .then((r) => r[0]?.total ?? 0);

      const totalAssigned = await db
        .select({
          total: sql<number>`coalesce(sum(${orderCuts.assignedQuantity}), 0)::int`,
        })
        .from(orderCuts)
        .innerJoin(orders, eq(orderCuts.orderId, orders.id))
        .where(
          and(
            eq(orderCuts.cutId, cutId),
            isNull(orders.deletedAt),
            ne(orders.status, "CANCELLED"),
          ),
        )
        .then((r) => r[0]?.total ?? 0);

      const allocationRows = await db
        .select({
          type: inventoryMovements.type,
          quantity: movementCutAllocations.quantity,
          cancelledAt: inventoryMovements.cancelledAt,
          orderDeletedAt: orders.deletedAt,
          orderStatus: orders.status,
        })
        .from(movementCutAllocations)
        .innerJoin(
          inventoryMovements,
          eq(movementCutAllocations.movementId, inventoryMovements.id),
        )
        .innerJoin(orderCuts, eq(movementCutAllocations.orderCutId, orderCuts.id))
        .innerJoin(orders, eq(orderCuts.orderId, orders.id))
        .where(eq(orderCuts.cutId, cutId));

      const allocations = allocationRows
        .filter(
          (r) =>
            r.cancelledAt == null &&
            r.orderDeletedAt == null &&
            r.orderStatus !== "CANCELLED",
        )
        .map((r) => ({
          type: r.type as MovementType,
          quantity: r.quantity,
          cancelled: false,
        }));

      // Fallback when allocations are missing: attribute order-level movements
      // proportionally only if the order has a single cut assignment.
      if (allocations.length === 0) {
        const singleCutOrders = await db
          .select({
            orderId: orderCuts.orderId,
            assignedQuantity: orderCuts.assignedQuantity,
          })
          .from(orderCuts)
          .innerJoin(orders, eq(orderCuts.orderId, orders.id))
          .where(
            and(
              eq(orderCuts.cutId, cutId),
              isNull(orders.deletedAt),
              ne(orders.status, "CANCELLED"),
            ),
          );

        for (const oc of singleCutOrders) {
          const cutCount = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(orderCuts)
            .where(eq(orderCuts.orderId, oc.orderId))
            .then((r) => r[0]?.count ?? 0);
          if (cutCount !== 1) continue;

          const movs = await db
            .select()
            .from(inventoryMovements)
            .where(
              and(
                eq(inventoryMovements.orderId, oc.orderId),
                isNull(inventoryMovements.cancelledAt),
              ),
            );
          for (const m of movs) {
            allocations.push({
              type: m.type as MovementType,
              quantity: m.quantity,
              cancelled: false,
            });
          }
        }
      }

      cutsMetrics.push(
        computeCutSettlementMetrics({
          cutId,
          cutNumber: cut.number,
          totalReceivedByCut: totalReceived,
          totalAssignedByCut: totalAssigned,
          allocations,
        }),
      );
    }

    cutsMetrics.sort((a, b) => a.cutNumber.localeCompare(b.cutNumber));
    const unsquaredCuts = cutsMetrics.filter((c) => !c.squared);

    const billableRows = await db
      .select({
        quantity: inventoryMovements.quantity,
        costPerGarment: orders.costPerGarment,
      })
      .from(inventoryMovements)
      .innerJoin(orders, eq(inventoryMovements.orderId, orders.id))
      .where(
        and(
          eq(inventoryMovements.clientWeekId, week.id),
          isNull(inventoryMovements.cancelledAt),
          isNull(orders.deletedAt),
          ne(orders.status, "CANCELLED"),
          sql`${inventoryMovements.type} in ('PARTIAL_EXIT', 'FINAL_EXIT')`,
        ),
      );

    let weeklyBillableQuantity = 0;
    let weeklyBillableAmount = 0;
    for (const row of billableRows) {
      weeklyBillableQuantity += row.quantity;
      weeklyBillableAmount += row.quantity * Number(row.costPerGarment ?? 0);
    }

    return {
      clientWeekId: week.id,
      canClose: unsquaredCuts.length === 0,
      cuts: cutsMetrics,
      unsquaredCuts,
      weeklyBillableQuantity,
      weeklyBillableAmount: weeklyBillableAmount.toFixed(2),
    };
  }

  private async listParticipantCutIds(db: Tx | AppDb, weekId: string): Promise<string[]> {
    const fromReceipts = await db
      .select({ cutId: cutReceipts.cutId })
      .from(cutReceipts)
      .where(eq(cutReceipts.clientWeekId, weekId));

    const fromMovements = await db
      .select({ cutId: orderCuts.cutId })
      .from(movementCutAllocations)
      .innerJoin(
        inventoryMovements,
        eq(movementCutAllocations.movementId, inventoryMovements.id),
      )
      .innerJoin(orderCuts, eq(movementCutAllocations.orderCutId, orderCuts.id))
      .innerJoin(orders, eq(orderCuts.orderId, orders.id))
      .where(
        and(
          eq(inventoryMovements.clientWeekId, weekId),
          isNull(inventoryMovements.cancelledAt),
          isNull(orders.deletedAt),
          ne(orders.status, "CANCELLED"),
        ),
      );

    // Also include cuts linked via order movements in this week (covers single-cut orders).
    const fromOrderMovements = await db
      .select({ cutId: orderCuts.cutId })
      .from(inventoryMovements)
      .innerJoin(orders, eq(inventoryMovements.orderId, orders.id))
      .innerJoin(orderCuts, eq(orderCuts.orderId, orders.id))
      .where(
        and(
          eq(inventoryMovements.clientWeekId, weekId),
          isNull(inventoryMovements.cancelledAt),
          isNull(orders.deletedAt),
          ne(orders.status, "CANCELLED"),
        ),
      );

    return [
      ...new Set([
        ...fromReceipts.map((r: { cutId: string }) => r.cutId),
        ...fromMovements.map((r: { cutId: string }) => r.cutId),
        ...fromOrderMovements.map((r: { cutId: string }) => r.cutId),
      ]),
    ];
  }

  private async requireClient(clientId: string) {
    const client = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    });
    if (!client) throw new NotFoundError("Cliente no encontrado");
    return client;
  }

  private toDto(
    row: typeof clientWeeks.$inferSelect,
    clientName: string,
  ): ClientWeekDto {
    return {
      id: row.id,
      clientId: row.clientId,
      clientName,
      startDate: row.startDate,
      endDate: row.endDate,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      status: row.status as ClientWeekStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSnapshotDto = (
    row: typeof weeklySettlementSnapshots.$inferSelect,
  ): SnapshotDto => ({
    id: row.id,
    clientWeekId: row.clientWeekId,
    version: row.version,
    status: row.status as SnapshotStatus,
    payload: row.payload,
    closedAt: row.closedAt.toISOString(),
    closedBy: row.closedBy,
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    invalidatedBy: row.invalidatedBy,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Ensure format belongs to client (for ops validation). */
export async function requireFormatClientId(
  db: Tx | AppDb,
  productionFormatId: string,
): Promise<{ formatId: string; clientId: string }> {
  const format = await db.query.productionFormats.findFirst({
    where: and(
      eq(productionFormats.id, productionFormatId),
      isNull(productionFormats.deletedAt),
    ),
  });
  if (!format) throw new NotFoundError("Formato de producción no encontrado");
  if (!format.clientId) {
    throw new AppError(
      "INVALID_STATE",
      "El formato no tiene cliente asignado. Corrija el formato antes de operar.",
    );
  }
  return { formatId: format.id, clientId: format.clientId };
}
