import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Eye } from "lucide-react";
import { toast } from "sonner";

export function AdminTokenPurchasesPanel() {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const fetchPurchases = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("token_transactions").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    else setPurchases(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  const typeColor = (t: string) => t === "purchase" ? "default" : t === "burn" ? "destructive" : "secondary";

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{purchases.length} transaction(s)</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Organisation</TableHead><TableHead>Reference</TableHead><TableHead>Date</TableHead><TableHead className="w-16">Detail</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {purchases.map((p) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant={typeColor(p.transaction_type)} className="text-xs">{p.transaction_type}</Badge></TableCell>
                <TableCell className="font-mono text-sm">{p.amount > 0 ? "+" : ""}{p.amount}</TableCell>
                <TableCell className="font-mono text-xs">{p.org_id.substring(0, 8)}...</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.reference || "N/A"}</TableCell>
                <TableCell className="text-xs">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(p)}><Eye className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {purchases.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No transactions found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transaction Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{selected.id}</span></div>
              <div><span className="text-muted-foreground">Type:</span> {selected.transaction_type}</div>
              <div><span className="text-muted-foreground">Amount:</span> {selected.amount}</div>
              <div><span className="text-muted-foreground">Organisation:</span> <span className="font-mono">{selected.org_id}</span></div>
              <div><span className="text-muted-foreground">Reference:</span> {selected.reference || "N/A"}</div>
              <div><span className="text-muted-foreground">Description:</span> {selected.description || "N/A"}</div>
              <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
