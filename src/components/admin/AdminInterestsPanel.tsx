import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Heart, Handshake, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";

interface Interest {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  org_id: string;
  status: string;
  context: string | null;
  created_at: string;
}

interface MutualInterest {
  id: string;
  entity_a: string;
  entity_b: string;
  org_id: string;
  status: string;
  formed_at: string;
  expires_at: string;
}

export function AdminInterestsPanel() {
  const {
    data: interests = [],
    isLoading: intLoading,
    isError: intError,
    refetch: refetchInt,
  } = useSupabaseList<Interest>("interests", { limit: 100 });

  const {
    data: mutualInterests = [],
    isLoading: miLoading,
    isError: miError,
    refetch: refetchMi,
  } = useSupabaseList<MutualInterest>("mutual_interests", {
    order: { column: "formed_at", ascending: false },
    limit: 100,
  });

  const loading = intLoading || miLoading;
  const refetch = () => { refetchInt(); refetchMi(); };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <TableSkeleton rows={5} columns={6} />
      </div>
    );
  }

  if (intError || miError) {
    return <ErrorState title="Failed to load interests" onRetry={refetch} />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Interests & Mutual Interests</h2>
          <p className="text-muted-foreground mt-1">
            Declared interests and auto-detected mutual interests (30-day expiry)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Heart className="h-5 w-5 text-primary" />
              Declared Interests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{interests.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Handshake className="h-5 w-5 text-primary" />
              Mutual Interests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{mutualInterests.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="interests">
        <TabsList>
          <TabsTrigger value="interests">Declared Interests</TabsTrigger>
          <TabsTrigger value="mutual">Mutual Interests</TabsTrigger>
        </TabsList>

        <TabsContent value="interests">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>From Entity</TableHead>
                    <TableHead>To Entity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Declared</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {interests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No interests declared yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    interests.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{i.from_entity_id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{i.to_entity_id.slice(0, 8)}…</TableCell>
                        <TableCell><StatusBadge status={i.status} /></TableCell>
                        <TableCell className="max-w-[200px] truncate">{i.context || "-"}</TableCell>
                        <TableCell>{format(new Date(i.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mutual">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Entity A</TableHead>
                    <TableHead>Entity B</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Formed</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mutualInterests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No mutual interests detected yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    mutualInterests.map((mi) => (
                      <TableRow key={mi.id}>
                        <TableCell className="font-mono text-xs">{mi.id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{mi.entity_a.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{mi.entity_b.slice(0, 8)}…</TableCell>
                        <TableCell><StatusBadge status={mi.status} /></TableCell>
                        <TableCell>{format(new Date(mi.formed_at), "dd MMM yyyy HH:mm")}</TableCell>
                        <TableCell>{format(new Date(mi.expires_at), "dd MMM yyyy HH:mm")}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
