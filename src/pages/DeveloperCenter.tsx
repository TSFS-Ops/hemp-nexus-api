import { Routes, Route, Navigate } from "react-router-dom";
import { DeveloperShell } from "@/components/developer/DeveloperShell";
import { ApiKeysPanel } from "@/components/developer/ApiKeysPanel";
import { LiveActivityFeed } from "@/components/developer/LiveActivityFeed";

function DeveloperHeader({ section }: { section: string }) {
  return (
    <header className="border-b border-slate-800 px-12 py-6 bg-slate-950">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
            izenzo · developer surface
          </div>
          <h1 className="mt-1 text-xl text-slate-100 tracking-tight">{section}</h1>
        </div>
        <div className="flex items-center gap-6 text-[11px] text-slate-500">
          <div>
            <span className="text-slate-600 uppercase tracking-[0.16em] mr-2">env</span>
            <span className="text-emerald-300">production</span>
          </div>
          <div>
            <span className="text-slate-600 uppercase tracking-[0.16em] mr-2">api</span>
            <span className="text-slate-200">v1.4.2</span>
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

function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <>
      <DeveloperHeader section={title} />
      <div className="px-12 py-10">
        <div className="bg-slate-900 border border-slate-800 rounded-sm p-8 max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400 mb-3">
            ◉ scheduled
          </div>
          <h2 className="text-base text-slate-100 mb-2">{title}</h2>
          <p className="text-[13px] text-slate-400 leading-relaxed">{blurb}</p>
          <div className="mt-6 pt-6 border-t border-slate-800 text-[11px] text-slate-500">
            ETA Q3 2026 · contact <span className="text-slate-300">api@izenzo.co.za</span> for early access
          </div>
        </div>
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
        <Route
          path="webhooks"
          element={
            <ComingSoon
              title="Webhook Logs"
              blurb="Replay, inspect, and debug every event delivered to your endpoints. Filter by signature, status, and retry attempt."
            />
          }
        />
        <Route
          path="schema"
          element={
            <ComingSoon
              title="Schema Explorer"
              blurb="Browse the live OpenAPI surface. Inspect request/response shapes, generate typed clients, and trace field-level provenance."
            />
          }
        />
        <Route
          path="docs"
          element={
            <ComingSoon
              title="Integration Docs"
              blurb="ERP connectors, SDK references, and step-by-step playbooks for wiring Izenzo into SAP, Oracle, NetSuite, and custom backends."
            />
          }
        />
      </Routes>
    </DeveloperShell>
  );
}
