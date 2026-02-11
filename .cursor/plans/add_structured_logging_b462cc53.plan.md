---
name: Add structured logging
overview: Add structured JSON logging to the Hono Cloudflare Worker app using pino (with browser.write for CF Workers compatibility), Hono's built-in requestId middleware, and a custom pino logger middleware. Enable Cloudflare Workers Logs for automatic JSON indexing.
todos:
  - id: install-pino
    content: Install pino and @types/pino
    status: pending
  - id: enable-observability
    content: Uncomment observability block in wrangler.jsonc
    status: pending
  - id: create-logger-middleware
    content: Create src/middleware/logger.ts with pino root logger + custom Hono middleware
    status: pending
  - id: update-types
    content: Add pino Logger to Hono Variables type in src/types.ts
    status: pending
  - id: register-middleware
    content: Register requestId + pino logger middleware in src/index.ts
    status: pending
  - id: log-generate
    content: Add structured pino logging to src/routes/generate.ts
    status: pending
  - id: log-models
    content: Add structured pino logging to src/routes/models.ts
    status: pending
  - id: log-fal
    content: Add structured pino logging to src/fal.ts
    status: pending
isProject: false
---

# Add Structured Logging with Pino

## Approach

Use **pino** directly (no `hono-pino` wrapper) with a custom Hono middleware. Pino gives us structured NDJSON logging, log-level filtering, child loggers with inherited context, and error serializers. For Cloudflare Workers compatibility, configure pino's `browser.write` mode so output goes through `console.*` methods, which CF Workers Logs automatically captures and indexes.

Pair with Hono's built-in `requestId` middleware to correlate all logs for a given request.

---

## Implementation Plan

### 1. Install pino

```bash
npm install pino
npm install -D @types/pino
```

Single new runtime dependency. The `nodejs_compat` flag in [wrangler.jsonc](wrangler.jsonc) is already enabled.

### 2. Enable Cloudflare Workers Logs

Uncomment the `observability` block in [wrangler.jsonc](wrangler.jsonc):

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1
}
```

This tells Cloudflare to capture all `console.*` output and index JSON fields automatically.

### 3. Create pino root logger and custom Hono middleware

Create `**src/middleware/logger.ts**` with two parts:

**Part A -- Root pino instance** configured for Cloudflare Workers:

```typescript
import pino from "pino";

export const rootLogger = pino({
  level: "debug",
  browser: {
    asObject: true,
    write: {
      debug: (o) => console.debug(JSON.stringify(o)),
      info:  (o) => console.log(JSON.stringify(o)),
      warn:  (o) => console.warn(JSON.stringify(o)),
      error: (o) => console.error(JSON.stringify(o)),
      fatal: (o) => console.error(JSON.stringify(o)),
    },
  },
});
```

The `browser.write` config bypasses pino's Node.js transport system (which doesn't work in Workers) and routes output through `console.*` for CF Workers Logs to capture.

**Part B -- Custom Hono middleware** that creates a child logger per request:

```typescript
import { createMiddleware } from "hono/factory";
import type { App } from "../types";

export const pinoLogger = () =>
  createMiddleware<App>(async (c, next) => {
    const requestId = c.get("requestId");
    const logger = rootLogger.child({ requestId });

    c.set("logger", logger);

    const start = Date.now();
    const { method } = c.req;
    const path = c.req.path;

    logger.info({ method, path }, "incoming request");

    await next();

    const elapsed = Date.now() - start;
    logger.info({ method, path, status: c.res.status, elapsed }, "request completed");
  });
```

Each request gets its own child logger with `requestId` automatically included in every log line.

### 4. Update types

In [src/types.ts](src/types.ts), add pino's `Logger` to the Hono `Variables` type:

```typescript
import type { Logger } from "pino";

type Variables = {
  requestId: string;
  logger: Logger;
};

export type App = { Bindings: Bindings; Variables: Variables };
```

This makes `c.var.logger` fully typed across all route handlers.

### 5. Register middleware in `src/index.ts`

In [src/index.ts](src/index.ts), register the middleware stack:

```typescript
import { requestId } from "hono/request-id";
import { pinoLogger } from "./middleware/logger";

app.use("*", requestId());
app.use("*", pinoLogger());
```

`requestId` must come first so the pino middleware can read it. Also update `app.onError` to use the structured logger (if available on context) with full error details including stack trace.

### 6. Add logging to the generate route

In [src/routes/generate.ts](src/routes/generate.ts), access `c.var.logger` and add logs at:

- **After validation**: log validated params (prompt length, dimensions, selected model)
- **Before fal.ai call**: log model, image size, enhanced prompt summary (first ~100 chars)
- **After fal.ai response**: log success with image URL and generation timing
- **CDN fetch**: log the fetch of the generated image from fal CDN
- **Errors**: replace bare `console.error` (line 156) with `logger.error()` including error object for pino's serializer

### 7. Add logging to the models route

In [src/routes/models.ts](src/routes/models.ts), access `c.var.logger` and add:

- Log incoming request params (category, query, limit, cursor)
- Log fal.ai API response (model count, has next cursor)
- Replace `console.error` (line 53) with `logger.error()`

### 8. Add logging to fal.ts

In [src/fal.ts](src/fal.ts), pass the logger as a parameter to `fetchModels()` and `fetchPricing()`:

```typescript
export async function fetchModels(
  apiKey: string,
  opts: { ... },
  logger?: Logger,
): Promise<FalModelsResponse> {
```

- Log outgoing HTTP request (URL, method) before `fetch()`
- Log response (status code, timing) after `fetch()`
- Replace `console.error` (line 58) with `logger.error()` in `fetchPricing()`

---

## Files Changed

- **[package.json](package.json)** -- add `pino` dependency and `@types/pino` dev dependency
- **[wrangler.jsonc](wrangler.jsonc)** -- enable `observability`
- `**src/middleware/logger.ts**` (new) -- pino root logger + custom Hono middleware
- **[src/types.ts](src/types.ts)** -- add `Logger` to Hono Variables type
- **[src/index.ts](src/index.ts)** -- register `requestId()` + `pinoLogger()` middleware, update error handler
- **[src/routes/generate.ts](src/routes/generate.ts)** -- add logging at validation/fal-call/response/error points
- **[src/routes/models.ts](src/routes/models.ts)** -- add logging at request/response/error points
- **[src/fal.ts](src/fal.ts)** -- accept optional logger param, add logging to outgoing API calls

## What This Gives You

- **Request correlation**: every log line includes `requestId` via pino child loggers
- **Log-level filtering**: set `level: "info"` in production to suppress debug logs at near-zero cost
- **Structured NDJSON output**: automatically indexed by Cloudflare Workers Logs, also parseable by external tools (Datadog, Loki, Elastic)
- **Error serialization**: pino extracts `message`, `stack`, `type`, `code` from Error objects automatically
- **Child logger inheritance**: context fields added via `.child()` propagate to all downstream logs
- **Single dependency**: only `pino` added, no `hono-pino` wrapper

