import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { WEEKDAYS, type Weekday } from "@leonel-platform/shared";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import { clients, productionFormats } from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";

export type ClientDto = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  rfc: string | null;
  notes: string | null;
  weekOpensOn: Weekday | null;
  weekClosesOn: Weekday | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function parseWeekday(value: string | null | undefined, field: string): Weekday | null {
  if (value == null || value === "") return null;
  if (!(WEEKDAYS as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser un día de la semana válido`);
  }
  return value as Weekday;
}

function toDto(row: typeof clients.$inferSelect): ClientDto {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    email: row.email,
    rfc: row.rfc,
    notes: row.notes,
    weekOpensOn: (row.weekOpensOn as Weekday | null) ?? null,
    weekClosesOn: (row.weekClosesOn as Weekday | null) ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ClientsService {
  constructor(private readonly db: AppDb) {}

  async list(input: {
    q?: string;
    activeOnly?: boolean;
    page: number;
    pageSize: number;
  }) {
    const conditions = [isNull(clients.deletedAt)];
    if (input.activeOnly) {
      conditions.push(eq(clients.isActive, true));
    }
    if (input.q?.trim()) {
      conditions.push(ilike(clients.name, `%${input.q.trim()}%`));
    }

    const where = and(...conditions);
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRow] = await Promise.all([
      this.db
        .select()
        .from(clients)
        .where(where)
        .orderBy(desc(clients.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(clients)
        .where(where)
        .then((r) => r[0]),
    ]);

    return {
      items: rows.map(toDto),
      page: input.page,
      pageSize: input.pageSize,
      total: countRow?.count ?? 0,
    };
  }

  async getById(id: string): Promise<ClientDto> {
    const row = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, id), isNull(clients.deletedAt)),
    });
    if (!row) throw new NotFoundError("Cliente no encontrado");
    return toDto(row);
  }

  async create(
    input: {
      name: string;
      contactName?: string | null;
      email?: string | null;
      rfc?: string | null;
      notes?: string | null;
      weekOpensOn?: string | null;
      weekClosesOn?: string | null;
    },
    actorUserId: string,
  ): Promise<ClientDto> {
    const name = input.name.trim();
    if (!name) throw new ConflictError("El nombre es obligatorio");

    const weekOpensOn = parseWeekday(input.weekOpensOn, "El día de apertura");
    const weekClosesOn = parseWeekday(input.weekClosesOn, "El día de cierre");

    const [row] = await this.db
      .insert(clients)
      .values({
        name,
        contactName: input.contactName?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        rfc: input.rfc?.trim().toUpperCase() || null,
        notes: input.notes?.trim() || null,
        weekOpensOn,
        weekClosesOn,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "clients.create",
      entityType: "client",
      entityId: row.id,
      metadata: { name: row.name },
    });

    return toDto(row);
  }

  async update(
    id: string,
    input: {
      name?: string;
      contactName?: string | null;
      email?: string | null;
      rfc?: string | null;
      notes?: string | null;
      weekOpensOn?: string | null;
      weekClosesOn?: string | null;
      isActive?: boolean;
    },
    actorUserId: string,
  ): Promise<ClientDto> {
    const existing = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, id), isNull(clients.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Cliente no encontrado");

    const weekOpensOn =
      input.weekOpensOn !== undefined
        ? parseWeekday(input.weekOpensOn, "El día de apertura")
        : (existing.weekOpensOn as Weekday | null);
    const weekClosesOn =
      input.weekClosesOn !== undefined
        ? parseWeekday(input.weekClosesOn, "El día de cierre")
        : (existing.weekClosesOn as Weekday | null);

    const [row] = await this.db
      .update(clients)
      .set({
        name: input.name !== undefined ? input.name.trim() : existing.name,
        contactName:
          input.contactName !== undefined
            ? input.contactName?.trim() || null
            : existing.contactName,
        email:
          input.email !== undefined
            ? input.email?.trim().toLowerCase() || null
            : existing.email,
        rfc:
          input.rfc !== undefined
            ? input.rfc?.trim().toUpperCase() || null
            : existing.rfc,
        notes:
          input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
        weekOpensOn,
        weekClosesOn,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(clients.id, id))
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "clients.update",
      entityType: "client",
      entityId: id,
    });

    return toDto(row);
  }

  async softDelete(id: string, actorUserId: string): Promise<void> {
    const existing = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, id), isNull(clients.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Cliente no encontrado");

    const formatCount = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(productionFormats)
      .where(
        and(eq(productionFormats.clientId, id), isNull(productionFormats.deletedAt)),
      )
      .then((r) => r[0]?.count ?? 0);
    if (formatCount > 0) {
      throw new ConflictError(
        `No se puede eliminar: el cliente tiene ${formatCount} formato(s). Elimínalos primero.`,
      );
    }

    const now = new Date();
    await this.db
      .update(clients)
      .set({
        deletedAt: now,
        isActive: false,
        updatedAt: now,
        updatedBy: actorUserId,
      })
      .where(eq(clients.id, id));

    await writeAudit(this.db, {
      actorUserId,
      action: "clients.delete",
      entityType: "client",
      entityId: id,
      metadata: { name: existing.name },
    });
  }
}
