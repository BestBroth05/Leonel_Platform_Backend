/**
 * Demo operativo local — ejemplo claro del flujo del taller.
 *
 * Historia:
 * 1) Cliente "Lider Jeans" envía el pedido PED-1024
 * 2) Esperaban 1,000 pantalones mezclilla marca Denim
 * 3) Llegaron 980 (faltante informativo 20)
 * 4) 15 van a compostura; regresan 10 (quedan 5 en compostura)
 * 5) Se registra merma de 5
 * 6) Salen 400 al CD Norte (salida parcial)
 *
 * Saldo resultante:
 *   recibido 980 | en compostura 5 | merma 5 | enviado 400 | disponible 570
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb, type AppDb } from "./client.js";
import {
  brands,
  clients,
  destinations,
  inventoryMovements,
  orderStatusHistory,
  orders,
  pantTypes,
  users,
} from "./schema.js";

export async function runDemoSeed(db: AppDb = getDb()) {
  console.log("[seed-demo] Limpiando datos operativos previos…");
  await db.delete(inventoryMovements);
  await db.delete(orderStatusHistory);
  await db.delete(orders);
  await db.delete(clients);

  const brandName = "Denim";
  const pantTypeName = "Mezclilla";
  const destinationName = "CD Norte";

  let brand = await db.query.brands.findFirst({ where: eq(brands.name, brandName) });
  if (!brand) {
    [brand] = await db.insert(brands).values({ name: brandName }).returning();
  }
  let pantType = await db.query.pantTypes.findFirst({
    where: eq(pantTypes.name, pantTypeName),
  });
  if (!pantType) {
    [pantType] = await db.insert(pantTypes).values({ name: pantTypeName }).returning();
  }
  let destination = await db.query.destinations.findFirst({
    where: eq(destinations.name, destinationName),
  });
  if (!destination) {
    [destination] = await db
      .insert(destinations)
      .values({ name: destinationName })
      .returning();
  }

  for (const name of ["Premium", "Genérica"]) {
    const existing = await db.query.brands.findFirst({ where: eq(brands.name, name) });
    if (!existing) await db.insert(brands).values({ name });
  }
  for (const name of ["Gabardina"]) {
    const existing = await db.query.pantTypes.findFirst({
      where: eq(pantTypes.name, name),
    });
    if (!existing) await db.insert(pantTypes).values({ name });
  }
  for (const name of ["Tienda Centro"]) {
    const existing = await db.query.destinations.findFirst({
      where: eq(destinations.name, name),
    });
    if (!existing) await db.insert(destinations).values({ name });
  }

  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@leonel-platform.local"),
  });
  const actorId = admin?.id ?? null;

  console.log("[seed-demo] Creando cliente y pedido PED-1024…");
  const [client] = await db
    .insert(clients)
    .values({
      name: "Lider Jeans",
      contactName: "María López",
      phone: "555-1024-8800",
      notes: "Cliente habitual de acabado de pantalón",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const [order] = await db
    .insert(orders)
    .values({
      number: "PED-1024",
      clientId: client.id,
      brandId: brand.id,
      pantTypeId: pantType.id,
      expectedQuantity: 1000,
      status: "DRAFT",
      notes: "Corte de mezclilla para temporada",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "DRAFT",
    note: "Pedido creado",
    actorUserId: actorId,
  });

  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "RECEPTION",
    quantity: 980,
    note: "Primera recepción del corte",
    createdBy: actorId,
  });
  await db
    .update(orders)
    .set({ status: "RECEIVING", updatedAt: new Date(), updatedBy: actorId, version: 2 })
    .where(eq(orders.id, order.id));
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: "DRAFT",
    toStatus: "RECEIVING",
    note: "Recepción registrada",
    actorUserId: actorId,
  });

  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "RECEPTION_SHORTAGE",
    quantity: 20,
    note: "Faltaron 20 vs lo esperado (solo informativo)",
    createdBy: actorId,
  });

  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "SEND_TO_REPAIR",
    quantity: 15,
    note: "Defectos de costura",
    createdBy: actorId,
  });
  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "RETURN_FROM_REPAIR",
    quantity: 10,
    note: "Regresaron 10 reparados; 5 siguen afuera",
    createdBy: actorId,
  });

  await db
    .update(orders)
    .set({ status: "IN_PROCESS", updatedAt: new Date(), updatedBy: actorId, version: 3 })
    .where(eq(orders.id, order.id));
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: "RECEIVING",
    toStatus: "IN_PROCESS",
    note: "Pedido en proceso",
    actorUserId: actorId,
  });

  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "SHRINKAGE",
    quantity: 5,
    note: "Daño irreparable en tela",
    createdBy: actorId,
  });

  await db.insert(inventoryMovements).values({
    orderId: order.id,
    type: "PARTIAL_EXIT",
    quantity: 400,
    note: "Primera entrega parcial",
    destinationId: destination.id,
    createdBy: actorId,
  });
  await db
    .update(orders)
    .set({
      status: "PARTIALLY_SHIPPED",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: 4,
    })
    .where(eq(orders.id, order.id));
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: "IN_PROCESS",
    toStatus: "PARTIALLY_SHIPPED",
    note: "Salida parcial a CD Norte",
    actorUserId: actorId,
  });

  console.log("");
  console.log("Ejemplo listo — Lider Jeans / PED-1024");
  console.log("  Esperado:      1,000");
  console.log("  Recibido:      980");
  console.log("  Faltante:       20 (informativo)");
  console.log("  En compostura:   5");
  console.log("  Merma:           5");
  console.log("  Enviado:       400 → CD Norte");
  console.log("  Disponible:    570");
  console.log("  Estado:        PARTIALLY_SHIPPED");
  console.log("");
  console.log("En la app: Pedidos → abrir PED-1024");
}

async function main() {
  const env = process.env.LEONEL_PLATFORM_ENV ?? process.env.NODE_ENV ?? "local";
  if (env === "production" || env === "prod") {
    console.error("[seed-demo] Refusing to run in production.");
    process.exit(1);
  }

  try {
    await runDemoSeed();
  } finally {
    await closeDb();
  }
}

const isDirectRun = process.argv[1]?.includes("seed-demo");
if (isDirectRun) {
  main().catch(async (error) => {
    console.error("[seed-demo] Failed:", error);
    await closeDb();
    process.exit(1);
  });
}
