import { Hono } from "hono";
import type { App } from "../types";
import { fetchModels, fetchPricing } from "../fal";

const models = new Hono<App>();

models.get("/", async (c) => {
  const category = c.req.query("category") ?? "text-to-image";
  const q = c.req.query("q");
  const limit = Number(c.req.query("limit")) || 50;
  const cursor = c.req.query("cursor");

  const logger = c.get("logger");
  try {
    // 1. Fetch models from fal.ai platform API
    const modelsRes = await fetchModels(
      c.get("falKey"),
      {
        category,
        q: q ?? undefined,
        limit,
        cursor: cursor ?? undefined,
      },
      logger,
    );

    // 2. Fetch pricing for the returned models
    const endpointIds = modelsRes.models.map((m) => m.endpoint_id);
    const pricing = await fetchPricing(c.get("falKey"), endpointIds, logger);

    // 3. Merge into a clean response
    const merged = modelsRes.models.map((m) => {
      const price = pricing.get(m.endpoint_id);
      return {
        id: m.endpoint_id,
        name: m.metadata.display_name,
        description: m.metadata.description,
        category: m.metadata.category,
        status: m.metadata.status,
        tags: m.metadata.tags,
        thumbnail_url: m.metadata.thumbnail_url ?? null,
        pricing: price
          ? {
              unit_price: price.unit_price,
              unit: price.unit,
              currency: price.currency,
            }
          : null,
      };
    });

    return c.json({
      models: merged,
      has_more: modelsRes.has_more,
      next_cursor: modelsRes.next_cursor,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch models");
    return c.json(
      {
        error: "Failed to fetch models from fal.ai",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      502,
    );
  }
});

export default models;
