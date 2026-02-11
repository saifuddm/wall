import { Hono } from "hono";
import { createFalClient } from "@fal-ai/client";
import type { Image } from "@fal-ai/client/endpoints";
import type { App } from "../types";
import { restyleHeadersSchema } from "../schemas";

const DEFAULT_MODEL = "fal-ai/image-editing/style-transfer";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// ---------------------------------------------------------------------------
// Aspect-ratio matching — fal only accepts a fixed set of ratios
// ---------------------------------------------------------------------------

const SUPPORTED_RATIOS = [
  "21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21",
] as const;

type AspectRatio = (typeof SUPPORTED_RATIOS)[number];

function closestAspectRatio(width: number, height: number): AspectRatio {
  const target = width / height;
  let best: AspectRatio = "1:1";
  let bestDiff = Infinity;

  for (const ratio of SUPPORTED_RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    const diff = Math.abs(w / h - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------

const restyle = new Hono<App>();

restyle.post("/", async (c) => {
  // Validate Content-Type
  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return c.json(
      {
        error:
          "Content-Type must be image/png, image/jpeg, image/webp, image/heic, or image/heif",
      },
      400,
    );
  }

  // Read style and size from headers
  const style = c.req.header("X-Style") ?? "";
  const widthRaw = c.req.header("X-Width") ?? "";
  const heightRaw = c.req.header("X-Height") ?? "";

  const parsed = restyleHeadersSchema.safeParse({
    style,
    width: widthRaw ? Number(widthRaw) : undefined,
    height: heightRaw ? Number(heightRaw) : undefined,
  });

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

  // Build the upload blob — for HEIC/HEIF we convert to JPEG first via the
  // Cloudflare Images binding.  We pass the raw request body stream directly
  // to IMAGES.input() to avoid an ArrayBuffer → Blob → stream() round-trip
  // that causes "Network connection lost" errors in remote mode.
  const isHeic = contentType === "image/heic" || contentType === "image/heif";
  let uploadBlob: Blob;

  if (isHeic) {
    const bodyStream = c.req.raw.body;
    if (!bodyStream) {
      return c.json({ error: "Request body is empty — send the image as the raw body" }, 400);
    }

    try {
      const converted = await c.env.IMAGES.input(bodyStream)
        .output({ format: "image/jpeg", quality: 90 });
      const jpegResponse = converted.response();
      const jpegBuffer = await jpegResponse.arrayBuffer();

      if (jpegBuffer.byteLength === 0) {
        return c.json(
          { error: "HEIC/HEIF conversion produced an empty image" },
          502,
        );
      }

      c.get("logger").info(
        { bytes: jpegBuffer.byteLength },
        "HEIC → JPEG conversion OK",
      );
      uploadBlob = new Blob([jpegBuffer], { type: "image/jpeg" });
    } catch (conversionErr) {
      c.get("logger").error({ err: conversionErr }, "HEIC/HEIF conversion failed");
      return c.json(
        {
          error: "Failed to convert HEIC/HEIF image to JPEG",
          message: conversionErr instanceof Error
            ? conversionErr.message
            : "Unknown conversion error",
        },
        502,
      );
    }
  } else {
    const imageBuffer = await c.req.arrayBuffer();
    if (imageBuffer.byteLength === 0) {
      return c.json({ error: "Request body is empty — send the image as the raw body" }, 400);
    }
    uploadBlob = new Blob([imageBuffer], { type: contentType });
  }

  // Build fal.ai client with the user's API key
  const fal = createFalClient({ credentials: c.get("falKey") });
  const logger = c.get("logger");
  const aspectRatio = closestAspectRatio(parsed.data.width, parsed.data.height);

  // Upload to fal storage — avoids large base64 data URLs in the API request
  logger.info({ blobSize: uploadBlob.size }, "fal_storage_upload_start");
  const uploadStart = Date.now();
  const imageUrl = await fal.storage.upload(uploadBlob);
  logger.info(
    { blobSize: uploadBlob.size, imageUrl, elapsed: Date.now() - uploadStart },
    "fal_storage_upload_complete",
  );

  const subscribeInput = {
    image_url: imageUrl,
    prompt: parsed.data.style,
    aspect_ratio: aspectRatio,
  };
  logger.info(
    { model: DEFAULT_MODEL, ...subscribeInput },
    "fal_subscribe_request",
  );
  const subscribeStart = Date.now();

  try {
    const result = await fal.subscribe(DEFAULT_MODEL, {
      input: subscribeInput,
    });

    const elapsed = Date.now() - subscribeStart;
    const data = result.data as { images?: Image[] };

    if (!data.images || data.images.length === 0) {
      logger.warn({ model: DEFAULT_MODEL, elapsed }, "fal_subscribe_no_images");
      return c.json(
        { error: "No image was generated by the model" },
        500,
      );
    }

    const resultImage = data.images[0];
    logger.info(
      {
        model: DEFAULT_MODEL,
        elapsed,
        imageUrl: resultImage.url,
      },
      "fal_subscribe_complete",
    );

    // Fetch the generated image binary from fal's CDN
    const imageResponse = await fetch(resultImage.url);
    if (!imageResponse.ok) {
      return c.json(
        { error: "Failed to fetch the generated image from CDN" },
        502,
      );
    }

    // Stream the image back as a binary response
    return new Response(imageResponse.body, {
      headers: {
        "Content-Type":
          resultImage.content_type ||
          imageResponse.headers.get("Content-Type") ||
          "image/jpeg",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const elapsed = Date.now() - subscribeStart;
    logger.error({ err, model: DEFAULT_MODEL, elapsed }, "fal_subscribe_error");

    const message =
      err instanceof Error ? err.message : "Image restyle failed";
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? ((err as Record<string, unknown>).status as number)
        : 500;

    return c.json(
      {
        error: "Restyle failed",
        message,
      },
      status >= 400 && status < 600 ? (status as 500) : 500,
    );
  }
});

export default restyle;
