import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  ShieldCheck,
  ShieldX,
  Hash,
  Clock,
  Key,
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface CollapseRecord {
  id: string;
  org_id: string;
  counterparty_org_id: string;
  match_id: string | null;
  asset_id: string;
  quantity: number;
  price: number;
  currency: string;
  client_timestamp: string;
  idempotency_key: string;
  signature_valid: boolean;
  signature_key_id: string | null;
  payload_hash: string;
  poi_state: string;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}

interface PoiEvent {
  id: string;
  from_state: string;
  to_state: string;
  reason: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function CollapseLedgerViewer() {
  const [records, setRecords] = useState<CollapseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [poiEvents, setPoiEvents] = useState<Record<string, PoiEvent[]>>({});

  const fetchRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("collapse_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      setRecords(data as unknown as CollapseRecord[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchPoiEvents = async (matchId: string) => {
    if (poiEvents[matchId]) return;
    const { data } = await supabase
      .from("poi_events")
      .select("*")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (data) {
      setPoiEvents((prev) => ({ ...prev, [matchId]: data as unknown as PoiEvent[] }));
    }
  };

  const toggleExpand = (record: CollapseRecord) => {
    if (expandedId === record.id) {
      setExpandedId(null);
    } else {
      setExpandedId(record.id);
      if (record.match_id) {
        fetchPoiEvents(record.match_id);
      }
    }
  };

  const filtered = records.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.id.toLowerCase().includes(term) ||
      r.idempotency_key.toLowerCase().includes(term) ||
      r.payload_hash.toLowerCase().includes(term) ||
      r.asset_id.toLowerCase().includes(term) ||
      r.org_id.toLowerCase().includes(term)
    );
  });

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Collapse Ledger</h2>
        <p className="text-muted-foreground text-sm">
          Append-only ledger of all POI collapse events. Includes payload hash, signature status, idempotency, and state history.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, hash, or asset…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            aria-label="Search collapse records"
          />
        </div>
        <Button variant="outline" size="icon" onClick={fetchRecords} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No collapse records found.
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-3">
            {filtered.map((record) => (
              <Card key={record.id} className="overflow-hidden">
                <button
                  onClick={() => toggleExpand(record)}
                  className="w-full text-left"
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {record.signature_valid ? (
                          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <ShieldX className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="font-mono text-xs truncate">{record.id}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{record.poi_state}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {new Date(record.created_at).toLocaleString()}
                        </span>
                        {expandedId === record.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    <CardDescription className="text-xs mt-1">
                      {record.asset_id} · {record.quantity} × {record.price} {record.currency}
                    </CardDescription>
                  </CardHeader>
                </button>

                {expandedId === record.id && (
                  <CardContent className="px-4 pb-4 space-y-4">
                    <Separator />

                    {/* Core fields */}
                    <div className="grid gap-3 sm:grid-cols-2 text-xs">
                      <div className="space-y-1">
                        <span className="text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Payload Hash</span>
                        <p className="font-mono break-all">{record.payload_hash}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground flex items-center gap-1"><Key className="h-3 w-3" /> Idempotency Key</span>
                        <p className="font-mono break-all">{record.idempotency_key}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Signature</span>
                        <Badge variant={record.signature_valid ? "default" : "destructive"} className="text-[10px]">
                          {record.signature_valid ? "Valid" : "Invalid"}
                        </Badge>
                        {record.signature_key_id && (
                          <p className="font-mono text-muted-foreground">Key: {record.signature_key_id}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Client Timestamp</span>
                        <p>{new Date(record.client_timestamp).toLocaleString()}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground">Org ID</span>
                        <p className="font-mono text-[10px] break-all">{record.org_id}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground">Counterparty Org ID</span>
                        <p className="font-mono text-[10px] break-all">{record.counterparty_org_id}</p>
                      </div>
                    </div>

                    {/* Metadata */}
                    {record.metadata && Object.keys(record.metadata).length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" /> Metadata</span>
                        <pre className="text-[10px] bg-muted p-2 rounded overflow-auto max-h-24 font-mono">
                          {JSON.stringify(record.metadata, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* POI State History */}
                    {record.match_id && (
                      <div className="space-y-2">
                        <span className="text-xs font-medium">POI State History</span>
                        {poiEvents[record.match_id] ? (
                          poiEvents[record.match_id].length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">From</TableHead>
                                  <TableHead className="text-xs">To</TableHead>
                                  <TableHead className="text-xs">Reason</TableHead>
                                  <TableHead className="text-xs">Timestamp</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {poiEvents[record.match_id].map((evt) => (
                                  <TableRow key={evt.id}>
                                    <TableCell className="text-xs font-mono">{evt.from_state}</TableCell>
                                    <TableCell className="text-xs font-mono">{evt.to_state}</TableCell>
                                    <TableCell className="text-xs">{evt.reason || "—"}</TableCell>
                                    <TableCell className="text-xs">{new Date(evt.created_at).toLocaleString()}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-xs text-muted-foreground">No POI events recorded.</p>
                          )
                        ) : (
                          <Skeleton className="h-12 w-full" />
                        )}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
