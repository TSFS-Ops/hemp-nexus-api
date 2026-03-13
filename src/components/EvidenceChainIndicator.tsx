import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Loader2, WifiOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface EvidenceChainIndicatorProps {
  matchId: string;
  compact?: boolean;
}

/** 15-second hard timeout to prevent infinite hangs on broken connections */
const FETCH_TIMEOUT_MS = 15_000;

export function EvidenceChainIndicator({ matchId, compact = false }: EvidenceChainIndicatorProps) {
  const navigate = useNavigate();
  const { data: status, isLoading, isError, error } = useQuery({
    queryKey: ["evidence-chain", matchId],
    queryFn: async () => {
      // 1. Input validation — reject non-UUID before any network call
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(matchId)) {
        return { eventCount: 0, chainValid: false, hasIntentConfirmed: false, errorType: null };
      }

      // 2. Auth check — surface expired/missing session explicitly
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new ChainVerificationError("auth_expired", "Please sign in to verify evidence chain");
      }

      // 3. Network request with hard timeout (prevents infinite spinner on broken connection)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evidence-pack/${matchId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          }
        );
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          throw new ChainVerificationError("timeout", "Verification timed out — check your connection");
        }
        throw new ChainVerificationError("network", "Unable to reach verification service");
      } finally {
        clearTimeout(timeoutId);
      }

      // 4. HTTP error handling with specific messages per status
      if (!response.ok) {
        if (response.status === 401) {
          throw new ChainVerificationError("auth_expired", "Session expired — please sign in again");
        }
        if (response.status === 402) {
          throw new ChainVerificationError("insufficient_tokens", "Insufficient credits for verification");
        }
        if (response.status === 403 || response.status === 404) {
          return { eventCount: 0, chainValid: true, hasIntentConfirmed: false, errorType: null };
        }
        if (response.status === 429) {
          throw new ChainVerificationError("rate_limited", "Too many requests — try again shortly");
        }
        throw new ChainVerificationError("server", `Verification failed (${response.status})`);
      }

      // 5. Safe JSON parsing — protects against truncated/corrupted responses
      let pack: Record<string, unknown>;
      try {
        pack = await response.json();
      } catch {
        throw new ChainVerificationError("parse", "Invalid response from verification service");
      }

      // Secure default: treat missing verification data as invalid
      const chainVerification = (pack.chainVerification as { valid: boolean; eventCount: number }) || { valid: false, eventCount: 0 };
      const canonical = pack.canonical as { timeline?: { event_type: string }[] } | undefined;
      const timeline = canonical?.timeline || [];

      const hasIntent = timeline.some(
        (e) => e.event_type === "intent.confirmed" || e.event_type === "match.settled"
      );

      return {
        eventCount: chainVerification.eventCount,
        chainValid: chainVerification.valid,
        hasIntentConfirmed: hasIntent,
        errorType: null,
      };
    },
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      // Don't retry auth or token errors — they won't self-resolve
      if (err instanceof ChainVerificationError) {
        if (["auth_expired", "insufficient_tokens", "rate_limited"].includes(err.type)) {
          return false;
        }
      }
      return failureCount < 1;
    },
  });

  // ── Loading state ──
  if (isLoading) {
    return compact ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </Badge>
    );
  }

  // ── Error state — previously missing, caused silent failures ──
  if (isError) {
    const errType = error instanceof ChainVerificationError ? error.type : "unknown";
    const errMsg = error instanceof ChainVerificationError ? error.message : "Verification unavailable";
    const Icon = errType === "network" || errType === "timeout" ? WifiOff : ShieldOff;
    const isActionable = errType === "auth_expired" || errType === "insufficient_tokens";
    const actionLabel = errType === "auth_expired" ? "Sign in" : errType === "insufficient_tokens" ? "View billing" : null;
    const handleAction = isActionable
      ? () => navigate(errType === "auth_expired" ? "/auth" : "/billing")
      : undefined;

    return compact ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={handleAction} className={isActionable ? "cursor-pointer" : "cursor-default"}>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{errMsg}</p>
            {actionLabel && <p className="text-xs font-medium text-primary mt-0.5">Click to {actionLabel.toLowerCase()}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`gap-1 text-muted-foreground ${isActionable ? "cursor-pointer hover:border-primary/50" : ""}`}
              onClick={handleAction}
            >
              <Icon className="h-3 w-3" />
              {actionLabel ?? "Unavailable"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{errMsg}</p>
            {actionLabel && <p className="text-xs font-medium text-primary mt-0.5">Click to {actionLabel.toLowerCase()}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // ── No events state ──
  if (!status || status.eventCount === 0) {
    return compact ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>No evidence events recorded yet</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Shield className="h-3 w-3" />
        No Evidence
      </Badge>
    );
  }

  // ── Verified / Compromised state ──
  const VerifyIcon = status.chainValid ? ShieldCheck : ShieldAlert;
  const variant = status.chainValid ? "default" : "destructive";
  const colorClass = status.chainValid
    ? "text-green-600"
    : "text-destructive";

  const tooltipContent = (
    <div className="space-y-1">
      <p className="font-medium">
        {status.chainValid ? "Chain Verified" : "Chain Compromised"}
      </p>
      <p className="text-xs">{status.eventCount} event{status.eventCount !== 1 ? 's' : ''} in chain</p>
      {status.hasIntentConfirmed && (
        <p className="text-xs text-green-600">Intent confirmed</p>
      )}
      {!status.chainValid && (
        <p className="text-xs text-destructive">Hash mismatch detected</p>
      )}
    </div>
  );

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <VerifyIcon className={`h-4 w-4 ${colorClass}`} />
          </TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={variant}
            className={`gap-1 cursor-help ${status.chainValid ? 'bg-green-600 hover:bg-green-700' : ''}`}
          >
            <VerifyIcon className="h-3 w-3" />
            {status.eventCount} Event{status.eventCount !== 1 ? 's' : ''}
            {status.hasIntentConfirmed && ' ✓'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Typed error class for specific failure categorisation */
class ChainVerificationError extends Error {
  constructor(public readonly type: string, message: string) {
    super(message);
    this.name = "ChainVerificationError";
  }
}