/**
 * P-5 Batch 1 — Stage 5 summary client.
 *
 * Thin typed wrapper around the `p5-governance-readiness-summary` edge
 * function. Customer / funder / API-client UI must use this client; never
 * read `p5_governance_readiness_cases` directly from those surfaces.
 */
import { supabase } from "@/integrations/supabase/client";
import type { P5ReadinessSummary } from "./summary-types";

export interface FetchP5SummaryArgs {
  case_id: string;
  correlation_id?: string;
}

export async function fetchP5ReadinessSummary(
  args: FetchP5SummaryArgs,
): Promise<P5ReadinessSummary> {
  const params = new URLSearchParams({ case_id: args.case_id });
  if (args.correlation_id) params.set("correlation_id", args.correlation_id);

  const { data, error } = await supabase.functions.invoke<P5ReadinessSummary>(
    `p5-governance-readiness-summary?${params.toString()}`,
    { method: "GET" },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty P-5 readiness summary response");
  return data;
}
