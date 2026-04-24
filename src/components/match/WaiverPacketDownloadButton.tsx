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
      console.log("[WaiverPacketDownload] invoking waiver-packet for", waiverId);
      const data = await invokeEdgeFunction<{ url?: string }>("waiver-packet", {
        body: { waiver_id: waiverId },
        label: "download waiver packet",
      });
      const url = data?.url;
      if (!url) throw new Error("No signed URL returned by waiver-packet function");
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
