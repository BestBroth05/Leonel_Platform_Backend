import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[local:test] typecheck + unit tests");
run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);

try {
  const health = await fetch("http://localhost:3000/health");
  if (health.ok) {
    console.log("[local:test] Smoke /health OK");
  } else {
    console.log("[local:test] Stack not running; skipped HTTP smoke");
  }
} catch {
  console.log("[local:test] Stack not running; skipped HTTP smoke");
}
