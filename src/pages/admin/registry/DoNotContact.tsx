/**
 * Batch 6 — Do-Not-Contact management UI.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

interface DncRow {
  id: string;
  company_reference: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reason: string;
  active: boolean;
  created_at: string;
}

export default function AdminRegistryDoNotContact() {
  const [rows, setRows] = useState<DncRow[]>([]);
  const [form, setForm] = useState({ company_reference: "", contact_email: "", contact_phone: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("registry_outreach_do_not_contact" as any).select("*").order("created_at", { ascending: false }).limit(100);
    setRows((data ?? []) as unknown as DncRow[]);
  }
  useEffect(()=>{ load(); }, []);

  async function add() {
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = { action: "mark_do_not_contact", reason: form.reason };
      if (form.company_reference) payload.company_reference = form.company_reference;
      if (form.contact_email) payload.contact_email = form.contact_email;
      if (form.contact_phone) payload.contact_phone = form.contact_phone;
      const { error } = await supabase.functions.invoke("registry-outreach-review", { body: payload });
      if (error) throw error;
      setForm({ company_reference: "", contact_email: "", contact_phone: "", reason: "" });
      await load();
    } catch (e:any) { setError(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Do not contact</h1>
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Add suppression</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Suppressing a company or contact blocks all future AI draft generation and approval for it.</p>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Company reference</Label><Input value={form.company_reference} onChange={e=>setForm({...form, company_reference: e.target.value})} /></div>
            <div><Label>Contact email</Label><Input value={form.contact_email} onChange={e=>setForm({...form, contact_email: e.target.value})} /></div>
            <div><Label>Contact phone</Label><Input value={form.contact_phone} onChange={e=>setForm({...form, contact_phone: e.target.value})} /></div>
          </div>
          <div><Label>Reason</Label><Textarea rows={2} value={form.reason} onChange={e=>setForm({...form, reason: e.target.value})} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={add} disabled={busy || !form.reason || (!form.company_reference && !form.contact_email && !form.contact_phone)}>{busy ? "Adding…" : "Add to DNC"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active suppressions</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-2">Company</th><th>Email</th><th>Phone</th><th>Reason</th><th>Active</th></tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">{r.company_reference ?? "—"}</td>
                  <td>{r.contact_email ?? "—"}</td>
                  <td>{r.contact_phone ?? "—"}</td>
                  <td>{r.reason}</td>
                  <td>{r.active ? "yes" : "no"}</td>
                </tr>
              ))}
              {rows.length===0 && <tr><td colSpan={5} className="py-3 text-muted-foreground">No suppressions recorded.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
