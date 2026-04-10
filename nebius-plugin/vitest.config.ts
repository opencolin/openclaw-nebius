import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "openclaw/plugin-sdk/provider-entry": new URL(
        "./__mocks__/plugin-sdk.ts",
        import.meta.url,
      ).pathname,
      "openclaw/plugin-sdk/plugin-entry": new URL(
        "./__mocks__/plugin-sdk.ts",
        import.meta.url,
      ).pathname,
      "openclaw/plugin-sdk/provider-auth": new URL(
        "./__mocks__/plugin-sdk.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
