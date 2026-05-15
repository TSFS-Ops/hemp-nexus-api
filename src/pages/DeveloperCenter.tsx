import { Routes, Route, Navigate } from "react-router-dom";
import { DeveloperShell } from "@/components/developer/DeveloperShell";
import { ApiKeysPanel } from "@/components/developer/ApiKeysPanel";
import { LiveActivityFeed } from "@/components/developer/LiveActivityFeed";
import WebhookLogs from "@/components/developer/WebhookLogs";
import SchemaExplorer from "@/components/developer/SchemaExplorer";
import IntegrationDocs from "@/components/developer/IntegrationDocs";
import { EnvProvider, EnvSwitcher, EnvModeBanner, EnvModeComparison } from "@/components/developer/EnvSwitcher";
import { QuickStart } from "@/components/developer/QuickStart";
import { SystemDiagnostics } from "@/components/developer/SystemDiagnostics";
import { QuickSchema } from "@/components/developer/QuickSchema";
import { PlainEnglishWalkthrough } from "@/components/developer/PlainEnglishWalkthrough";
import { DevPageHeader } from "@/components/developer/DevPageHeader";
import { OnboardingChecklist } from "@/components/developer/OnboardingChecklist";
import { Info } from "lucide-react";

function DeveloperHeader({ section, badge }: { section: string; badge?: string }) {
  return (
    <header className="border-b border-slate-800 px-12 py-6 bg-slate-950">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
            izenzo · developer surface
          </div>
          <h1 className="mt-1 text-xl text-slate-100 tracking-tight" style={{ fontFamily: "Inter, sans-serif" }}>
            {section}
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="font-mono text-[11px] text-slate-400">
            <span className="text-slate-500 uppercase tracking-[0.16em] mr-2">api</span>
            <span className="text-slate-100">{badge ?? "v1.4.2"}</span>
          </div>
          <EnvSwitcher />
        </div>
      </div>
    </header>
  );
}

/**
 * IntroBox — short plain-English orientation. Lives only on the Keys tab
 * (the landing tab) so a brand-new visitor immediately knows what this
 * area is, and what it is not.
 */
function KeysIntroBox() {
  return (
    <section className="rounded-sm border border-slate-800 bg-slate-900/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <Info className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div style={{ fontFamily: "Inter, sans-serif" }}>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
            What the Developer Centre is
          </div>
          <p className="mt-1 text-[13px] text-slate-200 leading-relaxed">
            A control surface for machines. Issue and manage API keys, watch live traffic, browse the
            data schema, and read integration guides. Anything you do here changes how your back-office
            systems talk to Izenzo.
          </p>
          <p className="mt-1.5 text-[12.5px] text-slate-400 leading-relaxed">
            <span className="text-slate-300 font-medium">It is not</span> the trade desk. Human trade
            actions (creating requests, accepting engagements, attesting WaD bundles) live under
            Desk. This page is for the people wiring those actions into other software.
          </p>
        </div>
      </div>
    </section>
  );
}

function KeysView() {
  return (
    <>
      <DeveloperHeader section="API Keys" />
      <div className="px-12 py-10 space-y-10">
        <EnvModeBanner />
        <DevPageHeader audience="Engineers and integration owners issuing credentials and wiring back-office systems to Izenzo." />
        <KeysIntroBox />
        <PlainEnglishWalkthrough />
        <OnboardingChecklist />
        <EnvModeComparison />
        <ApiKeysPanel />

        {/* HUD: Quick-Start (left) · Diagnostics (right) */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8 items-start">
          <QuickStart />
          <SystemDiagnostics />
        </div>

        <LiveActivityFeed />
        <QuickSchema />
      </div>
    </>
  );
}

function WebhooksView() {
  return (
    <>
      <DeveloperHeader section="Webhook Logs" />
      <div className="px-12 py-10 space-y-10">
        <EnvModeBanner />
        <DevPageHeader audience="Engineers verifying that Izenzo events are reaching your servers and being acknowledged." />
        <PlainEnglishWalkthrough />
        <WebhookLogs />
      </div>
    </>
  );
}

function SchemaView() {
  return (
    <>
      <DeveloperHeader section="Schema Explorer" badge="OpenAPI 3.1" />
      <div className="px-12 py-10 space-y-10">
        <EnvModeBanner />
        <DevPageHeader audience="Engineers looking up exact request and response shapes before writing client code." />
        <PlainEnglishWalkthrough />
        <SchemaExplorer />
      </div>
    </>
  );
}

function DocsView() {
  return (
    <>
      <DeveloperHeader section="Integration Docs" badge="REST API" />
      <div className="px-12 py-10 space-y-10">
        <EnvModeBanner />
        <DevPageHeader audience="Engineers learning how Izenzo flows fit together end to end, from key issue to sealed WaD bundle." />
        <PlainEnglishWalkthrough />
        <IntegrationDocs />
      </div>
    </>
  );
}

export default function DeveloperCenter() {
  return (
    <EnvProvider>
      <DeveloperShell>
        <Routes>
          <Route index element={<Navigate to="keys" replace />} />
          <Route path="keys" element={<KeysView />} />
          <Route path="webhooks" element={<WebhooksView />} />
          <Route path="schema" element={<SchemaView />} />
          <Route path="docs" element={<DocsView />} />
        </Routes>
      </DeveloperShell>
    </EnvProvider>
  );
}
