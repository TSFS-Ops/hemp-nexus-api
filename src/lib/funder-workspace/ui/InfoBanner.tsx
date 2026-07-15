import { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type Tone = "info" | "success" | "warning" | "destructive";

const ICON: Record<Tone, ReactNode> = {
  info: <Info className="h-4 w-4" aria-hidden="true" />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  destructive: <XCircle className="h-4 w-4" aria-hidden="true" />,
};

interface Props {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function InfoBanner({ tone = "info", title, children, className }: Props) {
  const variant = tone === "destructive" ? "destructive" : "default";
  return (
    <Alert variant={variant} className={className}>
      {ICON[tone]}
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="text-sm">{children}</AlertDescription>
    </Alert>
  );
}
