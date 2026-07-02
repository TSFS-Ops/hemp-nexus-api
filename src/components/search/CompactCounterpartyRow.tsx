/**
 * CompactCounterpartyRow - Desk-aesthetic compact row for discovery results.
 *
 * Mirrors the AttentionPipeline row anatomy:
 *  [priority dot] [initials avatar] [title + metadata stack] [right-aligned CTA]
 *
 * Batch O Remainder — trust-signal correction:
 *   The legacy provider-trust tier has been removed. The counterparty
 *   registry's org-mutable boolean is a bare, unaudited flag that is
 *   NOT tied to any live-provider check and MUST NOT be surfaced with
 *   green success styling or a provider-trust label. `search/index.ts`
 *   now emits every counterparty registry row as the neutral
 *   `registry_record` source; the two legacy source strings are
 *   mapped to the same neutral "Registry record" tier for backward
 *   safety with cached results.

 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, ExternalLink, Users, Mail, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  score: number;
  isEnriched: boolean;
  enrichmentReason: string | null;
  whySurfaced: string;
  coherence: {
    score: number;
    passed: boolean;
    factors: string[];
  };
  metadata?: {
    web_discovered?: boolean;
    has_contact?: boolean;
    contact_masked?: boolean;
    // NOTE: `verified` is intentionally NOT part of this interface —
    // it must never be surfaced from `counterparties.verified` to
    // customer-facing UI. See src/tests/batch-o-idv-kyb-lockout-guard.test.ts.
    [key: string]: any;
  };
}

interface CompactCounterpartyRowProps {
  result: SearchResult;
  rank: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onFindSimilar?: (result: SearchResult) => void;
  userSide?: "buyer" | "seller";
}

type Tier = "registry" | "order_book" | "web" | "unknown";

function tierFromSource(source: string): Tier {
  switch (source) {
    // Batch O Remainder: `verified_registry` (legacy) and
    // `counterparty_registry` (legacy) both collapse to the neutral
    // `registry` tier. `registry_record` is the new canonical source.
    case "registry_record":
    case "verified_registry":
    case "counterparty_registry":
      return "registry";
    case "order_book":
      return "order_book";
    case "web_discovery":
      return "web";
    default:
      return "unknown";
  }
}

function tierLabel(tier: Tier): string {
  switch (tier) {
    case "registry":
      return "Registry record";
    case "order_book":
      return "Order book";
    case "web":
      return "Web discovery";
    default:
      return "Source unknown";
  }
}

function tierDotClass(tier: Tier): string {
  // Solid dot + ring for visual weight, matches AttentionPipeline language.
  // Batch O Remainder: registry tier uses a neutral slate dot, NOT the
  // legacy emerald "verified" dot — the underlying signal is a bare
  // org-mutable boolean, not a live-provider verification.
  switch (tier) {
    case "registry":
      return "bg-slate-500 ring-slate-200";
    case "order_book":
      return "bg-violet-500 ring-violet-200";
    case "web":
      return "bg-amber-500 ring-amber-200";
    default:
      return "bg-slate-400 ring-slate-200";
  }
}


function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CompactCounterpartyRow({
  result,
  rank,
  isSelected,
  onToggleSelect,
  onFindSimilar,
  userSide,
}: CompactCounterpartyRowProps) {
  const tier = tierFromSource(result.source);
  const isWebDiscovered = tier === "web" || result.metadata?.web_discovered;
  const hasContact = result.metadata?.has_contact;
  const partnerRole = userSide === "buyer" ? "Seller" : userSide === "seller" ? "Buyer" : null;
  const scorePct = Math.round(result.score * 100);
  const coherencePct = Math.round(result.coherence.score * 100);

  return (
    <li
      className={cn(
        "group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 transition-colors cursor-pointer",
        "hover:bg-muted/70",
        isSelected && "bg-[hsl(var(--emerald-muted))]/60 hover:bg-[hsl(var(--emerald-muted))]/80",
      )}
      onClick={() => onToggleSelect(result.id)}
    >
      {/* Explicit selection checkbox - independent click target */}
      <div
        className="shrink-0 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(result.id)}
          aria-label={`${isSelected ? "Deselect" : "Select"} ${result.title}`}
          className={cn(
            "h-4 w-4",
            isSelected && "data-[state=checked]:bg-[hsl(var(--emerald))] data-[state=checked]:border-[hsl(var(--emerald)/0.4)]",
          )}
        />
      </div>

      {/* Priority dot - source tier */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "shrink-0 w-2 h-2 rounded-full ring-2",
              tierDotClass(tier),
            )}
            aria-label={tierLabel(tier)}
          />
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="text-xs">{tierLabel(tier)}</p>
        </TooltipContent>
      </Tooltip>

      {/* Initials / selection avatar */}
      <div
        className={cn(
          "shrink-0 hidden sm:flex w-9 h-9 rounded-full items-center justify-center font-mono text-[11px] tracking-wider transition-colors",
          isSelected
            ? "bg-[hsl(var(--emerald))] text-white"
            : "bg-muted text-muted-foreground group-hover:bg-muted",
        )}
        aria-hidden
      >
        {isSelected ? <CheckCircle className="w-4 h-4" /> : initialsOf(result.title)}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 hidden sm:inline">
            #{rank}
          </span>
          <h4 className="truncate text-sm sm:text-[15px] font-medium text-foreground leading-tight">
            {result.title}
          </h4>
          {partnerRole && (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 hidden md:inline-flex h-5 px-1.5 text-[10px] font-mono tracking-wider uppercase",
                partnerRole === "Seller"
                  ? "border-orange-300 text-orange-700"
                  : "border-blue-300 text-blue-700",
              )}
            >
              {partnerRole}
            </Badge>
          )}
        </div>

        {/* Metadata line 1 - description */}
        <p className="truncate text-xs text-muted-foreground">{result.description}</p>

        {/* Metadata line 2 - signals */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums" title="Match score">
            {scorePct}% match
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span
            className={cn(
              "font-mono tabular-nums",
              result.coherence.passed ? "text-[hsl(var(--emerald))]" : "text-amber-600",
            )}
            title={`Coherence ${coherencePct}%`}
          >
            ◇ {coherencePct}%
          </span>
          {result.coherence.factors[0] && (
            <>
              <span className="text-muted-foreground/50 hidden sm:inline">·</span>
              <span className="hidden sm:inline truncate max-w-[180px]" title={result.coherence.factors.join(", ")}>
                {result.coherence.factors[0]}
                {result.coherence.factors.length > 1 && ` +${result.coherence.factors.length - 1}`}
              </span>
            </>
          )}
          {isWebDiscovered && hasContact && (
            <>
              <span className="text-muted-foreground/50 hidden md:inline">·</span>
              <span className="hidden md:inline-flex items-center gap-1" title="Contact available after match creation">
                <Mail className="w-3 h-3" />
                contact
              </span>
            </>
          )}
          {result.whySurfaced && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden lg:inline-flex items-center gap-1 cursor-help text-muted-foreground/70">
                  <Lightbulb className="w-3 h-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs italic">{result.whySurfaced}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Right-aligned actions */}
      <div className="shrink-0 flex items-center gap-1">
        {result.url !== "#" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hidden sm:inline-flex text-muted-foreground hover:text-foreground"
                asChild
                onClick={(e) => e.stopPropagation()}
              >
                <a href={result.url} target="_blank" rel="noopener noreferrer" aria-label="Open website">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Open website</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hidden sm:inline-flex text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onFindSimilar?.(result);
              }}
              aria-label="Find similar"
            >
              <Users className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Find similar counterparties</p>
          </TooltipContent>
        </Tooltip>

        <Button
          size="sm"
          variant={isSelected ? "default" : "outline"}
          className={cn(
            "h-8 px-3 text-xs font-medium ml-1",
            isSelected && "bg-[hsl(var(--emerald))] hover:bg-[hsl(var(--emerald))] text-white border-[hsl(var(--emerald)/0.4)]",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(result.id);
          }}
        >
          {isSelected ? "Selected" : "Select"}
        </Button>
      </div>
    </li>
  );
}
