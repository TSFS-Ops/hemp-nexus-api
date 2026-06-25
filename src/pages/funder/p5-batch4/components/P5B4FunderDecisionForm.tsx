/**
 * P-5 Batch 4 Stage 6 — funder decision form.
 *
 * The ONLY mutation surface available to a funder user. Calls the
 * approved wrapper `p5b4Funder.recordDecision` (which maps to
 * `p5b4_record_funder_decision_v1`). All gating is enforced server-side
 * by the RPC body (funder org match, release not revoked / expired,
 * status enum). The note field is optional and stored as funder-side
 * commentary; we do not render anyone else's notes here.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  P5B4_FUNDER_RELEASE_STATUSES,
  type P5B4FunderReleaseStatus,
} from "@/lib/p5-batch4/constants";
import { p5b4Funder } from "@/lib/p5-batch4/rpc";

/**
 * Statuses a funder is allowed to select from their UI. We exclude
 * `released` (admin-set) and `revoked` (admin-only). `viewed` is also
 * not user-selectable; it is recorded automatically when the funder
 * loads the pack.
 */
const FUNDER_SELECTABLE_STATUSES: readonly P5B4FunderReleaseStatus[] =
  P5B4_FUNDER_RELEASE_STATUSES.filter(
    (s) => s !== "released" && s !== "revoked" && s !== "viewed",
  );

export interface P5B4FunderDecisionFormProps {
  releaseId: string;
  currentStatus: P5B4FunderReleaseStatus;
  onRecorded?: () => void;
}

export function P5B4FunderDecisionForm({
  releaseId,
  currentStatus,
  onRecorded,
}: P5B4FunderDecisionFormProps) {
  const [status, setStatus] = useState<P5B4FunderReleaseStatus>(
    FUNDER_SELECTABLE_STATUSES.includes(currentStatus)
      ? currentStatus
      : FUNDER_SELECTABLE_STATUSES[0],
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const { error: rpcErr } = await p5b4Funder.recordDecision(
        releaseId,
        status,
        note.trim() || null,
      );
      if (rpcErr) throw rpcErr;
      setOk(true);
      onRecorded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3"
      data-testid="p5b4-funder-decision-form"
    >
      <div className="space-y-1">
        <Label htmlFor="p5b4-funder-decision-status">Your decision</Label>
        <select
          id="p5b4-funder-decision-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as P5B4FunderReleaseStatus)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {FUNDER_SELECTABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="p5b4-funder-decision-note">Note (optional)</Label>
        <Textarea
          id="p5b4-funder-decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a short comment for your own audit trail."
          rows={3}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" data-testid="p5b4-funder-decision-error">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="text-sm text-emerald-700" data-testid="p5b4-funder-decision-ok">
          Decision recorded.
        </p>
      ) : null}
      <Button type="submit" disabled={busy} data-testid="p5b4-funder-decision-submit">
        {busy ? "Recording…" : "Record decision"}
      </Button>
    </form>
  );
}
