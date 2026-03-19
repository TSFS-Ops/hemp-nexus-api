/**
 * MatchDetailsTabs — Tabbed navigation for match sub-sections.
 * Tab state synced to ?tab= query param for deep-linking.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, FileText, Shield, Clock, MessageSquare, FileSignature, ShieldAlert } from "lucide-react";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchDocuments } from "@/components/match/MatchDocuments";
import { WadModule } from "@/components/wad/WadModule";
import { EvidencePackPanel } from "@/components/match/EvidencePackPanel";
import { MatchNotes } from "@/components/match/MatchNotes";
import { DealTermsPanel } from "@/components/match/DealTermsPanel";
import { DisputePanel } from "@/components/match/DisputePanel";
import { ConfirmIntentCard } from "@/components/match/ConfirmIntentCard";
import { useUrlTab } from "@/hooks/use-url-tab";
import type { Match } from "@/hooks/use-match-details";

const ALLOWED_TABS = ["details", "documents", "terms", "notes", "evidence", "wad", "disputes", "timeline"];

interface MatchDetailsTabsProps {
  match: Match;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onRefresh: () => void;
}

export function MatchDetailsTabs({ match, canConfirm, confirming, onConfirm, onRefresh }: MatchDetailsTabsProps) {
  const [activeTab, setActiveTab] = useUrlTab("tab", "details", ALLOWED_TABS);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-8">
          <TabsTrigger value="details" className="flex items-center gap-1.5 min-w-[44px]">
            <Info className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Details</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-1.5 min-w-[44px]">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Documents</span>
          </TabsTrigger>
          <TabsTrigger value="terms" className="flex items-center gap-1.5 min-w-[44px]">
            <FileSignature className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Terms</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1.5 min-w-[44px]">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="evidence" className="flex items-center gap-1.5 min-w-[44px]">
            <Shield className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Evidence</span>
          </TabsTrigger>
          <TabsTrigger value="wad" className="flex items-center gap-1.5 min-w-[44px]">
            <Shield className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">WaD</span>
          </TabsTrigger>
          <TabsTrigger value="disputes" className="flex items-center gap-1.5 min-w-[44px]">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Disputes</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-1.5 min-w-[44px]">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Timeline</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="details" className="mt-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Match Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Commodity:</span> <span className="font-medium">{match.commodity}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <MatchStatusBadge status={match.status} /></div>
              <div><span className="text-muted-foreground">Buyer:</span> <span className="font-medium">{match.buyer_name}</span></div>
              <div><span className="text-muted-foreground">Seller:</span> <span className="font-medium">{match.seller_name}</span></div>
              <div><span className="text-muted-foreground">Quantity:</span> <span className="font-medium">{match.quantity_amount ?? "—"} {match.quantity_unit ?? ""}</span></div>
              <div><span className="text-muted-foreground">Price:</span> <span className="font-medium">{match.price_currency ?? ""} {match.price_amount?.toLocaleString() ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Total Value:</span> <span className="font-medium">{match.price_currency ?? ""} {((match.price_amount ?? 0) * (match.quantity_amount ?? 0)).toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">Hash:</span> <span className="font-mono text-xs">{match.hash}</span></div>
            </div>
            {match.terms && (
              <div className="pt-2 border-t">
                <span className="text-sm text-muted-foreground">Terms:</span>
                <p className="text-sm mt-1">{match.terms}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {canConfirm && (
          <ConfirmIntentCard onConfirm={onConfirm} loading={confirming} />
        )}
      </TabsContent>

      <TabsContent value="documents" className="mt-4 space-y-4">
        <MatchDocuments matchId={match.id} orgId={match.org_id} />
      </TabsContent>

      <TabsContent value="terms" className="mt-4">
        <DealTermsPanel matchId={match.id} orgId={match.org_id} />
      </TabsContent>

      <TabsContent value="notes" className="mt-4">
        <MatchNotes matchId={match.id} orgId={match.org_id} />
      </TabsContent>

      <TabsContent value="evidence" className="mt-4">
        <EvidencePackPanel matchId={match.id} matchStatus={match.status} />
      </TabsContent>

      <TabsContent value="wad" className="mt-4">
        <WadModule match={match} onWadCreated={onRefresh} />
      </TabsContent>

      <TabsContent value="disputes" className="mt-4">
        <DisputePanel matchId={match.id} orgId={match.org_id} />
      </TabsContent>

      <TabsContent value="timeline" className="mt-4">
        <MatchTimeline matchId={match.id} />
      </TabsContent>
    </Tabs>
  );
}
