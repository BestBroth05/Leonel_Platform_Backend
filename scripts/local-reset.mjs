import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[local:reset] Removing containers and volumes...");
run(["compose", "-f", "compose.local.yaml", "down", "-v"]);
console.log("[local:reset] Starting fresh stack...");
const up = spawnSync("node", ["scripts/local-up.mjs"], { stdio: "inherit" });
process.exit(up.status ?? 1);
