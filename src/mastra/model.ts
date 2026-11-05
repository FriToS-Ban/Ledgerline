import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

type NvidiaModel = ReturnType<ReturnType<typeof createOpenAICompatible>["chatModel"]>;
export type ResolvedModel = string | NvidiaModel;

export type Provider = "google" | "anthropic" | "openai" | "nvidia";

function googleKey(): string | undefined {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
}

const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

/**
 * Which LLM writes the memo / polishes extraction. Set LLM_PROVIDER=nvidia|google|anthropic|openai
 * to choose; otherwise the first provider that has a key wins (google, anthropic, openai, nvidia).
 * Pay/hold never depends on this.
 */
export function activeProvider(): Provider | null {
  const has: Record<Provider, boolean> = {
    google: !!googleKey(),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
  };
  const want = process.env.LLM_PROVIDER?.toLowerCase() as Provider | undefined;
  if (want && has[want]) return want;
  return (["google", "anthropic", "openai", "nvidia"] as Provider[]).find((p) => has[p]) ?? null;
}

export function hasLlmKey(): boolean {
  return activeProvider() !== null;
}

let nvidia: NvidiaModel | null = null;

/**
 * NVIDIA NIM (OpenAI-compatible). The Nemotron models "think" by default and can spend the whole
 * token budget on reasoning and return empty content, so we switch thinking off (NVIDIA_THINKING=1 to keep it).
 */
function nvidiaModel(): NvidiaModel {
  if (nvidia) return nvidia;
  const think = process.env.NVIDIA_THINKING === "1";
  const provider = createOpenAICompatible({
    name: "nvidia",
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NVIDIA_API_KEY,
    fetch: async (input, init) => {
      if (!think && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          body.chat_template_kwargs = { ...(body.chat_template_kwargs ?? {}), enable_thinking: false };
          return fetch(input, { ...init, body: JSON.stringify(body) });
        } catch {
          /* not JSON: send as is */
        }
      }
      return fetch(input, init);
    },
  });
  nvidia = provider.chatModel(process.env.NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL);
  return nvidia;
}

export function resolveMastraModel(): ResolvedModel | null {
  switch (activeProvider()) {
    case "google":
      return process.env.GOOGLE_MODEL ?? "google/gemini-3.5-flash-lite";
    case "anthropic":
      return "anthropic/claude-sonnet-4-5";
    case "openai":
      return "openai/gpt-4o";
    case "nvidia":
      return nvidiaModel();
    default:
      return null;
  }
}

export function modelLabel(): string | null {
  switch (activeProvider()) {
    case "google":
      return process.env.GOOGLE_MODEL ?? "google/gemini-3.5-flash-lite";
    case "anthropic":
      return "anthropic/claude-sonnet-4-5";
    case "openai":
      return "openai/gpt-4o";
    case "nvidia":
      return `nvidia/${(process.env.NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL).replace(/^nvidia\//, "")}`;
    default:
      return null;
  }
}
