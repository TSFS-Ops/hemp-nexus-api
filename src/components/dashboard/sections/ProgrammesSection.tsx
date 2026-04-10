import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/ui/section-header";
import { Landmark, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { ROUTES } from "@/lib/constants";

const STATUS_VARIANT: Record<string, string> = {
  draft: "secondary",
  active: "default",
  reporting: "outline",
  closed: "destructive",
  pending: "secondary",
  completed: "default",
  overdue: "destructive",
  in_progress: "outline",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 0 }).format(amount);
}

export function ProgrammesSection() {
  const { data: programmes, isLoading } = useQuery({
    queryKey: ["dashboard-programmes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("programmes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Programmes"
        description="View your organisation's programme budgets, milestones, and fund flow status."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading programmes…</p>
      ) : !programmes?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Landmark className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No programmes are linked to your organisation yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Programme</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Fiscal Year</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {programmes.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-sm">{p.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.department}</TableCell>
                <TableCell className="text-sm">{p.fiscal_year}</TableCell>
                <TableCell className="font-mono text-sm">{formatCurrency(p.budget_allocated)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[p.status] as any || "secondary"}>
                    {p.status === "active" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {p.status === "draft" && <Clock className="h-3 w-3 mr-1" />}
                    {p.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{format(new Date(p.created_at), "dd MMM yyyy")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
