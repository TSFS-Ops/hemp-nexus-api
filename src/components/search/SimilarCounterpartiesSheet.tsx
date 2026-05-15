import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Sparkles, Lightbulb } from "lucide-react";

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
}

interface SimilarMatch {
  result: SearchResult;
  reasons: string[];
  similarityScore: number;
}

interface SimilarCounterpartiesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: SearchResult | null;
  allResults: SearchResult[];
  onSelect: (id: string) => void;
}

/**
 * Computes similarity between two results based on shared factors, source, and score proximity.
 */
function computeSimilarity(anchor: SearchResult, candidate: SearchResult): SimilarMatch | null {
  if (anchor.id === candidate.id) return null;

  const reasons: string[] = [];
  let score = 0;

  // Shared coherence factors
  const sharedFactors = anchor.coherence.factors.filter(f =>
    candidate.coherence.factors.includes(f)
  );
  if (sharedFactors.length > 0) {
    score += sharedFactors.length * 0.25;
    reasons.push(`Shared traits: ${sharedFactors.join(", ")}`);
  }

  // Same source
  if (anchor.source === candidate.source) {
    score += 0.15;
    reasons.push(`Same source: ${anchor.source}`);
  }

  // Both enriched by 12% engine
  if (anchor.isEnriched && candidate.isEnriched) {
    score += 0.1;
    reasons.push("Both surfaced by 12% Discovery Engine");
  }

  // Score proximity (within 15%)
  const scoreDelta = Math.abs(anchor.score - candidate.score);
  if (scoreDelta <= 0.15) {
    score += 0.2 * (1 - scoreDelta / 0.15);
    reasons.push(`Similar relevance score (${Math.round(candidate.score * 100)}%)`);
  }

  // Coherence proximity
  const cohDelta = Math.abs(anchor.coherence.score - candidate.coherence.score);
  if (cohDelta <= 0.15) {
    score += 0.1;
    reasons.push(`Similar coherence (${Math.round(candidate.coherence.score * 100)}%)`);
  }

  if (reasons.length === 0) return null;

  return { result: candidate, reasons, similarityScore: Math.min(score, 1) };
}

export function SimilarCounterpartiesSheet({
  open,
  onOpenChange,
  anchor,
  allResults,
  onSelect,
}: SimilarCounterpartiesSheetProps) {
  if (!anchor) return null;

  const similar: SimilarMatch[] = allResults
    .map(r => computeSimilarity(anchor, r))
    .filter((m): m is SimilarMatch => m !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base">
            Similar to {anchor.title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Trading Partners with similar characteristics, sectors, or data sources.
          </SheetDescription>
        </SheetHeader>

        {similar.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No similar trading partners found in the current results.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Try broadening your search to surface more candidates.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {similar.map(({ result, reasons, similarityScore }) => (
              <div
                key={result.id}
                className="border border-border rounded-md p-3 space-y-2 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-medium text-sm leading-snug line-clamp-1">
                      {result.title}
                    </h4>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {result.description}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0">
                    {Math.round(similarityScore * 100)}% match
                  </Badge>
                </div>

                {/* Why similar */}
                <div className="space-y-1">
                  {reasons.map((reason, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <Lightbulb className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-[11px] text-muted-foreground">{reason}</span>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    onClick={() => {
                      onSelect(result.id);
                      onOpenChange(false);
                    }}
                  >
                    Select
                  </Button>
                  {result.url !== "#" && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2" asChild>
                      <a href={result.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Profile
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
