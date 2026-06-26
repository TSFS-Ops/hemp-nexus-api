/**
 * P-5 Batch 7 — Phase 5
 * Shared dashboard action bar: saved views + export, with audit logging.
 *
 * All writes go through `@/lib/p5-batch7/actions`. No raw table reads
 * or direct supabase.rpc calls live in this component.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAsyncAction } from "@/hooks/use-async-action";
import {
  P5_BATCH7_EXPORT_DEFINITIONS,
  type P5Batch7Dashboard,
  type P5Batch7ExportType,
  type P5Batch7Role,
} from "@/lib/p5-batch7/registry";
import {
  p5b7CanRunExport,
  p5b7CreateExportJob,
  p5b7DeleteSavedView,
  p5b7ExportRequiresReason,
  p5b7ListSavedViews,
  p5b7UpsertSavedView,
  type P5B7SavedView,
} from "@/lib/p5-batch7/actions";

interface ActionBarProps {
  dashboard: P5Batch7Dashboard;
  filters: Record<string, unknown>;
  selectedViewId: string | null;
  onSelectView: (view: P5B7SavedView | null) => void;
  effectiveRoles: ReadonlyArray<P5Batch7Role>;
  /** Export types allowed on this dashboard (already filtered by role at call site). */
  availableExportTypes: ReadonlyArray<P5Batch7ExportType>;
}

export function P5B7ActionBar({
  dashboard,
  filters,
  selectedViewId,
  onSelectView,
  effectiveRoles,
  availableExportTypes,
}: ActionBarProps) {
  const [views, setViews] = useState<ReadonlyArray<P5B7SavedView>>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [name, setName] = useState("");
  const [exportType, setExportType] = useState<P5Batch7ExportType | "">(
    availableExportTypes[0] ?? "",
  );
  const [reason, setReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      setViews(await p5b7ListSavedViews(dashboard));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[p5b7] saved views fetch failed:", (e as Error).message);
    }
  }, [dashboard]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveView = useAsyncAction(async () => {
    await p5b7UpsertSavedView({ dashboard, name, filters });
    await refresh();
    setName("");
    setSavedOpen(false);
  }, { successMessage: "Saved view created" });

  const deleteView = useAsyncAction(async (viewId: string) => {
    await p5b7DeleteSavedView({ viewId, dashboard });
    onSelectView(null);
    await refresh();
  }, { successMessage: "Saved view deleted" });

  const runExport = useAsyncAction(async () => {
    if (!exportType) throw new Error("Select an export type");
    await p5b7CreateExportJob({
      dashboard,
      exportType: exportType as P5Batch7ExportType,
      reason,
      filters,
      effectiveRoles,
    });
    setReason("");
    setExportOpen(false);
  }, { successMessage: "Export queued" });

  const reasonNeeded = exportType ? p5b7ExportRequiresReason(exportType as P5Batch7ExportType) : false;
  const exportPermitted = availableExportTypes.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectedViewId ?? "__none__"}
        onValueChange={(v) => {
          if (v === "__none__") onSelectView(null);
          else onSelectView(views.find((x) => x.view_id === v) ?? null);
        }}
      >
        <SelectTrigger className="w-[220px]" aria-label="Saved views">
          <SelectValue placeholder="Saved views" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No saved view</SelectItem>
          {views.map((v) => (
            <SelectItem key={v.view_id} value={v.view_id}>{v.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" onClick={() => setSavedOpen(true)}>
        Save view
      </Button>
      {selectedViewId ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const v = views.find((x) => x.view_id === selectedViewId);
            if (v) void deleteView.run(v.view_id);
          }}
          disabled={deleteView.loading}
        >
          Delete view
        </Button>
      ) : null}

      <div className="flex-1" />

      <Button
        size="sm"
        onClick={() => setExportOpen(true)}
        disabled={!exportPermitted}
        title={exportPermitted ? "Request export" : "You are not authorised to export from this dashboard"}
      >
        Request export
      </Button>

      {/* Save-view dialog */}
      <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>
              Saves your filters and sort settings for this dashboard. Visible to you only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="p5b7-view-name">View name</Label>
            <Input
              id="p5b7-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="My view"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedOpen(false)}>Cancel</Button>
            <Button onClick={saveView.run} disabled={saveView.loading || name.trim().length === 0}>
              {saveView.loading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request export</DialogTitle>
            <DialogDescription>
              Exports are queued, audited and scoped to your role. Sensitive fields
              are never included.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="p5b7-export-type">Export type</Label>
              <Select
                value={exportType || undefined}
                onValueChange={(v) => setExportType(v as P5Batch7ExportType)}
              >
                <SelectTrigger id="p5b7-export-type">
                  <SelectValue placeholder="Select export…" />
                </SelectTrigger>
                <SelectContent>
                  {availableExportTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {P5_BATCH7_EXPORT_DEFINITIONS[t].label}
                      {p5b7CanRunExport(t, effectiveRoles) ? "" : " (not authorised)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p5b7-export-reason">
                Reason {reasonNeeded ? "*" : "(optional)"}
              </Label>
              <Textarea
                id="p5b7-export-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  reasonNeeded
                    ? "Minimum 10 characters; recorded in audit log."
                    : "Optional context"
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button
              onClick={runExport.run}
              disabled={
                runExport.loading ||
                !exportType ||
                (reasonNeeded && reason.trim().length < 10)
              }
            >
              {runExport.loading ? "Submitting…" : "Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function staleAckUiUnusedStub() { toast.dismiss(); }
