// Support attachment scanner stub.
// Performs mime-vs-magic-byte re-verification and size recheck, then marks
// the attachment `clean` or `infected`. This is a placeholder for a real
// ClamAV/GCS-native scanner; the enforcement surface (RLS, download button)
// already respects the scan_status field, so plugging in a real scanner
// later is a drop-in replacement.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const attachmentId: string | undefined = body?.attachment_id;
    if (!attachmentId) {
      return json({ error: "attachment_id required" }, 400);
    }

    const { data: att, error: attErr } = await admin
      .from("support_ticket_attachments")
      .select("id, storage_bucket, storage_path, mime_type, size_bytes")
      .eq("id", attachmentId)
      .single();
    if (attErr || !att) return json({ error: "attachment not found" }, 404);

    // Download first 4KB to check magic bytes
    const dl = await admin.storage
      .from(att.storage_bucket)
      .download(att.storage_path);
    if (dl.error || !dl.data) {
      await mark(admin, attachmentId, "failed", `download error: ${dl.error?.message}`);
      return json({ ok: false, status: "failed" });
    }
    const buf = new Uint8Array(await dl.data.arrayBuffer());
    if (buf.length !== att.size_bytes) {
      await mark(admin, attachmentId, "infected", "size mismatch after upload");
      return json({ ok: false, status: "infected" });
    }
    const magicOk = magicMatches(buf, att.mime_type);
    if (!magicOk) {
      await mark(admin, attachmentId, "infected", "magic-byte mismatch for declared mime");
      return json({ ok: false, status: "infected" });
    }
    await mark(admin, attachmentId, "clean", "stub scanner: structural checks passed");
    return json({ ok: true, status: "clean" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function mark(
  admin: ReturnType<typeof createClient>,
  id: string,
  status: "clean" | "infected" | "failed",
  note: string
) {
  await admin
    .from("support_ticket_attachments")
    .update({ scan_status: status, scanned_at: new Date().toISOString(), scan_note: note })
    .eq("id", id);
}

function magicMatches(buf: Uint8Array, mime: string): boolean {
  const has = (sig: number[], off = 0) =>
    sig.every((b, i) => buf[off + i] === b);
  switch (mime) {
    case "image/png":
      return has([0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return has([0xff, 0xd8, 0xff]);
    case "image/gif":
      return has([0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return has([0x52, 0x49, 0x46, 0x46]) && has([0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf":
      return has([0x25, 0x50, 0x44, 0x46]);
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return has([0x50, 0x4b, 0x03, 0x04]);
    case "text/plain":
    case "text/csv":
      return true;
    default:
      return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
