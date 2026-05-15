import { Routes, Route, useNavigate, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Plus, ShieldAlert, X } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { DeskLayout } from "@/components/desk/DeskLayout";
import { DeskSidebar } from "@/components/desk/DeskSidebar";
import { AttentionPipeline } from "@/components/desk/AttentionPipeline";
import { DealPipeline } from "@/components/desk/DealPipeline";
import { DeskSettingsLayout } from "@/components/desk/settings/DeskSettingsLayout";
import { MyProfileTab } from "@/components/desk/settings/MyProfileTab";
import { CompanyIdentityTab } from "@/components/desk/settings/CompanyIdentityTab";
import { NotificationRulesTab } from "@/components/desk/settings/NotificationRulesTab";
import { TokenBalanceTab } from "@/components/desk/settings/TokenBalanceTab";
import { MatchCompiler } from "@/components/desk/match/MatchCompiler";
import { SealedEngagement } from "@/components/desk/match/SealedEngagement";
import { RejectedMatch } from "@/components/desk/match/RejectedMatch";
import { DiscoverCounterparties } from "@/components/desk/discover/DiscoverCounterparties";
import { InboundReview } from "@/components/desk/inbound/InboundReview";
import { EvidencePackView } from "@/components/desk/evidence/EvidencePackView";
import { ComplianceProfile } from "@/components/desk/compliance/ComplianceProfile";
import { BillingOverview } from "@/components/desk/billing/BillingOverview";
import { NewTradeInitiation } from "@/components/desk/NewTradeInitiation";
// Migrated from the retired /dashboard shell. Data hooks (useQuery, Supabase) are unchanged.
import MatchDetails from "@/pages/MatchDetails";
import TradeDealWizard from "@/pages/TradeDealWizard";
import { MatchesList } from "@/components/MatchesList";

/** Full-bleed shell: sidebar only, no padded max-w container. */
function DeskFullBleed({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex bg-white">
      <DeskSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function DeskOverview() {
  const navigate = useNavigate();

  return (
    <>
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-8 mb-8 sm:mb-12">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
            Commercial Trading
          </p>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight break-words">
            Your Deal Desk
          </h1>
        </div>
        <button
          onClick={() => navigate("/desk/discover")}
          className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Start New Trade
        </button>
      </header>

      <AttentionPipeline />
      <DealPipeline />
    </>
  );
}

/* DeskPlaceholder removed, all Desk routes now mount functional components. */

/** Forward legacy /desk/deals/:matchId deep links to the migrated MatchDetails route. */
function RedirectDealToMatch() {
  const { matchId } = useParams();
  return <Navigate to={`/desk/match/${matchId ?? ""}`} replace />;
}

export default function Desk() {
  const { user, isLoading } = useAuth();

  // Guests landing on /desk (or any sub-route) see the public Landing page
  // instead of being auto-bounced to /auth. Signed-in users get the desk.
  if (!isLoading && !user) {
    return <Landing />;
  }

  return (
    <RequireAuth>
      <Routes>
        {/* Full-bleed routes, no padded container */}
        <Route
          path="match/active"
          element={
            <DeskFullBleed>
              <SealedEngagement />
            </DeskFullBleed>
          }
        />
        <Route
          path="match/rejected"
          element={
            <DeskFullBleed>
              <RejectedMatch />
            </DeskFullBleed>
          }
        />
        <Route
          path="inbound/review/:matchId"
          element={
            <DeskFullBleed>
              <InboundReview />
            </DeskFullBleed>
          }
        />
        {/* Legacy mock route, redirect to deals overview */}
        <Route path="inbound/review" element={<Navigate to="/desk" replace />} />
        {/* New trade initiation, must be defined BEFORE /match/:matchId so the
            literal "new" segment is not interpreted as a match UUID. */}
        <Route
          path="match/new"
          element={
            <DeskFullBleed>
              <NewTradeInitiation />
            </DeskFullBleed>
          }
        />
        {/* MatchDetails, migrated from /dashboard/matches/:matchId.
            Backend hooks (useMatchDetails, useQuery for engagements) are unchanged;
            only the surrounding shell is now the Desk layout. */}
        <Route
          path="match/:matchId"
          element={
            <DeskFullBleed>
              <MatchDetails />
            </DeskFullBleed>
          }
        />
        {/* MatchCompiler retains its split-screen WaD editor under a dedicated path. */}
        <Route
          path="compiler/:matchId"
          element={
            <DeskFullBleed>
              <MatchCompiler />
            </DeskFullBleed>
          }
        />
        {/* TradeDealWizard, migrated from /trade/wizard. */}
        <Route
          path="wizard"
          element={
            <DeskFullBleed>
              <TradeDealWizard />
            </DeskFullBleed>
          }
        />
        <Route path="evidence/:id" element={<EvidencePackView />} />

        {/* Standard padded Desk surfaces */}
        <Route
          path="*"
          element={
            <DeskLayout>
              <Routes>
                <Route index element={<DeskOverview />} />
                <Route path="discover" element={<DiscoverCounterparties />} />
                <Route
                  path="deals"
                  element={
                    <>
                      <header className="mb-8">
                        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
                          Commercial Trading
                        </p>
                        <h1 className="text-4xl font-semibold text-slate-900 tracking-tight">My Deals</h1>
                        <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-xl">
                          The complete archive of your trade activity, including drafts, active negotiations, and sealed Proofs of Intent.
                        </p>
                      </header>
                      <MatchesList />
                    </>
                  }
                />
                {/* Legacy /desk/deals/:matchId, forward to the migrated MatchDetails surface. */}
                <Route path="deals/:matchId" element={<RedirectDealToMatch />} />
                {/* Deep links to a specific deal route through the migrated MatchDetails surface. */}
                <Route path="compliance" element={<ComplianceProfile />} />
                <Route path="billing" element={<BillingOverview />} />
                <Route path="settings" element={<DeskSettingsLayout />}>
                  <Route index element={<MyProfileTab />} />
                  <Route path="company" element={<CompanyIdentityTab />} />
                  <Route path="notifications" element={<NotificationRulesTab />} />
                  <Route path="balance" element={<TokenBalanceTab />} />
                </Route>
                <Route path="new-trade" element={<NewTradeInitiation />} />
              </Routes>
            </DeskLayout>
          }
        />
      </Routes>
    </RequireAuth>
  );
}
