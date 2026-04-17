import { Routes, Route, Navigate } from "react-router-dom";
import { DeveloperShell } from "@/components/developer/DeveloperShell";
import { ApiKeysPanel } from "@/components/developer/ApiKeysPanel";
import { LiveActivityFeed } from "@/components/developer/LiveActivityFeed";
import WebhookLogs from "@/components/developer/WebhookLogs";
import SchemaExplorer from "@/components/developer/SchemaExplorer";
import IntegrationDocs from "@/components/developer/IntegrationDocs";

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
        <div className="flex items-center gap-6 font-mono text-[11px] text-slate-400">
          <div>
            <span className="text-slate-500 uppercase tracking-[0.16em] mr-2">env</span>
            <span className="text-green-400">production</span>
          </div>
          <div>
            <span className="text-slate-500 uppercase tracking-[0.16em] mr-2">api</span>
            <span className="text-slate-100">{badge ?? "v1.4.2"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function KeysView() {
  return (
    <>
      <DeveloperHeader section="API Keys" />
      <div className="px-12 py-10 space-y-12">
        <ApiKeysPanel />
        <LiveActivityFeed />
      </div>
    </>
  );
}

function WebhooksView() {
  return (
    <>
      <DeveloperHeader section="Webhook Logs" />
      <div className="px-12 py-10">
        <WebhookLogs />
      </div>
    </>
  );
}

function SchemaView() {
  return (
    <>
      <DeveloperHeader section="Schema Explorer" badge="OpenAPI 3.1" />
      <div className="px-12 py-10">
        <SchemaExplorer />
      </div>
    </>
  );
}

function DocsView() {
  return (
    <>
      <DeveloperHeader section="Integration Docs" badge="SDK 1.4.2" />
      <div className="px-12 py-10">
        <IntegrationDocs />
      </div>
    </>
  );
}

export default function DeveloperCenter() {
  return (
    <DeveloperShell>
      <Routes>
        <Route index element={<Navigate to="keys" replace />} />
        <Route path="keys" element={<KeysView />} />
        <Route path="webhooks" element={<WebhooksView />} />
        <Route path="schema" element={<SchemaView />} />
        <Route path="docs" element={<DocsView />} />
      </Routes>
    </DeveloperShell>
  );
}
