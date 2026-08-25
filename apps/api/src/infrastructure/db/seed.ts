import { eq } from "drizzle-orm";
import argon2 from "argon2";
import { PERMISSIONS } from "@leonel-platform/shared";
import { closeDb, getDb } from "./client.js";
import {
  auditLogs,
  brands,
  destinations,
  pantTypes,
  permissions,
  rolePermissions,
  roles,
  users,
} from "./schema.js";

async function main() {
  const env = process.env.LEONEL_PLATFORM_ENV ?? process.env.NODE_ENV ?? "local";
  const isProduction = env === "production" || env === "prod";
  const seedOnBoot = process.env.SEED_ON_BOOT === "true";

  // Production: only allow bootstrap when SEED_ON_BOOT=true (idempotent admin/roles).
  if (isProduction && !seedOnBoot) {
    console.error(
      "[seed] Refusing to run in production without SEED_ON_BOOT=true.",
    );
    process.exit(1);
  }

  const db = getDb();
  const adminEmail = (
    process.env.ADMIN_EMAIL ?? "admin@leonel-platform.local"
  ).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Pass123!";
  const adminName = process.env.ADMIN_NAME ?? "Administrador";

  const roleDefs = [
    { slug: "admin", name: "Administrador" },
    { slug: "manager", name: "Encargado" },
    { slug: "viewer", name: "Consulta" },
  ] as const;

  const permissionDefs = [
    { key: PERMISSIONS.USERS_READ, description: "Ver usuarios" },
    { key: PERMISSIONS.USERS_WRITE, description: "Administrar usuarios" },
    { key: PERMISSIONS.AUDIT_READ, description: "Ver auditoría" },
    { key: PERMISSIONS.CLIENTS_READ, description: "Ver clientes" },
    { key: PERMISSIONS.CLIENTS_WRITE, description: "Administrar clientes" },
    { key: PERMISSIONS.CATALOGS_READ, description: "Ver catálogos" },
    { key: PERMISSIONS.CATALOGS_WRITE, description: "Administrar catálogos" },
    { key: PERMISSIONS.ORDERS_READ, description: "Ver pedidos" },
    { key: PERMISSIONS.ORDERS_WRITE, description: "Administrar pedidos" },
    { key: PERMISSIONS.INVENTORY_READ, description: "Ver inventario" },
    { key: PERMISSIONS.INVENTORY_WRITE, description: "Registrar movimientos" },
    { key: PERMISSIONS.INVENTORY_CORRECT, description: "Corregir/cancelar movimientos" },
  ];

  for (const role of roleDefs) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.slug, role.slug) });
    if (!existing) {
      await db.insert(roles).values(role);
    }
  }

  for (const permission of permissionDefs) {
    const existing = await db.query.permissions.findFirst({
      where: eq(permissions.key, permission.key),
    });
    if (!existing) {
      await db.insert(permissions).values(permission);
    }
  }

  const allRoles = await db.select().from(roles);
  const allPermissions = await db.select().from(permissions);
  const adminRole = allRoles.find((r) => r.slug === "admin");
  if (!adminRole) {
    throw new Error("Admin role missing after seed");
  }

  const managerKeys = [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.CLIENTS_WRITE,
    PERMISSIONS.CATALOGS_READ,
    PERMISSIONS.CATALOGS_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
  ];

  const viewerKeys = [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.CATALOGS_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.INVENTORY_READ,
  ];

  for (const role of allRoles) {
    const keys =
      role.slug === "admin"
        ? allPermissions.map((p) => p.key)
        : role.slug === "manager"
          ? managerKeys
          : viewerKeys;

    for (const key of keys) {
      const permission = allPermissions.find((p) => p.key === key);
      if (!permission) continue;
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: permission.id })
        .onConflictDoNothing();
    }
  }

  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, adminEmail),
  });

  if (!existingAdmin) {
    const passwordHash = await argon2.hash(adminPassword);
    const [created] = await db
      .insert(users)
      .values({
        email: adminEmail,
        name: adminName,
        passwordHash,
        roleId: adminRole.id,
        isActive: true,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: created.id,
      action: "seed.admin_created",
      entityType: "user",
      entityId: created.id,
      metadata: { email: adminEmail },
    });
    console.log(`[seed] Admin user created: ${adminEmail}`);
  } else {
    // Idempotent: never recreate. Local/CI may refresh password; production leaves it alone.
    if (!isProduction) {
      const passwordHash = await argon2.hash(adminPassword);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, existingAdmin.id));
      console.log(`[seed] Admin password refreshed: ${adminEmail}`);
    } else {
      console.log(`[seed] Admin already exists (skipped): ${adminEmail}`);
    }
  }

  // Sample catalogs + demo data only outside production.
  if (!isProduction) {
    for (const name of ["Denim", "Premium", "Genérica"]) {
      const existing = await db.query.brands.findFirst({ where: eq(brands.name, name) });
      if (!existing) await db.insert(brands).values({ name });
    }
    for (const name of ["Mezclilla", "Gabardina"]) {
      const existing = await db.query.pantTypes.findFirst({
        where: eq(pantTypes.name, name),
      });
      if (!existing) await db.insert(pantTypes).values({ name });
    }
    for (const name of ["CD Norte", "Tienda Centro"]) {
      const existing = await db.query.destinations.findFirst({
        where: eq(destinations.name, name),
      });
      if (!existing) await db.insert(destinations).values({ name });
    }
    console.log("[seed] Catalog samples ensured");

    const { runDemoSeed } = await import("./seed-demo.js");
    await runDemoSeed(db);
  } else {
    console.log("[seed] Production bootstrap complete (no demo data).");
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error("[seed] Failed:", error);
  await closeDb();
  process.exit(1);
});
