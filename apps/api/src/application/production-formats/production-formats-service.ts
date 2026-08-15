import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import { clients, cuts, orders, productionFormats } from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";

export type ProductionFormatDto = {
  id: string;
  number: string;
  clientId: string | null;
  clientName: string | null;
  cutsCount: number;
  ordersCount: number;
  createdAt: string;
  updatedAt: string;
};

export class ProductionFormatsService {
  constructor(private readonly db: AppDb) {}

  async list(input: { q?: string; page: number; pageSize: number }) {
    const conditions = [isNull(productionFormats.deletedAt)];
    if (input.q?.trim()) {
      conditions.push(ilike(productionFormats.number, `%${input.q.trim()}%`));
    }
    const where = and(...conditions);
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRow] = await Promise.all([
      this.db
        .select({
          id: productionFormats.id,
          number: productionFormats.number,
          clientId: productionFormats.clientId,
          clientName: clients.name,
          createdAt: productionFormats.createdAt,
          updatedAt: productionFormats.updatedAt,
          cutsCount: sql<number>`cast(count(distinct ${cuts.id}) filter (where ${cuts.deletedAt} is null) as int)`,
          ordersCount: sql<number>`cast(count(distinct ${orders.id}) filter (where ${orders.deletedAt} is null) as int)`,
        })
        .from(productionFormats)
        .leftJoin(clients, eq(productionFormats.clientId, clients.id))
        .leftJoin(cuts, eq(cuts.productionFormatId, productionFormats.id))
        .leftJoin(orders, eq(orders.productionFormatId, productionFormats.id))
        .where(where)
        .groupBy(
          productionFormats.id,
          productionFormats.number,
          productionFormats.clientId,
          clients.name,
          productionFormats.createdAt,
          productionFormats.updatedAt,
        )
        .orderBy(desc(productionFormats.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(productionFormats)
        .where(where)
        .then((r) => r[0]),
    ]);

    return {
      items: rows.map((r) => this.toDto(r)),
      page: input.page,
      pageSize: input.pageSize,
      total: countRow?.count ?? 0,
    };
  }

  async getById(id: string): Promise<ProductionFormatDto> {
    const row = await this.db
      .select({
        id: productionFormats.id,
        number: productionFormats.number,
        clientId: productionFormats.clientId,
        clientName: clients.name,
        createdAt: productionFormats.createdAt,
        updatedAt: productionFormats.updatedAt,
        cutsCount: sql<number>`cast(count(distinct ${cuts.id}) filter (where ${cuts.deletedAt} is null) as int)`,
        ordersCount: sql<number>`cast(count(distinct ${orders.id}) filter (where ${orders.deletedAt} is null) as int)`,
      })
      .from(productionFormats)
      .leftJoin(clients, eq(productionFormats.clientId, clients.id))
      .leftJoin(cuts, eq(cuts.productionFormatId, productionFormats.id))
      .leftJoin(orders, eq(orders.productionFormatId, productionFormats.id))
      .where(and(eq(productionFormats.id, id), isNull(productionFormats.deletedAt)))
      .groupBy(
        productionFormats.id,
        productionFormats.number,
        productionFormats.clientId,
        clients.name,
        productionFormats.createdAt,
        productionFormats.updatedAt,
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!row) throw new NotFoundError("Formato de producción no encontrado");
    return this.toDto(row);
  }

  async create(
    input: { number: string; clientId: string },
    actorUserId: string,
  ): Promise<ProductionFormatDto> {
    const number = input.number.trim();
    if (!number) throw new AppError("VALIDATION_ERROR", "El número de formato es obligatorio");
    if (!input.clientId) {
      throw new AppError("VALIDATION_ERROR", "El cliente es obligatorio");
    }

    const client = await this.db.query.clients.findFirst({
      where: and(
        eq(clients.id, input.clientId),
        isNull(clients.deletedAt),
        eq(clients.isActive, true),
      ),
    });
    if (!client) throw new AppError("VALIDATION_ERROR", "Cliente inexistente o inactivo");

    const duplicate = await this.db.query.productionFormats.findFirst({
      where: and(eq(productionFormats.number, number), isNull(productionFormats.deletedAt)),
    });
    if (duplicate) throw new ConflictError("Ya existe un formato con ese número");

    const [created] = await this.db
      .insert(productionFormats)
      .values({
        number,
        clientId: input.clientId,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "production_formats.create",
      entityType: "production_format",
      entityId: created.id,
      metadata: { number, clientId: input.clientId },
    });

    return this.getById(created.id);
  }

  async update(
    id: string,
    input: { number?: string; clientId?: string },
    actorUserId: string,
  ): Promise<ProductionFormatDto> {
    const existing = await this.db.query.productionFormats.findFirst({
      where: and(eq(productionFormats.id, id), isNull(productionFormats.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Formato de producción no encontrado");

    const number =
      input.number !== undefined ? input.number.trim() : existing.number;
    if (!number) throw new AppError("VALIDATION_ERROR", "El número de formato es obligatorio");

    let clientId = existing.clientId;
    if (input.clientId !== undefined) {
      const client = await this.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          isNull(clients.deletedAt),
          eq(clients.isActive, true),
        ),
      });
      if (!client) throw new AppError("VALIDATION_ERROR", "Cliente inexistente o inactivo");
      clientId = input.clientId;
    }

    if (number !== existing.number) {
      const duplicate = await this.db.query.productionFormats.findFirst({
        where: and(eq(productionFormats.number, number), isNull(productionFormats.deletedAt)),
      });
      if (duplicate) throw new ConflictError("Ya existe un formato con ese número");
    }

    await this.db
      .update(productionFormats)
      .set({
        number,
        clientId,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(productionFormats.id, id));

    await writeAudit(this.db, {
      actorUserId,
      action: "production_formats.update",
      entityType: "production_format",
      entityId: id,
    });

    return this.getById(id);
  }

  async softDelete(id: string, actorUserId: string): Promise<void> {
    const existing = await this.db.query.productionFormats.findFirst({
      where: and(eq(productionFormats.id, id), isNull(productionFormats.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Formato de producción no encontrado");

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ deletedAt: now, updatedAt: now, updatedBy: actorUserId })
        .where(
          and(eq(orders.productionFormatId, id), isNull(orders.deletedAt)),
        );
      await tx
        .update(cuts)
        .set({ deletedAt: now, updatedAt: now, updatedBy: actorUserId })
        .where(and(eq(cuts.productionFormatId, id), isNull(cuts.deletedAt)));
      await tx
        .update(productionFormats)
        .set({ deletedAt: now, updatedAt: now, updatedBy: actorUserId })
        .where(eq(productionFormats.id, id));

      await writeAudit(tx, {
        actorUserId,
        action: "production_formats.delete",
        entityType: "production_format",
        entityId: id,
        metadata: { number: existing.number },
      });
    });
  }

  private toDto(r: {
    id: string;
    number: string;
    clientId: string | null;
    clientName: string | null;
    cutsCount: number | null;
    ordersCount: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProductionFormatDto {
    return {
      id: r.id,
      number: r.number,
      clientId: r.clientId,
      clientName: r.clientName,
      cutsCount: r.cutsCount ?? 0,
      ordersCount: r.ordersCount ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
