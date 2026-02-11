import pino from "pino";
import { createMiddleware } from "hono/factory";
import type { App } from "./types";

// ---------------------------------------------------------------------------
// Pino root logger — configured for Cloudflare Workers (browser.write)
// ---------------------------------------------------------------------------

export const rootLogger = pino({
  level: "debug",
  browser: {
    asObject: true,
    write: {
      debug: (o: object) => console.debug(JSON.stringify(o)),
      info: (o: object) => console.log(JSON.stringify(o)),
      warn: (o: object) => console.warn(JSON.stringify(o)),
      error: (o: object) => console.error(JSON.stringify(o)),
      fatal: (o: object) => console.error(JSON.stringify(o)),
    },
  },
});

// ---------------------------------------------------------------------------
// Redact sensitive headers for logging
// ---------------------------------------------------------------------------

const REDACT_HEADERS = new Set(["x-fal-key", "x-google-key"]);

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? "[REDACTED]" : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pino logger middleware — creates per-request child logger with requestId
// ---------------------------------------------------------------------------

export const pinoLogger = createMiddleware<App>(async (c, next) => {
  const requestId = c.get("requestId");
  const logger = rootLogger.child({ requestId });
  c.set("logger", logger);
  await next();
});

// ---------------------------------------------------------------------------
// Request logger — logs incoming request with redaction; does not consume body
// ---------------------------------------------------------------------------

export const requestLogger = createMiddleware<App>(async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  const headers = redactHeaders(
    Object.fromEntries(c.req.raw.headers.entries()),
  ) as Record<string, string>;

  let body: unknown = null;
  const skipBody = path.startsWith("/restyle");

  if (!skipBody && method !== "GET" && method !== "HEAD") {
    try {
      const cloned = c.req.raw.clone();
      const contentType = cloned.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        body = await cloned.json();
      } else {
        const text = await cloned.text();
        body = text.length > 1000 ? `${text.slice(0, 1000)}...[truncated]` : text;
      }
    } catch {
      body = "<unable to read body>";
    }
  } else if (skipBody) {
    body = "[binary image - omitted]";
  }

  const logger = c.get("logger");
  logger.info(
    { method, path, headers, body },
    "incoming request",
  );

  await next();
});

/**
 * Extracts the user's fal.ai API key from the `X-Fal-Key` request header.
 * Returns 401 if the header is missing or empty.
 */
export const falKeyMiddleware = createMiddleware<App>(async (c, next) => {
  const key = c.req.header("X-Fal-Key");

  if (!key) {
    return c.json(
      { error: "Missing X-Fal-Key header. Provide your fal.ai API key." },
      401,
    );
  }

  c.set("falKey", key);
  await next();
});

/**
 * Extracts the user's Google AI API key from the `X-Google-Key` request header.
 * Returns 401 if the header is missing or empty.
 * Applied only to /wallpaper routes.
 */
export const googleKeyMiddleware = createMiddleware<App>(async (c, next) => {
  const key = c.req.header("X-Google-Key");

  if (!key) {
    return c.json(
      { error: "Missing X-Google-Key header. Provide your Google AI API key." },
      401,
    );
  }

  c.set("googleKey", key);
  await next();
});
