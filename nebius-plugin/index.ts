import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";

/**
 * Model type tags used in the `input` array to distinguish capabilities.
 * OpenClaw uses these to filter which models are offered for which tasks.
 *
 *   "text"      — standard text-to-text chat/completion
 *   "image"     — text-to-image generation (not chat-eligible)
 *   "embedding" — embedding-only (not chat-eligible)
 */

export interface NebiusModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  reasoning: boolean;
}

// ─── Chat / Reasoning Models ────────────────────────────────────────────────

// contextWindow & maxTokens sourced from Nebius Token Factory endpoint metadata
// and cross-referenced with OpenRouter provider data (2026-04).
// To re-verify: GET https://api.tokenfactory.nebius.com/v1/models?verbose=true
const CHAT_MODELS: NebiusModel[] = [
  // MiniMax
  { id: "minimax/MiniMax-M2.5", name: "MiniMax M2.5", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "minimax/MiniMax-M2.1", name: "MiniMax M2.1", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // NVIDIA
  { id: "nvidia/Nemotron-3-Super-120b-a12b", name: "Nemotron 3 Super 120B", contextWindow: 262144, maxTokens: 16384, input: ["text"], cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "nvidia/Nemotron-Nano-V2-12b", name: "Nemotron Nano V2 12B", contextWindow: 32768, maxTokens: 8192, input: ["text"], cost: { input: 0.07, output: 0.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1", name: "Nemotron Ultra 253B", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.6, output: 1.8, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "nvidia/Nemotron-3-Nano-30B-A3B", name: "Nemotron 3 Nano 30B", contextWindow: 32768, maxTokens: 8192, input: ["text"], cost: { input: 0.06, output: 0.24, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // Qwen
  { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen 3.5 397B MoE", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.6, output: 3.6, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B", contextWindow: 262144, maxTokens: 16384, input: ["text"], cost: { input: 0.4, output: 1.8, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen3-235B-A22B-Thinking-2507", name: "Qwen3 235B Thinking", contextWindow: 131072, maxTokens: 65536, input: ["text"], cost: { input: 0.2, output: 0.8, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B Instruct", contextWindow: 262144, maxTokens: 16384, input: ["text"], cost: { input: 0.2, output: 0.6, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen3-Next-80B-A3B-Thinking", name: "Qwen3 Next 80B Thinking", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.15, output: 1.2, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "Qwen/Qwen3-32B", name: "Qwen3 32B", contextWindow: 40960, maxTokens: 40960, input: ["text"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen3-30B-A3B-Thinking-2507", name: "Qwen3 30B Thinking", contextWindow: 40960, maxTokens: 40960, input: ["text"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "Qwen/Qwen3-30B-A3B-Instruct-2507", name: "Qwen3 30B Instruct", contextWindow: 40960, maxTokens: 16384, input: ["text"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen3-Coder-30B-A3B-Instruct", name: "Qwen3 Coder 30B", contextWindow: 40960, maxTokens: 16384, input: ["text"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen2.5-VL-72B-Instruct", name: "Qwen2.5 VL 72B", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.25, output: 0.75, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "Qwen/Qwen2.5-Coder-7B", name: "Qwen2.5 Coder 7B", contextWindow: 128000, maxTokens: 8192, input: ["text"], cost: { input: 0.03, output: 0.09, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // Moonshot AI
  { id: "moonshot-ai/Kimi-K2.5", name: "Kimi K2.5", contextWindow: 262144, maxTokens: 262144, input: ["text"], cost: { input: 0.5, output: 2.5, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "moonshot-ai/Kimi-K2-Instruct", name: "Kimi K2 Instruct", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.5, output: 2.4, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "moonshot-ai/Kimi-K2-Thinking", name: "Kimi K2 Thinking", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.6, output: 2.5, cacheRead: 0, cacheWrite: 0 }, reasoning: true },

  // Z.ai (GLM)
  { id: "zai-org/GLM-5", name: "GLM-5", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 1.0, output: 3.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "zai-org/GLM-4.7", name: "GLM-4.7", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.4, output: 2.0, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "zai-org/GLM-4.5", name: "GLM-4.5", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.6, output: 2.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "zai-org/GLM-4.5-Air", name: "GLM-4.5 Air", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.2, output: 1.2, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // DeepSeek
  { id: "deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2", contextWindow: 163840, maxTokens: 163840, input: ["text"], cost: { input: 0.3, output: 0.45, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "deepseek-ai/DeepSeek-R1-0528", name: "DeepSeek R1", contextWindow: 131072, maxTokens: 16000, input: ["text"], cost: { input: 0.8, output: 2.4, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "deepseek-ai/DeepSeek-V3-0324", name: "DeepSeek V3", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // NousResearch
  { id: "NousResearch/Hermes-4-405B", name: "Hermes 4 405B", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 1.0, output: 3.0, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "NousResearch/Hermes-4-70B", name: "Hermes 4 70B", contextWindow: 128000, maxTokens: 16384, input: ["text"], cost: { input: 0.13, output: 0.4, cacheRead: 0, cacheWrite: 0 }, reasoning: true },

  // OpenAI (open-weight)
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.05, output: 0.2, cacheRead: 0, cacheWrite: 0 }, reasoning: true },

  // Prime Intellect
  { id: "PrimeIntellect/INTELLECT-3", name: "INTELLECT-3", contextWindow: 32768, maxTokens: 8192, input: ["text"], cost: { input: 0.2, output: 1.1, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // Google
  { id: "google/Gemma-3-27b-it", name: "Gemma 3 27B", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "google/Gemma-2-9b-it", name: "Gemma 2 9B", contextWindow: 8192, maxTokens: 8192, input: ["text"], cost: { input: 0.03, output: 0.09, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "google/Gemma-2-2b-it", name: "Gemma 2 2B", contextWindow: 8192, maxTokens: 8192, input: ["text"], cost: { input: 0.02, output: 0.06, cacheRead: 0, cacheWrite: 0 }, reasoning: false },

  // Meta
  { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.13, output: 0.4, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct", contextWindow: 131072, maxTokens: 16384, input: ["text"], cost: { input: 0.02, output: 0.06, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "meta-llama/Meta-Llama-Guard-3-8B", name: "Llama Guard 3 8B", contextWindow: 8192, maxTokens: 4096, input: ["text"], cost: { input: 0.02, output: 0.06, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
];

// ─── Embedding Models ───────────────────────────────────────────────────────
// Excluded from provider catalog: OpenClaw's ModelDefinitionConfig only allows
// input: "text" | "image". Embedding models would need a separate registration
// path (registerEmbeddingProvider) if/when the SDK supports it.
//
// Available on Nebius but not registered here:
//   - Qwen/Qwen3-Embedding-8B
//   - BAAI/bge-multilingual-gemma2
//   - BAAI/BGE-ICL
//   - intfloat/e5-mistral-7b-instruct

// ─── Image Generation Models (not chat-eligible) ───────────────────────────
// FLUX models are priced per-image on Nebius, not per-token.
// The SDK cost model (per-1M-tokens) doesn't map cleanly; costs are set to 0.
// contextWindow = 77 (CLIP prompt token limit); maxTokens is not applicable.

const IMAGE_MODELS: NebiusModel[] = [
  { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell", contextWindow: 77, maxTokens: 1, input: ["image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
  { id: "black-forest-labs/FLUX.1-dev", name: "FLUX.1 Dev", contextWindow: 77, maxTokens: 1, input: ["image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false },
];

// ─── Full catalog (exported for testing) ────────────────────────────────────

export const NEBIUS_MODELS: NebiusModel[] = [
  ...CHAT_MODELS,
  ...IMAGE_MODELS,
];

export const PROVIDER_ID = "nebius";
export const BASE_URL = "https://api.tokenfactory.us-central1.nebius.com/v1";

// ─── Plugin entry ───────────────────────────────────────────────────────────
// Uses defineSingleProviderPluginEntry (same pattern as built-in DeepSeek,
// OpenAI, etc.) so the gateway handles auth resolution + catalog registration.

function buildNebiusProvider() {
  return {
    baseUrl: BASE_URL,
    api: "openai-completions" as const,
    models: NEBIUS_MODELS,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin: any = defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Nebius Token Factory",
  description:
    "Nebius Token Factory model provider — 44+ open-source models via a single OpenAI-compatible endpoint",
  provider: {
    label: "Nebius Token Factory",
    docsPath: "/providers/nebius",
    auth: [{
      methodId: "api-key",
      label: "Nebius Token Factory API key",
      optionKey: "nebiusApiKey",
      flagName: "--nebius-api-key",
      envVar: "NEBIUS_API_KEY",
      promptMessage: "Enter your Nebius Token Factory API key",
      defaultModel: `${PROVIDER_ID}/Qwen/Qwen3.5-397B-A17B`,
    }],
    catalog: { buildProvider: buildNebiusProvider },
  },
});
export default plugin;
