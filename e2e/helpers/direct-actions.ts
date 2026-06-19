/**
 * Direct backend invocation helpers.
 *
 * Required by §9 of the brief: every wrong-action test must prove the
 * BACKEND denies (not just that the UI hides the button). These helpers
 * obtain a fresh access token for the given role and POST directly to
 * either a PostgREST RPC or an edge function.
 *
 * They DELIBERATELY bypass the React app so a regression hiding the UI
 * cannot mask a missing server-side check.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { type Role, requireUser } from "../fixtures/users";

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).replace(/^['"]|['"]$/g, "");
  } catch { return undefined; }
}

function backend() {
  const url = envValue("SUPABASE_URL") ?? envValue("VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_ANON_KEY") ?? envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Missing backend URL or publishable key.");
  return { url, key };
}

async function tokenFor(role: Role): Promise<string | null> {
  if (role === "logged_out_user") return null;
  const { url, key } = backend();
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { email, password } = requireUser(role);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`direct-actions: sign-in failed for ${role}: ${error?.message}`);
  return data.session.access_token;
}

export type DirectResult = { status: number; body: string };

/** Invoke a PostgREST RPC with the role's JWT. */
export async function callRpcAs(role: Role, fn: string, args: Record<string, unknown> = {}): Promise<DirectResult> {
  const { url, key } = backend();
  const token = await tokenFor(role);
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-E2E-Safe-Mode": "1", // edge functions that honour this header skip side effects
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.text() };
}

/** Invoke a Supabase edge function with the role's JWT. */
export async function callEdgeAs(role: Role, fn: string, body: Record<string, unknown> = {}): Promise<DirectResult> {
  const { url, key } = backend();
  const token = await tokenFor(role);
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-E2E-Safe-Mode": "1",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

/** Issue a GET to a download URL with the role's JWT — returns status only (no body). */
export async function getDownloadAs(role: Role, path: string): Promise<{ status: number }> {
  const { url, key } = backend();
  const token = await tokenFor(role);
  const target = path.startsWith("http") ? path : `${url}${path}`;
  const res = await fetch(target, {
    method: "GET",
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-E2E-Safe-Mode": "1",
    },
    redirect: "manual",
  });
  // drain to free socket
  await res.arrayBuffer().catch(() => {});
  return { status: res.status };
}
