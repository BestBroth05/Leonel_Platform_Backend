import { spawnSync } from "node:child_process";

const result = spawnSync(
  "docker",
  ["compose", "-f", "compose.local.yaml", "down"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
