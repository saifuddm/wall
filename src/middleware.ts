import { createMiddleware } from "hono/factory";
import type { App } from "./types";

/**
 * Logs incoming request details (method, path, headers, body) for debugging.
 */
export const requestLogger = createMiddleware<App>(async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  const headers = Object.fromEntries(c.req.raw.headers.entries());

  let body: unknown = null;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await c.req.json();
    } catch {
      try {
        body = await c.req.text();
      } catch {
        body = "<unable to read body>";
      }
    }
  }

  console.log(
    JSON.stringify(
      { incoming_request: { method, path, headers, body } },
      null,
      2,
    ),
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
