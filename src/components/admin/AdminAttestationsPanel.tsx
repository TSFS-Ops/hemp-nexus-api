import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Eye, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

const ATTESTATION_LIMIT = 200;

export function AdminAttestationsPanel() {
  const [attestations, setAttestations] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [countRes, dataRes] = await Promise.all([
        supabase.from("attestations").select("id", { count: "exact", head: true }),
        supabase.from("attestations").select("*").order("signed_at", { ascending: false }).limit(ATTESTATION_LIMIT),
      ]);
      setTotal(countRes.count);
      if (dataRes.error) throw dataRes.error;
      setAttestations(dataRes.data || []);
    } catch (err) {
      console.error("Failed to fetch attestations:", err);
      toast.error("Failed to load attestations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{attestations.length} attestation(s)</p>
      {total !== null && attestations.length >= ATTESTATION_LIMIT && (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Showing {attestations.length} of {total} attestations. Results are capped at {ATTESTATION_LIMIT}.</AlertDescription></Alert>
      )}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Attester</TableHead><TableHead>Role</TableHead><TableHead>Organisation</TableHead><TableHead>Signed</TableHead><TableHead className="w-16">Detail</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {attestations.map((a) => (
              <TableRow key={a.id}>
                <TableCell><Badge variant="outline" className="text-xs">{a.attestation_type}</Badge></TableCell>
                <TableCell className="text-sm">{a.attester_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.attester_role}</TableCell>
                <TableCell className="font-mono text-xs">{a.org_id.substring(0, 8)}...</TableCell>
                <TableCell className="text-xs">{new Date(a.signed_at).toLocaleString()}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(a)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {attestations.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No attestations found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Attestation Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Type:</span> {selected.attestation_type}</div>
              <div><span className="text-muted-foreground">Attester:</span> {selected.attester_name} ({selected.attester_role})</div>
              <div><span className="text-muted-foreground">Text:</span></div>
              <p className="text-xs bg-muted p-2 rounded">{selected.attestation_text}</p>
              <div><span className="text-muted-foreground">Signature Hash:</span> <span className="font-mono text-xs break-all">{selected.signature_hash}</span></div>
              <div><span className="text-muted-foreground">Match:</span> <span className="font-mono text-xs">{selected.match_id || "N/A"}</span></div>
              <div><span className="text-muted-foreground">Signed:</span> {new Date(selected.signed_at).toLocaleString()}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
