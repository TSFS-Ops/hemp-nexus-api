import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";

// Internal cron endpoint (INTERNAL_CRON_KEY-gated). Server-to-server only.
const corsHeaders = {
  ...webhookCorsHeaders(),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Authenticate: only internal cron or service_role
  const internalKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedCronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const isInternalCron =
    expectedCronKey && internalKey === expectedCronKey;
  const isServiceRole =
    authHeader === `Bearer ${serviceRoleKey}`;

  if (!isInternalCron && !isServiceRole) {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Fetch pending items past their compliance hold
  const { data: pendingItems, error: fetchError } = await supabase
    .from("storage_deletion_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(100); // batch cap to avoid timeout

  if (fetchError) {
    console.error("[storage-retention-cleanup] Fetch error:", fetchError.message);
    return new Response(
      JSON.stringify({ error: "FETCH_FAILED", detail: fetchError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!pendingItems || pendingItems.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, failed: 0, message: "No items due for cleanup" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let processed = 0;
  let failed = 0;

  for (const item of pendingItems) {
    try {
      // Remove file from storage bucket
      const { error: removeError } = await supabase.storage
        .from(item.bucket_id)
        .remove([item.file_path]);

      if (removeError) {
        throw new Error(removeError.message);
      }

      // Mark as processed
      const { error: updateError } = await supabase
        .from("storage_deletion_queue")
        .update({ status: "processed" })
        .eq("id", item.id);

      if (updateError) {
        console.error(`[storage-retention-cleanup] Status update failed for ${item.id}:`, updateError.message);
      }

      processed++;
      console.log(`[storage-retention-cleanup] Deleted ${item.bucket_id}/${item.file_path}`);
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[storage-retention-cleanup] Failed ${item.bucket_id}/${item.file_path}: ${errMsg}`);

      // Mark as failed with error message
      await supabase
        .from("storage_deletion_queue")
        .update({ status: "failed", error_message: errMsg.slice(0, 500) })
        .eq("id", item.id);
    }
  }

  const summary = {
    processed,
    failed,
    total_queued: pendingItems.length,
    timestamp: new Date().toISOString(),
  };

  console.log("[storage-retention-cleanup] Run complete:", JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
