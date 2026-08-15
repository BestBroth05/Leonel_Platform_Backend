import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import { brands, destinations, pantTypes } from "../../infrastructure/db/schema.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";

export type CatalogKind = "brands" | "pant-types" | "destinations";

export type CatalogItemDto = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CatalogItemDto {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class CatalogsService {
  constructor(private readonly db: AppDb) {}

  async list(kind: CatalogKind, activeOnly = false) {
    if (kind === "brands") {
      const conditions = [isNull(brands.deletedAt)];
      if (activeOnly) conditions.push(eq(brands.isActive, true));
      const rows = await this.db
        .select()
        .from(brands)
        .where(and(...conditions))
        .orderBy(asc(brands.name));
      return rows.map(toDto);
    }
    if (kind === "pant-types") {
      const conditions = [isNull(pantTypes.deletedAt)];
      if (activeOnly) conditions.push(eq(pantTypes.isActive, true));
      const rows = await this.db
        .select()
        .from(pantTypes)
        .where(and(...conditions))
        .orderBy(asc(pantTypes.name));
      return rows.map(toDto);
    }
    const conditions = [isNull(destinations.deletedAt)];
    if (activeOnly) conditions.push(eq(destinations.isActive, true));
    const rows = await this.db
      .select()
      .from(destinations)
      .where(and(...conditions))
      .orderBy(asc(destinations.name));
    return rows.map(toDto);
  }

  async create(kind: CatalogKind, name: string, actorUserId: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new ConflictError("El nombre es obligatorio");

    if (kind === "brands") {
      await this.assertUniqueBrand(trimmed);
      const [row] = await this.db.insert(brands).values({ name: trimmed }).returning();
      await this.audit(actorUserId, kind, "create", row.id, { name: trimmed });
      return toDto(row);
    }

    if (kind === "pant-types") {
      await this.assertUniquePantType(trimmed);
      const [row] = await this.db.insert(pantTypes).values({ name: trimmed }).returning();
      await this.audit(actorUserId, kind, "create", row.id, { name: trimmed });
      return toDto(row);
    }

    await this.assertUniqueDestination(trimmed);
    const [row] = await this.db.insert(destinations).values({ name: trimmed }).returning();
    await this.audit(actorUserId, kind, "create", row.id, { name: trimmed });
    return toDto(row);
  }

  async update(
    kind: CatalogKind,
    id: string,
    input: { name?: string; isActive?: boolean },
    actorUserId: string,
  ) {
    if (kind === "brands") {
      const existing = await this.db.query.brands.findFirst({
        where: and(eq(brands.id, id), isNull(brands.deletedAt)),
      });
      if (!existing) throw new NotFoundError("Marca no encontrada");
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed) throw new ConflictError("El nombre es obligatorio");
        await this.assertUniqueBrand(trimmed, id);
      }
      const [row] = await this.db
        .update(brands)
        .set({
          name: input.name !== undefined ? input.name.trim() : existing.name,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(brands.id, id))
        .returning();
      await this.audit(actorUserId, kind, "update", id);
      return toDto(row);
    }

    if (kind === "pant-types") {
      const existing = await this.db.query.pantTypes.findFirst({
        where: and(eq(pantTypes.id, id), isNull(pantTypes.deletedAt)),
      });
      if (!existing) throw new NotFoundError("Tipo no encontrado");
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed) throw new ConflictError("El nombre es obligatorio");
        await this.assertUniquePantType(trimmed, id);
      }
      const [row] = await this.db
        .update(pantTypes)
        .set({
          name: input.name !== undefined ? input.name.trim() : existing.name,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(pantTypes.id, id))
        .returning();
      await this.audit(actorUserId, kind, "update", id);
      return toDto(row);
    }

    const existing = await this.db.query.destinations.findFirst({
      where: and(eq(destinations.id, id), isNull(destinations.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Destino no encontrado");
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw new ConflictError("El nombre es obligatorio");
      await this.assertUniqueDestination(trimmed, id);
    }
    const [row] = await this.db
      .update(destinations)
      .set({
        name: input.name !== undefined ? input.name.trim() : existing.name,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(destinations.id, id))
      .returning();
    await this.audit(actorUserId, kind, "update", id);
    return toDto(row);
  }

  async softDelete(kind: CatalogKind, id: string, actorUserId: string): Promise<void> {
    const now = new Date();
    if (kind === "brands") {
      const existing = await this.db.query.brands.findFirst({
        where: and(eq(brands.id, id), isNull(brands.deletedAt)),
      });
      if (!existing) throw new NotFoundError("Marca no encontrada");
      await this.db
        .update(brands)
        .set({ deletedAt: now, isActive: false, updatedAt: now })
        .where(eq(brands.id, id));
      await this.audit(actorUserId, kind, "delete", id, { name: existing.name });
      return;
    }
    if (kind === "pant-types") {
      const existing = await this.db.query.pantTypes.findFirst({
        where: and(eq(pantTypes.id, id), isNull(pantTypes.deletedAt)),
      });
      if (!existing) throw new NotFoundError("Tipo no encontrado");
      await this.db
        .update(pantTypes)
        .set({ deletedAt: now, isActive: false, updatedAt: now })
        .where(eq(pantTypes.id, id));
      await this.audit(actorUserId, kind, "delete", id, { name: existing.name });
      return;
    }
    const existing = await this.db.query.destinations.findFirst({
      where: and(eq(destinations.id, id), isNull(destinations.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Destino no encontrado");
    await this.db
      .update(destinations)
      .set({ deletedAt: now, isActive: false, updatedAt: now })
      .where(eq(destinations.id, id));
    await this.audit(actorUserId, kind, "delete", id, { name: existing.name });
  }

  private async assertUniqueBrand(name: string, excludeId?: string) {
    const existing = await this.db.query.brands.findFirst({
      where: and(
        eq(brands.name, name),
        isNull(brands.deletedAt),
        excludeId ? ne(brands.id, excludeId) : undefined,
      ),
    });
    if (existing) throw new ConflictError("Ya existe una marca con ese nombre");
  }

  private async assertUniquePantType(name: string, excludeId?: string) {
    const existing = await this.db.query.pantTypes.findFirst({
      where: and(
        eq(pantTypes.name, name),
        isNull(pantTypes.deletedAt),
        excludeId ? ne(pantTypes.id, excludeId) : undefined,
      ),
    });
    if (existing) throw new ConflictError("Ya existe un tipo con ese nombre");
  }

  private async assertUniqueDestination(name: string, excludeId?: string) {
    const existing = await this.db.query.destinations.findFirst({
      where: and(
        eq(destinations.name, name),
        isNull(destinations.deletedAt),
        excludeId ? ne(destinations.id, excludeId) : undefined,
      ),
    });
    if (existing) throw new ConflictError("Ya existe un destino con ese nombre");
  }

  private async audit(
    actorUserId: string,
    kind: CatalogKind,
    action: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ) {
    await writeAudit(this.db, {
      actorUserId,
      action: `catalogs.${kind}.${action}`,
      entityType: kind,
      entityId,
      metadata,
    });
  }
}
