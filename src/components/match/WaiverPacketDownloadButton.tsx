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
      const { data, error } = await supabase.functions.invoke("waiver-packet", {
        body: { waiver_id: waiverId },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("No signed URL returned");
      // Trigger download in a new tab
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = (err as Error).message || "Failed to fetch waiver packet";
      toast.error(`Could not download waiver packet: ${msg}`);
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
