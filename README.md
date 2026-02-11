# Wall

A Cloudflare Worker that generates AI wallpapers via [fal.ai](https://fal.ai). Built with [Hono](https://hono.dev) and TypeScript.

## Setup

### Prerequisites

- Node.js 18+
- A [fal.ai](https://fal.ai) account and API key
- (For deployment) A [Cloudflare](https://dash.cloudflare.com) account

### Install dependencies

```bash
npm install
```

### Authentication

This API does **not** store any fal.ai API key on the server. Every request must include the user's own key via the `X-Fal-Key` header:

```
X-Fal-Key: your_fal_api_key_here
```

Requests without this header will receive a `401 Unauthorized` response.

## Development

```bash
npm run dev
```

The server starts at `http://localhost:8787`.

## Deploy

```bash
npm run deploy
```

## API Reference

### `GET /`

Health check. Returns service info and available endpoints.

### `GET /models`

Fetches available image generation models **live from fal.ai** with pricing info.

**Query parameters:**

| Param      | Default         | Description                                |
| ---------- | --------------- | ------------------------------------------ |
| `category` | `text-to-image` | Model category filter                      |
| `q`        |                 | Free-text search (e.g. `flux`, `stable`)   |
| `limit`    | `50`            | Max models to return per page              |
| `cursor`   |                 | Pagination cursor from a previous response |

**Example requests:**

```bash
# List all text-to-image models with pricing
curl -H "X-Fal-Key: YOUR_FAL_KEY" http://localhost:8787/models

# Search for "flux" models
curl -H "X-Fal-Key: YOUR_FAL_KEY" "http://localhost:8787/models?q=flux"
```

**Response:**

```json
{
  "models": [
    {
      "id": "fal-ai/flux/dev",
      "name": "FLUX.1 [dev]",
      "description": "Fast text-to-image generation",
      "category": "text-to-image",
      "status": "active",
      "tags": ["fast", "pro"],
      "thumbnail_url": "https://fal.media/files/example.jpg",
      "pricing": {
        "unit_price": 0.025,
        "unit": "image",
        "currency": "USD"
      }
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### `POST /generate`

Generate a wallpaper image. Returns the raw image binary.

**Request body (JSON):**

| Field                 | Type   | Required | Description                                         |
| --------------------- | ------ | -------- | --------------------------------------------------- |
| `prompt`              | string | yes      | Description of the wallpaper (max 2000 chars)       |
| `width`               | number | yes      | Screen width in px (512–4096, divisible by 8)       |
| `height`              | number | yes      | Screen height in px (512–4096, divisible by 8)      |
| `model`               | string | no       | fal.ai model ID (default: `fal-ai/flux/schnell`)    |
| `negative_prompt`     | string | no       | What to avoid in the image (max 2000 chars)         |
| `num_inference_steps` | number | no       | Quality vs speed trade-off (1–100, model-dependent) |

**Example request:**

```bash
curl -X POST http://localhost:8787/generate \
  -H "Content-Type: application/json" \
  -H "X-Fal-Key: YOUR_FAL_KEY" \
  -d '{
    "prompt": "A serene mountain landscape at sunset with northern lights",
    "width": 1920,
    "height": 1080
  }' \
  --output wallpaper.png
```

**Success response:** Raw image binary with appropriate `Content-Type` header.

**Error response (JSON):**

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "width", "message": "Width must be divisible by 8" }
  ]
}
```

### `POST /restyle`

Restyle an existing image with an artistic style (image-to-image). Returns the raw image binary.

Uses the `fal-ai/image-editing/style-transfer` model under the hood.

**Request body:** Raw image binary (not JSON).

**Required headers:**

| Header         | Description                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `Content-Type` | MIME type of the image: `image/png`, `image/jpeg`, `image/webp`, `image/heic`, or `image/heif` |
| `X-Style`      | Artistic style to apply, e.g. `anime`, `cartoon`, `watercolor`, `Van Gogh` (max 2000 chars)    |
| `X-Width`      | Output width in px (512–4096, divisible by 8)                                                  |
| `X-Height`     | Output height in px (512–4096, divisible by 8)                                                 |

> **iPhone users:** HEIC/HEIF images are automatically converted to JPEG via Cloudflare Images before processing.

**Example request:**

```bash
curl -X POST http://localhost:8787/restyle \
  -H "Content-Type: image/jpeg" \
  -H "X-Fal-Key: YOUR_FAL_KEY" \
  -H "X-Style: anime" \
  -H "X-Width: 1920" \
  -H "X-Height: 1080" \
  --data-binary @photo.jpg \
  --output restyled.jpg

# iPhone HEIC photo
curl -X POST http://localhost:8787/restyle \
  -H "Content-Type: image/heic" \
  -H "X-Fal-Key: YOUR_FAL_KEY" \
  -H "X-Style: watercolor" \
  -H "X-Width: 1179" \
  -H "X-Height: 2556" \
  --data-binary @IMG_1234.HEIC \
  --output restyled.jpg
```

**Success response:** Raw image binary with appropriate `Content-Type` header.

**Error response (JSON):**

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "style", "message": "X-Style header is required" }
  ]
}
```

## Common screen sizes

| Device        | Width | Height |
| ------------- | ----- | ------ |
| 1080p         | 1920  | 1080   |
| 1440p         | 2560  | 1440   |
| 4K            | 3840  | 2160   |
| Ultrawide     | 3440  | 1440   |
| MacBook Pro   | 3024  | 1964   |
| iPhone 15 Pro | 1179  | 2556   |

---

**Disclaimer:** This project was vibe coded. It was used for testing what I can do with Cloudflare Workers, and it's pretty nice — I should use this more.

### Stats

| Agents                   | What they did                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cloudflare worker        | made the plan, executed, proper fal model and pricing endpoint, refactor, better prompt for background |
| Image Upload and styling | added restyle endpoint                                                                                 |
| API key management       | header key middlewear                                                                                  |
| HEIC format x2           | cloudflare IMAGE binding                                                                               |
| Logging                  | plan for logging, not implemented                                                                      |
| Learning                 | apple shortcut and automation                                                                          |
