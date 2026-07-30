import { buildApp } from "./app-context.js";

async function main() {
  const { app, config } = await buildApp();
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
  app.log.info(`Leonel Platform API listening on :${config.API_PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
