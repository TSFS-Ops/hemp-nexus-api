import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Match endpoint validation
export const matchSchema = z.object({
  buyer: z.object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
  }),
  seller: z.object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
  }),
  commodity: z.string().trim().min(1).max(200),
  quantity: z.object({
    amount: z.number().positive(),
    unit: z.string().trim().min(1).max(50),
  }),
  price: z.object({
    amount: z.number().positive(),
    currency: z.string().length(3),
  }),
  terms: z.string().trim().min(1).max(1000).optional(), // Key commercial terms - optional to match DB schema
  metadata: z.record(z.unknown()).optional(), // Optional minimal extra data
});

// Signal endpoint validation
export const signalSchema = z.object({
  product: z.string().trim().min(1).max(200),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().max(50).optional(),
  location: z.string().trim().max(200).optional(),
  deliveryWindow: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  budget: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(2000).optional(),
});

export const signalSelectSchema = z.object({
  option_id: z.string().uuid(),
});

// API Keys endpoint validation
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string().max(50)).optional(),
  expires_at: z.string().datetime().optional(),
});

// Consent endpoint validation
export const consentCreateSchema = z.object({
  data_source_id: z.string().uuid(),
  scope: z.record(z.unknown()).optional(),
  expires_at: z.string().datetime().optional(),
});

// Data Source endpoint validation
export const dataSourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["marketplace", "sheet", "erp", "registry", "lab", "web_search"]),
  config: z.record(z.unknown()).optional(),
});

export const dataSourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  config: z.record(z.unknown()).optional(),
});

// Organization endpoint validation
export const orgCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["active", "inactive"]).optional(),
});

export const orgUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sahpra_licence_no: z.string().trim().max(50).optional(),
});

// SAHPRA verification validation
export const sahpraVerifySchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  licenceNo: z.string().trim().max(50).optional(),
});

// Web search validation
export const webSearchSchema = z.object({
  signal: z.object({
    content: z.object({
      what: z.string().max(200).optional(),
      product: z.string().max(200).optional(),
      where: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      how_much: z.number().optional(),
      quantity: z.number().optional(),
    }),
  }),
  searchType: z.enum(["buyers", "sellers"]).optional(),
});

// SR Discover validation
export const srDiscoverSchema = z.object({
  signalId: z.string().uuid(),
});

// Helper function to validate and return parsed data or throw API error
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Validation failed: ${messages}`);
    }
    throw error;
  }
}
