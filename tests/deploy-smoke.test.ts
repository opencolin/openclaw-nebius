import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const SKIP = !!process.env.SKIP_SMOKE;
const PORT = 19876 + Math.floor(Math.random() * 1000);

describe.skipIf(SKIP)("deploy-ui smoke test", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawn("node", ["server.js"], {
      cwd: resolve(ROOT, "deploy-ui/web"),
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
      stdio: "pipe",
    });

    // Wait for server to start listening
    await new Promise<void>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error("Server did not start within 10s")), 10000);
      server.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes(String(PORT))) {
          clearTimeout(timeout);
          res();
        }
      });
      server.stderr?.on("data", (data: Buffer) => {
        if (data.toString().includes(String(PORT))) {
          clearTimeout(timeout);
          res();
        }
      });
      server.on("error", (err) => {
        clearTimeout(timeout);
        rej(err);
      });
      server.on("exit", (code) => {
        clearTimeout(timeout);
        rej(new Error(`Server exited with code ${code}`));
      });
    });
  }, 15000);

  afterAll(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  });

  it("GET /health returns 200", async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.status).toBe(200);
  });

  it("GET / returns HTML", async () => {
    const res = await fetch(`http://localhost:${PORT}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toContain("html");
  });
});
