/**
 * Dark obsidian developer panel with full structured cURL.
 * Extracted from Landing.tsx for modularity.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export function DeveloperAccessPanel() {
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 bg-basalt text-basalt-foreground">
      <div className="max-w-[1280px] mx-auto">
        <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-3 block animate-fade-up">
          For Developers
        </span>
        <h2 className="text-basalt-foreground mb-2 tracking-tighter animate-fade-up delay-75">Developer Access</h2>
        <p className="text-[13px] text-basalt-foreground/50 mb-10 max-w-md leading-relaxed animate-fade-up delay-150">
          Integrate counterparty discovery, intent signalling, and governance workflows
          directly into your systems via the Izenzo API.
        </p>

        {/* Premium IDE code block */}
        <div className="border border-graphite bg-[hsl(225,20%,3.5%)] overflow-hidden animate-fade-up delay-200">
          {/* Tab bar */}
          <div className="flex items-center border-b border-graphite">
            <div className="px-4 py-2.5 border-r border-graphite bg-basalt/80">
              <span className="text-[10px] font-mono text-basalt-foreground/70">intent-discover.sh</span>
            </div>
            <div className="px-4 py-2.5">
              <span className="text-[10px] font-mono text-basalt-foreground/25">response.json</span>
            </div>
          </div>

          {/* Code content */}
          <pre className="p-5 sm:p-6 font-mono text-[12px] leading-[1.85] whitespace-pre overflow-x-auto">
            <code>
              <span className="text-muted-foreground">{"# Initialise governed counterparty discovery"}</span>{"\n"}
              <span className="text-muted-foreground">{"# Requires active API key and valid compliance workspace ID"}</span>{"\n"}
              {"\n"}
              <span className="text-primary">curl</span>
              <span className="text-basalt-foreground">{" -X "}</span>
              <span className="text-primary">POST</span>
              <span className="text-basalt-foreground"> https://api.trade.izenzo.co.za/v1/intent/discover</span>
              <span className="text-basalt-foreground/30">{" \\"}</span>{"\n"}
              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Authorization: Bearer sk_test_example_9a8b7c6d"'}</span>
              <span className="text-basalt-foreground/30">{" \\"}</span>{"\n"}
              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Content-Type: application/json"'}</span>
              <span className="text-basalt-foreground/30">{" \\"}</span>{"\n"}
              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Idempotency-Key: req_01H8X7B2"'}</span>
              <span className="text-basalt-foreground/30">{" \\"}</span>{"\n"}
              <span className="text-basalt-foreground">{"  -d '"}</span>
              <span className="text-basalt-foreground">{"{"}</span>{"\n"}
              <span className="text-basalt-foreground/40">{"    "}</span><span className="text-border">{'"instrument"'}</span><span className="text-basalt-foreground">{": {"}</span>{"\n"}
              <span className="text-basalt-foreground/40">{"      "}</span><span className="text-border">{'"product"'}</span><span className="text-basalt-foreground">{": "}</span><span className="text-signal-verified">{'"copper_cathode"'}</span><span className="text-basalt-foreground">{","}</span>{"\n"}
              <span className="text-basalt-foreground/40">{"      "}</span><span className="text-border">{'"volume"'}</span><span className="text-basalt-foreground">{": "}</span><span className="text-signal-verified">{'"2500"'}</span><span className="text-basalt-foreground">{","}</span>{"\n"}
              <span className="text-basalt-foreground/40">{"      "}</span><span className="text-border">{'"unit"'}</span><span className="text-basalt-foreground">{": "}</span><span className="text-signal-verified">{'"MT"'}</span>
              {"\n"}
              <span className="text-basalt-foreground/40">{"    "}</span><span className="text-basalt-foreground">{"},"}</span>{"\n"}
              <span className="text-basalt-foreground/40">{"    "}</span><span className="text-border">{'"governance"'}</span><span className="text-basalt-foreground">{": { "}</span>
              <span className="text-border">{'"intent_type"'}</span><span className="text-basalt-foreground">{": "}</span><span className="text-signal-verified">{'"buy"'}</span><span className="text-basalt-foreground">{", "}</span>
              <span className="text-border">{'"require_kyc_cleared"'}</span><span className="text-basalt-foreground">{": "}</span><span className="text-signal-pending">{"true"}</span>
              <span className="text-basalt-foreground">{" }"}</span>{"\n"}
              <span className="text-basalt-foreground">{"  }'"}</span>{"\n"}
              {"\n"}
              <span className="text-muted-foreground">{"# Response: 201 Created"}</span>{"\n"}
              <span className="text-muted-foreground">{'# { "poi_eligible": true, "market_hash": "0x4a2b...", "corridors_active": 3 }'}</span>
            </code>
          </pre>
        </div>

        <Link
          to="/docs"
          className="inline-flex items-center gap-1.5 mt-6 text-[11px] font-mono uppercase tracking-widest font-medium text-primary hover:text-primary/80 transition-colors
                   relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-primary/30 after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300 after:origin-left"
        >
          View full API documentation
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}
