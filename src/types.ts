// ---------------------------------------------------------------------------
// Cloudflare Images binding (HEIC → JPEG conversion, etc.)
// ---------------------------------------------------------------------------

export interface ImagesInputContext {
  transform(options: Record<string, unknown>): ImagesInputContext;
  output(options: { format: string; quality?: number }): Promise<{ response(): Response }>;
}

export interface ImagesBinding {
  input(stream: ReadableStream): ImagesInputContext;
  info(stream: ReadableStream): Promise<{ format: string; width: number; height: number; fileSize: number }>;
}

// ---------------------------------------------------------------------------
// Worker env bindings
// ---------------------------------------------------------------------------

export type Bindings = {
  IMAGES: ImagesBinding;
  GOOGLE_AI_KEY?: string;
};

import type { Logger } from "pino";

export type Variables = {
  requestId: string;
  logger: Logger;
  falKey: string;
  googleKey?: string;
};

export type App = { Bindings: Bindings; Variables: Variables };

// ---------------------------------------------------------------------------
// fal.ai Platform API — model search
// ---------------------------------------------------------------------------

export interface FalModelMetadata {
  display_name: string;
  category: string;
  description: string;
  status: string;
  tags: string[];
  updated_at: string;
  thumbnail_url?: string;
  model_url?: string;
}

export interface FalModelEntry {
  endpoint_id: string;
  metadata: FalModelMetadata;
}

export interface FalModelsResponse {
  models: FalModelEntry[];
  next_cursor: string | null;
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// fal.ai Platform API — pricing
// ---------------------------------------------------------------------------

export interface FalPriceEntry {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

export interface FalPricingResponse {
  prices: FalPriceEntry[];
  next_cursor: string | null;
  has_more: boolean;
}
