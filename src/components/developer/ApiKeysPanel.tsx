import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw, Check, Plus, Pencil, Trash2, AlertTriangle, X, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  status: string;
  environment: string | null;
  expires_at: string | null;
}

interface RevealedKey {
  id: string;
  name: string;
  key: string;
  rotated?: boolean;
}

async function callKeysFn<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path = "",
  body?: Record<string, unknown>
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/api-keys${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

function maskedKeyDisplay(id: string, environment: string | null = "live") {
  // We never store plaintext, so always show a stable visual placeholder
  // that mirrors the real key contract (sk_live_ / sk_test_).
  const env = (environment || "live").toLowerCase() === "sandbox" ? "test" : "live";
  return `sk_${env}_••••••••••••••••${id.slice(0, 4).padEnd(4, "x").toLowerCase()}`;
}

function RevealModal({ data, onClose }: { data: RevealedKey; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(data.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-sm">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
              {data.rotated ? "Key rotated" : "Key created"}
            </div>
            <h3 className="mt-1 text-sm text-slate-100">{data.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 rounded-sm">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="font-mono text-[11px] text-amber-200 leading-relaxed">
              Save this key now. For security, it will <strong>never be shown again</strong>.
              {data.rotated && " The previous key has been revoked."}
            </p>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">
              Secret Key (one-time display)
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <div className="flex-1 bg-black border border-slate-800 px-3 py-2.5 font-mono text-[12px] text-green-400 break-all rounded-sm">
                {data.key}
              </div>
              <button
                onClick={copy}
                className="px-3 py-2 sm:py-0 bg-black border border-slate-700 text-slate-400 hover:text-green-400 hover:border-slate-600 transition-colors rounded-sm inline-flex items-center justify-center gap-1.5"
                aria-label="Copy key"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="sm:hidden font-mono text-[11px] uppercase tracking-[0.16em]">
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t border-slate-800 px-6 py-3">
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 bg-green-600/20 border border-green-500/40 hover:bg-green-600/30 px-4 py-1.5 rounded-sm transition-colors"
          >
            I&apos;ve saved it
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-sm">
        <div className="px-6 py-4 border-b border-slate-800">
          <h3 className="text-sm text-slate-100">{title}</h3>
        </div>
        <div className="px-6 py-4">
          <p className="text-[13px] text-slate-300 leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-3">
          <button
            onClick={onCancel}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={[
              "font-mono text-[11px] uppercase tracking-[0.16em] px-4 py-1.5 rounded-sm border transition-colors",
              destructive
                ? "text-rose-300 border-rose-500/40 hover:bg-rose-500/10"
                : "text-amber-300 border-amber-500/40 hover:bg-amber-500/10",
            ].join(" ")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyCard({
  row,
  onRename,
  onRotate,
  onRevoke,
}: {
  row: ApiKeyRow;
  onRename: (id: string, name: string) => void;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.name);
  const env = (row.environment || "live").toLowerCase();
  const masked = maskedKeyDisplay(row.id, row.environment);
  const lastUsed = row.last_used_at
    ? formatDistanceToNow(new Date(row.last_used_at), { addSuffix: true })
    : "never";

  const submitRename = () => {
    const next = draft.trim();
    if (!next || next === row.name) {
      setEditing(false);
      setDraft(row.name);
      return;
    }
    onRename(row.id, next);
    setEditing(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={[
              "font-mono text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 border shrink-0",
              env === "live"
                ? "text-green-400 border-green-500/40"
                : "text-amber-300 border-amber-500/40",
            ].join(" ")}
          >
            {env}
          </span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(row.name);
                }
              }}
              maxLength={100}
              className="flex-1 min-w-0 bg-black border border-slate-700 text-[13px] text-slate-100 px-2 py-1 rounded-sm focus:outline-none focus:border-green-500/50"
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-[13px] text-slate-100 hover:text-green-400 transition-colors flex items-center gap-1.5 truncate"
              title="Click to rename"
            >
              <span className="truncate">{row.name}</span>
              <Pencil className="h-3 w-3 text-slate-500 shrink-0" strokeWidth={1.5} />
            </button>
          )}
        </div>
        <span className="font-mono text-[11px] text-slate-400 shrink-0 ml-3">
          last used {lastUsed}
        </span>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">
          Secret Key (hashed at rest)
        </div>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 bg-black border border-slate-800 px-3 py-2.5 font-mono text-[13px] text-slate-500 overflow-x-auto whitespace-nowrap rounded-sm">
            {masked}
          </div>
        </div>

        {row.scopes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.scopes.map((s) => (
              <span
                key={s}
                className="font-mono text-[10px] tracking-tight text-slate-400 bg-black border border-slate-800 px-1.5 py-0.5 rounded-sm"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          onClick={() => onRotate(row.id)}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-amber-300 border border-slate-700 hover:border-amber-500/50 px-3 py-1.5 rounded-sm transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="h-3 w-3" />
          Rotate
        </button>
        <button
          onClick={() => onRevoke(row.id)}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/50 px-3 py-1.5 rounded-sm transition-colors flex items-center gap-1.5"
        >
          <Trash2 className="h-3 w-3" />
          Revoke
        </button>
      </div>
    </div>
  );
}

const AVAILABLE_SCOPES: { value: string; label: string; hint: string }[] = [
  { value: "match", label: "match", hint: "Create & manage trade matches" },
  { value: "match:read", label: "match:read", hint: "Read-only match access" },
  { value: "signals", label: "signals", hint: "Submit & read trade signals" },
  { value: "collapse", label: "collapse", hint: "Collapse-ledger writes" },
  { value: "preflight", label: "preflight", hint: "Pre-trade eligibility checks" },
  { value: "trade-status", label: "trade-status", hint: "Read trade status" },
  { value: "evidence", label: "evidence", hint: "Read evidence packs" },
  { value: "webhooks:write", label: "webhooks:write", hint: "Manage webhook endpoints" },
  { value: "webhooks:read", label: "webhooks:read", hint: "Read webhook config & logs" },
];

export function ApiKeysPanel() {
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "rotate" | "revoke"; id: string; name: string }
    | null
  >(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>(["match"]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["developer-api-keys"],
    queryFn: async () => {
      const res = await callKeysFn<{ data: ApiKeyRow[] }>("GET");
      return res.data || [];
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      callKeysFn("PATCH", `/${id}`, { name }),
    onSuccess: () => {
      toast.success("Key renamed");
      qc.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotateMut = useMutation({
    mutationFn: (id: string) => callKeysFn<RevealedKey>("POST", `/${id}/rotate`),
    onSuccess: (res) => {
      setRevealed({ id: res.id, name: res.name, key: res.key, rotated: true });
      qc.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => callKeysFn("DELETE", `/${id}`),
    onSuccess: () => {
      toast.success("Key revoked");
      qc.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: ({ name, scopes }: { name: string; scopes: string[] }) =>
      callKeysFn<RevealedKey>("POST", "", { name, scopes }),
    onSuccess: (res) => {
      setRevealed({ id: res.id, name: res.name, key: res.key });
      setCreating(false);
      setNewName("");
      setNewScopes(["match"]);
      qc.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const keys = data || [];

  return (
    <section>
      {/* Plain-English intro for the API Keys area */}
      <div className="mb-5 rounded-sm border border-slate-800 bg-slate-900/40 px-5 py-4" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          About API keys
        </div>
        <p className="mt-1 text-[13px] text-slate-200 leading-relaxed">
          API keys let your back-office systems act on Izenzo on your behalf. Each key carries a set of scopes (what it can do) and an environment (sandbox or live). Calls made with a live key burn credits at the same rate as a manual operator, $1.00 per credit.
        </p>
      </div>

      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            §01 / Authentication
          </div>
          <h2 className="mt-1 text-lg text-slate-100 tracking-tight">
            Production Infrastructure Keys
          </h2>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 border border-slate-700 hover:border-green-400/60 hover:text-green-400 px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Key
        </button>
      </div>

      {/* Always-visible secret-key handling advisory.
          Sits above the key list so the protection rules are read
          BEFORE a key is created, not only after the reveal modal. */}
      <div className="mb-5 flex items-start gap-3 bg-amber-500/5 border border-amber-500/30 px-4 py-3 rounded-sm">
        <ShieldAlert className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">
            Secret key handling
          </p>
          <ul className="text-[12px] text-slate-300 leading-relaxed space-y-0.5 list-disc pl-4 marker:text-amber-400/60">
            <li>Secrets are shown <strong className="text-slate-100">once</strong> at creation or rotation. We store only a hash — we cannot recover or re-display them.</li>
            <li>Treat each key like a password: paste it straight into your secrets manager, never commit to git, never paste into chat or tickets.</li>
            <li>Use the <span className="font-mono text-amber-200">sk_live_</span> / <span className="font-mono text-amber-200">sk_test_</span> prefix for support — it is not sensitive.</li>
            <li>If a key is exposed, <strong className="text-slate-100">rotate</strong> immediately (issues a new key, disables the old one) or <strong className="text-slate-100">revoke</strong> if the integration is gone.</li>
            <li>Default to least privilege — only tick the scopes the integration actually needs.</li>
          </ul>
        </div>
      </div>

      {isLoading && (
        <div className="bg-slate-900 border border-slate-800 px-6 py-8 text-center font-mono text-[12px] text-slate-400">
          Loading keys…
        </div>
      )}

      {error && !isLoading && (
        <div className="bg-rose-950/40 border border-rose-500/40 px-6 py-4 font-mono text-[12px] text-rose-300">
          Failed to load: {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && keys.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 border-dashed px-6 py-10 text-center">
          <p className="font-mono text-[12px] text-slate-400">
            No API keys yet. Create one to start integrating.
          </p>
        </div>
      )}

      {!isLoading && keys.length > 0 && (
        <div className="space-y-3">
          {keys.map((k) => (
            <KeyCard
              key={k.id}
              row={k}
              onRename={(id, name) => renameMut.mutate({ id, name })}
              onRotate={(id) => setConfirm({ kind: "rotate", id, name: k.name })}
              onRevoke={(id) => setConfirm({ kind: "revoke", id, name: k.name })}
            />
          ))}
        </div>
      )}

      {confirm?.kind === "rotate" && (
        <ConfirmDialog
          title={`Rotate "${confirm.name}"?`}
          message="This will affect production. A new key will be issued and shown once. The current key stops working immediately, so update every integration using it before any in-flight request fails."
          confirmLabel="Rotate Now"
          onConfirm={() => {
            rotateMut.mutate(confirm.id);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === "revoke" && (
        <ConfirmDialog
          title={`Revoke "${confirm.name}"?`}
          message="This will affect production. The key is permanently disabled. Any service still using it will fail authentication on the next call. This cannot be undone."
          confirmLabel="Revoke Key"
          destructive
          onConfirm={() => {
            revokeMut.mutate(confirm.id);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-sm">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm text-slate-100">Create new key</h3>
              <button onClick={() => setCreating(false)} className="text-slate-500 hover:text-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 block mb-2">
                  Label (e.g. ERP Integration)
                </span>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                  placeholder="Production · Backend"
                  className="w-full bg-black border border-slate-700 text-[13px] text-slate-100 px-3 py-2.5 rounded-sm focus:outline-none focus:border-green-500/50 font-mono"
                />
              </label>
            </div>
            <div className="px-6 pb-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 block mb-2">
                Scopes (permissions)
              </span>
              <div className="space-y-1.5 max-h-56 overflow-y-auto border border-slate-800 rounded-sm p-2 bg-black/40">
                {AVAILABLE_SCOPES.map((s) => {
                  const checked = newScopes.includes(s.value);
                  return (
                    <label
                      key={s.value}
                      className="flex items-start gap-2 px-2 py-1.5 hover:bg-slate-800/40 rounded-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setNewScopes((prev) =>
                            prev.includes(s.value)
                              ? prev.filter((v) => v !== s.value)
                              : [...prev, s.value]
                          );
                        }}
                        className="mt-0.5 accent-green-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] text-slate-100">{s.label}</div>
                        <div className="text-[11px] text-slate-500">{s.hint}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {newScopes.length === 0 && (
                <p className="mt-2 font-mono text-[10px] text-amber-400">
                  ⚠ Key with no scopes will be rejected by every endpoint.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-3">
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setNewScopes(["match"]);
                }}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const n = newName.trim();
                  if (!n) return toast.error("Label is required");
                  if (newScopes.length === 0) return toast.error("Select at least one scope");
                  createMut.mutate({ name: n, scopes: newScopes });
                }}
                disabled={createMut.isPending}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 bg-green-600/20 border border-green-500/40 hover:bg-green-600/30 px-4 py-1.5 rounded-sm transition-colors disabled:opacity-50"
              >
                {createMut.isPending ? "Creating…" : "Create Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealed && <RevealModal data={revealed} onClose={() => setRevealed(null)} />}
    </section>
  );
}
