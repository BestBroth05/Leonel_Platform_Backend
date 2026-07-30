import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle",
  );

  console.log("[migrate] Applying Drizzle migrations...");
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Done.");
  await client.end({ timeout: 5 });
}

main().catch((error) => {
  console.error("[migrate] Failed:", error);
  process.exit(1);
});
