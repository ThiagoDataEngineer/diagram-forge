import { spawn, execSync, ChildProcess } from "child_process";

let serverProcess: ChildProcess | null = null;

export async function setup(): Promise<void> {
  // Kill any stale server on port 3000 from a previous run before starting fresh.
  // On Windows, port 3000 may still be bound if teardown was skipped.
  try {
    execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" },
    );
    // Give the OS a moment to release the port
    await new Promise((r) => setTimeout(r, 500));
  } catch { /* non-fatal */ }

  // TEST_MOCK_LIGHTNING=true makes isProductionLightning() return false regardless of
  // what dotenv loads from .env (where LIGHTNING_ADDRESS may be set for production).
  // Using a non-empty truthy string avoids the Windows OS behavior of dropping
  // empty-string env vars before they reach the child process.
  const env = { ...process.env, TEST_MOCK_LIGHTNING: "true" };

  serverProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env,
    shell: true,
    stdio: "pipe",
  });

  serverProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

  await waitForHealth("http://localhost:3000/health", 30_000);
}

export async function teardown(): Promise<void> {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3_000);
    serverProcess!.on("exit", () => { clearTimeout(t); resolve(); });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* server not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy at ${url} within ${timeoutMs}ms`);
}
