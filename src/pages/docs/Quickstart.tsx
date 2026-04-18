import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";
import { DocsLayout } from "./DocsLayout";

export default function DocsQuickstart() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <p className="text-[13px] font-medium text-emerald-600 tracking-wider uppercase mb-3">
          Quickstart
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-slate-900 mb-5">
          Your first authenticated request
        </h1>
        <p className="text-lg text-slate-500 leading-relaxed mb-10">
          Issue an API key, sign a request, and read your organisation profile in under five minutes.
        </p>

        <ol className="space-y-10">
          <li>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-2">
              1. Create an API key
            </h2>
            <p className="text-slate-500 leading-relaxed mb-3">
              Open the Developer Centre and generate a key scoped to <code className="text-[13px] bg-slate-100 px-1.5 py-0.5 rounded">orgs:read</code>.
              Keys are shown once at creation; store the secret in your secrets manager.
            </p>
            <Link
              to="/developer/keys"
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-emerald-600 hover:text-emerald-700"
            >
              Open Developer Centre <ArrowRight className="h-4 w-4" />
            </Link>
          </li>

          <li>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-2">
              2. Call the API
            </h2>
            <p className="text-slate-500 leading-relaxed mb-3">
              Pass the key in the <code className="text-[13px] bg-slate-100 px-1.5 py-0.5 rounded">Authorization</code> header.
              All endpoints accept and return JSON.
            </p>
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-[13px] font-mono leading-relaxed overflow-x-auto">
              <code>{`curl https://api.trade.izenzo.co.za/v1/orgs \\
  -H "Authorization: Bearer izenzo_live_..." \\
  -H "Content-Type: application/json"`}</code>
            </pre>
          </li>

          <li>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-2">
              3. Inspect the response
            </h2>
            <p className="text-slate-500 leading-relaxed mb-3">
              A successful call returns the organisations visible to the key, along with a request ID
              for cross-referencing in the audit ledger.
            </p>
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-[13px] font-mono leading-relaxed overflow-x-auto">
              <code>{`{
  "data": [
    { "id": "org_…", "name": "Acme Trading", "status": "active" }
  ]
}`}</code>
            </pre>
          </li>
        </ol>

        <section className="border-t border-slate-100 mt-14 pt-10">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-emerald-600 mt-0.5" strokeWidth={1.75} />
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900 mb-1.5 tracking-tight">
                Next: explore the full reference
              </h3>
              <p className="text-[13.5px] text-slate-500 leading-relaxed mb-3">
                Every endpoint, parameter and response shape is documented in the API reference.
              </p>
              <Link
                to="/docs/api"
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-emerald-600 hover:text-emerald-700"
              >
                Open API reference <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
