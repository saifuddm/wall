import type { Logger } from "pino";
import type {
  FalModelsResponse,
  FalPriceEntry,
  FalPricingResponse,
} from "./types";

const FAL_PLATFORM_API = "https://api.fal.ai/v1";

/**
 * Fetch image-generation models from fal.ai's model search endpoint.
 * Supports optional free-text search via `q`.
 */
export async function fetchModels(
  apiKey: string,
  opts: { category?: string; q?: string; limit?: number; cursor?: string } = {},
  logger?: Logger,
): Promise<FalModelsResponse> {
  const params = new URLSearchParams();
  params.set("category", opts.category ?? "text-to-image");
  params.set("status", "active");
  if (opts.q) params.set("q", opts.q);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);

  const url = `${FAL_PLATFORM_API}/models?${params}`;
  logger?.info(
    { url: `${FAL_PLATFORM_API}/models`, category: opts.category, q: opts.q, limit: opts.limit },
    "fal_platform_models_request",
  );
  const start = Date.now();

  const res = await fetch(url, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  const elapsed = Date.now() - start;

  if (!res.ok) {
    logger?.error(
      { status: res.status, statusText: res.statusText, elapsed },
      "fal_platform_models_error",
    );
    throw new Error(
      `fal.ai model search failed: ${res.status} ${res.statusText}`,
    );
  }

  logger?.info({ elapsed }, "fal_platform_models_complete");
  return res.json() as Promise<FalModelsResponse>;
}

/**
 * Fetch pricing for a batch of endpoint IDs (max 50 per call).
 * Returns a Map keyed by endpoint_id for easy lookup.
 * Best-effort — returns an empty map on failure.
 */
export async function fetchPricing(
  apiKey: string,
  endpointIds: string[],
  logger?: Logger,
): Promise<Map<string, FalPriceEntry>> {
  if (endpointIds.length === 0) return new Map();

  const params = new URLSearchParams();
  for (const id of endpointIds) {
    params.append("endpoint_id", id);
  }

  logger?.info(
    { endpointCount: endpointIds.length },
    "fal_platform_pricing_request",
  );
  const start = Date.now();

  const res = await fetch(`${FAL_PLATFORM_API}/models/pricing?${params}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  const elapsed = Date.now() - start;

  if (!res.ok) {
    logger?.error(
      { status: res.status, elapsed },
      "fal_platform_pricing_error",
    );
    return new Map();
  }

  logger?.info({ elapsed }, "fal_platform_pricing_complete");

  const data = (await res.json()) as FalPricingResponse;
  const map = new Map<string, FalPriceEntry>();
  for (const p of data.prices) {
    map.set(p.endpoint_id, p);
  }
  return map;
}
