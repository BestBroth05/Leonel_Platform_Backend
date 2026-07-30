import { buildApp } from "../src/app-context.js";
import { closeDb } from "../src/infrastructure/db/client.js";

async function main() {
  const { app } = await buildApp();
  await app.listen({ port: 3010, host: "127.0.0.1" });

  const login = await fetch("http://127.0.0.1:3010/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "admin@leonel-platform.local",
      password: "ChangeMeLocalOnly!",
    }),
  });
  const loginBody = (await login.json()) as {
    tokens?: { accessToken: string };
    error?: unknown;
  };
  if (!login.ok || !loginBody.tokens) {
    throw new Error(JSON.stringify(loginBody));
  }
  const token = loginBody.tokens.accessToken;
  const h = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const clientRes = await fetch("http://127.0.0.1:3010/clients", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: `Cliente Smoke ${Date.now()}` }),
  });
  const client = (await clientRes.json()) as { id: string };
  if (!clientRes.ok) throw new Error(JSON.stringify(client));

  const brands = (await (
    await fetch("http://127.0.0.1:3010/catalogs/brands?activeOnly=true", {
      headers: h,
    })
  ).json()) as Array<{ id: string }>;
  const pantTypes = (await (
    await fetch("http://127.0.0.1:3010/catalogs/pant-types?activeOnly=true", {
      headers: h,
    })
  ).json()) as Array<{ id: string }>;

  const orderRes = await fetch("http://127.0.0.1:3010/orders", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      number: `SMOKE-${Date.now()}`,
      clientId: client.id,
      brandId: brands[0]?.id,
      pantTypeId: pantTypes[0]?.id,
      expectedQuantity: 1000,
    }),
  });
  const order = (await orderRes.json()) as { id: string };
  if (!orderRes.ok) throw new Error(JSON.stringify(order));

  const idem = `smoke-reception-${Date.now()}`;
  const movRes = await fetch(`http://127.0.0.1:3010/orders/${order.id}/movements`, {
    method: "POST",
    headers: { ...h, "idempotency-key": idem },
    body: JSON.stringify({ type: "RECEPTION", quantity: 900 }),
  });
  const mov = await movRes.json();
  if (!movRes.ok) throw new Error(JSON.stringify(mov));

  const replayRes = await fetch(
    `http://127.0.0.1:3010/orders/${order.id}/movements`,
    {
      method: "POST",
      headers: { ...h, "idempotency-key": idem },
      body: JSON.stringify({ type: "RECEPTION", quantity: 900 }),
    },
  );
  const replay = (await replayRes.json()) as { replayed?: boolean };
  if (!replay.replayed) throw new Error("expected idempotent replay");

  const exitRes = await fetch(`http://127.0.0.1:3010/orders/${order.id}/movements`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ type: "PARTIAL_EXIT", quantity: 200 }),
  });
  const exit = await exitRes.json();
  if (!exitRes.ok) throw new Error(JSON.stringify(exit));

  const balance = await (
    await fetch(`http://127.0.0.1:3010/orders/${order.id}/balance`, {
      headers: h,
    })
  ).json();
  const orderAfter = (await (
    await fetch(`http://127.0.0.1:3010/orders/${order.id}`, { headers: h })
  ).json()) as { status: string };

  console.log(
    JSON.stringify(
      {
        ok: true,
        balance,
        status: orderAfter.status,
        replayed: replay.replayed,
      },
      null,
      2,
    ),
  );

  await app.close();
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
