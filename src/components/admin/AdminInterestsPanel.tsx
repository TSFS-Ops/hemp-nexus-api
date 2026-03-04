import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Handshake, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

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
  const [interests, setInterests] = useState<Interest[]>([]);
  const [mutualInterests, setMutualInterests] = useState<MutualInterest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [intRes, miRes] = await Promise.all([
      supabase.from("interests").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("mutual_interests").select("*").order("formed_at", { ascending: false }).limit(100),
    ]);
    setInterests((intRes.data as Interest[]) || []);
    setMutualInterests((miRes.data as MutualInterest[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const statusBadge = (status: string) => {
    const variant = status === "active" ? "default" : "secondary";
    return <Badge variant={variant}>{status}</Badge>;
  };

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
          <h2 className="text-3xl font-bold tracking-tight">Interests & Mutual Interests</h2>
          <p className="text-muted-foreground mt-1">
            Declared interests and auto-detected mutual interests (30-day expiry)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
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
                        <TableCell>{statusBadge(i.status)}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{i.context || "—"}</TableCell>
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
                        <TableCell>{statusBadge(mi.status)}</TableCell>
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
