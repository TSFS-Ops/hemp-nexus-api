/**
 * WaiverPacketDownloadButton — Fetches a short-lived signed URL for the POI
 * evidence waiver packet PDF and triggers the browser download.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
      // Verify we still have a live session before invoking. supabase.functions
      // .invoke silently sends the (possibly expired) JWT and the resulting 401
      // surfaces as a generic "Edge Function returned a non-2xx status code"
      // which is what the client has been seeing.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(`Session check failed: ${sessionError.message}`);
      if (!sessionData.session) {
        throw new Error("Your session has expired. Please log out and log back in, then try again.");
      }

      console.log("[WaiverPacketDownload] invoking waiver-packet for", waiverId);
      const { data, error } = await supabase.functions.invoke("waiver-packet", {
        body: { waiver_id: waiverId },
      });
      console.log("[WaiverPacketDownload] response", { data, error });

      if (error) {
        // FunctionsHttpError carries a `context.response` with the body
        const ctx = (error as { context?: Response }).context;
        let serverMsg = error.message;
        if (ctx && typeof ctx.text === "function") {
          try {
            const text = await ctx.clone().text();
            serverMsg = `${error.message} — ${text}`;
          } catch {
            // ignore
          }
        }
        throw new Error(serverMsg);
      }
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("No signed URL returned by waiver-packet function");
      // Trigger download in a new tab
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = (err as Error).message || "Failed to fetch waiver packet";
      console.error("[WaiverPacketDownload] failed", err);
      toast.error(`Could not download waiver packet: ${msg}`, { duration: 8000 });
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
