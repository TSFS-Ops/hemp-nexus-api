import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface Poi {
  id: string;
  org_id: string;
  buyer_entity_id: string;
  seller_entity_id: string;
  state: string;
  completion_probability: number;
  jurisdiction_code: string;
  industry_code: string;
  terms: Record<string, unknown>;
  created_at: string;
  last_activity_at: string;
}

const STATE_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "outline",
  ELIGIBLE: "default",
  COMPLETION_REQUESTED: "default",
  COMPLETED: "default",
  EXPIRED: "destructive",
  ANNULLED: "destructive",
  REJECTED: "destructive",
};

export function AdminPoisPanel() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pois")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setPois((data as Poi[]) || []);
    } catch (err) {
      console.error("Failed to fetch POIs:", err);
      toast.error("Failed to load Intents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const stateCounts = pois.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Trade Request</h2>
          <p className="text-muted-foreground mt-1">
            Intent lifecycle management - ≥50.1% probability threshold enforced
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["DRAFT", "ELIGIBLE", "COMPLETED", "EXPIRED"].map((state) => (
          <Card key={state}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{state}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stateCounts[state] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            All Intents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Probability</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pois.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No intents created yet
                  </TableCell>
                </TableRow>
              ) : (
                pois.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <Badge variant={STATE_COLOURS[p.state] || "secondary"}>{p.state}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {(p.completion_probability * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.buyer_entity_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-mono text-xs">{p.seller_entity_id.slice(0, 8)}…</TableCell>
                    <TableCell>{p.jurisdiction_code}</TableCell>
                    <TableCell>{p.industry_code}</TableCell>
                    <TableCell>{format(new Date(p.created_at), "dd MMM yyyy")}</TableCell>
                    <TableCell>{format(new Date(p.last_activity_at), "dd MMM yyyy HH:mm")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
