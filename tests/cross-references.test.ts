import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";

const ROOT = resolve(import.meta.dirname, "..");

describe("cross-references", () => {
  it("server.js script paths resolve to existing files", () => {
    const serverPath = resolve(ROOT, "deploy-ui/web/server.js");
    const serverDir = dirname(serverPath);
    const content = readFileSync(serverPath, "utf-8");

    // Extract all path.resolve(__dirname, '...') patterns
    const pathPattern = /path\.resolve\(__dirname,\s*'([^']+)'\)/g;
    let match;
    const resolved: string[] = [];

    while ((match = pathPattern.exec(content)) !== null) {
      const target = resolve(serverDir, match[1]);
      resolved.push(match[1]);
      expect(existsSync(target), `server.js references '${match[1]}' but ${target} does not exist`).toBe(true);
    }

    expect(resolved.length).toBeGreaterThan(0);
  });

  it("vercel.json source paths exist", () => {
    const vercelPath = resolve(ROOT, "deploy-ui/vercel.json");
    const vercelDir = dirname(vercelPath);
    const config = JSON.parse(readFileSync(vercelPath, "utf-8"));

    for (const build of config.builds) {
      // Strip glob patterns to get the directory/file base
      const src = build.src.replace(/\*\*/g, "").replace(/\*/g, "").replace(/\/+$/, "");
      if (src) {
        const target = resolve(vercelDir, src);
        expect(existsSync(target), `vercel.json references '${build.src}' but ${target} does not exist`).toBe(true);
      }
    }
  });

  it("markdown relative links resolve to existing files", () => {
    const broken: string[] = [];

    function scanDir(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          scanDir(full);
        } else if (entry.endsWith(".md")) {
          checkMarkdownLinks(full);
        }
      }
    }

    function checkMarkdownLinks(filePath: string) {
      const content = readFileSync(filePath, "utf-8");
      const relative = filePath.replace(ROOT + "/", "");
      const dir = dirname(filePath);

      // Match markdown links: [text](path) — only relative paths starting with ./ or ../
      const linkPattern = /\]\((\.\.[^)#\s]+|\.\/[^)#\s]+)\)/g;
      let match;

      while ((match = linkPattern.exec(content)) !== null) {
        const linkTarget = match[1];
        const resolved = resolve(dir, linkTarget);
        if (!existsSync(resolved)) {
          broken.push(`${relative}: [](${linkTarget}) → ${resolved.replace(ROOT + "/", "")}`);
        }
      }
    }

    scanDir(ROOT);
    expect(broken, `Broken markdown links:\n${broken.join("\n")}`).toHaveLength(0);
  });
});
