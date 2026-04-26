/**
 * WaiverPacketDownloadButton — Fetches a short-lived signed URL for the POI
 * evidence waiver packet PDF and triggers the browser download.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invokeEdgeFunction, describeEdgeError, isSessionExpiredError } from "@/lib/edge-invoke";
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
      console.log("[WaiverPacketDownload] invoking waiver-packet for", waiverId);
      const data = await invokeEdgeFunction<{ url?: string }>("waiver-packet", {
        body: { waiver_id: waiverId },
        label: "download waiver packet",
      });
      const url = data?.url;
      if (!url) throw new Error("No signed URL returned by waiver-packet function");

      // Fetch the PDF bytes and trigger a download via an anchor element.
      // We deliberately avoid `window.open(url)` here because, after an
      // `await`, browsers treat the call as not-user-initiated and silently
      // block the popup, leaving the user with "nothing happens".
      const pdfResp = await fetch(url);
      if (!pdfResp.ok) {
        throw new Error(`Could not fetch waiver packet (HTTP ${pdfResp.status}).`);
      }
      const blob = await pdfResp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `waiver-packet-${waiverId}.pdf`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a short delay so the click has time to start the download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      toast.success("Waiver packet downloaded");
    } catch (err) {
      const msg = describeEdgeError(err, "Failed to fetch waiver packet");
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
