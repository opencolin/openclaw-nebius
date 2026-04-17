import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function grepTrackedFiles(pattern: string): string[] {
  try {
    // Use git grep to only search tracked files (skips node_modules, dist, etc.)
    const result = execSync(`git grep -n '${pattern}' -- ':!package-lock.json' ':!tests/'`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.split("\n").filter(Boolean);
  } catch {
    // git grep returns exit code 1 when no matches found
    return [];
  }
}

describe("no stale references", () => {
  it("no references to old GitHub username 'opencolin' predecessor 'colygon'", () => {
    const matches = grepTrackedFiles("colygon");
    expect(matches, `Found stale 'colygon' references:\n${matches.join("\n")}`).toHaveLength(0);
  });

  it("no references to old directory '/nebius-plugin'", () => {
    const matches = grepTrackedFiles("/nebius-plugin").filter(
      (line) => !line.includes("tokenfactory-plugin")
    );
    expect(matches, `Found stale '/nebius-plugin' references:\n${matches.join("\n")}`).toHaveLength(0);
  });

  it("no references to old 'deploy/web' or 'deploy/vercel' paths", () => {
    const matches = [
      ...grepTrackedFiles("deploy/web"),
      ...grepTrackedFiles("deploy/vercel"),
    ].filter(
      (line) => !line.includes("deploy-ui/") && !line.includes("deploy-scripts/")
    );
    expect(matches, `Found stale 'deploy/' path references:\n${matches.join("\n")}`).toHaveLength(0);
  });
});
