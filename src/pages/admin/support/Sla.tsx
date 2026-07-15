/**
 * Admin: SLA targets — per-team overrides + platform defaults.
 * platform_admin gated in the router.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import { listTeams, type SupportPriority } from "@/lib/support/client";
import {
  adminListSlaTargets,
  adminUpsertSlaTarget,
  adminDeleteSlaTarget,
  SLA_PRIORITIES,
  type SupportSlaTargetRow,
} from "@/lib/support/sla";

type Team = { key: string; label: string };

const GLOBAL_KEY = "__global__";

function fmtMinutes(m: number) {
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round((m / 60) * 10) / 10}h`;
  return `${Math.round((m / 1440) * 10) / 10}d`;
}

export default function AdminSupportSla() {
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [rows, setRows] = useState<SupportSlaTargetRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor state
  const [selTeam, setSelTeam] = useState<string>(GLOBAL_KEY); // GLOBAL_KEY → null
  const [selPriority, setSelPriority] = useState<SupportPriority>("high");
  const [frMin, setFrMin] = useState<number>(120);
  const [resMin, setResMin] = useState<number>(480);
  const [bizHours, setBizHours] = useState<boolean>(true);

  const reload = async () => {
    try {
      const r = await adminListSlaTargets();
      setRows(r);
    } catch (e) {
      toast({
        title: "Failed to load SLA targets",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [t] = await Promise.all([listTeams(), reload()]);
        setTeams(t.map((x) => ({ key: x.key, label: x.label })));
      } catch (e) {
        toast({
          title: "Failed to load teams",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill editor when selection changes to reflect existing row (if any).
  useEffect(() => {
    if (!rows) return;
    const teamKey = selTeam === GLOBAL_KEY ? null : selTeam;
    const existing = rows.find(
      (r) => r.team_key === teamKey && r.priority === selPriority
    );
    if (existing) {
      setFrMin(existing.first_response_minutes);
      setResMin(existing.resolution_minutes);
      setBizHours(existing.business_hours_only);
    }
  }, [selTeam, selPriority, rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, SupportSlaTargetRow[]>();
    for (const r of rows ?? []) {
      const k = r.team_key ?? "";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [rows]);

  async function save() {
    setSaving(true);
    try {
      await adminUpsertSlaTarget({
        team_key: selTeam === GLOBAL_KEY ? null : selTeam,
        priority: selPriority,
        first_response_minutes: Number(frMin),
        resolution_minutes: Number(resMin),
        business_hours_only: bizHours,
      });
      toast({ title: "SLA target saved" });
      await reload();
    } catch (e) {
      toast({
        title: "Save failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: SupportSlaTargetRow) {
    if (row.team_key === null) {
      toast({
        title: "Cannot delete a platform default",
        description:
          "Platform defaults must exist for every priority — edit the values instead.",
        variant: "destructive",
      });
      return;
    }
    if (
      !confirm(
        `Delete the ${row.priority} override for team "${row.team_key}"? Tickets will fall back to the platform default.`
      )
    )
      return;
    try {
      await adminDeleteSlaTarget(row.id);
      toast({ title: "Override removed" });
      await reload();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  if (!rows || !teams) return <FullPageLoader />;

  const teamKeys = ["", ...teams.map((t) => t.key)];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div>
          <Link
            to="/admin/support"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Support queue
          </Link>
          <h1 className="text-2xl font-semibold mt-1">SLA targets</h1>
          <p className="text-sm text-muted-foreground">
            First-response and resolution deadlines used when a ticket is
            created and by the escalation cron. Team overrides win; anything
            not overridden uses the platform default.
          </p>
        </div>

        {/* Editor */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add or update a target</CardTitle>
            <CardDescription>
              Pick a team + priority. Save creates a new row or updates the
              existing one.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Team</Label>
              <Select value={selTeam} onValueChange={setSelTeam}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_KEY}>Platform default</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select
                value={selPriority}
                onValueChange={(v) => setSelPriority(v as SupportPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLA_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">First response (min)</Label>
              <Input
                type="number"
                min={1}
                value={frMin}
                onChange={(e) => setFrMin(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Resolution (min)</Label>
              <Input
                type="number"
                min={1}
                value={resMin}
                onChange={(e) => setResMin(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2">
                <Switch checked={bizHours} onCheckedChange={setBizHours} />
                <Label className="text-xs">Business hours</Label>
              </div>
            </div>
            <div className="md:col-span-6 flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save target"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Current matrix */}
        {teamKeys.map((tk) => {
          const list = grouped.get(tk) ?? [];
          if (tk !== "" && list.length === 0) return null;
          const label =
            tk === ""
              ? "Platform default"
              : teams.find((t) => t.key === tk)?.label ?? tk;
          return (
            <Card key={tk || "global"}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {label}
                    {tk === "" && <Badge variant="secondary">default</Badge>}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {tk === ""
                      ? "Applies to every priority that has no team-specific row."
                      : `Overrides for team "${tk}". Missing priorities fall back to the platform default.`}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-2">Priority</th>
                        <th className="text-left px-4 py-2">First response</th>
                        <th className="text-left px-4 py-2">Resolution</th>
                        <th className="text-left px-4 py-2">Business hours</th>
                        <th className="text-right px-4 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-3 text-xs text-muted-foreground"
                          >
                            No targets configured.
                          </td>
                        </tr>
                      ) : (
                        SLA_PRIORITIES.map((p) => {
                          const row = list.find((r) => r.priority === p);
                          if (!row) {
                            if (tk === "") return null;
                            return (
                              <tr key={p} className="border-t border-border/60">
                                <td className="px-4 py-2 capitalize">{p}</td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  falls back to default
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  —
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  —
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelTeam(tk);
                                      setSelPriority(p);
                                    }}
                                  >
                                    Add override
                                  </Button>
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={p} className="border-t border-border/60">
                              <td className="px-4 py-2 capitalize">{p}</td>
                              <td className="px-4 py-2">
                                {row.first_response_minutes}m
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({fmtMinutes(row.first_response_minutes)})
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                {row.resolution_minutes}m
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({fmtMinutes(row.resolution_minutes)})
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                {row.business_hours_only ? "yes" : "24/7"}
                              </td>
                              <td className="px-4 py-2 text-right space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelTeam(tk === "" ? GLOBAL_KEY : tk);
                                    setSelPriority(p);
                                    setFrMin(row.first_response_minutes);
                                    setResMin(row.resolution_minutes);
                                    setBizHours(row.business_hours_only);
                                  }}
                                >
                                  Edit
                                </Button>
                                {tk !== "" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => remove(row)}
                                  >
                                    Delete
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
