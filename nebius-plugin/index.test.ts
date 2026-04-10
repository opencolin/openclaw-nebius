import { describe, it, expect } from "vitest";
import { NEBIUS_MODELS, PROVIDER_ID, BASE_URL } from "./index.js";

describe("nebius provider plugin", () => {
  describe("model catalog", () => {
    it("exports a non-empty model list", () => {
      expect(NEBIUS_MODELS.length).toBeGreaterThan(0);
    });

    it("has no duplicate model IDs", () => {
      const ids = NEBIUS_MODELS.map((m) => m.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("every model has required fields", () => {
      for (const m of NEBIUS_MODELS) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.contextWindow).toBeGreaterThan(0);
        expect(m.maxTokens).toBeGreaterThan(0);
        expect(m.input).toBeInstanceOf(Array);
        expect(m.input.length).toBeGreaterThan(0);
        expect(m.cost).toBeDefined();
        expect(typeof m.cost.input).toBe("number");
        expect(typeof m.cost.output).toBe("number");
        expect(typeof m.cost.cacheRead).toBe("number");
        expect(typeof m.cost.cacheWrite).toBe("number");
        expect(typeof m.reasoning).toBe("boolean");
      }
    });

    it("model IDs do NOT include the provider prefix", () => {
      for (const m of NEBIUS_MODELS) {
        expect(m.id).not.toMatch(
          /^nebius\//,
          `Model "${m.id}" should not include the "nebius/" prefix — ` +
            `OpenClaw adds it automatically. Users reference as nebius/${m.id}`,
        );
      }
    });

    it("all input types are SDK-compatible (text or image only)", () => {
      for (const m of NEBIUS_MODELS) {
        for (const t of m.input) {
          expect(["text", "image"]).toContain(t);
        }
      }
    });

    it("model IDs follow org/name format", () => {
      for (const m of NEBIUS_MODELS) {
        expect(m.id).toMatch(
          /^[A-Za-z0-9_-]+\/.+$/,
          `Model "${m.id}" should follow org/model-name format`,
        );
      }
    });

    it("maxTokens is not blanket-hardcoded to 4096 for chat models", () => {
      const chat = NEBIUS_MODELS.filter((m) => m.input.includes("text"));
      const maxTokensValues = new Set(chat.map((m) => m.maxTokens));
      expect(maxTokensValues.size).toBeGreaterThan(1);
    });

    it("contextWindow is not blanket-hardcoded to 32000 for chat models", () => {
      const chat = NEBIUS_MODELS.filter((m) => m.input.includes("text"));
      const contextValues = new Set(chat.map((m) => m.contextWindow));
      expect(contextValues.size).toBeGreaterThan(1);
    });

    it("maxTokens does not exceed contextWindow for any model", () => {
      for (const m of NEBIUS_MODELS) {
        expect(m.maxTokens).toBeLessThanOrEqual(
          m.contextWindow,
          `Model "${m.id}": maxTokens (${m.maxTokens}) exceeds contextWindow (${m.contextWindow})`,
        );
      }
    });
  });

  describe("model types", () => {
    it("chat models use input: ['text']", () => {
      const chat = NEBIUS_MODELS.filter((m) => m.input.includes("text"));
      expect(chat.length).toBeGreaterThan(0);
      for (const m of chat) {
        expect(m.input).toEqual(["text"]);
      }
    });

    it("no embedding models in catalog (unsupported by SDK)", () => {
      const embeddings = NEBIUS_MODELS.filter((m) =>
        m.input.includes("embedding"),
      );
      expect(embeddings.length).toBe(0);
    });

    it("image models use input: ['image']", () => {
      const images = NEBIUS_MODELS.filter((m) => m.input.includes("image"));
      expect(images.length).toBeGreaterThan(0);
    });

    it("reasoning flag is only set on thinking/reasoning models", () => {
      const reasoning = NEBIUS_MODELS.filter((m) => m.reasoning);
      expect(reasoning.length).toBeGreaterThan(0);
      for (const m of reasoning) {
        const name = m.name.toLowerCase();
        const id = m.id.toLowerCase();
        const isReasoningModel =
          name.includes("thinking") ||
          name.includes("hermes") ||
          id.includes("r1") ||
          id.includes("gpt-oss");
        expect(isReasoningModel).toBe(true);
      }
    });
  });

  describe("constants", () => {
    it("PROVIDER_ID is 'nebius'", () => {
      expect(PROVIDER_ID).toBe("nebius");
    });

    it("BASE_URL points to token factory", () => {
      expect(BASE_URL).toBe("https://api.tokenfactory.us-central1.nebius.com/v1");
    });
  });

  describe("qualified model names", () => {
    it("all models resolve correctly with nebius/ prefix", () => {
      for (const m of NEBIUS_MODELS) {
        const qualified = `${PROVIDER_ID}/${m.id}`;
        expect(qualified).toMatch(/^nebius\/.+\/.+$/);
        expect(qualified).not.toMatch(/^nebius\/nebius\//);
      }
    });
  });
});
