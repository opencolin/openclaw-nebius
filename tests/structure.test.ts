import { describe, it, expect } from "vitest";
import { existsSync, statSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

describe("monorepo structure", () => {
  it("workspace directories have package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    for (const ws of pkg.workspaces) {
      const pkgPath = resolve(ROOT, ws, "package.json");
      expect(existsSync(pkgPath), `${ws}/package.json should exist`).toBe(true);
    }
  });

  it("non-workspace directories have expected marker files", () => {
    const markers: Record<string, string> = {
      "deploy-scripts": "Dockerfile",
      "nebius-skill": "SKILL.md",
    };
    for (const [dir, file] of Object.entries(markers)) {
      const path = resolve(ROOT, dir, file);
      expect(existsSync(path), `${dir}/${file} should exist`).toBe(true);
    }
  });

  it("deploy scripts are executable", () => {
    const scripts = [
      "install-openclaw-serverless.sh",
      "install-nemoclaw-serverless.sh",
      "install-nemoclaw-vm.sh",
      "deploy-cloud.sh",
      "setup-deploy-vm.sh",
      "entrypoint.sh",
      "healthcheck.sh",
    ];
    for (const script of scripts) {
      const path = resolve(ROOT, "deploy-scripts", script);
      expect(existsSync(path), `${script} should exist`).toBe(true);
      const mode = statSync(path).mode;
      expect(mode & 0o111, `${script} should be executable`).toBeGreaterThan(0);
    }
  });

  it("npm workspaces resolve without errors", () => {
    const result = execSync("npm ls --workspaces --json 2>&1", {
      cwd: ROOT,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(result);
    expect(parsed.problems).toBeUndefined();
  });
});
