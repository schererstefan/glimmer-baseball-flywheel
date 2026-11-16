import { MockProvider } from "./mock.ts";
import { MuseSparkProvider } from "./muse-spark.ts";
import { OllamaProvider } from "./ollama.ts";
import type { ModelProvider } from "./types.ts";

export const VALID_PROVIDERS = ["mock", "glimmer", "ollama", "spark"] as const;

export type ProviderName = (typeof VALID_PROVIDERS)[number];

/**
 * Shared `--provider` selection so eval, flywheel, and CLI agree:
 *   mock            -> MockProvider
 *   glimmer/ollama  -> OllamaProvider
 *   spark           -> MuseSparkProvider
 * Unknown names throw instead of silently falling back to Mock.
 */
export function selectProvider(name: string, model?: string): ModelProvider {
  if (!(VALID_PROVIDERS as readonly string[]).includes(name)) {
    throw new Error(
      `Unknown --provider "${name}". Valid values: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  if (name === "glimmer" || name === "ollama")
    return new OllamaProvider({ model });
  if (name === "spark") return new MuseSparkProvider({ model });
  return new MockProvider(model ?? "mock-glimmer-v1");
}
