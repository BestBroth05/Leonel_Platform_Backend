import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { CutStatus } from "@leonel-platform/shared";
import { computeCutMetrics } from "../../domain/cuts/cut-metrics.js";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  cutReceipts,
  cuts,
  orderCuts,
  orders,
  productionFormats,
} from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import {
  lockOpenWeekForClient,
  validateEffectiveAgainstOpenWeek,
} from "../client-weeks/week-lock.js";
import { requireFormatClientId } from "../client-weeks/client-weeks-service.js";

export type CutDto = {
  id: string;
  productionFormatId: string;
  number: string;
  workPlan: string;
  style: string;
  expectedQuantity: number;
  totalReceived: number;
  totalAssigned: number;
  availableToAssign: number;
  pendingQuantity: number;
  partialsCount: number;
  status: CutStatus;
  createdAt: string;
  updatedAt: string;
};

export type CutOrderAssignmentDto = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  assignedQuantity: number;
};

export type CutReceiptDto = {
  id: string;
  cutId: string;
  clientWeekId: string | null;
  folioNumber: string;
  partialNumber: number;
  quantity: number;
  receivedAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tx = Pick<AppDb, "execute" | "select" | "insert" | "update" | "delete" | "query">;

export class CutsService {
  constructor(private readonly db: AppDb) {}

  async listByFormat(productionFormatId: string): Promise<CutDto[]> {
    await this.requireFormat(productionFormatId);
    const rows = await this.db
      .select()
      .from(cuts)
      .where(and(eq(cuts.productionFormatId, productionFormatId), isNull(cuts.deletedAt)))
      .orderBy(desc(cuts.createdAt));

    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async getById(id: string): Promise<CutDto> {
    const row = await this.db.query.cuts.findFirst({
      where: and(eq(cuts.id, id), isNull(cuts.deletedAt)),
    });
    if (!row) throw new NotFoundError("Corte no encontrado");
    return this.toDto(row);
  }

  async create(
    productionFormatId: string,
    input: {
      number: string;
      workPlan: string;
      style: string;
      expectedQuantity: number;
    },
    actorUserId: string,
  ): Promise<CutDto> {
    await this.requireFormat(productionFormatId);
    const number = input.number.trim();
    const workPlan = input.workPlan.trim();
    const style = input.style.trim();
    if (!number) throw new AppError("VALIDATION_ERROR", "El número de corte es obligatorio");
    if (!workPlan) throw new AppError("VALIDATION_ERROR", "El plan de trabajo es obligatorio");
    if (!style) throw new AppError("VALIDATION_ERROR", "El estilo es obligatorio");
    if (!Number.isInteger(input.expectedQuantity) || input.expectedQuantity <= 0) {
      throw new AppError("VALIDATION_ERROR", "La cantidad esperada debe ser un entero > 0");
    }

    const duplicate = await this.db.query.cuts.findFirst({
      where: and(
        eq(cuts.productionFormatId, productionFormatId),
        eq(cuts.number, number),
        isNull(cuts.deletedAt),
      ),
    });
    if (duplicate) throw new ConflictError("Ya existe un corte con ese número en el formato");

    const [created] = await this.db
      .insert(cuts)
      .values({
        productionFormatId,
        number,
        workPlan,
        style,
        expectedQuantity: input.expectedQuantity,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "cuts.create",
      entityType: "cut",
      entityId: created.id,
      metadata: { productionFormatId, number },
    });

    return this.toDto(created);
  }

  async update(
    id: string,
    input: {
      number?: string;
      workPlan?: string;
      style?: string;
      expectedQuantity?: number;
    },
    actorUserId: string,
  ): Promise<CutDto> {
    const existing = await this.db.query.cuts.findFirst({
      where: and(eq(cuts.id, id), isNull(cuts.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Corte no encontrado");

    const number = input.number !== undefined ? input.number.trim() : existing.number;
    const workPlan =
      input.workPlan !== undefined ? input.workPlan.trim() : existing.workPlan;
    const style = input.style !== undefined ? input.style.trim() : existing.style;
    const expectedQuantity = input.expectedQuantity ?? existing.expectedQuantity;

    if (!number || !workPlan || !style) {
      throw new AppError("VALIDATION_ERROR", "Número, plan de trabajo y estilo son obligatorios");
    }
    if (!Number.isInteger(expectedQuantity) || expectedQuantity <= 0) {
      throw new AppError("VALIDATION_ERROR", "La cantidad esperada debe ser un entero > 0");
    }

    if (number !== existing.number) {
      const duplicate = await this.db.query.cuts.findFirst({
        where: and(
          eq(cuts.productionFormatId, existing.productionFormatId),
          eq(cuts.number, number),
          isNull(cuts.deletedAt),
        ),
      });
      if (duplicate) throw new ConflictError("Ya existe un corte con ese número en el formato");
    }

    const [updated] = await this.db
      .update(cuts)
      .set({
        number,
        workPlan,
        style,
        expectedQuantity,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(cuts.id, id))
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "cuts.update",
      entityType: "cut",
      entityId: id,
    });

    return this.toDto(updated);
  }

  async softDelete(id: string, actorUserId: string): Promise<void> {
    const existing = await this.db.query.cuts.findFirst({
      where: and(eq(cuts.id, id), isNull(cuts.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Corte no encontrado");

    const assignedOrders = await this.db
      .select({ orderId: orderCuts.orderId })
      .from(orderCuts)
      .innerJoin(orders, eq(orderCuts.orderId, orders.id))
      .where(
        and(
          eq(orderCuts.cutId, id),
          isNull(orders.deletedAt),
          ne(orders.status, "CANCELLED"),
        ),
      )
      .limit(1);
    if (assignedOrders.length > 0) {
      throw new ConflictError(
        "No se puede eliminar: el corte está asignado a pedidos activos. Elimina o cancela esos pedidos primero.",
      );
    }

    const now = new Date();
    await this.db
      .update(cuts)
      .set({ deletedAt: now, updatedAt: now, updatedBy: actorUserId })
      .where(eq(cuts.id, id));

    await writeAudit(this.db, {
      actorUserId,
      action: "cuts.delete",
      entityType: "cut",
      entityId: id,
      metadata: { number: existing.number },
    });
  }

  async listReceipts(cutId: string): Promise<CutReceiptDto[]> {
    await this.getById(cutId);
    const rows = await this.db
      .select()
      .from(cutReceipts)
      .where(eq(cutReceipts.cutId, cutId))
      .orderBy(asc(cutReceipts.partialNumber));
    return rows.map(this.toReceiptDto);
  }

  async createReceipt(
    cutId: string,
    input: {
      folioNumber: string;
      quantity: number;
      receivedAt?: string | Date;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<CutReceiptDto> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new AppError("VALIDATION_ERROR", "La cantidad recibida debe ser un entero > 0");
    }
    const folioNumber = input.folioNumber.trim();
    if (!folioNumber) throw new AppError("VALIDATION_ERROR", "El folio es obligatorio");

    return this.db.transaction(async (tx) => {
      const cut = await this.lockCut(tx, cutId);
      const { clientId } = await requireFormatClientId(tx, cut.productionFormatId);
      const week = await lockOpenWeekForClient(tx, clientId);
      const receivedAt = validateEffectiveAgainstOpenWeek(
        week,
        input.receivedAt ?? new Date(),
      );

      const maxPartial = await tx
        .select({
          max: sql<number>`coalesce(max(${cutReceipts.partialNumber}), 0)`,
        })
        .from(cutReceipts)
        .where(eq(cutReceipts.cutId, cutId))
        .then((r) => r[0]?.max ?? 0);

      const partialNumber = Number(maxPartial) + 1;
      if (partialNumber <= 0) {
        throw new AppError("VALIDATION_ERROR", "El número de parcial debe ser > 0");
      }

      const [created] = await tx
        .insert(cutReceipts)
        .values({
          cutId,
          clientWeekId: week.id,
          folioNumber,
          partialNumber,
          quantity: input.quantity,
          receivedAt,
          notes: input.notes?.trim() || null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "cut_receipts.create",
        entityType: "cut_receipt",
        entityId: created.id,
        metadata: {
          cutId,
          partialNumber,
          quantity: input.quantity,
          clientWeekId: week.id,
        },
      });

      return this.toReceiptDto(created);
    });
  }

  async updateReceipt(
    receiptId: string,
    input: {
      folioNumber?: string;
      quantity?: number;
      receivedAt?: string | Date;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<CutReceiptDto> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.cutReceipts.findFirst({
        where: eq(cutReceipts.id, receiptId),
      });
      if (!existing) throw new NotFoundError("Recepción no encontrada");

      const cut = await this.lockCut(tx, existing.cutId);
      const { clientId } = await requireFormatClientId(tx, cut.productionFormatId);
      const week = await lockOpenWeekForClient(tx, clientId);
      if (existing.clientWeekId && existing.clientWeekId !== week.id) {
        throw new ConflictError(
          "No se puede modificar una recepción de otra semana sin reabrirla.",
        );
      }
      const receivedAt =
        input.receivedAt !== undefined
          ? validateEffectiveAgainstOpenWeek(week, input.receivedAt)
          : existing.receivedAt;

      const quantity = input.quantity ?? existing.quantity;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError("VALIDATION_ERROR", "La cantidad recibida debe ser un entero > 0");
      }

      const folioNumber =
        input.folioNumber !== undefined
          ? input.folioNumber.trim()
          : existing.folioNumber;
      if (!folioNumber) throw new AppError("VALIDATION_ERROR", "El folio es obligatorio");

      const nextReceived = await this.sumReceived(tx, existing.cutId, receiptId);
      const resultingReceived = nextReceived + quantity;
      const totalAssigned = await this.sumAssigned(tx, existing.cutId);
      if (resultingReceived < totalAssigned) {
        const deficit = totalAssigned - resultingReceived;
        throw new ConflictError(
          `No se puede reducir la recepción: recibido quedaría en ${resultingReceived}, asignado ${totalAssigned}. Debe liberar ${deficit} prendas de pedidos antes de modificar.`,
        );
      }

      const [updated] = await tx
        .update(cutReceipts)
        .set({
          folioNumber,
          quantity,
          clientWeekId: existing.clientWeekId ?? week.id,
          receivedAt,
          notes:
            input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
          updatedAt: new Date(),
          updatedBy: actorUserId,
        })
        .where(eq(cutReceipts.id, receiptId))
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "cut_receipts.update",
        entityType: "cut_receipt",
        entityId: receiptId,
      });

      return this.toReceiptDto(updated);
    });
  }

  async deleteReceipt(receiptId: string, actorUserId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx.query.cutReceipts.findFirst({
        where: eq(cutReceipts.id, receiptId),
      });
      if (!existing) throw new NotFoundError("Recepción no encontrada");

      const cut = await this.lockCut(tx, existing.cutId);
      const { clientId } = await requireFormatClientId(tx, cut.productionFormatId);
      const week = await lockOpenWeekForClient(tx, clientId);
      if (existing.clientWeekId && existing.clientWeekId !== week.id) {
        throw new ConflictError(
          "No se puede eliminar una recepción de otra semana sin reabrirla.",
        );
      }

      const nextReceived = await this.sumReceived(tx, existing.cutId, receiptId);
      const totalAssigned = await this.sumAssigned(tx, existing.cutId);
      if (nextReceived < totalAssigned) {
        const deficit = totalAssigned - nextReceived;
        throw new ConflictError(
          `No se puede eliminar la recepción: recibido quedaría en ${nextReceived}, asignado ${totalAssigned}. Debe liberar ${deficit} prendas de pedidos antes de modificar.`,
        );
      }

      await tx.delete(cutReceipts).where(eq(cutReceipts.id, receiptId));

      await writeAudit(tx, {
        actorUserId,
        action: "cut_receipts.delete",
        entityType: "cut_receipt",
        entityId: receiptId,
        metadata: { cutId: existing.cutId },
      });
    });
  }

  async listOrdersUsingCut(cutId: string): Promise<CutOrderAssignmentDto[]> {
    await this.getById(cutId);
    const rows = await this.db
      .select({
        orderId: orders.id,
        orderNumber: orders.number,
        orderStatus: orders.status,
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
      )
      .orderBy(desc(orders.createdAt));
    return rows;
  }

  private async lockCut(tx: Tx, cutId: string) {
    await tx.execute(
      sql`select id from cuts where id = ${cutId} and deleted_at is null for update`,
    );
    const cut = await tx.query.cuts.findFirst({
      where: and(eq(cuts.id, cutId), isNull(cuts.deletedAt)),
    });
    if (!cut) throw new NotFoundError("Corte no encontrado");
    return cut;
  }

  private async sumReceived(tx: Tx, cutId: string, excludeReceiptId?: string) {
    const conditions = [eq(cutReceipts.cutId, cutId)];
    if (excludeReceiptId) {
      conditions.push(ne(cutReceipts.id, excludeReceiptId));
    }
    const row = await tx
      .select({
        total: sql<number>`coalesce(sum(${cutReceipts.quantity}), 0)::int`,
      })
      .from(cutReceipts)
      .where(and(...conditions))
      .then((r) => r[0]);
    return row?.total ?? 0;
  }

  private async sumAssigned(tx: Tx, cutId: string, excludeOrderId?: string) {
    const conditions = [
      eq(orderCuts.cutId, cutId),
      isNull(orders.deletedAt),
      ne(orders.status, "CANCELLED"),
    ];
    if (excludeOrderId) {
      conditions.push(ne(orderCuts.orderId, excludeOrderId));
    }
    const row = await tx
      .select({
        total: sql<number>`coalesce(sum(${orderCuts.assignedQuantity}), 0)::int`,
      })
      .from(orderCuts)
      .innerJoin(orders, eq(orderCuts.orderId, orders.id))
      .where(and(...conditions))
      .then((r) => r[0]);
    return row?.total ?? 0;
  }

  private async requireFormat(id: string) {
    const format = await this.db.query.productionFormats.findFirst({
      where: and(eq(productionFormats.id, id), isNull(productionFormats.deletedAt)),
    });
    if (!format) throw new NotFoundError("Formato de producción no encontrado");
    return format;
  }

  private async toDto(row: typeof cuts.$inferSelect): Promise<CutDto> {
    const [receivedRow, assignedRow, partialsRow] = await Promise.all([
      this.db
        .select({
          total: sql<number>`coalesce(sum(${cutReceipts.quantity}), 0)::int`,
        })
        .from(cutReceipts)
        .where(eq(cutReceipts.cutId, row.id))
        .then((r) => r[0]),
      this.db
        .select({
          total: sql<number>`coalesce(sum(${orderCuts.assignedQuantity}), 0)::int`,
        })
        .from(orderCuts)
        .innerJoin(orders, eq(orderCuts.orderId, orders.id))
        .where(
          and(
            eq(orderCuts.cutId, row.id),
            isNull(orders.deletedAt),
            ne(orders.status, "CANCELLED"),
          ),
        )
        .then((r) => r[0]),
      this.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(cutReceipts)
        .where(eq(cutReceipts.cutId, row.id))
        .then((r) => r[0]),
    ]);

    const metrics = computeCutMetrics({
      expectedQuantity: row.expectedQuantity,
      totalReceived: receivedRow?.total ?? 0,
      totalAssigned: assignedRow?.total ?? 0,
    });

    return {
      id: row.id,
      productionFormatId: row.productionFormatId,
      number: row.number,
      workPlan: row.workPlan,
      style: row.style,
      expectedQuantity: row.expectedQuantity,
      totalReceived: metrics.totalReceived,
      totalAssigned: metrics.totalAssigned,
      availableToAssign: metrics.availableToAssign,
      pendingQuantity: metrics.pendingQuantity,
      partialsCount: partialsRow?.count ?? 0,
      status: metrics.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReceiptDto = (row: typeof cutReceipts.$inferSelect): CutReceiptDto => ({
    id: row.id,
    cutId: row.cutId,
    clientWeekId: row.clientWeekId,
    folioNumber: row.folioNumber,
    partialNumber: row.partialNumber,
    quantity: row.quantity,
    receivedAt: row.receivedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
