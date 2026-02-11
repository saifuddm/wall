import { Hono } from "hono";
import type { App } from "./types";
import { requestLogger, falKeyMiddleware } from "./middleware";
import models from "./routes/models";
import generate from "./routes/generate";
import restyle from "./routes/restyle";

const app = new Hono<App>();

// -- Log incoming requests (before auth) ------------------------------------

app.use("*", requestLogger);

// -- Require X-Fal-Key header on protected routes ---------------------------

app.use("/models/*", falKeyMiddleware);
app.use("/generate/*", falKeyMiddleware);
app.use("/restyle/*", falKeyMiddleware);

// -- Global error handler ---------------------------------------------------

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      message:
        err instanceof Error ? err.message : "An unexpected error occurred",
    },
    500,
  );
});

// -- Health check -----------------------------------------------------------

app.get("/", (c) => {
  return c.json({
    name: "Wallpaper Generator API",
    version: "1.0.0",
    endpoints: {
      "GET /": "Health check",
      "GET /models": "List fal.ai image models with pricing (?category=text-to-image&q=&limit=50&cursor=)",
      "POST /generate": "Generate a wallpaper image",
      "POST /restyle": "Restyle an image with an artistic style (image-to-image)",
    },
  });
});

// -- Routes -----------------------------------------------------------------

app.route("/models", models);
app.route("/generate", generate);
app.route("/restyle", restyle);

export default app;
