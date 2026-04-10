import { resolve } from "path";
import { runNebius, runShell } from "./nebius-cli";
import type { EndpointInfo } from "./types";

// Type matching CopilotKit's Action interface from @copilotkit/shared
type Action = {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: "string" | "boolean" | "number";
    description: string;
    required?: boolean;
    enum?: string[];
  }[];
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export const actions: Action[] = [
  {
    name: "checkPrerequisites",
    description:
      "Run the nebius CLI pre-flight check to verify installation, authentication, and project configuration. Always call this before any deployment.",
    parameters: [],
    handler: async () => {
      const scriptPath = resolve(
        process.cwd(),
        "..",
        "nebius-skill",
        "scripts",
        "check-nebius-cli.sh",
      );
      const result = await runShell("bash", [scriptPath]);
      return {
        passed: result.exitCode === 0,
        output: result.stdout || result.stderr,
        exitCode: result.exitCode,
      };
    },
  },

  {
    name: "listEndpoints",
    description:
      "List all Nebius AI endpoints in the current project. Returns endpoint names, states, IPs, and platforms.",
    parameters: [],
    handler: async () => {
      const result = await runNebius(["ai", "endpoint", "list"]);
      if (!result.success) {
        return { error: result.error };
      }

      const data = result.data as { items?: Record<string, unknown>[] };
      const endpoints: EndpointInfo[] = (data.items ?? []).map(
        (item: Record<string, unknown>) => {
          const meta = item.metadata as Record<string, unknown> | undefined;
          const status = item.status as Record<string, unknown> | undefined;
          const spec = item.spec as Record<string, unknown> | undefined;
          const instances = (status?.instances as Record<string, unknown>[]) ?? [];
          const firstInstance = instances[0] as Record<string, unknown> | undefined;

          return {
            id: (meta?.id as string) ?? "",
            name: (meta?.name as string) ?? "",
            state: (status?.state as string) ?? "UNKNOWN",
            publicIp: (firstInstance?.public_ip as string)?.replace(/\/32$/, "") ?? null,
            privateIp: (firstInstance?.private_ip as string) ?? null,
            platform: (spec?.platform as string) ?? null,
            preset: (spec?.preset as string) ?? null,
            image: (spec?.image as string) ?? null,
            createdAt: (meta?.created_at as string) ?? null,
          };
        },
      );

      return { endpoints, count: endpoints.length };
    },
  },

  {
    name: "deployEndpoint",
    description:
      "Deploy an OpenClaw or NemoClaw agent as a Nebius serverless endpoint. Collects all parameters and runs `nebius ai endpoint create`. Returns the endpoint ID and generated dashboard password.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "Endpoint name (lowercase, hyphens ok)",
        required: true,
      },
      {
        name: "image",
        type: "string",
        description:
          'Container image. Use "openclaw" for ghcr.io/colygon/openclaw-serverless:latest, "nemoclaw" for ghcr.io/colygon/nemoclaw-serverless:latest, or a full image URL for custom.',
        required: true,
        enum: ["openclaw", "nemoclaw"],
      },
      {
        name: "region",
        type: "string",
        description: "Nebius region",
        required: true,
        enum: ["eu-north1", "eu-west1", "us-central1"],
      },
      {
        name: "platform",
        type: "string",
        description:
          "Compute platform. IMPORTANT: eu-west1 only supports cpu-d3, not cpu-e2.",
        required: true,
        enum: [
          "cpu-e2",
          "cpu-d3",
          "gpu-h100-sxm",
          "gpu-h200-sxm",
          "gpu-b200-sxm",
          "gpu-l40s-pcie",
        ],
      },
      {
        name: "preset",
        type: "string",
        description:
          'Resource preset, e.g. "2vcpu-8gb" for CPU or "1gpu-16vcpu-200gb" for GPU',
        required: true,
      },
      {
        name: "inferenceProvider",
        type: "string",
        description: "Inference API provider",
        required: true,
        enum: ["token-factory", "openrouter", "huggingface"],
      },
      {
        name: "apiKey",
        type: "string",
        description:
          "API key for the inference provider (Token Factory, OpenRouter, or HuggingFace)",
        required: true,
      },
      {
        name: "modelId",
        type: "string",
        description:
          'Model ID for inference, e.g. "zai-org/GLM-5" or "deepseek-ai/DeepSeek-V3.2"',
        required: true,
      },
      {
        name: "isPublic",
        type: "boolean",
        description: "Whether to assign a public IP (uses quota)",
        required: true,
      },
    ],
    handler: async (args) => {
      const name = args.name as string;
      const imageArg = args.image as string;
      const region = args.region as string;
      const platform = args.platform as string;
      const preset = args.preset as string;
      const inferenceProvider = args.inferenceProvider as string;
      const apiKey = args.apiKey as string;
      const modelId = args.modelId as string;
      const isPublic = args.isPublic as boolean;

      // Resolve image
      const imageMap: Record<string, string> = {
        openclaw: "ghcr.io/colygon/openclaw-serverless:latest",
        nemoclaw: "ghcr.io/colygon/nemoclaw-serverless:latest",
      };
      const image = imageMap[imageArg] ?? imageArg;

      // Generate dashboard password
      const password = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Token Factory URL depends on region
      const tokenFactoryUrl =
        region === "us-central1"
          ? "https://api.tokenfactory.us-central1.nebius.com/v1"
          : "https://api.tokenfactory.nebius.com/v1";

      // Build env vars based on provider
      const envVars: string[] = [
        `INFERENCE_MODEL=${modelId}`,
        `OPENCLAW_WEB_PASSWORD=${password}`,
      ];

      if (inferenceProvider === "token-factory") {
        envVars.push(`TOKEN_FACTORY_API_KEY=${apiKey}`);
        envVars.push(`TOKEN_FACTORY_URL=${tokenFactoryUrl}`);
      } else if (inferenceProvider === "openrouter") {
        envVars.push(`OPENROUTER_API_KEY=${apiKey}`);
        envVars.push(`INFERENCE_URL=https://openrouter.ai/api/v1`);
        envVars.push(`OPENROUTER_PROVIDER_ONLY=nebius`);
      } else if (inferenceProvider === "huggingface") {
        envVars.push(`HUGGINGFACE_API_KEY=${apiKey}`);
        envVars.push(`HF_TOKEN=${apiKey}`);
        envVars.push(`HUGGINGFACE_PROVIDER=nebius`);
      }

      // Build CLI args
      const cliArgs = [
        "ai",
        "endpoint",
        "create",
        "--name",
        name,
        "--image",
        image,
        "--platform",
        platform,
        "--preset",
        preset,
        "--container-port",
        "8080",
        "--container-port",
        "18789",
        "--disk-size",
        "250Gi",
      ];

      for (const env of envVars) {
        cliArgs.push("--env", env);
      }

      if (isPublic) {
        cliArgs.push("--public");
      }

      const result = await runNebius(cliArgs);

      if (!result.success) {
        return { error: result.error, password };
      }

      const data = result.data as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;

      return {
        endpointId: meta?.id ?? null,
        name,
        password,
        message: `Endpoint "${name}" is being created. Use listEndpoints to check when it reaches RUNNING state, then getConnectionInstructions to connect.`,
      };
    },
  },

  {
    name: "deleteEndpoint",
    description:
      "Delete a Nebius AI endpoint. Always confirm with the user before calling this.",
    parameters: [
      {
        name: "endpointId",
        type: "string",
        description: "The endpoint ID to delete",
        required: true,
      },
    ],
    handler: async (args) => {
      const endpointId = args.endpointId as string;
      const result = await runNebius(["ai", "endpoint", "delete", endpointId]);
      if (!result.success) {
        return { error: result.error };
      }
      return { deleted: true, endpointId };
    },
  },

  {
    name: "getConnectionInstructions",
    description:
      "Get connection instructions for a deployed endpoint — SSH tunnel command, dashboard URL, TUI command, and device approval command. Call this after deployment reaches RUNNING state.",
    parameters: [
      {
        name: "endpointId",
        type: "string",
        description: "The endpoint ID",
        required: true,
      },
      {
        name: "password",
        type: "string",
        description:
          "The dashboard password generated during deployment",
        required: true,
      },
    ],
    handler: async (args) => {
      const endpointId = args.endpointId as string;
      const password = args.password as string;

      const result = await runNebius(["ai", "endpoint", "get", endpointId]);
      if (!result.success) {
        return { error: result.error };
      }

      const data = result.data as Record<string, unknown>;
      const status = data.status as Record<string, unknown> | undefined;
      const instances = (status?.instances as Record<string, unknown>[]) ?? [];
      const firstInstance = instances[0] as Record<string, unknown> | undefined;
      const publicIp = (firstInstance?.public_ip as string)?.replace(/\/32$/, "");

      if (!publicIp) {
        return {
          state: status?.state ?? "UNKNOWN",
          message:
            "No public IP yet. The endpoint may still be starting. Try again in a minute.",
        };
      }

      return {
        state: status?.state,
        publicIp,
        sshTunnel: `ssh -f -N -o StrictHostKeyChecking=no -L 28789:${publicIp}:18789 nebius@${publicIp}`,
        dashboardUrl: `http://localhost:28789/#token=${password}&gatewayUrl=ws://localhost:28789`,
        tuiCommand: `openclaw tui --url ws://localhost:28789 --token ${password}`,
        deviceApproval: `ssh -o StrictHostKeyChecking=no nebius@${publicIp} "sudo docker exec \\$(sudo docker ps -q | head -1) env OPENCLAW_GATEWAY_TOKEN=${password} openclaw devices approve --latest"`,
        steps: [
          `1. Set up SSH tunnel: ssh -f -N -o StrictHostKeyChecking=no -L 28789:${publicIp}:18789 nebius@${publicIp}`,
          `2. Approve device pairing: ssh nebius@${publicIp} "sudo docker exec \\$(sudo docker ps -q | head -1) env OPENCLAW_GATEWAY_TOKEN=${password} openclaw devices approve --latest"`,
          `3. Open dashboard: http://localhost:28789/#token=${password}&gatewayUrl=ws://localhost:28789`,
          `   Or use TUI: openclaw tui --url ws://localhost:28789 --token ${password}`,
        ],
      };
    },
  },
];
