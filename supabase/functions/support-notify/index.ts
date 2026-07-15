/**
 * support-notify
 * --------------
 * Fan-out email dispatcher for the Enterprise Support Centre.
 * Invoked from DB triggers on `support_ticket_events` and
 * `support_incident_updates` via `net.http_post`.
 *
 * Auth: internal-only. Requires `x-internal-key` = `INTERNAL_CRON_KEY`.
 * All sends go through the platform `send-transactional-email` function,
 * so retries, suppression, unsubscribes, and logging are handled by the
 * shared queue.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SITE = "https://izenzo.co.za";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
    if (!internalKey) return json({ error: "INTERNAL_CRON_KEY not set" }, 500);
    if (req.headers.get("x-internal-key") !== internalKey) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const kind = body.kind as string | undefined;
    if (!kind) return json({ error: "kind required" }, 400);

    if (kind === "ticket_event") {
      const eventId = body.event_id as string | undefined;
      if (!eventId) return json({ error: "event_id required" }, 400);
      return json(await dispatchTicketEvent(admin, eventId));
    }
    if (kind === "incident_update") {
      const updateId = body.incident_update_id as string | undefined;
      if (!updateId) return json({ error: "incident_update_id required" }, 400);
      return json(await dispatchIncidentUpdate(admin, updateId));
    }
    return json({ error: `unknown kind ${kind}` }, 400);
  } catch (e) {
    console.error("support-notify error", e);
    return json({ error: "internal_error", message: (e as Error).message }, 500);
  }
});

// ---- Ticket events ---------------------------------------------------

async function dispatchTicketEvent(admin: any, eventId: string) {
  const { data: ev, error: evErr } = await admin
    .from("support_ticket_events")
    .select("id,ticket_id,event_kind,payload,created_at")
    .eq("id", eventId)
    .single();
  if (evErr || !ev) return { skipped: true, reason: `event ${eventId} not found` };

  const { data: t, error: tErr } = await admin
    .from("support_tickets")
    .select(
      "id,ticket_number,subject,status,priority,current_team_key,current_assignee_user_id,created_by,contact_email"
    )
    .eq("id", ev.ticket_id)
    .single();
  if (tErr || !t) return { skipped: true, reason: `ticket ${ev.ticket_id} not found` };

  const results: unknown[] = [];
  const customerUrl = `${SITE}/support/tickets/${t.id}`;
  const adminUrl = `${SITE}/admin/support/tickets/${t.id}`;

  const customerEmail = await resolveCustomerEmail(admin, t);

  switch (ev.event_kind) {
    case "created": {
      if (customerEmail) {
        results.push(
          await enqueue(admin, {
            templateName: "support-ticket-customer-update",
            recipientEmail: customerEmail,
            idempotencyKey: `support-cust-created-${t.id}`,
            templateData: {
              ticketNumber: t.ticket_number,
              subject: t.subject,
              headline: "We have received your ticket",
              bodyText:
                "Thanks for reaching out. Our team will review shortly and update you here as soon as we have an answer.",
              status: t.status,
              priority: t.priority,
              ctaUrl: customerUrl,
            },
          })
        );
      }
      results.push(...(await notifyStaff(admin, t, {
        alertKind: "new ticket",
        detail: "A new support ticket has been logged.",
        slaGate: null,
        ctaUrl: adminUrl,
      })));
      break;
    }
    case "customer_message_posted": {
      // Reply from someone. If actor differs from ticket owner, treat as staff→customer.
      const actorId = (ev.payload?.actor_user_id ?? null) as string | null;
      const isStaffReply = actorId && actorId !== t.created_by;
      if (isStaffReply && customerEmail) {
        results.push(
          await enqueue(admin, {
            templateName: "support-ticket-customer-update",
            recipientEmail: customerEmail,
            idempotencyKey: `support-cust-reply-${ev.id}`,
            templateData: {
              ticketNumber: t.ticket_number,
              subject: t.subject,
              headline: "New reply from the support team",
              bodyText: "There is a new reply on your ticket. Please view it in-app for the full message.",
              status: t.status,
              priority: t.priority,
              ctaUrl: customerUrl,
            },
          })
        );
      } else {
        results.push(...(await notifyStaff(admin, t, {
          alertKind: "customer reply",
          detail: "The customer has posted a new message.",
          slaGate: null,
          ctaUrl: adminUrl,
        })));
      }
      break;
    }
    case "status_changed": {
      if (customerEmail) {
        results.push(
          await enqueue(admin, {
            templateName: "support-ticket-customer-update",
            recipientEmail: customerEmail,
            idempotencyKey: `support-cust-status-${ev.id}`,
            templateData: {
              ticketNumber: t.ticket_number,
              subject: t.subject,
              headline: `Ticket status: ${String(t.status).replace(/_/g, " ")}`,
              bodyText: (ev.payload?.reason as string) || undefined,
              status: t.status,
              priority: t.priority,
              ctaUrl: customerUrl,
            },
          })
        );
      }
      break;
    }
    case "auto_escalated": {
      const gate = String(ev.payload?.gate ?? "").replace(/_/g, " ");
      const fromP = ev.payload?.from_priority;
      const toP = ev.payload?.to_priority;
      const staffDetail = `SLA ${gate} breached; priority raised from ${fromP} to ${toP}.`;

      // Staff email
      results.push(
        ...(await notifyStaff(admin, t, {
          alertKind: "auto-escalated",
          detail: staffDetail,
          slaGate: (ev.payload?.gate as string) ?? null,
          ctaUrl: adminUrl,
        }))
      );

      // Customer email — reassures the requester that we've prioritised
      // their ticket. Independent idempotency key so it never collides
      // with staff sends.
      if (customerEmail) {
        results.push(
          await enqueue(admin, {
            templateName: "support-ticket-customer-update",
            recipientEmail: customerEmail,
            idempotencyKey: `support-cust-escalated-${ev.id}`,
            templateData: {
              ticketNumber: t.ticket_number,
              subject: t.subject,
              headline: "We've escalated your ticket",
              bodyText: `Your ticket has been auto-escalated to ${toP} priority because our ${gate} target was missed. A senior team member will pick it up shortly.`,
              status: t.status,
              priority: toP ?? t.priority,
              ctaUrl: customerUrl,
            },
          })
        );
      }

      // In-app notifications — one per staff recipient user + customer.
      results.push(
        ...(await createInAppNotifications(admin, t, {
          type: "support_ticket_auto_escalated",
          staffTitle: `Ticket ${t.ticket_number} auto-escalated`,
          staffBody: staffDetail,
          staffLink: `/admin/support/tickets/${t.id}`,
          customerTitle: "Your support ticket was escalated",
          customerBody: `We've raised ${t.ticket_number} to ${toP} priority so a senior team member can respond faster.`,
          customerLink: `/support/tickets/${t.id}`,
        }))
      );
      break;
    }
    default:
      return { skipped: true, reason: `event_kind ${ev.event_kind} has no email hook` };
  }

  return { ok: true, event_id: eventId, kind: ev.event_kind, results };
}

async function resolveCustomerEmail(admin: any, ticket: any): Promise<string | null> {
  if (ticket.contact_email) return ticket.contact_email as string;
  if (!ticket.created_by) return null;
  const { data } = await admin.auth.admin.getUserById(ticket.created_by);
  return data?.user?.email ?? null;
}

async function notifyStaff(
  admin: any,
  ticket: any,
  opts: { alertKind: string; detail: string; slaGate: string | null; ctaUrl: string }
) {
  const recipients = await resolveStaffRecipients(admin, ticket);
  const out: unknown[] = [];
  for (const email of recipients) {
    out.push(
      await enqueue(admin, {
        templateName: "support-staff-alert",
        recipientEmail: email,
        idempotencyKey: `support-staff-${opts.alertKind.replace(/\s+/g, "-")}-${ticket.id}-${email}`,
        templateData: {
          ticketNumber: ticket.ticket_number,
          subject: ticket.subject,
          alertKind: opts.alertKind,
          detail: opts.detail,
          status: ticket.status,
          priority: ticket.priority,
          team: ticket.current_team_key,
          slaGate: opts.slaGate,
          ctaUrl: opts.ctaUrl,
        },
      })
    );
  }
  return out;
}

async function resolveStaffUserIds(admin: any, ticket: any): Promise<string[]> {
  const userIds = new Set<string>();
  if (ticket.current_assignee_user_id) userIds.add(ticket.current_assignee_user_id);

  if (ticket.current_team_key) {
    const { data: tm } = await admin
      .from("support_team_members")
      .select("user_id")
      .eq("team_key", ticket.current_team_key);
    (tm ?? []).forEach((r: any) => r.user_id && userIds.add(r.user_id));
  }

  if (userIds.size === 0) {
    const { data: admins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "platform_admin")
      .limit(20);
    (admins ?? []).forEach((r: any) => r.user_id && userIds.add(r.user_id));
  }
  return Array.from(userIds);
}

async function resolveStaffRecipients(admin: any, ticket: any): Promise<string[]> {
  const userIds = await resolveStaffUserIds(admin, ticket);

  const emails: string[] = [];
  for (const uid of userIds) {
    const { data } = await admin.auth.admin.getUserById(uid);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return Array.from(new Set(emails));
}

async function createInAppNotifications(
  admin: any,
  ticket: any,
  opts: {
    type: string;
    staffTitle: string;
    staffBody: string;
    staffLink: string;
    customerTitle: string;
    customerBody: string;
    customerLink: string;
  }
) {
  const rows: Array<Record<string, unknown>> = [];
  const staffIds = await resolveStaffUserIds(admin, ticket);
  for (const uid of staffIds) {
    rows.push({
      user_id: uid,
      type: opts.type,
      title: opts.staffTitle,
      body: opts.staffBody,
      link: opts.staffLink,
      entity_type: "support_ticket",
      entity_id: ticket.id,
    });
  }
  if (ticket.created_by) {
    rows.push({
      user_id: ticket.created_by,
      type: opts.type,
      title: opts.customerTitle,
      body: opts.customerBody,
      link: opts.customerLink,
      entity_type: "support_ticket",
      entity_id: ticket.id,
    });
  }
  if (rows.length === 0) return [];
  const { error } = await admin.from("notifications").insert(rows);
  if (error) {
    console.error("in-app notification insert failed", error);
    return [{ inapp_error: error.message }];
  }
  return [{ inapp_inserted: rows.length }];
}

// ---- Incident updates ------------------------------------------------

async function dispatchIncidentUpdate(admin: any, updateId: string) {
  const { data: u, error: uErr } = await admin
    .from("support_incident_updates")
    .select("id,incident_id,status,body,is_public,created_at")
    .eq("id", updateId)
    .single();
  if (uErr || !u) return { skipped: true, reason: `update ${updateId} not found` };
  if (!u.is_public) return { skipped: true, reason: "internal-only update" };

  const { data: inc, error: iErr } = await admin
    .from("support_incidents")
    .select("id,incident_number,title,severity,affected_components,is_public")
    .eq("id", u.incident_id)
    .single();
  if (iErr || !inc || !inc.is_public)
    return { skipped: true, reason: "incident missing or not public" };

  // Recipients: contact_email on all open (non-terminal) tickets. Deduped, capped.
  const { data: tickets } = await admin
    .from("support_tickets")
    .select("contact_email,created_by")
    .not("status", "in", "(resolved,closed,cancelled)")
    .limit(2000);

  const emails = new Set<string>();
  for (const t of tickets ?? []) {
    if (t.contact_email) {
      emails.add(String(t.contact_email).toLowerCase());
    } else if (t.created_by) {
      const { data } = await admin.auth.admin.getUserById(t.created_by);
      if (data?.user?.email) emails.add(data.user.email.toLowerCase());
    }
    if (emails.size >= 500) break;
  }

  const statusPageUrl = `${SITE}/support/incidents`;
  const templateData = {
    incidentNumber: inc.incident_number,
    incidentTitle: inc.title,
    status: u.status,
    severity: inc.severity,
    updateBody: u.body,
    affectedComponents: Array.isArray(inc.affected_components)
      ? inc.affected_components.join(", ")
      : "",
    statusPageUrl,
  };
  const results: unknown[] = [];
  for (const email of emails) {
    results.push(
      await enqueue(admin, {
        templateName: "support-incident-update",
        recipientEmail: email,
        idempotencyKey: `support-incident-${u.id}-${email}`,
        templateData,
      })
    );
  }
  return { ok: true, incident_update_id: updateId, recipient_count: emails.size, results };
}

// ---- Enqueue helper --------------------------------------------------

async function enqueue(
  admin: any,
  payload: {
    templateName: string;
    recipientEmail: string;
    idempotencyKey: string;
    templateData: Record<string, unknown>;
  }
) {
  try {
    const { data, error } = await admin.functions.invoke("send-transactional-email", {
      body: { ...payload, purpose: "transactional" },
    });
    if (error) {
      console.error("send-transactional-email error", payload.templateName, payload.recipientEmail, error);
      return { ok: false, template: payload.templateName, to: payload.recipientEmail, error: error.message };
    }
    return { ok: true, template: payload.templateName, to: payload.recipientEmail, data };
  } catch (e) {
    console.error("enqueue exception", e);
    return { ok: false, template: payload.templateName, to: payload.recipientEmail, error: (e as Error).message };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
