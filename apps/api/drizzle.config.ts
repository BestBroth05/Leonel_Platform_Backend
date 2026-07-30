import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://leonel_platform:leonel_platform_local@localhost:5432/leonel_platform",
  },
  strict: true,
  verbose: true,
});
