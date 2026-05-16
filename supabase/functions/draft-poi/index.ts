/**
 * draft-poi - Agentic POI Drafter
 *
 * Accepts raw unstructured text (e.g. pasted email) and extracts
 * structured trade intent fields using Lovable AI (tool-calling).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { authenticateRequest } from "../_shared/auth.ts";
import { guardedAiCall, aiGuardEnvelope } from "../_shared/ai-guard.ts";

// Stage 2A CORS hardening (2026-05-01): replaced local wildcard `corsHeaders`
// with the shared `_shared/cors.ts` helper. Stub keeps existing spreads valid.
const corsHeaders = { "Content-Type": "application/json" } as Record<string, string>;

serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  return withCors(req, await _serve(req));
});

async function _serve(req: Request): Promise<Response> {

  try {
    const { rawText } = await req.json();

    if (!rawText || typeof rawText !== "string" || rawText.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Please provide at least 10 characters of text to draft from." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (rawText.length > 5000) {
      return new Response(
        JSON.stringify({ error: "Text too long. Please keep it under 5,000 characters." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const tool = {
      type: "function" as const,
      function: {
        name: "extract_trade_intent",
        description:
          "Extract structured trade intent fields from unstructured text such as an email, WhatsApp message, or verbal note about a commodity trade.",
        parameters: {
          type: "object",
          properties: {
            side: {
              type: "string",
              enum: ["buyer", "seller"],
              description:
                'Whether the person described wants to BUY or SELL. Use "buyer" if they want to source/purchase/import. Use "seller" if they want to sell/supply/export.',
            },
            commodity: {
              type: "string",
              description:
                "The commodity or product being traded, e.g. 'Non-GMO Food-Grade Soybeans', 'Yellow Maize', 'Chrome Ore'.",
            },
            quantity: {
              type: "string",
              description:
                "The numeric quantity as a string, e.g. '25000'. Leave empty string if not mentioned.",
            },
            unit: {
              type: "string",
              enum: ["MT", "kg", "lbs", "bushels", "units"],
              description: "The unit of measurement. Default to MT if not specified.",
            },
            price: {
              type: "string",
              description:
                "The price per unit as a string, e.g. '495'. Leave empty string if not mentioned.",
            },
            currency: {
              type: "string",
              enum: ["USD", "ZAR", "EUR", "GBP"],
              description: "The currency. Default to USD if not clearly specified.",
            },
            location: {
              type: "string",
              description:
                "The origin, destination, or jurisdiction mentioned, e.g. 'Malawi', 'Free State, South Africa'. Leave empty string if not mentioned.",
            },
            notes: {
              type: "string",
              description:
                "Any remaining context not captured above - delivery terms, quality specs, timeline, etc. Leave empty string if nothing extra.",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description:
                "Your confidence in the extraction. 'high' if all key fields are clear, 'medium' if some are inferred, 'low' if the text is very ambiguous.",
            },
          },
          required: [
            "side",
            "commodity",
            "quantity",
            "unit",
            "price",
            "currency",
            "location",
            "notes",
            "confidence",
          ],
          additionalProperties: false,
        },
      },
    };

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are an expert commodity trade analyst. You extract structured trade intent data from raw unstructured text such as emails, WhatsApp messages, meeting notes, or verbal descriptions.

Rules:
- Always determine if the person is a BUYER or SELLER based on context clues.
- If quantity/price are ranges, use the midpoint.
- Default unit to "MT" (metric tons) if not specified.
- Default currency to "USD" if not clearly stated. If ZAR/Rand is mentioned, use "ZAR".
- Be conservative: if something is truly not mentioned, leave the field as an empty string.
- Put delivery terms, quality specs, and timeline info in the notes field.`,
            },
            {
              role: "user",
              content: rawText.trim(),
            },
          ],
          tools: [tool],
          tool_choice: {
            type: "function",
            function: { name: "extract_trade_intent" },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI rate limit reached. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI extraction failed");
    }

    const result = await response.json();

    // Extract tool call arguments
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured extraction");
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("draft-poi error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error during extraction",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}
