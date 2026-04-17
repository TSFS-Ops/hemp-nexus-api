import { ExternalLink } from "lucide-react";
import { DocsLayout } from "./DocsLayout";

const SDKS = [
  {
    name: "Node.js",
    pkg: "@izenzo/sdk",
    install: "npm install @izenzo/sdk",
    sample: `import { Izenzo } from "@izenzo/sdk";

const izenzo = new Izenzo(process.env.IZENZO_KEY);

const match = await izenzo.matches.create({
  counterparty_id: "cp_8f3a...",
  commodity: "iron_ore_62fe",
  side: "bid",
  quantity: 50000
});`,
    runtime: "Node 18+ · TypeScript",
  },
  {
    name: "Python",
    pkg: "izenzo",
    install: "pip install izenzo",
    sample: `from izenzo import Izenzo

izenzo = Izenzo(api_key=os.environ["IZENZO_KEY"])

match = izenzo.matches.create(
    counterparty_id="cp_8f3a...",
    commodity="iron_ore_62fe",
    side="bid",
    quantity=50000,
)`,
    runtime: "Python 3.10+",
  },
  {
    name: "Go",
    pkg: "github.com/izenzo/izenzo-go",
    install: "go get github.com/izenzo/izenzo-go",
    sample: `client := izenzo.NewClient(os.Getenv("IZENZO_KEY"))

match, err := client.Matches.Create(ctx, &izenzo.MatchParams{
    CounterpartyID: "cp_8f3a...",
    Commodity:      "iron_ore_62fe",
    Side:           "bid",
    Quantity:       50000,
})`,
    runtime: "Go 1.21+",
  },
];

export default function Sdks() {
  return (
    <DocsLayout>
      <div className="max-w-5xl">
        <p className="text-[13px] font-medium text-emerald-600 tracking-wider uppercase mb-3">
          Reference
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-slate-900 mb-5">
          Libraries & SDKs
        </h1>
        <p className="text-lg text-slate-500 leading-relaxed mb-12 max-w-2xl">
          Official client libraries with type-safe request builders, automatic retries, and
          signature verification helpers built in.
        </p>

        <div className="grid md:grid-cols-3 gap-5">
          {SDKS.map((sdk) => (
            <div
              key={sdk.name}
              className="rounded-xl border border-slate-100 bg-white p-6 flex flex-col"
            >
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">{sdk.name}</h3>
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">{sdk.runtime}</span>
              </div>
              <code className="text-[12.5px] font-mono text-slate-500 mb-5">{sdk.pkg}</code>

              <div className="rounded-md bg-slate-950 border border-slate-800 p-3 mb-4">
                <code className="text-[11.5px] font-mono text-slate-300">{sdk.install}</code>
              </div>

              <pre className="text-[11.5px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-100 rounded-md p-4 overflow-x-auto flex-1">
                <code>{sdk.sample}</code>
              </pre>

              <a
                href="#"
                className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600 hover:text-emerald-700"
              >
                View source <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </DocsLayout>
  );
}
