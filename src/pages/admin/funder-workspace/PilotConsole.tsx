/**
 * Institutional Funder Evidence Workspace — Controlled-Pilot Seed Console
 *
 * Platform-admin only. One-click seeder that creates six fake pilot users
 * (with email pre-confirmed and a temporary password) and links them to the
 * two pre-seeded funder organisations (Pilot Funder Bank, Isolation Test Fund).
 *
 * The demo trading orgs (Acacia buyer, Blue River seller), the canonical
 * demo match, and the synthetic evidence documents are seeded once via
 * migration/insert. This page focuses on getting non-technical testers
 * logged in without SQL or UUIDs, and gives them a plain-English pilot guide.
 *
 * We deliberately do NOT create the funder release here. The pilot admin
 * performs the release manually via /admin/funder-workspace/releases/new —
 * that is part of what the pilot is meant to test.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function FunderWorkspacePilotConsole() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<SeededUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seededAt, setSeededAt] = useState<string | null>(null);

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
      ...users.map((u) => `${u.organisation} — ${u.role}\n  email:    ${u.email}\n  password: ${u.password}\n`),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copied", description: "Full credential list copied to clipboard." });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="fw-pilot-console">
      <div>
        <h1 className="text-2xl font-semibold">Funder Workspace — Controlled Pilot</h1>
        <p className="text-sm text-muted-foreground">
          One-click preparation of a non-technical manual test environment.
          Demo data is already seeded. Click <em>Prepare pilot logins</em> to
          create (or rotate the passwords for) the six test users.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pre-seeded fixtures</CardTitle>
          <CardDescription>
            The following DEMO records were created by the pilot seed migration
            and are already in place. Nothing here touches real client data.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>• Funder organisation — <strong>Pilot Funder Bank</strong> (commercial bank)</div>
          <div>• Funder organisation — <strong>Isolation Test Fund</strong> (private debt fund, MUST NOT receive the pilot deal)</div>
          <div>• Buyer trader — <strong>DEMO — Acacia Trading Test Pty Ltd</strong></div>
          <div>• Seller trader — <strong>DEMO — Blue River Exports Test Pty Ltd</strong></div>
          <div>• Canonical demo match — <strong>DEMO — Acacia–Blue River Pilot Trade</strong> (selectable in the deal picker)</div>
          <div>• Two synthetic evidence documents (one per side) attached to the demo match</div>
          <div>• Eligible synthetic evidence pack — <strong>Evidence Pack — Version 1</strong> for the demo match</div>
          <div className="text-muted-foreground pt-2">
            No release has been created. The platform admin releases the deal
            manually as part of the pilot test itself.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Prepare pilot logins</CardTitle>
          <CardDescription>
            Creates the six pilot users on first run, or rotates their
            temporary passwords on subsequent runs. Test emails end in
            <code className="mx-1">.test</code> so no real inbox is touched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={runSeed} disabled={loading} data-testid="fw-pilot-seed-btn">
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
          <CardTitle className="text-base">Step 2 — Release the demo deal (Izenzo Platform Admin)</CardTitle>
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
          <CardTitle className="text-base">Step 3 — Funder journey (each Pilot Funder Bank user)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>• Log in at <Link to="/auth" className="underline">/auth</Link> with the funder user credentials above.</div>
          <div>• Land on <Link to="/funder/workspace" className="underline">/funder/workspace</Link> and click into the assigned demo deal.</div>
          <div>• Download the sealed pack. Confirm raw documents are hidden.</div>
          <div>• Post an RFI as <strong>Reviewer</strong> or <strong>Approver</strong>, answer it as Izenzo Admin, then record the formal decision as <strong>Approver</strong>. (Funder Admin and Viewer cannot post RFIs or record decisions — that is expected.)</div>
          <div>• Add a funder-internal note. Confirm Izenzo Admin cannot see funder-internal notes; only shared comments.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 4 — Isolation check</CardTitle>
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
