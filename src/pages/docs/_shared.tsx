import { ReactNode } from "react";

/**
 * Shared primitives for the /docs surface.
 * Tone target: Plaid / Modern Treasury — declarative, code-forward, no marketing.
 */

export function DocEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] font-medium text-[hsl(var(--emerald))] tracking-wider uppercase mb-3">
      {children}
    </p>
  );
}

export function DocH1({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-foreground mb-5">
      {children}
    </h1>
  );
}

export function DocLede({ children }: { children: ReactNode }) {
  return (
    <p className="text-lg text-muted-foreground leading-relaxed mb-12 max-w-2xl">{children}</p>
  );
}

export function DocH2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="text-2xl font-semibold tracking-tight text-foreground mt-12 mb-3 scroll-mt-28"
    >
      {children}
    </h2>
  );
}

export function DocH3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="text-[15px] font-semibold tracking-tight text-foreground mt-8 mb-2 scroll-mt-28"
    >
      {children}
    </h3>
  );
}

export function DocP({ children }: { children: ReactNode }) {
  return <p className="text-[14.5px] text-muted-foreground leading-relaxed mb-4">{children}</p>;
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="text-[12.5px] font-mono px-1.5 py-0.5 rounded bg-muted text-slate-800">
      {children}
    </code>
  );
}

export function CodePanel({
  code,
  title,
  language,
}: {
  code: string;
  title?: string;
  language?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden my-5">
      {(title || language) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
            {title ?? language}
          </span>
          {language && title && (
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>
      )}
      <pre className="p-5 text-[12.5px] leading-relaxed text-slate-100 font-mono overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ParamTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; desc: ReactNode }[];
}) {
  return (
    <div className="border border-border rounded-xl divide-y divide-border my-5">
      {rows.map((r) => (
        <div key={r.name} className="px-4 py-3 grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-3">
            <code className="text-[13px] font-mono text-foreground">{r.name}</code>
          </div>
          <div className="col-span-12 md:col-span-2">
            <span className="text-[11.5px] font-mono text-muted-foreground">{r.type}</span>
            {r.required && (
              <span className="ml-2 text-[10px] font-medium text-rose-600 uppercase tracking-wider">
                required
              </span>
            )}
          </div>
          <div className="col-span-12 md:col-span-7 text-[13px] text-muted-foreground leading-relaxed">
            {r.desc}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Callout({
  variant = "info",
  children,
}: {
  variant?: "info" | "warning";
  children: ReactNode;
}) {
  const styles =
    variant === "warning"
      ? "border-amber-200 bg-amber-50/60 text-amber-900"
      : "border-border bg-muted text-muted-foreground";
  return (
    <div className={`border rounded-lg px-4 py-3 my-5 text-[13.5px] leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function EndpointBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "text-[hsl(var(--emerald))] bg-[hsl(var(--emerald-muted))] border-[hsl(var(--emerald)/0.2)]",
    POST: "text-blue-700 bg-blue-50 border-blue-100",
    PATCH: "text-amber-700 bg-amber-50 border-amber-100",
    DELETE: "text-rose-700 bg-rose-50 border-rose-100",
  };
  return (
    <span
      className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${
        colors[method] ?? "text-muted-foreground bg-muted border-border"
      }`}
    >
      {method}
    </span>
  );
}
