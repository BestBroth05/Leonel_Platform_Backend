import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingFrontend = path.resolve(root, "../leonel-platform-frontend");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    cwd: root,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

async function waitFor(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[local:up] ${label} is healthy`);
        return;
      }
    } catch {
      // retry
    }
    await sleep(2000);
  }
  console.error(`[local:up] Timed out waiting for ${label} at ${url}`);
  process.exit(1);
}

async function main() {
  if (!existsSync(path.join(siblingFrontend, "package.json"))) {
    console.error(
      "[local:up] Missing sibling frontend at ../leonel-platform-frontend",
    );
    console.error(
      "Clone/populate Leonel_Platform_Frontend as a sister folder of this backend.",
    );
    process.exit(1);
  }

  console.log("[local:up] Checking Docker...");
  if (!dockerAvailable()) {
    console.error(
      "[local:up] Docker is not available. Start Docker Desktop and retry.",
    );
    process.exit(1);
  }

  console.log("[local:up] Building and starting compose.local.yaml...");
  console.log(`[local:up] Frontend context: ${siblingFrontend}`);
  run("docker", ["compose", "-f", "compose.local.yaml", "up", "-d", "--build"]);

  console.log("[local:up] Waiting for health checks...");
  await waitFor("http://localhost:3000/health", "API");
  await waitFor("http://localhost:5173/", "Web");

  console.log("");
  console.log("Leonel Platform — local URLs");
  console.log("  Web:  http://localhost:5173");
  console.log("  API:  http://localhost:3000");
  console.log("  Health: http://localhost:3000/health");
  console.log("  Admin: admin@leonel-platform.local / ChangeMeLocalOnly!");
  console.log("");
  console.log("Logs: pnpm local:logs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
