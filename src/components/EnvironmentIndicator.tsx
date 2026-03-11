import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import {
  FlaskConical,
  Sparkles,
  CheckCircle2,
  Loader2,
  Database,
  Signal,
  Handshake,
} from "lucide-react";
import { toast } from "sonner";

// ── Preview Banner (for unauthenticated / public search) ──────────────

interface DemoModeBannerProps {
  variant?: "compact" | "full";
}

export function DemoModeBanner({ variant = "full" }: DemoModeBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-lg mb-6">
        <span className="text-xs font-medium text-muted-foreground">Preview</span>
        <span className="text-xs text-muted-foreground">— Sign in to search real counterparties and create matches.</span>
        <Link to="/auth" className="ml-auto">
          <button className="px-3 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border rounded-lg mb-6">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground mb-1">Preview mode</p>
        <p className="text-sm text-muted-foreground">
          You are viewing sample results.{" "}
          <Link to="/auth" className="text-primary hover:underline">Sign in</Link> or{" "}
          <Link to="/auth" className="text-primary hover:underline">create an account</Link> to search real counterparties and create matches.
        </p>
      </div>
    </div>
  );
}

// ── Sandbox Indicator (for authenticated console) ───────────────────────

interface SandboxIndicatorProps {
  isSandbox?: boolean;
}

export function SandboxIndicator({ isSandbox = true }: SandboxIndicatorProps) {
  if (!isSandbox) return null;

  return (
    <div className="mb-6">
      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
        <FlaskConical className="h-4 w-4 text-amber-600 shrink-0" />
        <AlertDescription className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 border-amber-300 shrink-0 w-fit"
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Sandbox
          </Badge>
          <span className="text-sm text-amber-800 dark:text-amber-200">
            You are using a sandbox environment. Data here is isolated from production.
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
