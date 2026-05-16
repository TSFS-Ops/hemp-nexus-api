import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { ApiException } from "./errors.ts";
import { validateAndNormaliseScopes } from "./api-scopes.ts";

// Match endpoint validation.
//
// `id` is OPTIONAL by design: after the R1 role-of-truth hardening
// (CounterpartySearch.tsx) the client deliberately omits `id` for the
// counterparty slot when the result came from a web/AI discovery source —
// those IDs are NOT org UUIDs and writing them through would either resolve
// to null or, if they collide with a real org UUID, write the WRONG org into
// the buyer/seller slot. The counterparty slot is left to be filled by the
// `auto_link_engagement_on_signup` trigger when the partner signs up.
// `name` remains required so audit logs and notifications always have a label.
const partySchema = z.object({
  id: z.string().trim().min(1).max(100).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  org_id: z.string().uuid().nullable().optional(),
});

export const matchSchema = z.object({
  buyer: partySchema.nullable().optional(),
  seller: partySchema.nullable().optional(),
  commodity: z.string().trim().min(1).max(200),
  quantity: z.object({
    amount: z.number().positive(),
    unit: z.string().trim().min(1).max(50),
  }).nullable().optional(),
  price: z.object({
    amount: z.number().positive(),
    currency: z.string().length(3),
  }).nullable().optional(),
  terms: z.string().trim().min(1).max(1000).nullable().optional(),
  match_type: z.enum(["search", "bilateral", "unilateral"]).optional().default("search"),
  metadata: z.record(z.unknown()).optional(),
  origin_country: z.string().trim().max(100).nullable().optional(),
  destination_country: z.string().trim().max(100).nullable().optional(),
  trade_request_id: z.string().uuid().nullable().optional(),
}).refine(
  (data) => {
    // At least one party is required
    return data.buyer != null || data.seller != null;
  },
  { message: "At least one of buyer or seller must be provided" }
);

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
  expires_at: z.string().datetime().nullish(), // Accept null, undefined, or valid datetime string
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

// Organisation endpoint validation
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

/**
 * Validate input against a Zod schema and throw ApiException on failure.
 * Returns parsed data with proper types.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new ApiException(
        "VALIDATION_ERROR",
        `Validation failed: ${messages}`,
        400,
        {
          errors: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
        }
      );
    }
    throw error;
  }
}
