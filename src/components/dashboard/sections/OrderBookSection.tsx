/**
 * OrderBookSection — Persistent order book view.
 * Shows all active buyer and seller orders across the platform.
 * Users can create, cancel, and browse orders.
 */

/** Map internal DB side values to user-facing labels */
const SIDE_LABEL: Record<string, string> = { bid: "Buyer", offer: "Seller" };

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Filter, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface TradeOrder {
  id: string;
  org_id: string;
  user_id: string;
  side: "bid" | "offer";
  product: string;
  price: number | null;
  price_currency: string;
  volume: number | null;
  volume_unit: string;
  location: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
}

/** Sanitise product filter — allow only safe characters to prevent ilike injection */
function sanitiseProductFilter(raw: string): string {
  return raw.replace(/[%_\\]/g, "").replace(/[^a-zA-Z0-9\s\-.,()]/g, "").slice(0, 100);
}

const ORDER_PAGE_SIZE = 200;

export function OrderBookSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Fetch profile for org_id
  const { data: profile } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, org_id")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const orgId = profile?.org_id;

  const { data: ordersResult, isLoading } = useQuery({
    queryKey: ["trade-orders", sideFilter, productFilter],
    queryFn: async () => {
      let query = supabase
        .from("trade_orders")
        .select("*", { count: "exact" })
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(ORDER_PAGE_SIZE);

      if (sideFilter !== "all") {
        query = query.eq("side", sideFilter);
      }
      const sanitised = sanitiseProductFilter(productFilter);
      if (sanitised) {
        query = query.ilike("product", `%${sanitised}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { orders: (data || []) as TradeOrder[], totalCount: count ?? (data || []).length };
    },
    enabled: !!orgId,
  });

  const orders = ordersResult?.orders;
  const totalCount = ordersResult?.totalCount ?? 0;
  const isTruncated = totalCount > ORDER_PAGE_SIZE;

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      // Ownership enforced: RLS ensures only own-org orders can be updated,
      // but we also explicitly scope the filter for defence-in-depth.
      const { data, error } = await supabase
        .from("trade_orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("org_id", orgId!)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Order not found or you do not have permission to cancel it");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trade-orders"] });
      toast.success("Order cancelled");
    },
    onError: (err: Error) => toast.error("Failed to cancel order", { description: err.message }),
  });

  const bidCount = orders?.filter(o => o.side === "bid").length ?? 0;
  const offerCount = orders?.filter(o => o.side === "offer").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Order Book</h2>
          <p className="text-sm text-muted-foreground">
            Browse and manage active buyer and seller orders across the platform
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              New Order
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Trade Order</DialogTitle>
            </DialogHeader>
            <CreateOrderForm
              orgId={orgId!}
              userId={profile?.id!}
              onSuccess={() => {
                setShowCreate(false);
                queryClient.invalidateQueries({ queryKey: ["trade-orders"] });
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-foreground">{orders?.length ?? "—"}</p>
            <p className="text-xs text-muted-foreground">Active Orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-green-600">{bidCount}</p>
            <p className="text-xs text-muted-foreground">Buyers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{offerCount}</p>
            <p className="text-xs text-muted-foreground">Sellers</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={sideFilter} onValueChange={setSideFilter}>
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sides</SelectItem>
                  <SelectItem value="bid">Buyers Only</SelectItem>
                  <SelectItem value="offer">Sellers Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Filter by product…"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            {(sideFilter !== "all" || productFilter) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setSideFilter("all"); setProductFilter(""); }}
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Order table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !orders?.length ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No active orders found</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
                Place the first order
              </Button>
            </div>
          ) : (
            <>
              {isTruncated && (
                <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-b">
                  Showing {ORDER_PAGE_SIZE} of {totalCount} orders. Refine your filters to narrow results.
                </div>
              )}
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Role</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Badge variant={order.side === "bid" ? "default" : "secondary"}
                             className={order.side === "bid" ? "bg-green-600 hover:bg-green-700" : "bg-orange-600 hover:bg-orange-700 text-white"}>
                        {SIDE_LABEL[order.side] || order.side}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{order.product}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {order.price != null ? `${order.price_currency} ${Number(order.price).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {order.volume != null ? `${Number(order.volume).toLocaleString()} ${order.volume_unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{order.location || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(order.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.expires_at ? format(new Date(order.expires_at), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      {order.org_id === orgId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={() => cancelMutation.mutate(order.id)}
                          disabled={cancelMutation.isPending}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateOrderForm({ orgId, userId, onSuccess }: { orgId: string; userId: string; onSuccess: () => void }) {
  const [side, setSide] = useState<"bid" | "offer">("bid");
  const [product, setProduct] = useState("");
  const [price, setPrice] = useState("");
  const [volume, setVolume] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product.trim()) {
      toast.error("Product is required");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("trade_orders").insert({
        org_id: orgId,
        user_id: userId,
        side,
        product: product.trim(),
        price: price ? parseFloat(price) : null,
        volume: volume ? parseFloat(volume) : null,
        location: location.trim() || null,
      });
      if (error) throw error;
      toast.success("Order created successfully");
      onSuccess();
    } catch (err: any) {
      toast.error("Failed to create order", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Role</Label>
        <Select value={side} onValueChange={(v) => setSide(v as "bid" | "offer")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bid">Buyer</SelectItem>
            <SelectItem value="offer">Seller</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Product *</Label>
        <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Chrome Ore, Manganese" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Price (USD)</Label>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Enter price" />
        </div>
        <div className="space-y-2">
          <Label>Volume (MT)</Label>
          <Input type="number" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Enter quantity" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Location</Label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Johannesburg, SA" />
      </div>
      <Button type="submit" className="w-full" disabled={submitting || !product.trim()}>
        {submitting ? "Creating…" : "Create Order"}
      </Button>
    </form>
  );
}
