import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Canonical back button. Uses browser history if available, falls back to a specified route.
 * DO NOT duplicate ArrowLeft + "Back to…" patterns in page files - use this component.
 */
interface BackButtonProps {
  /** Fallback route when there's no browser history (default: "/dashboard") */
  fallback?: string;
  /** Label to display (default: "Back") */
  label?: string;
  /** Additional className */
  className?: string;
}

export function BackButton({ fallback = "/dashboard", label = "Back", className }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    // If there's history, go back; otherwise navigate to fallback
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };

  return (
    <Button variant="ghost" onClick={handleClick} className={className}>
      <ArrowLeft className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
}
