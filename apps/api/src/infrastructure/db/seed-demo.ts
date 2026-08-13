/**
 * Demo operativo local — flujo con formatos / cortes / pedidos / semana OPEN.
 *
 * Historia:
 * 1) Cliente Lider Jeans + semana OPEN
 * 2) Formato FMT-1024 (clientId) con corte C-100
 * 3) Recepciones parciales en la semana: 200 + 300 + 480 = 980
 * 4) Pedido PED-1024 asigna 980 del corte
 * 5) Movimientos con allocations: compostura, merma, salida parcial
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb, type AppDb } from "./client.js";
import {
  brands,
  clients,
  clientWeeks,
  cutReceipts,
  cuts,
  destinations,
  inventoryMovements,
  movementCutAllocations,
  movementSizeBreakdowns,
  orderCuts,
  orderSizeBreakdowns,
  orderStatusHistory,
  orders,
  pantTypes,
  productionFormats,
  users,
  weeklySettlementSnapshots,
} from "./schema.js";
import { toBusinessDateString } from "../../domain/weeks/business-dates.js";

export async function runDemoSeed(db: AppDb = getDb()) {
  console.log("[seed-demo] Limpiando datos operativos previos…");
  await db.delete(movementSizeBreakdowns);
  await db.delete(movementCutAllocations);
  await db.delete(inventoryMovements);
  await db.delete(orderStatusHistory);
  await db.delete(orderSizeBreakdowns);
  await db.delete(orderCuts);
  await db.delete(orders);
  await db.delete(cutReceipts);
  await db.delete(cuts);
  await db.delete(weeklySettlementSnapshots);
  await db.delete(clientWeeks);
  await db.delete(productionFormats);
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

  console.log("[seed-demo] Creando cliente, semana OPEN, formato, corte y pedido PED-1024…");
  const [client] = await db
    .insert(clients)
    .values({
      name: "Lider Jeans",
      contactName: "María López",
      notes: "Cliente habitual de acabado de pantalón",
      weekOpensOn: "SATURDAY",
      weekClosesOn: "THURSDAY",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const startDate = toBusinessDateString(new Date());
  const [week] = await db
    .insert(clientWeeks)
    .values({
      clientId: client.id,
      startDate,
      status: "OPEN",
      openedAt: new Date(),
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const [format] = await db
    .insert(productionFormats)
    .values({
      number: "FMT-1024",
      clientId: client.id,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const [cut] = await db
    .insert(cuts)
    .values({
      productionFormatId: format.id,
      number: "C-100",
      workPlan: "PT-4587",
      style: "4587",
      expectedQuantity: 1000,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  await db.insert(cutReceipts).values([
    {
      cutId: cut.id,
      clientWeekId: week.id,
      folioNumber: "F-1",
      partialNumber: 1,
      quantity: 200,
      notes: "Primera entrega parcial",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      cutId: cut.id,
      clientWeekId: week.id,
      folioNumber: "F-2",
      partialNumber: 2,
      quantity: 300,
      notes: "Segunda entrega parcial",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      cutId: cut.id,
      clientWeekId: week.id,
      folioNumber: "F-3",
      partialNumber: 3,
      quantity: 480,
      notes: "Tercera entrega parcial",
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  const [order] = await db
    .insert(orders)
    .values({
      number: "PED-1024",
      clientId: client.id,
      brandId: brand.id,
      pantTypeId: pantType.id,
      productionFormatId: format.id,
      cutId: cut.id,
      assignedQuantity: 980,
      expectedQuantity: 980,
      purchaseOrder: "OC-7788",
      costPerGarment: "12.5000",
      createdInClientWeekId: week.id,
      status: "DRAFT",
      notes: "Pedido asignado del corte C-100",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const [orderCut] = await db
    .insert(orderCuts)
    .values({
      orderId: order.id,
      cutId: cut.id,
      assignedQuantity: 980,
    })
    .returning();

  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "DRAFT",
    note: "Pedido creado",
    actorUserId: actorId,
  });

  const [sendRepair] = await db
    .insert(inventoryMovements)
    .values({
      orderId: order.id,
      clientWeekId: week.id,
      type: "SEND_TO_REPAIR",
      quantity: 15,
      note: "Defectos de costura",
      occurredAt: new Date(),
      createdBy: actorId,
    })
    .returning();
  await db.insert(movementCutAllocations).values({
    movementId: sendRepair.id,
    orderCutId: orderCut.id,
    quantity: 15,
  });

  const [returnRepair] = await db
    .insert(inventoryMovements)
    .values({
      orderId: order.id,
      clientWeekId: week.id,
      type: "RETURN_FROM_REPAIR",
      quantity: 10,
      note: "Regresaron 10 reparados; 5 siguen afuera",
      occurredAt: new Date(),
      createdBy: actorId,
    })
    .returning();
  await db.insert(movementCutAllocations).values({
    movementId: returnRepair.id,
    orderCutId: orderCut.id,
    quantity: 10,
  });

  await db
    .update(orders)
    .set({ status: "IN_PROCESS", updatedAt: new Date(), updatedBy: actorId, version: 2 })
    .where(eq(orders.id, order.id));
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: "DRAFT",
    toStatus: "IN_PROCESS",
    note: "Pedido en proceso",
    actorUserId: actorId,
  });

  const [shrinkage] = await db
    .insert(inventoryMovements)
    .values({
      orderId: order.id,
      clientWeekId: week.id,
      type: "SHRINKAGE",
      quantity: 5,
      note: "Daño irreparable en tela",
      occurredAt: new Date(),
      createdBy: actorId,
    })
    .returning();
  await db.insert(movementCutAllocations).values({
    movementId: shrinkage.id,
    orderCutId: orderCut.id,
    quantity: 5,
  });

  const [exit] = await db
    .insert(inventoryMovements)
    .values({
      orderId: order.id,
      clientWeekId: week.id,
      type: "PARTIAL_EXIT",
      quantity: 400,
      note: "Primera entrega parcial",
      destinationId: destination.id,
      occurredAt: new Date(),
      createdBy: actorId,
    })
    .returning();
  await db.insert(movementCutAllocations).values({
    movementId: exit.id,
    orderCutId: orderCut.id,
    quantity: 400,
  });

  await db
    .update(orders)
    .set({
      status: "PARTIALLY_SHIPPED",
      updatedAt: new Date(),
      updatedBy: actorId,
      version: 3,
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
  console.log("Ejemplo listo — Formato FMT-1024 / Corte C-100 / PED-1024 / semana OPEN");
  console.log(`  Cliente:         ${client.name}`);
  console.log(`  Semana OPEN:     desde ${week.startDate}`);
  console.log("  Recibido corte: 980 (200+300+480)");
  console.log("  Asignado pedido: 980");
  console.log("  En compostura:     5");
  console.log("  Merma:             5");
  console.log("  Enviado:         400 → CD Norte");
  console.log("  Disponible:      570");
  console.log("  Estado:          PARTIALLY_SHIPPED");
  console.log("  Nota: el corte NO está SQUARED (pendiente + compostura); el cierre fallará hasta cuadrarlo.");
  console.log("");
  console.log("En la app: Formatos → FMT-1024 · Cuadre semanal → Lider Jeans");
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
