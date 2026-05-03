import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useEnv } from "./EnvSwitcher";
const SAMPLE_KEY = {
  production: "sk_live_77f4••••3a21",
  sandbox: "sk_test_3lp8••••8e02"
};
const HOST = {
  production: "https://api.izenzo.co.za/functions/v1",
  sandbox: "https://api.izenzo.co.za/functions/v1"
};
const ORG_ID = {
  production: "org_4Lp2ZA",
  sandbox: "org_sbx_demo"
};
export function QuickStart() {
  const {
    env
  } = useEnv();
  const [copied, setCopied] = useState(false);
  const cmd = `# 1. Export your institutional credential (never commit this)
export IZENZO_KEY="${SAMPLE_KEY[env]}"

# 2. Verify the ledger is reachable from your network
curl -X GET ${HOST[env]}/healthz \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "X-Org-Id: ${ORG_ID[env]}" \\
  -H "Content-Type: application/json"

# Expect: { "status": "ok", "ledger": "synchronised" }`;
  const copy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return <section>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
        // 01_AUTHENTICATE_SESSION
      </div>
      <p className="text-[12px] text-slate-400 mb-3 max-w-xl" style={{
      fontFamily: "Inter, sans-serif"
    }}>
        Your first call. Copy the snippet, paste it into a shell, and confirm the ledger handshake.
        Comments are inline so a new engineer can read it top-to-bottom without docs.
      </p>
      <div className="bg-black border border-slate-800 rounded-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              shell · hello world
            </span>
            <span className="font-mono text-[10px] text-slate-600">env={env}</span>
          </div>
          <button onClick={copy} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 hover:text-green-400 transition-colors">
            {copied ? <>
                <Check className="h-3 w-3 text-green-400" />
                <span className="text-green-400">copied</span>
              </> : <>
                <Copy className="h-3 w-3" />
                <span>copy</span>
              </>}
          </button>
        </div>
        <pre className="p-4 font-mono text-[12px] leading-[1.7] text-slate-100 overflow-x-auto">
          <Line>
            <C># 1. Export your institutional credential (never commit this)</C>
          </Line>
          <Line>
            <K>export</K> <V>IZENZO_KEY</V>=<S>"{SAMPLE_KEY[env]}"</S>
          </Line>
          <Line> </Line>
          <Line>
            <C># 2. Verify the ledger is reachable from your network</C>
          </Line>
          <Line>
            <K>curl</K> -X <M>GET</M> {HOST[env]}/healthz \
          </Line>
          <Line>{"  "}-H <S>"X-API-Key: $IZENZO_KEY"</S> \</Line>
          <Line>
            {"  "}-H <S>"X-Org-Id: {ORG_ID[env]}"</S> \
          </Line>
          <Line>{"  "}-H <S>"Content-Type: application/json"</S></Line>
          <Line> </Line>
          <Line>
            <C># Expect: {"{ "}<span className="text-amber-300">"status"</span>: <span className="text-amber-300">"ok"</span>, <span className="text-amber-300">"ledger"</span>: <span className="text-amber-300">"synchronised"</span>{" }"}</C>
          </Line>
        </pre>
      </div>
    </section>;
}
const Line = ({
  children
}: {
  children: React.ReactNode;
}) => <div className="whitespace-pre">{children}</div>;
const C = ({
  children
}: {
  children: React.ReactNode;
}) => <span className="text-slate-500">{children}</span>;
const K = ({
  children
}: {
  children: React.ReactNode;
}) => <span className="text-cyan-400">{children}</span>;
const V = ({
  children
}: {
  children: React.ReactNode;
}) => <span className="text-blue-400">{children}</span>;
const S = ({
  children
}: {
  children: React.ReactNode;
}) => <span className="text-green-400">{children}</span>;
const M = ({
  children
}: {
  children: React.ReactNode;
}) => <span className="text-amber-300">{children}</span>;