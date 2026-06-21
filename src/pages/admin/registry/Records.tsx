/**
 * Batch 8 — Admin registry record inspector.
 * Lists the seeded registry company records, lets admins refresh the
 * sample seed and rebuild the search index, and shows the field-tier
 * visibility table.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";
import {
  PUBLIC_SEARCHABLE_FIELDS,
  ADMIN_ONLY_SEARCHABLE_FIELDS,
  FORBIDDEN_PUBLIC_FIELDS,
} from "@/lib/registry-record-model";

interface RecordRow {
  id: string;
  country_code: string;
  company_name: string;
  registration_number: string | null;
  readiness_state: string;
  claim_allowed: boolean;
  claim_blocked_reason: string | null;
  public_display_allowed: boolean;
}

export default function AdminRegistryRecords() {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("registry_company_records")
      .select("id, country_code, company_name, registration_number, readiness_state, claim_allowed, claim_blocked_reason, public_display_allowed")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error("Failed to load records");
    setRows((data ?? []) as RecordRow[]);
  }
  useEffect(() => { void load(); }, []);

  async function seed() {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-company-record-manage", { body: {} });
      if (error) throw error;
      toast.success("Sample records loaded");
      await load();
    } catch (e) {
      toast.error("Seed failed");
    } finally { setBusy(false); }
  }

  async function rebuildAll() {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-company-search-index-rebuild", {
        body: { all_seed: true },
      });
      if (error) throw error;
      toast.success("Search index rebuilt");
    } catch {
      toast.error("Rebuild failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <BackButton />
      <Card>
        <CardHeader>
          <CardTitle>Registry company records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={seed} disabled={busy}>Load / refresh sample records</Button>
            <Button onClick={rebuildAll} variant="outline" disabled={busy}>Rebuild search index</Button>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Reg. no.</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Public</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.company_name}</TableCell>
                    <TableCell>{r.country_code}</TableCell>
                    <TableCell className="font-mono text-xs">{r.registration_number ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{r.readiness_state}</Badge></TableCell>
                    <TableCell>{r.claim_allowed ? "yes" : r.claim_blocked_reason ?? "no"}</TableCell>
                    <TableCell>{r.public_display_allowed ? "yes" : "no"}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No records loaded. Click "Load / refresh sample records".
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Field visibility tiers</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Public searchable</div>
            <div className="flex flex-wrap gap-1">
              {PUBLIC_SEARCHABLE_FIELDS.map(f => <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Admin-only searchable</div>
            <div className="flex flex-wrap gap-1">
              {ADMIN_ONLY_SEARCHABLE_FIELDS.map(f => <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Forbidden in any public surface</div>
            <div className="flex flex-wrap gap-1">
              {FORBIDDEN_PUBLIC_FIELDS.map(f => <Badge key={f} variant="destructive" className="text-[10px]">{f}</Badge>)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
