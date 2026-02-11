import { z } from "zod";

export const generateSchema = z.object({
  prompt: z
    .string()
    .min(1, "Prompt is required")
    .max(2000, "Prompt must be 2000 characters or less"),
  width: z
    .number()
    .int("Width must be an integer")
    .min(512, "Minimum width is 512px")
    .max(4096, "Maximum width is 4096px")
    .refine((v) => v % 8 === 0, "Width must be divisible by 8"),
  height: z
    .number()
    .int("Height must be an integer")
    .min(512, "Minimum height is 512px")
    .max(4096, "Maximum height is 4096px")
    .refine((v) => v % 8 === 0, "Height must be divisible by 8"),
  model: z
    .string()
    .refine((v) => v.startsWith("fal-ai/"), "Model must start with 'fal-ai/'")
    .optional(),
  negative_prompt: z
    .string()
    .max(2000, "Negative prompt must be 2000 characters or less")
    .optional(),
  num_inference_steps: z
    .number()
    .int()
    .min(1, "Minimum inference steps is 1")
    .max(100, "Maximum inference steps is 100")
    .optional(),
});

export const wallpaperSchema = z.object({
  city: z
    .string()
    .min(1, "City is required")
    .max(200, "City must be 200 characters or less"),
  weather: z
    .string()
    .min(1, "Weather is required")
    .max(500, "Weather must be 500 characters or less"),
  datetime: z
    .string()
    .min(1, "Datetime is required")
    .max(200, "Datetime must be 200 characters or less"),
  width: z
    .number()
    .int("Width must be an integer")
    .min(512, "Minimum width is 512px")
    .max(4096, "Maximum width is 4096px")
    .refine((v) => v % 8 === 0, "Width must be divisible by 8"),
  height: z
    .number()
    .int("Height must be an integer")
    .min(512, "Minimum height is 512px")
    .max(4096, "Maximum height is 4096px")
    .refine((v) => v % 8 === 0, "Height must be divisible by 8"),
});

export const restyleHeadersSchema = z.object({
  style: z
    .string()
    .min(1, "X-Style header is required")
    .max(2000, "Style must be 2000 characters or less"),
  width: z
    .number()
    .int("Width must be an integer")
    .min(512, "Minimum width is 512px")
    .max(4096, "Maximum width is 4096px")
    .refine((v) => v % 8 === 0, "Width must be divisible by 8"),
  height: z
    .number()
    .int("Height must be an integer")
    .min(512, "Minimum height is 512px")
    .max(4096, "Maximum height is 4096px")
    .refine((v) => v % 8 === 0, "Height must be divisible by 8"),
});
