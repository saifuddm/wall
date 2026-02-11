import { Hono } from "hono";
import type { App } from "./types";
import { requestLogger, falKeyMiddleware, googleKeyMiddleware } from "./middleware";
import models from "./routes/models";
import generate from "./routes/generate";
import restyle from "./routes/restyle";
import wallpaper from "./routes/wallpaper";

const app = new Hono<App>();

// -- Log incoming requests (before auth) ------------------------------------

app.use("*", requestLogger);

// -- Require X-Fal-Key header on protected routes ---------------------------

app.use("/models/*", falKeyMiddleware);
app.use("/generate/*", falKeyMiddleware);
app.use("/restyle/*", falKeyMiddleware);
app.use("/wallpaper/*", falKeyMiddleware);
app.use("/wallpaper/*", googleKeyMiddleware);

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
      "POST /wallpaper": "Queue an isometric city wallpaper (returns 202 with request_id)",
      "GET /wallpaper/status/:requestId": "Poll generation status (IN_QUEUE | IN_PROGRESS | COMPLETED)",
      "GET /wallpaper/result/:requestId": "Fetch the generated image when COMPLETED",
    },
  });
});

// -- Routes -----------------------------------------------------------------

app.route("/models", models);
app.route("/generate", generate);
app.route("/restyle", restyle);
app.route("/wallpaper", wallpaper);

export default app;
