import { Hono } from "hono";
import { createFalClient } from "@fal-ai/client";
import type { Image } from "@fal-ai/client/endpoints";
import type { Logger } from "pino";
import type { App } from "../types";
import { wallpaperSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-3-flash-preview";
const FAL_MODEL = "fal-ai/flux-2-pro";

// ---------------------------------------------------------------------------
// Gemini system prompt — instructs Gemini to fill in the dynamic fields
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert prompt engineer for AI image generation, specializing in structured JSON outputs for the Flux image generation model.

Your goal is to generate a JSON object based on a user's input of a City, Time, and Weather.

THE VISUAL STYLE:
The output must ALWAYS describe a specific "Isometric Micro-World" style.
- Geometry: A floating, square-rounded platform isolated in the center. On this platform, the iconic landmarks of the city are condensed and arranged in a pleasing, toy-like but high-fidelity cluster.
- Platform: The platform must be a THIN, SLIM base—minimal vertical thickness (like a thin slab or tile), never a chunky or thick block. The platform size must be CONSISTENT across all cities. CRITICAL: The ENTIRE platform must fit FULLY within the image frame—all four sides and corners visible. No cropping, no edges cut off. Camera framing should show the complete platform with margin/padding from the image edges.
- City layout: The platform must feel like a city miniature. Include roads or pathways connecting the landmarks, and nature elements (stylized trees, greenery, small park areas). AVOID: people, cars, buses, and other small detailed figures—keep the scene clean.
- Proportions: Landmarks must have sensible relative scales. The tallest landmark (e.g., Eiffel Tower, CN Tower) should dominate; smaller buildings proportionally smaller. Avoid oversizing secondary landmarks.
- Render Style: 3D rendered, "Blender Cycles" look, smooth clay or matte plastic textures, soft ambient occlusion, isometric projection (orthographic view), minimalistic but detailed.
- Background & Environment: The platform floats in clear sky. Clouds and sky appear above and behind the city; volumetric stylized clouds in the upper portion (above the tallest landmarks). The area below the platform is a clear empty void. Solid or gradient sky appropriate for time of day above.

LANDMARKS — Per-building subjects with visual descriptions:
- Return 3–5 SEPARATE Landmark subjects (one per building). Do NOT use a single "Landmark Cluster".
- For each landmark: include its name AND clear visual descriptors (shape, structure, materials, distinctive features).
- For landmarks that may NOT be globally iconic (e.g., Rogers Centre, ROM Crystal, Casa Loma): the image model may not recognize names alone—ALWAYS add descriptive details: shape (dome, tower, crystal, arch), structure (angular facets, circular, retractable roof), materials (glass, stone, metal). Example: "Royal Ontario Museum Crystal" → "Deconstructivist crystalline structure with sharp angular glass facets emerging from historic stone base".
- For world-famous landmarks (Eiffel Tower, CN Tower): a brief visual cue helps: "needle-like tower with observation deck", "distinctive dome shape".

INPUT VARIABLES HANDLING:
1. City: Select 3–5 distinct landmarks for that city. Each becomes its own Landmark subject on the platform.
2. Time:
   - Day: Bright, high-key lighting, soft shadows.
   - Sunset/Sunrise: Golden hour, long shadows, warm oranges/purples.
   - Night: Dark blue background, landmarks lit by internal warm lights (windows) or street lamps, glowing effects.
3. Weather:
   - Sunny: Fluffy white clouds, sharp soft shadows.
   - Rainy: Darker grey clouds, glossy wet surfaces on the ground, perhaps subtle rain streaks.
   - Snow: White caps on roofs, white ground, cool tones.

ASPECT RATIO:
- When image is portrait (tall): frame for vertical composition—platform centered with sky above and below. Ensure the full platform fits in the narrower width.
- When image is landscape (wide): frame for horizontal composition—platform centered with margin.
- When square: center the platform with equal margin on all sides.

OUTPUT FORMAT:
Return ONLY the raw JSON object with the following fields: scene, subjects, color_palette, lighting, mood.
- subjects: 3–5 Landmark entries (one per building, each with type "Landmark" and visual description) + 1 Environment entry (type "Environment", clouds/sky in upper background). The platform is pre-defined and injected separately—describe only the buildings and environment ON the platform, not the platform itself.
- color_palette: Include HEX codes when helpful for consistency (e.g., "#87CEEB" for sky blue).`;

// ---------------------------------------------------------------------------
// Gemini response schema — only the 5 dynamic fields
// ---------------------------------------------------------------------------

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    scene: {
      type: "string",
      description:
        "Describe the city content ON the platform: landmarks with sensible proportions (tallest dominates), roads connecting them, trees/greenery, weather, and time of day. The platform itself is pre-defined—do not describe it; focus only on what sits on it. No people, cars, or buses.",
    },
    subjects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["Landmark", "Environment"],
            description:
              "Landmark for each building; Environment for sky/clouds",
          },
          description: {
            type: "string",
            description:
              "For Landmark: building name + visual descriptors (shape, structure, materials). For Environment: clouds, sky. Always add visual details for lesser-known buildings.",
          },
          pose: { type: "string" },
          position: {
            type: "string",
            description:
              "For Landmark: position on platform (e.g., center-back, left side). For Environment: upper background, above city; area below platform is clear empty void.",
          },
        },
        required: ["type", "description", "pose", "position"],
      },
      description:
        "3–5 Landmark entries (one per building) and 1 Environment entry. Landmarks on platform; Environment in upper background; platform is pre-defined elsewhere.",
    },
    color_palette: {
      type: "array",
      items: { type: "string" },
      description:
        "3 colors: dominant sky color, light color, accent color. Use HEX codes when possible (e.g., #87CEEB) for consistency.",
    },
    lighting: {
      type: "string",
      description: "Directional light description based on time and weather",
    },
    mood: {
      type: "string",
      description: "Emotional atmosphere based on time and weather",
    },
  },
  required: ["scene", "subjects", "color_palette", "lighting", "mood"],
} as const;

// ---------------------------------------------------------------------------
// Hardcoded style constants — never change, ensures visual consistency
// ---------------------------------------------------------------------------

const HARDCODED_STYLE = {
  style:
    "Isometric 3D render, orthographic view, claymorphism, soft global illumination, Octane render, cute, miniature world, high fidelity, 4k",
  composition:
    "Isometric centered. Platform fully contained—entire platform visible within frame, no edges cut off, margin from image borders.",
  camera: {
    angle: "high angle isometric view (approx 45 degrees)",
    distance:
      "pulled back so the entire platform fits within frame with margin, full object visibility",
    lens: "50mm orthographic",
  },
  platform:
    "Thin slim platform base, minimal thickness, thin slab, NOT thick or chunky. Platform size consistent. ENTIRE platform FULLY visible within image—all edges and corners contained, no cropping or cut-off. Centered with margin from frame edges.",
  environment:
    "Clouds and sky above and behind the city. Clear empty void below the platform. Volumetric clouds in upper sky only.",
};

/** Hardcoded platform subject — ensures consistent appearance across all generations */
const PLATFORM_SUBJECT = {
  type: "Platform",
  description:
    "Thin slim square platform with rounded corners, minimal vertical thickness like a flat slab or tile, light gray or off-white concrete texture. Entire platform fully visible within frame—all sides and corners contained, no cropping.",
  pose: "Horizontal base",
  position: "Center of composition, floating in clear sky, fully framed within image boundaries",
};

/** Hardcoded urban layout — roads, nature; no people or vehicles */
const URBAN_LAYOUT_SUBJECT = {
  type: "UrbanLayout",
  description:
    "Light gray roads or pathways connecting landmarks on the platform. Stylized green trees and small park areas along paths. City miniature feel. No people, cars, buses, or small figures.",
  pose: "Flat on platform surface",
  position: "On platform surface, between and around landmarks",
};

// ---------------------------------------------------------------------------
// Gemini API call — generates the 5 dynamic prompt fields
// ---------------------------------------------------------------------------

interface GeminiDynamicFields {
  scene: string;
  subjects: Array<{
    type: string;
    description: string;
    pose: string;
    position: string;
  }>;
  color_palette: string[];
  lighting: string;
  mood: string;
}

async function generatePromptWithGemini(
  apiKey: string,
  city: string,
  weather: string,
  datetime: string,
  width: number,
  height: number,
  logger?: Logger,
): Promise<GeminiDynamicFields> {
  const orientation =
    height > width
      ? "portrait/vertical (tall)"
      : width > height
        ? "landscape/horizontal (wide)"
        : "square";
  const userMessage = `City: ${city}\nWeather: ${weather}\nTime: ${datetime}\nImage dimensions: ${width}×${height} (${orientation})`;

  logger?.info(
    { model: GEMINI_MODEL, userMessage, width, height },
    "gemini_request",
  );
  const geminiStart = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            parts: [{ text: userMessage }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const elapsed = Date.now() - geminiStart;
    logger?.error(
      {
        model: GEMINI_MODEL,
        status: response.status,
        elapsed,
        errorBody: errorBody.slice(0, 500),
      },
      "gemini_error",
    );
    throw new Error(
      `Gemini API returned ${response.status}: ${errorBody}`,
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const elapsed = Date.now() - geminiStart;
    logger?.error({ model: GEMINI_MODEL, elapsed }, "gemini_empty_response");
    throw new Error("Gemini returned an empty response");
  }

  const result = JSON.parse(text) as GeminiDynamicFields;
  const elapsed = Date.now() - geminiStart;
  const responseSummary = {
    sceneLength: result.scene?.length ?? 0,
    subjectsCount: result.subjects?.length ?? 0,
    colorPalette: result.color_palette,
    lighting: result.lighting,
    mood: result.mood,
  };
  logger?.info(
    { model: GEMINI_MODEL, elapsed, responseSummary },
    "gemini_response",
  );
  return result;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const wallpaper = new Hono<App>();

wallpaper.post("/", async (c) => {
  // Parse JSON body
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid or missing JSON body" }, 400);
  }

  // Validate
  const parsed = wallpaperSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const { city, weather, datetime, width, height } = parsed.data;

  // ── Step 1: Generate dynamic prompt fields with Gemini ────────────

  const googleApiKey = c.get("googleKey");
  if (!googleApiKey) {
    return c.json(
      { error: "Missing X-Google-Key header. Provide your Google AI API key." },
      401,
    );
  }

  const logger = c.get("logger");
  let geminiResult: GeminiDynamicFields;
  try {
    geminiResult = await generatePromptWithGemini(
      googleApiKey,
      city,
      weather,
      datetime,
      width,
      height,
      logger,
    );
  } catch (err) {
    logger.error({ err }, "Gemini prompt generation error");
    return c.json(
      {
        error: "Prompt generation failed",
        message:
          err instanceof Error ? err.message : "Failed to generate prompt",
      },
      502,
    );
  }

  // ── Step 2: Merge dynamic fields with hardcoded style + inject platform subject ───
  // Token order: Gemini scene/subjects first (takes precedence), then hardcoded style modifiers

  const orientationHint =
    height > width
      ? "Vertical portrait framing—platform fully contained, centered, with sky above and below."
      : width > height
        ? "Horizontal landscape framing—platform fully contained, centered."
        : "Square framing—platform centered with equal margin.";

  const fullPrompt = {
    // Gemini content first — model prioritizes earlier tokens
    scene: geminiResult.scene,
    subjects: [
      PLATFORM_SUBJECT,
      URBAN_LAYOUT_SUBJECT,
      ...geminiResult.subjects,
    ],
    color_palette: geminiResult.color_palette,
    lighting: geminiResult.lighting,
    mood: geminiResult.mood,
    // Hardcoded style modifiers follow
    style: HARDCODED_STYLE.style,
    composition: `${HARDCODED_STYLE.composition} ${orientationHint}`,
    camera: HARDCODED_STYLE.camera,
    platform: HARDCODED_STYLE.platform,
    environment: HARDCODED_STYLE.environment,
  };

  const promptString = JSON.stringify(fullPrompt);

  logger.info(
    { city, weather, datetime, width, height, promptLength: promptString.length },
    "wallpaper_prompt_ready",
  );

  // ── Step 3: Submit to fal.ai queue (async — avoids request timeout) ───

  const fal = createFalClient({ credentials: c.get("falKey") });

  const falInput = {
    prompt: promptString,
    image_size: { width, height },
    output_format: "png",
  };
  logger.info(
    { model: FAL_MODEL, promptLength: promptString.length, image_size: { width, height } },
    "fal_queue_submit_request",
  );
  const falSubmitStart = Date.now();

  try {
    const queueStatus = await fal.queue.submit(FAL_MODEL, {
      input: falInput,
    });

    const elapsed = Date.now() - falSubmitStart;
    const requestId = queueStatus.request_id;
    logger.info(
      { model: FAL_MODEL, falRequestId: requestId, elapsed },
      "fal_queue_submit_complete",
    );
    const statusUrl = queueStatus.status_url ?? `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/status`;
    const responseUrl = queueStatus.response_url ?? `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}`;

    return c.json(
      {
        request_id: requestId,
        status_url: statusUrl,
        response_url: responseUrl,
        message:
          "Image generation queued. Poll GET /wallpaper/status/:requestId until status is COMPLETED, then fetch image from GET /wallpaper/result/:requestId",
      },
      202,
    );
  } catch (err) {
    const elapsed = Date.now() - falSubmitStart;
    logger.error({ err, model: FAL_MODEL, elapsed }, "fal_queue_submit_error");

    const message =
      err instanceof Error ? err.message : "Failed to queue image generation";
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? ((err as Record<string, unknown>).status as number)
        : 500;

    return c.json(
      {
        error: "Queue submission failed",
        message,
      },
      status >= 400 && status < 600 ? (status as 500) : 500,
    );
  }
});

// ---------------------------------------------------------------------------
// Status polling — check progress of a queued wallpaper generation
// Room to expand: a future GET /wallpaper/wait/:id could reuse getQueueStatus
// and long-poll until COMPLETED (hybrid approach).
// ---------------------------------------------------------------------------

async function getQueueStatus(
  fal: ReturnType<typeof createFalClient>,
  requestId: string,
  logger?: Logger,
): Promise<
  | { status: string; queue_position?: number; image_url?: string }
  | { error: string; status?: number }
> {
  try {
    logger?.info({ model: FAL_MODEL, requestId }, "fal_queue_status_request");
    const statusStart = Date.now();
    const status = await fal.queue.status(FAL_MODEL, {
      requestId,
    });
    const elapsed = Date.now() - statusStart;
    logger?.info(
      { model: FAL_MODEL, requestId, status: status.status, elapsed },
      "fal_queue_status_complete",
    );

    const queuePosition =
      status.status === "IN_QUEUE" && "queue_position" in status
        ? (status as { queue_position: number }).queue_position
        : undefined;
    const base: { status: string; queue_position?: number } = {
      status: status.status,
      ...(queuePosition !== undefined && { queue_position: queuePosition }),
    };

    if (status.status === "COMPLETED") {
      logger?.info({ model: FAL_MODEL, requestId }, "fal_queue_result_request");
      const resultStart = Date.now();
      const result = await fal.queue.result(FAL_MODEL, { requestId });
      const resultElapsed = Date.now() - resultStart;
      const data = result.data as { images?: Image[] };
      const imageUrl = data.images?.[0]?.url;
      logger?.info(
        { model: FAL_MODEL, requestId, elapsed: resultElapsed, imageUrl },
        "fal_queue_result_complete",
      );
      return { ...base, image_url: imageUrl ?? undefined };
    }

    return base;
  } catch (err) {
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? (err as Record<string, unknown>).status as number
        : 500;
    const message =
      err instanceof Error ? err.message : "Failed to get queue status";
    logger?.error(
      { err, model: FAL_MODEL, requestId },
      "fal_queue_status_error",
    );
    return { error: message, status };
  }
}

wallpaper.get("/status/:requestId", async (c) => {
  const requestId = c.req.param("requestId");
  if (!requestId) {
    return c.json({ error: "Missing request_id" }, 400);
  }

  const fal = createFalClient({ credentials: c.get("falKey") });
  const outcome = await getQueueStatus(fal, requestId, c.get("logger"));

  if ("error" in outcome) {
    const httpStatus =
      outcome.status && outcome.status >= 400 && outcome.status < 600
        ? outcome.status
        : 500;
    return c.json({ error: outcome.error }, httpStatus as 400 | 404 | 500);
  }

  return c.json(outcome);
});

// ---------------------------------------------------------------------------
// Result — fetch and stream the generated image (when status is COMPLETED)
// ---------------------------------------------------------------------------

wallpaper.get("/result/:requestId", async (c) => {
  const requestId = c.req.param("requestId");
  if (!requestId) {
    return c.json({ error: "Missing request_id" }, 400);
  }

  const fal = createFalClient({ credentials: c.get("falKey") });
  const logger = c.get("logger");

  logger.info({ model: FAL_MODEL, requestId }, "fal_queue_result_request");
  const resultStart = Date.now();

  try {
    const result = await fal.queue.result(FAL_MODEL, { requestId });
    const elapsed = Date.now() - resultStart;
    const data = result.data as { images?: Image[] };

    if (!data.images || data.images.length === 0) {
      logger.warn({ model: FAL_MODEL, requestId, elapsed }, "fal_queue_result_no_images");
      return c.json(
        { error: "No image was generated by the model" },
        500,
      );
    }

    const image = data.images[0];
    logger.info(
      { model: FAL_MODEL, requestId, elapsed, imageUrl: image.url },
      "fal_queue_result_complete",
    );

    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      return c.json(
        { error: "Failed to fetch the generated image from CDN" },
        502,
      );
    }

    return new Response(imageResponse.body, {
      headers: {
        "Content-Type":
          image.content_type ||
          imageResponse.headers.get("Content-Type") ||
          "image/png",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const elapsed = Date.now() - resultStart;
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? (err as Record<string, unknown>).status as number
        : 500;

    logger.error({ err, model: FAL_MODEL, requestId, elapsed }, "fal_queue_result_error");

    if (status === 400) {
      return c.json(
        {
          status: "IN_PROGRESS",
          message:
            "Generation not complete yet. Poll GET /wallpaper/status/:requestId until status is COMPLETED.",
        },
        202,
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to get result";
    const httpStatus = status >= 400 && status < 600 ? status : 500;
    return c.json({ error: message }, httpStatus as 400 | 404 | 500);
  }
});

export default wallpaper;
