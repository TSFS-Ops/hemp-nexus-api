/**
 * WaiverPacketDownloadButton — Fetches a short-lived signed URL for the POI
 * evidence waiver packet PDF and triggers the browser download.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/edge-invoke";
import { Button } from "@/components/ui/button";

interface Props {
  waiverId: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
  className?: string;
}

export function WaiverPacketDownloadButton({
  waiverId,
  variant = "outline",
  size = "sm",
  label = "Download waiver packet",
  className,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Ensure we have a *live* (non-expired) access token before invoking.
      // supabase.functions.invoke silently sends whatever JWT is in storage,
      // so a stale token surfaces server-side as {"error":"Unauthorized"}.
      // Detect expiry locally and try a refresh first; if that fails the user
      // must sign in again.
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(`Session check failed: ${sessionError.message}`);
      let session = sessionData.session;

      const isExpired = (s: typeof session) => {
        if (!s?.expires_at) return false;
        // expires_at is unix seconds; refresh if <30s remaining
        return s.expires_at * 1000 - Date.now() < 30_000;
      };

      if (!session || isExpired(session)) {
        console.log("[WaiverPacketDownload] session missing/expired, attempting refresh");
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshed.session) {
          throw new Error(
            "Your session has expired. Please sign out and sign back in, then try again."
          );
        }
        session = refreshed.session;
      }

      console.log("[WaiverPacketDownload] invoking waiver-packet for", waiverId);
      const { data, error } = await supabase.functions.invoke("waiver-packet", {
        body: { waiver_id: waiverId },
      });
      console.log("[WaiverPacketDownload] response", { data, error });

      if (error) {
        // FunctionsHttpError carries a `context.response` with the body
        const ctx = (error as { context?: Response }).context;
        let serverBody = "";
        let serverStatus: number | undefined;
        if (ctx && typeof ctx.text === "function") {
          serverStatus = ctx.status;
          try {
            serverBody = await ctx.clone().text();
          } catch {
            // ignore
          }
        }

        // Translate server-side auth failures into a clear, actionable message
        // instead of leaking the raw {"error":"Unauthorized"} payload.
        const looksUnauthorized =
          serverStatus === 401 ||
          /unauthorized/i.test(serverBody) ||
          /unauthorized/i.test(error.message);
        if (looksUnauthorized) {
          throw new Error(
            "Your session has expired. Please sign out and sign back in, then try again."
          );
        }

        const looksForbidden = serverStatus === 403 || /forbidden/i.test(serverBody);
        if (looksForbidden) {
          throw new Error(
            "You don't have permission to download this waiver packet. Contact an administrator if you believe this is a mistake."
          );
        }

        const looksMaintenance =
          serverStatus === 503 || /maintenance/i.test(serverBody);
        if (looksMaintenance) {
          throw new Error(
            "The platform is in maintenance mode. Please try again shortly."
          );
        }

        throw new Error(serverBody ? `${error.message} — ${serverBody}` : error.message);
      }
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("No signed URL returned by waiver-packet function");
      // Trigger download in a new tab
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = (err as Error).message || "Failed to fetch waiver packet";
      console.error("[WaiverPacketDownload] failed", err);
      toast.error(msg, { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  );
}
