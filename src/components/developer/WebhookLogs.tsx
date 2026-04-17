import { useState } from "react";

interface Delivery {
  id: string;
  ts: string;
  event: string;
  endpoint: string;
  status: "delivered" | "retry" | "failed";
  attempts: number;
  ms: number;
  code: number;
}

const DELIVERIES: Delivery[] = [
  { id: "evt_8h2k", ts: "2026-04-17 12:46:11", event: "match.sealed",       endpoint: "https://erp.acme.co.za/hooks/izenzo", status: "delivered", attempts: 1, ms: 184, code: 200 },
  { id: "evt_8h2j", ts: "2026-04-17 12:45:48", event: "poi.generated",      endpoint: "https://erp.acme.co.za/hooks/izenzo", status: "delivered", attempts: 1, ms: 211, code: 200 },
  { id: "evt_8h2h", ts: "2026-04-17 12:44:02", event: "trade.created",      endpoint: "https://api.partner.io/izenzo",        status: "retry",     attempts: 3, ms: 1842, code: 502 },
  { id: "evt_8h2g", ts: "2026-04-17 12:42:55", event: "entity.verified",    endpoint: "https://erp.acme.co.za/hooks/izenzo", status: "delivered", attempts: 1, ms: 167, code: 200 },
  { id: "evt_8h2f", ts: "2026-04-17 12:41:18", event: "dispute.raised",     endpoint: "https://compliance.harbour.io/in",     status: "failed",    attempts: 5, ms: 0,    code: 0   },
  { id: "evt_8h2e", ts: "2026-04-17 12:39:44", event: "match.sealed",       endpoint: "https://erp.acme.co.za/hooks/izenzo", status: "delivered", attempts: 1, ms: 192, code: 200 },
  { id: "evt_8h2d", ts: "2026-04-17 12:37:21", event: "key.rotated",        endpoint: "https://api.partner.io/izenzo",        status: "delivered", attempts: 2, ms: 412, code: 200 },
  { id: "evt_8h2c", ts: "2026-04-17 12:35:09", event: "poi.generated",      endpoint: "https://erp.acme.co.za/hooks/izenzo", status: "delivered", attempts: 1, ms: 174, code: 200 },
];

const PAYLOAD = `{
  "id": "evt_8h2k",
  "type": "match.sealed",
  "created": 1745330771,
  "data": {
    "match_id": "mch_77f4a219",
    "buyer_org": "org_4Lp2",
    "seller_org": "org_9Tk6",
    "commodity": "maize.yellow.za",
    "quantity_mt": 5000,
    "price_zar": 4250,
    "incoterm": "FOB Durban",
    "poi_id": "poi_3a21bc"
  },
  "signature": "v1=8f4c…b2d7"
}`;

function statusBadge(s: Delivery["status"]) {
  if (s === "delivered") return "text-green-400 border-green-500/40";
  if (s === "retry") return "text-amber-400 border-amber-500/40";
  return "text-rose-400 border-rose-500/40";
}

export default function WebhookLogs() {
  const [selected, setSelected] = useState<Delivery>(DELIVERIES[0]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-6">
      {/* Table */}
      <div>
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§01 / Deliveries</div>
            <h2 className="mt-1 text-lg text-slate-100 tracking-tight">Recent Webhook Events</h2>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            <span className="text-green-400">●</span> 6 delivered &nbsp;
            <span className="text-amber-400">●</span> 1 retry &nbsp;
            <span className="text-rose-400">●</span> 1 failed
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-sm overflow-hidden">
          <div className="grid grid-cols-[140px_1fr_90px_60px_70px] gap-3 px-4 py-2.5 border-b border-slate-800 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400 bg-black/40">
            <div>Timestamp</div>
            <div>Event · Endpoint</div>
            <div>Status</div>
            <div className="text-right">Try</div>
            <div className="text-right">Latency</div>
          </div>
          <div className="divide-y divide-slate-800/70">
            {DELIVERIES.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d)}
                className={[
                  "w-full grid grid-cols-[140px_1fr_90px_60px_70px] gap-3 px-4 py-3 font-mono text-[12px] text-left transition-colors",
                  selected.id === d.id ? "bg-slate-800/60" : "hover:bg-slate-800/30",
                ].join(" ")}
              >
                <div className="text-blue-400">{d.ts.slice(11)}</div>
                <div className="min-w-0">
                  <div className="text-slate-100 truncate">{d.event}</div>
                  <div className="text-slate-400 truncate text-[11px]">{d.endpoint}</div>
                </div>
                <div>
                  <span className={`text-[10px] uppercase tracking-[0.16em] px-1.5 py-0.5 border rounded-sm ${statusBadge(d.status)}`}>
                    {d.status}
                  </span>
                </div>
                <div className="text-right text-slate-400">{d.attempts}×</div>
                <div className="text-right text-slate-400">{d.ms ? `${d.ms}ms` : "—"}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Inspector */}
      <aside>
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§02 / Inspector</div>
            <h2 className="mt-1 text-lg text-slate-100 tracking-tight">Payload</h2>
          </div>
          <button className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-green-400 border border-slate-700 hover:border-green-500/50 px-3 py-1.5 rounded-sm transition-colors">
            ↻ Replay
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-sm">
          <div className="px-4 py-3 border-b border-slate-800 space-y-1.5">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">event_id</span>
              <span className="text-slate-100">{selected.id}</span>
            </div>
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">type</span>
              <span className="text-slate-100">{selected.event}</span>
            </div>
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">http_status</span>
              <span className={selected.code >= 200 && selected.code < 300 ? "text-green-400" : "text-rose-400"}>
                {selected.code || "—"}
              </span>
            </div>
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">attempts</span>
              <span className="text-slate-100">{selected.attempts} of 5</span>
            </div>
          </div>
          <pre className="bg-black p-4 font-mono text-[11px] leading-relaxed text-green-400 overflow-x-auto rounded-b-sm">{PAYLOAD}</pre>
        </div>
      </aside>
    </div>
  );
}
