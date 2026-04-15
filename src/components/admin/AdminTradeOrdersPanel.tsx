import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const ORDER_LIMIT = 200;

export function AdminTradeOrdersPanel() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const updatingRef = useRef(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("trade_orders").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error("Failed to fetch trade orders:", err);
      toast.error("Failed to load trade orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const updateStatus = async (id: string, status: string) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    try {
      const { error } = await supabase.from("trade_orders").update({ status }).eq("id", id);
      if (error) throw error;
      toast.success(`Order ${status}`);
      fetchOrders();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      updatingRef.current = false;
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={orders} limit={ORDER_LIMIT} />
      <p className="text-sm text-muted-foreground">{orders.length} trade order(s) | {orders.filter(o => o.status === "active").length} active</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead><TableHead>Side</TableHead><TableHead>Quantity</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead>Organisation</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium text-sm">{o.product || "N/A"}</TableCell>
                <TableCell><Badge variant={o.side === "buy" ? "default" : "secondary"} className="text-xs">{o.side}</Badge></TableCell>
                <TableCell className="text-sm">{o.quantity || "N/A"}</TableCell>
                <TableCell className="text-sm">{o.price ? `${o.currency || "USD"} ${o.price}` : "N/A"}</TableCell>
                <TableCell><Badge variant={o.status === "active" ? "default" : "secondary"} className="text-xs">{o.status}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{o.org_id.substring(0, 8)}...</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {o.status === "active" && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => updateStatus(o.id, "cancelled")}>Cancel</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {orders.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No trade orders found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}