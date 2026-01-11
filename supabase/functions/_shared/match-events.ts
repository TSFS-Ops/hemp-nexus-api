import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Record a match event with hash chaining for tamper-evident timeline
 */
export async function recordMatchEvent(
  supabase: SupabaseClient,
  matchId: string,
  orgId: string,
  eventType: string,
  eventData: Record<string, any>,
  actorUserId?: string | null,
  actorApiKeyId?: string | null
): Promise<void> {
  try {
    // Get the last event for this match to chain hashes
    const { data: lastEvent } = await supabase
      .from("match_events")
      .select("payload_hash")
      .eq("match_id", matchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const previousHash = lastEvent?.payload_hash || null;

    // Generate hash for this event
    const payload = JSON.stringify({
      eventType,
      eventData,
      timestamp: new Date().toISOString(),
      previousHash,
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const payloadHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Insert event with hash chain
    // Ensure null for empty/invalid actor IDs to avoid UUID validation errors
    const validActorUserId = actorUserId && actorUserId.length > 0 ? actorUserId : null;
    const validActorApiKeyId = actorApiKeyId && actorApiKeyId.length > 0 ? actorApiKeyId : null;
    
    const { error } = await supabase.from("match_events").insert({
      match_id: matchId,
      org_id: orgId,
      event_type: eventType,
      event_data: eventData,
      actor_user_id: validActorUserId,
      actor_api_key_id: validActorApiKeyId,
      payload_hash: payloadHash,
      previous_event_hash: previousHash,
    });

    if (error) {
      console.error(`Failed to record match event:`, error);
      throw error;
    }

    console.log(`Match event recorded: ${eventType} (hash: ${payloadHash.substring(0, 8)}...)`);
  } catch (error) {
    console.error(`Error recording match event:`, error);
    // Don't throw - allow the main operation to succeed even if event logging fails
  }
}
