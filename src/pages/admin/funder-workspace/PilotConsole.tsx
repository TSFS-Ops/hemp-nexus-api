/**
* Institutional Funder Evidence Workspace — Controlled-Pilot Seed Console
*
* Platform-admin only. One-click seeder that creates six fake pilot users
* (with email pre-confirmed and a temporary password) and links them to the
* two pre-seeded funder organisations (Pilot Funder Bank, Isolation Test Fund).
*
* The demo trading orgs (Acacia buyer, Blue River seller), the canonical
* demo match, the synthetic evidence documents and the eligible evidence
* pack are created by a fixture migration (see supabase/migrations). This
* page independently verifies that those fixtures actually exist and are
* correctly linked by calling fw_admin_check_pilot_fixtures_v1() — it does
* NOT assume the fixtures are present just because a migration exists.
*
* We deliberately do NOT create the funder release here. The pilot admin
* performs the release manually via /admin/funder-workspace/releases/new —
* that is part of what the pilot is meant to test.
*/
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { Copy } from "lucide-react";

interface SeededUser {
  email: string;
  displayName: string;
  role: string;
  organisation: string;
  password: string;
  created: boolean;
}

interface FixtureCheckRow {
  check_key: string;
  label: string;
  status: "Ready" | "Missing" | "Incorrectly linked";
  detail: string;
}

// Canonical, human-readable labels for every fixture check. Kept as a
// static map (rather than relying solely on the live RPC's label text) so
// the pilot guide always names the exact records testers should expect,
// even before the readiness check has ever been run.
const FIXTURE_CHECK_LABELS: Record<string, string> = {
  funder_org_bank: "Funder organisation — Pilot Funder Bank",
  funder_org_isolation: "Funder organisation — Isolation Test Fund",
  buyer_org: "Buyer trader — DEMO — Acacia Trading Test Pty Ltd",
  seller_org: "Seller trader — DEMO — Blue River Exports Test Pty Ltd",
  demo_match: "Canonical demo match — DEMO — Acacia–Blue River Pilot Trade",
  doc_invoice: "DEMO pro-forma invoice",
  doc_bol: "DEMO bill of lading",
  evidence_pack: "Eligible synthetic evidence pack — Evidence Pack — Version 1",
};

function statusBadgeVariant(status: FixtureCheckRow["status"]) {
  if (status === "Ready") return "default" as const;
  if (status === "Missing") return "secondary" as const;
  return "destructive" as const;
}

export default function FunderWorkspacePilotConsole() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<SeededUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seededAt, setSeededAt] = useState<string | null>(null);

  const [checks, setChecks] = useState<FixtureCheckRow[] | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);

  async function runReadinessCheck() {
    setChecksLoading(true);
    setChecksError(null);
    try {
      const { data, error } = await supabase.rpc("fw_admin_check_pilot_fixtures_v1");
      if (error) throw error;
      setChecks((data ?? []) as FixtureCheckRow[]);
    } catch (e) {
      setChecksError((e as Error).message);
      toast({ title: "Fixture check failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setChecksLoading(false);
    }
  }

  useEffect(() => {
    void runReadinessCheck();
  }, []);

  const allFixturesReady = checks !== null && checks.length > 0 && checks.every((c) => c.status === "Ready");

  async function runSeed() {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("fw-pilot-seed", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "seed_failed");
      setUsers(data.users as SeededUser[]);
      setSeededAt(data.seeded_at as string);
      toast({ title: "Pilot users ready", description: "Temporary passwords issued. Copy them now." });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast({ title: "Seed failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function copyAll() {
    if (!users) return;
    const lines = [
      "Institutional Funder Evidence Workspace — pilot test logins",
      `Seeded at: ${seededAt}`,
      "Login page: /auth (email + password)",
      "",
      ...users.map((u) => `${u.organisation} — ${u.role}\n  email: ${u.email}\n  password: ${u.password}\n`),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copied", description: "Full credential list copied to clipboard." });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="fw-pilot-console">
      <div>
        <h1 className="text-2xl font-semibold">Funder Workspace — Controlled Pilot</h1>
        <p className="text-sm text-muted-foreground">
          Non-technical preparation of a manual test environment. Run the
          fixture check below first, then click <em>Prepare pilot logins</em> to
          create (or rotate the passwords for) the six test users.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Pilot fixture readiness</CardTitle>
          <CardDescription>
            This checks the live database for every record the pilot needs and
            verifies each one is correctly linked — not just that a row with
            the right name exists. You should not need to know any database
            record names or UUIDs to read this checklist.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              onClick={runReadinessCheck}
              disabled={checksLoading}
              variant="outline"
              data-testid="fw-pilot-check-fixtures-btn"
            >
              {checksLoading ? "Checking…" : "Re-check fixtures"}
            </Button>
            {checks !== null && !checksLoading && (
              allFixturesReady ? (
                <Badge data-testid="fw-pilot-fixtures-ready">All fixtures ready</Badge>
              ) : (
                <Badge variant="destructive" data-testid="fw-pilot-fixtures-not-ready">
                  Not ready — resolve the items below
                </Badge>
              )
            )}
          </div>
          {checksError && (
            <p className="text-sm text-destructive">Could not run the fixture check: {checksError}</p>
          )}
          {checks && checks.length > 0 && (
            <div className="rounded-md border divide-y" data-testid="fw-pilot-fixture-checklist">
              {checks.map((c) => (
                <div key={c.check_key} className="p-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{FIXTURE_CHECK_LABELS[c.check_key] ?? c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.detail}</div>
                  </div>
                  <Badge variant={statusBadgeVariant(c.status)} data-testid={`fw-pilot-check-${c.check_key}`}>
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The pilot is only ready once every item above reads <strong>Ready</strong>.
            If anything reads Missing or Incorrectly linked, apply the fixture
            migration (or ask an engineer to) and re-check — do not proceed with
            the manual pilot until this list is fully green.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 2 — Prepare pilot logins</CardTitle>
          <CardDescription>
            Creates the six pilot users on first run, or rotates their
            temporary passwords on subsequent runs. Test emails end in
            <code className="mx-1">.test</code> so no real inbox is touched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checks !== null && !allFixturesReady && (
            <p className="text-sm text-destructive" data-testid="fw-pilot-logins-fixture-warning">
              Fixture readiness (Step 1) is not fully green yet. You can still
              prepare logins, but the manual pilot itself should not begin
              until every fixture check above reads Ready.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={runSeed}
              disabled={loading || checks === null}
              data-testid="fw-pilot-seed-btn"
              title={checks === null ? "Run the Step 1 fixture check first" : undefined}
            >
              {loading ? "Preparing…" : users ? "Rotate passwords" : "Prepare pilot logins"}
            </Button>
            {users && (
              <Button variant="outline" onClick={copyAll}>
                <Copy className="h-4 w-4 mr-2" />
                Copy all credentials
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">Failed: {error}</p>}
          {users && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Temporary password</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.email}>
                      <TableCell className="text-sm">{u.organisation}</TableCell>
                      <TableCell className="text-sm">{u.role}</TableCell>
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell className="font-mono text-xs">{u.password}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {users && (
            <p className="text-xs text-muted-foreground">
              Copy the credentials now. Passwords are only shown here and are
              rotated the next time you run the seeder.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 3 — Release the demo deal (Izenzo Platform Admin)</CardTitle>
          <CardDescription>
            Log in as the Izenzo Platform Admin and release the demo deal to
            Pilot Funder Bank so the funder testers can see it.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>1. Log in at <Link to="/auth" className="underline">/auth</Link> using the Izenzo Platform Admin credentials above.</div>
          <div>2. Open <Link to="/admin/funder-workspace/releases/new" className="underline">New deal release</Link>.</div>
          <div>3. In the deal selector, pick <strong>DEMO — Acacia–Blue River Pilot Trade</strong>. The evidence pack is selected automatically; do not paste any UUID.</div>
          <div>4. Select the funder organisation <strong>Pilot Funder Bank</strong>. Do <em>not</em> pick Isolation Test Fund.</div>
          <div>5. Record buyer consent = granted, seller consent = granted.</div>
          <div>6. Leave raw-document access <strong>disabled</strong> and unmasked sensitive details <strong>disabled</strong>. Enable sealed-pack download.</div>
          <div>7. Set an expiry at least 30 days in the future.</div>
          <div>8. Save the release, then open it and use <em>Generate sealed pack</em>.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 4 — Funder journey (each Pilot Funder Bank user)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>• Log in at <Link to="/auth" className="underline">/auth</Link> with the funder user credentials above.</div>
          <div>• Land on <Link to="/funder/workspace" className="underline">/funder/workspace</Link> and click into the assigned demo deal.</div>
          <div>• Download the sealed pack. Confirm raw documents are hidden.</div>
          <div>• Post an RFI as <strong>Funder Admin</strong>, <strong>Reviewer</strong> or <strong>Approver</strong>, answer it as Izenzo Admin, then record the formal decision as <strong>Approver</strong>. (Funder Admin, Reviewer and Approver can create RFIs. Viewer cannot create RFIs. Only Approver can record a formal decision.)</div>
          <div>• Add a funder-internal note. Confirm Izenzo Admin cannot see funder-internal notes; only shared comments.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 5 — Isolation check</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>• Log in as <strong>Isolation Test Fund — Viewer</strong>.</div>
          <div>• Confirm the assigned-deals list is <strong>empty</strong> and the demo deal is not visible.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Honest limitations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1 text-muted-foreground">
          <div>• Bank-confidence, finality and required-evidence-checklist sections continue to show the approved "unavailable" wording — these are not fabricated for the pilot.</div>
          <div>• No synthetic WaD is seeded (WaD sealing requires a live attestation flow that is not safe to fake).</div>
          <div>• Test emails use the <code>.test</code> TLD and never send real email; testers log in with email + password.</div>
          <div>• The seeder is idempotent and only affects the six fixed pilot email addresses.</div>
        </CardContent>
      </Card>
    </div>
  );
}
