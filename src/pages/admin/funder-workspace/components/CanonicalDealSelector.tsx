/**
 * Institutional Funder Evidence Workspace — Batch 8
 * Server-backed canonical deal selector.
 * Stores match_id; never allows arbitrary free text to become the canonical link.
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  searchReleasableDeals,
  type ReleasableDealRow,
} from "@/lib/funder-workspace/admin-client";

interface Props {
  value: string;
  onChange: (matchId: string, display: ReleasableDealRow | null) => void;
  testIdPrefix?: string;
}

export function CanonicalDealSelector({ value, onChange, testIdPrefix = "fw-deal-selector" }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ReleasableDealRow[]>([]);
  const [selected, setSelected] = useState<ReleasableDealRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const list = await searchReleasableDeals(query.trim(), 25);
      setRows(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (r: ReleasableDealRow) => {
    setSelected(r);
    onChange(r.match_id, r);
    setRows([]);
  };

  return (
    <div className="space-y-2" data-testid={testIdPrefix}>
      <div className="flex gap-2">
        <Input
          placeholder="Search by deal hash, buyer, seller, commodity, or paste a match UUID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
          data-testid={`${testIdPrefix}-query`}
        />
        <Button type="button" variant="secondary" onClick={() => void run()} disabled={busy} data-testid={`${testIdPrefix}-search`}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {rows.length > 0 && (
        <div className="border rounded-md divide-y max-h-64 overflow-auto" data-testid={`${testIdPrefix}-results`}>
          {rows.map((r) => (
            <button
              key={r.match_id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
              onClick={() => pick(r)}
              data-testid={`${testIdPrefix}-result-${r.match_id}`}
            >
              <div className="flex justify-between items-center gap-2">
                <div className="font-mono text-xs truncate">{r.display_reference}</div>
                <Badge variant="secondary" className="text-[10px]">{r.deal_status ?? "—"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Buyer: {r.buyer_org_name ?? "—"} · Seller: {r.seller_org_name ?? "—"} · Docs: {r.evidence_document_count}
              </div>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="border rounded-md p-3 bg-muted/40 text-sm" data-testid={`${testIdPrefix}-selected`}>
          <div className="flex justify-between">
            <div>
              <div className="font-medium">Selected canonical deal</div>
              <div className="font-mono text-xs">{selected.display_reference}</div>
              <div className="text-xs text-muted-foreground">
                Buyer: {selected.buyer_org_name ?? "—"} · Seller: {selected.seller_org_name ?? "—"}
              </div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(null); onChange("", null); }}>
              Clear
            </Button>
          </div>
        </div>
      )}
      {!selected && value && (
        <div className="text-xs text-muted-foreground font-mono">match_id: {value}</div>
      )}
    </div>
  );
}
