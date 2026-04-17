import { createContext, useContext, useState, ReactNode } from "react";

type Env = "production" | "sandbox";

interface EnvCtx {
  env: Env;
  setEnv: (e: Env) => void;
}

const Ctx = createContext<EnvCtx>({ env: "sandbox", setEnv: () => {} });

export function EnvProvider({ children }: { children: ReactNode }) {
  // Sandbox is active by default — safer baseline for a developer landing fresh.
  const [env, setEnv] = useState<Env>("sandbox");
  return <Ctx.Provider value={{ env, setEnv }}>{children}</Ctx.Provider>;
}

export const useEnv = () => useContext(Ctx);

export function EnvSwitcher() {
  const { env, setEnv } = useEnv();
  const isProd = env === "production";

  return (
    <div
      className={[
        "inline-flex items-center rounded-full p-0.5 transition-colors",
        isProd
          ? "border border-red-500/60 bg-red-500/5"
          : "border border-slate-700 bg-slate-900",
      ].join(" ")}
    >
      <button
        onClick={() => setEnv("production")}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          isProd
            ? "border border-red-500/70 text-red-500 bg-red-500/10"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ● prod
      </button>
      <button
        onClick={() => setEnv("sandbox")}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          !isProd
            ? "border border-slate-100/80 text-slate-100 bg-slate-800"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ○ sandbox
      </button>
    </div>
  );
}
