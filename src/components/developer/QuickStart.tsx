import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useEnv } from "./EnvSwitcher";

const SAMPLE_KEY = {
  production: "iz_live_77f4••••3a21",
  sandbox: "iz_test_3lp8••••8e02",
};

const HOST = {
  production: "https://api.izenzo.io",
  sandbox: "https://sandbox.api.izenzo.io",
};

export function QuickStart() {
  const { env } = useEnv();
  const [copied, setCopied] = useState(false);

  const cmd = `curl -X GET ${HOST[env]}/v1/health \\
  -H "Authorization: Bearer ${SAMPLE_KEY[env]}" \\
  -H "Content-Type: application/json"`;

  const copy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
        // INITIALIZE_CONNECTION
      </div>
      <div className="bg-black border border-slate-800 rounded-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              shell · first call
            </span>
            <span className="font-mono text-[10px] text-slate-600">env={env}</span>
          </div>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 hover:text-green-400 transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-400" />
                <span className="text-green-400">copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>copy</span>
              </>
            )}
          </button>
        </div>
        <pre className="p-4 font-mono text-[12px] leading-[1.7] text-slate-100 overflow-x-auto">
          <span className="text-slate-500">$ </span>
          <span className="text-cyan-400">curl</span>
          <span className="text-slate-100"> -X </span>
          <span className="text-amber-300">GET</span>
          <span className="text-slate-100"> {HOST[env]}/v1/health \</span>
          {"\n  "}
          <span className="text-slate-100">-H </span>
          <span className="text-green-400">"Authorization: Bearer {SAMPLE_KEY[env]}"</span>
          <span className="text-slate-100"> \</span>
          {"\n  "}
          <span className="text-slate-100">-H </span>
          <span className="text-green-400">"Content-Type: application/json"</span>
        </pre>
      </div>
    </section>
  );
}
