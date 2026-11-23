import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelWithRetries } from "@mastra/core/agent";

type NvidiaModel = ReturnType<ReturnType<typeof createOpenAICompatible>["chatModel"]>;
/** An ordered fallback chain: Mastra tries each entry until one answers. */
export type ModelChain = ModelWithRetries[];

export type Provider = "google" | "anthropic" | "openai" | "nvidia";
const PROVIDER_ORDER: Provider[] = ["google", "anthropic", "openai", "nvidia"];

function googleKey(): string | undefined {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
}

const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

/**
 * Google retires Gemini model ids on its own schedule (production broke in Nov 2026 when
 * gemini-2.5-flash was withdrawn for new users). The configured GOOGLE_MODEL is tried first, then
 * these current free-tier ids, so one retirement never takes the AI features down.
 */
const GOOGLE_FALLBACK_MODELS = ["google/gemini-3.8-flash", "google/gemini-3.5-flash", "google/gemini-3.5-flash-lite"];
const ANTHROPIC_MODEL = "anthropic/claude-sonnet-4-5";
const OPENAI_MODEL = "openai/gpt-4o";

function hasKey(p: Provider): boolean {
  switch (p) {
    case "google":
      return !!googleKey();
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "nvidia":
      return !!process.env.NVIDIA_API_KEY;
  }
}

/**
 * Which LLM writes the memo / polishes extraction. Set LLM_PROVIDER=nvidia|google|anthropic|openai
 * to choose; otherwise the first provider that has a key wins (google, anthropic, openai, nvidia).
 * Pay/hold never depends on this.
 */
export function activeProvider(): Provider | null {
  const want = process.env.LLM_PROVIDER?.toLowerCase() as Provider | undefined;
  if (want && PROVIDER_ORDER.includes(want) && hasKey(want)) return want;
  return PROVIDER_ORDER.find(hasKey) ?? null;
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

function googleModels(): string[] {
  const configured = process.env.GOOGLE_MODEL?.trim();
  const first = configured ? (configured.includes("/") ? configured : `google/${configured}`) : null;
  return [...new Set([first, ...GOOGLE_FALLBACK_MODELS].filter((m): m is string => !!m))];
}

function entriesFor(p: Provider): ModelChain {
  switch (p) {
    case "google":
      return googleModels().map((model) => ({ id: model, model, maxRetries: 0 }));
    case "anthropic":
      return [{ id: ANTHROPIC_MODEL, model: ANTHROPIC_MODEL, maxRetries: 1 }];
    case "openai":
      return [{ id: OPENAI_MODEL, model: OPENAI_MODEL, maxRetries: 1 }];
    case "nvidia":
      return [{ id: "nvidia", model: nvidiaModel(), maxRetries: 1 }];
  }
}

function chain(providers: Provider[]): ModelChain | null {
  const active = activeProvider();
  const ordered = [...new Set([active, ...PROVIDER_ORDER])].filter(
    (p): p is Provider => !!p && providers.includes(p) && hasKey(p),
  );
  const entries = ordered.flatMap(entriesFor);
  return entries.length ? entries : null;
}

/** Text model chain: the chosen provider first, then every other provider that has a key. */
export function resolveMastraModel(): ModelChain | null {
  return chain(PROVIDER_ORDER);
}

/**
 * Models that can read a PDF/image directly. NVIDIA Nemotron is text-only, so it is never in this
 * chain even when LLM_PROVIDER=nvidia.
 */
export function resolveVisionModel(): ModelChain | null {
  return chain(["google", "anthropic", "openai"]);
}

export function modelLabel(): string | null {
  switch (activeProvider()) {
    case "google":
      return googleModels()[0];
    case "anthropic":
      return ANTHROPIC_MODEL;
    case "openai":
      return OPENAI_MODEL;
    case "nvidia":
      return `nvidia/${(process.env.NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL).replace(/^nvidia\//, "")}`;
    default:
      return null;
  }
}
