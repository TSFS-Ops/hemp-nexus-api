import { createContext, useContext, useState, ReactNode } from "react";

type Env = "production" | "sandbox";

interface EnvCtx {
  env: Env;
  setEnv: (e: Env) => void;
}

const Ctx = createContext<EnvCtx>({ env: "production", setEnv: () => {} });

export function EnvProvider({ children }: { children: ReactNode }) {
  const [env, setEnv] = useState<Env>("production");
  return <Ctx.Provider value={{ env, setEnv }}>{children}</Ctx.Provider>;
}

export const useEnv = () => useContext(Ctx);

export function EnvSwitcher() {
  const { env, setEnv } = useEnv();
  const isProd = env === "production";

  return (
    <div className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900 p-0.5">
      <button
        onClick={() => setEnv("production")}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          isProd
            ? "border border-red-500/60 text-red-400 bg-red-500/5"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ● production
      </button>
      <button
        onClick={() => setEnv("sandbox")}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          !isProd
            ? "border border-slate-600 text-slate-200 bg-slate-800"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ○ sandbox
      </button>
    </div>
  );
}
