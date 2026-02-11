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
): Promise<FalModelsResponse> {
  const params = new URLSearchParams();
  params.set("category", opts.category ?? "text-to-image");
  params.set("status", "active");
  if (opts.q) params.set("q", opts.q);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);

  const res = await fetch(`${FAL_PLATFORM_API}/models?${params}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(
      `fal.ai model search failed: ${res.status} ${res.statusText}`,
    );
  }

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
): Promise<Map<string, FalPriceEntry>> {
  if (endpointIds.length === 0) return new Map();

  const params = new URLSearchParams();
  for (const id of endpointIds) {
    params.append("endpoint_id", id);
  }

  const res = await fetch(`${FAL_PLATFORM_API}/models/pricing?${params}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  if (!res.ok) {
    console.error(`fal.ai pricing fetch failed: ${res.status}`);
    return new Map();
  }

  const data = (await res.json()) as FalPricingResponse;
  const map = new Map<string, FalPriceEntry>();
  for (const p of data.prices) {
    map.set(p.endpoint_id, p);
  }
  return map;
}
