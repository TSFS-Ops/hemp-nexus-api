/**
 * Public API V1 · Batch 11 — Client API Support intake.
 *
 * Client-facing support ticket form + own-ticket list. Only an authorised
 * org admin of api_clients.org_id (or internal staff) may create or view
 * tickets — enforced server-side by RPCs:
 *   • create_api_support_ticket
 *   • list_api_support_tickets_for_client
 *
 * The client surface NEVER returns internal_notes or internal_owner.
 * The server's RPC returns the client-shape JSON only.
 *
 * Hard exclusions: no payment, no invoice, no webhook config, no write
 * API, no evidence/document upload, no POI/WaD/compliance decisions.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw, LifeBuoy } from "lucide-react";

const CATEGORIES = [
  "authentication", "sandbox", "production", "rate_limit", "monthly_limit",
  "unexpected_response", "outage_or_degradation", "billing_visibility",
  "documentation", "other",
] as const;
const SEVERITIES = ["low", "medium", "high", "urgent"] as const;
const ENVIRONMENTS = ["sandbox", "production", "unspecified"] as const;
const STATUSES = [
  "open", "triaged", "in_progress", "waiting_on_client", "resolved", "closed",
] as const;

type Category = (typeof CATEGORIES)[number];
type Severity = (typeof SEVERITIES)[number];
type Environment = (typeof ENVIRONMENTS)[number];

interface ApiClientOption { id: string; legal_entity_name: string; org_id: string }

interface ClientTicket {
  id: string;
  api_client_id: string;
  subject: string;
  environment: Environment;
  severity: Severity;
  category: Category;
  description: string;
  contact_name: string;
  contact_email: string;
  request_id: string | null;
  endpoint: string | null;
  external_reference: string | null;
  approximate_time: string | null;
  status: string;
  client_visible_response: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Forbidden tokens — client tickets must NEVER carry these payload fields.
const FORBIDDEN_FIELDS = [
  "key_hash", "api_key", "secret", "internal_notes", "internal_owner",
  "document", "evidence", "governance", "poi", "wad", "payment",
  "compliance",
] as const;

function scanPayloadForLeak(payload: Record<string, unknown>): string | null {
  const flat = JSON.stringify(payload).toLowerCase();
  for (const t of FORBIDDEN_FIELDS) {
    // Reject only when a forbidden token appears as a key in this payload.
    if (new RegExp(`"${t}"\\s*:`).test(flat)) return t;
  }
  return null;
}

export function ClientSupportPanel() {
  const [clients, setClients] = useState<ApiClientOption[]>([]);
  const [apiClientId, setApiClientId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [environment, setEnvironment] = useState<Environment>("sandbox");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [category, setCategory] = useState<Category>("other");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [requestIdField, setRequestIdField] = useState("");
  const [endpointField, setEndpointField] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [approxTime, setApproxTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<ClientTicket[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch api_clients visible to the caller (RLS scoped — own-org clients
  // only; platform/api admins also see all).
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("api_clients")
          .select("id, legal_entity_name, org_id")
          .order("legal_entity_name", { ascending: true });
        if (error) throw error;
        const opts = (data ?? []) as ApiClientOption[];
        setClients(opts);
        if (opts.length && !apiClientId) setApiClientId(opts[0].id);
      } catch (e) {
        toast.error("Could not load API clients", { description: (e as Error).message });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTickets = async (clientId: string) => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_api_support_tickets_for_client", {
        p_api_client_id: clientId,
        p_status: null,
        p_limit: 100,
      });
      if (error) throw error;
      setTickets((data ?? []) as unknown as ClientTicket[]);
    } catch (e) {
      toast.error("Could not load tickets", { description: (e as Error).message });
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiClientId) loadTickets(apiClientId);
  }, [apiClientId]);

  const canSubmit = useMemo(() => {
    return (
      apiClientId &&
      subject.trim().length >= 4 &&
      description.trim().length >= 10 &&
      contactName.trim().length >= 1 &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim())
    );
  }, [apiClientId, subject, description, contactName, contactEmail]);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        p_api_client_id: apiClientId,
        p_subject: subject.trim(),
        p_environment: environment,
        p_severity: severity,
        p_category: category,
        p_description: description.trim(),
        p_contact_name: contactName.trim(),
        p_contact_email: contactEmail.trim(),
        p_request_id: requestIdField.trim() || null,
        p_endpoint: endpointField.trim() || null,
        p_external_reference: externalRef.trim() || null,
        p_approximate_time: approxTime ? new Date(approxTime).toISOString() : null,
      };
      // Defensive: refuse to send any forbidden field.
      const leak = scanPayloadForLeak(payload as unknown as Record<string, unknown>);
      if (leak) {
        toast.error(`Support ticket blocked: forbidden field '${leak}'`);
        return;
      }
      const { error } = await supabase.rpc("create_api_support_ticket", payload);
      if (error) throw error;
      toast.success("Support ticket submitted");
      setSubject(""); setDescription(""); setRequestIdField("");
      setEndpointField(""); setExternalRef(""); setApproxTime("");
      await loadTickets(apiClientId);
    } catch (e) {
      toast.error("Could not submit ticket", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-sm border border-slate-800 bg-slate-900/40 p-6 space-y-5">
        <header className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-emerald-400" />
          <h2 className="text-[13px] uppercase tracking-[0.18em] text-slate-300 font-mono">
            Submit an API support ticket
          </h2>
        </header>
        <p className="text-[12.5px] text-slate-400 leading-relaxed">
          Support intake for API-related issues only. This is not live chat
          and not a 24/7 human support guarantee. Tickets are visible only
          to your own API client and to authorised Izenzo internal staff.
          Internal notes are never shown to client users.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">API client</Label>
            <Select value={apiClientId} onValueChange={setApiClientId}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-100">
                <SelectValue placeholder="Select your API client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENVIRONMENTS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Subject</Label>
            <Input
              value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 200))}
              placeholder="Short summary of the API issue"
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Description</Label>
            <Textarea
              value={description} onChange={(e) => setDescription(e.target.value.slice(0, 8000))}
              placeholder="What happened? What did you expect? Include the request_id if you have one."
              rows={5}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Contact name</Label>
            <Input
              value={contactName} onChange={(e) => setContactName(e.target.value.slice(0, 200))}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Contact email</Label>
            <Input
              type="email" value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value.slice(0, 255))}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">request_id (optional)</Label>
            <Input
              value={requestIdField} onChange={(e) => setRequestIdField(e.target.value.slice(0, 128))}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Endpoint (optional)</Label>
            <Input
              value={endpointField} onChange={(e) => setEndpointField(e.target.value.slice(0, 200))}
              placeholder="/v1/counterparty/lookup"
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">external_reference (optional)</Label>
            <Input
              value={externalRef} onChange={(e) => setExternalRef(e.target.value.slice(0, 128))}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-[11px] uppercase tracking-wider">Approximate time</Label>
            <Input
              type="datetime-local" value={approxTime}
              onChange={(e) => setApproxTime(e.target.value)}
              className="bg-slate-950 border-slate-800 text-slate-100"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit ticket
          </Button>
        </div>
      </section>

      <section className="rounded-sm border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-[13px] uppercase tracking-[0.18em] text-slate-300 font-mono">
            Your tickets
          </h2>
          <Button
            onClick={() => apiClientId && loadTickets(apiClientId)}
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-slate-100"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
          </Button>
        </header>
        {loading ? (
          <div className="text-slate-400 text-[12.5px]">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="text-slate-500 text-[12.5px]">No tickets yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] text-slate-200">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Env</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Response</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-slate-900">
                    <td className="py-2 pr-3">{t.subject}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{t.environment}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{t.severity}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{t.category}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{t.status}</td>
                    <td className="py-2 pr-3 font-mono text-[10px] text-slate-400">
                      {new Date(t.created_at).toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="py-2 pr-3 max-w-[28ch] truncate text-slate-300">
                      {t.client_visible_response ?? <span className="text-slate-500">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Allowed status values: {STATUSES.join(", ")}. Internal notes and
          internal owner are never returned to client users.
        </p>
      </section>
    </div>
  );
}

export default ClientSupportPanel;
