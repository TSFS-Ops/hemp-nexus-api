/**
 * notification-dispatch - Backend consumer for admin notification settings.
 * Called by lifecycle events (breach detection, compliance cases, etc.)
 * to dispatch email/Slack alerts based on saved admin_settings.
 *
 * This function reads the "notifications" key from admin_settings
 * and dispatches alerts accordingly.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import { recordNotificationSkipped } from "../_shared/notification-skip-audit.ts";

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  // ── Auth: internal cron key or service-role JWT required ──
  const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const providedKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") || "";
  const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "NEVER_MATCH");

  if ((!cronKey || providedKey !== cronKey) && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { event_type, subject: rawSubject, message, metadata } = body;
    // Defensive clamp — protects every downstream channel (email + Slack)
    // even if a future caller forgets to pre-clamp a free-text subject.
    const rawSubjectStr = rawSubject != null ? String(rawSubject) : undefined;
    const subject = rawSubjectStr != null ? clampSubject(rawSubjectStr) : undefined;
    const defensiveTruncationFired =
      rawSubjectStr != null && subject !== undefined && rawSubjectStr !== subject;

    if (!event_type || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "event_type and message are required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Observability: when the defensive clamp actually changed the subject,
    // emit a discrete audit row so cross-surface QA (N-7) can detect callers
    // that bypass the SSOT clampSubject contract. The dispatcher succeeds
    // either way — this is a drift signal, not an error.
    if (defensiveTruncationFired) {
      try {
        await supabase.from("audit_logs").insert({
          org_id: (metadata?.org_id as string) || "00000000-0000-0000-0000-000000000000",
          entity_type: "notification",
          action: "email.subject_defensively_truncated",
          metadata: {
            event_type,
            raw_subject_length: rawSubjectStr.length,
            clamped_subject_length: subject!.length,
            // Store only the head/tail to aid forensic correlation without
            // bloating the audit log with arbitrary free-text payloads.
            raw_subject_head: rawSubjectStr.slice(0, 80),
            clamped_subject: subject,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditErr) {
        console.error("[notification-dispatch] Failed to log defensive truncation:", auditErr);
      }
    }

    // Fetch notification settings
    const { data: settingsRow } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "notifications")
      .single();

    const settings = (settingsRow?.value as Record<string, unknown>) || {
      emailAlerts: false,
      slackWebhook: "",
      alertThreshold: 10,
    };

    const dispatched: string[] = [];
    const skipped: Array<{ channel: string; reason: string }> = [];
    const orgIdForAudit = (metadata?.org_id as string) || undefined;

    // Email dispatch via Resend (if configured)
    if (settings.emailAlerts) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Compliance Match <notifications@compliance-matching.lovable.app>",
              to: ["admin@izenzo.co.za"],
              subject: subject || `[Alert] ${event_type}`,
              text: `${message}\n\nEvent: ${event_type}\nTime: ${new Date().toISOString()}\n${
                metadata ? `\nDetails: ${JSON.stringify(metadata, null, 2)}` : ""
              }`,
            }),
          });
          if (emailRes.ok) {
            dispatched.push("email");
          } else {
            console.error("[notification-dispatch] Resend error:", await emailRes.text());
            await recordNotificationSkipped(supabase, {
              reason: "dispatcher_unavailable",
              sourceFunction: "notification-dispatch",
              sourceEventType: event_type,
              channel: "email",
              orgId: orgIdForAudit,
              extra: { http_status: emailRes.status },
            });
            skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
          }
        } catch (emailErr) {
          console.error("[notification-dispatch] Email dispatch failed:", emailErr);
          await recordNotificationSkipped(supabase, {
            reason: "dispatcher_unavailable",
            sourceFunction: "notification-dispatch",
            sourceEventType: event_type,
            channel: "email",
            orgId: orgIdForAudit,
            extra: { error: emailErr instanceof Error ? emailErr.message : String(emailErr) },
          });
          skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
        }
      } else {
        // No RESEND_API_KEY configured — silent skip without audit before D-07
        await recordNotificationSkipped(supabase, {
          reason: "dispatcher_unavailable",
          sourceFunction: "notification-dispatch",
          sourceEventType: event_type,
          channel: "email",
          orgId: orgIdForAudit,
          extra: { detail: "RESEND_API_KEY not configured" },
        });
        skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
      }
    } else {
      // emailAlerts toggle disabled in admin_settings.notifications
      await recordNotificationSkipped(supabase, {
        reason: "email_disabled",
        sourceFunction: "notification-dispatch",
        sourceEventType: event_type,
        channel: "email",
        orgId: orgIdForAudit,
      });
      skipped.push({ channel: "email", reason: "email_disabled" });
    }

    // Slack dispatch (if webhook configured)
    const slackWebhook = settings.slackWebhook as string;
    if (slackWebhook && slackWebhook.startsWith("https://hooks.slack.com/")) {
      try {
        const slackRes = await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*[${event_type}]* ${subject || "Alert"}\n${message}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*:rotating_light: ${subject || event_type}*\n${message}`,
                },
              },
              ...(metadata ? [{
                type: "context",
                elements: [{
                  type: "mrkdwn",
                  text: `Event: \`${event_type}\` | Time: ${new Date().toISOString()}`,
                }],
              }] : []),
            ],
          }),
        });
        if (slackRes.ok) {
          dispatched.push("slack");
        } else {
          console.error("[notification-dispatch] Slack error:", await slackRes.text());
          await recordNotificationSkipped(supabase, {
            reason: "dispatcher_unavailable",
            sourceFunction: "notification-dispatch",
            sourceEventType: event_type,
            channel: "slack",
            orgId: orgIdForAudit,
            extra: { http_status: slackRes.status },
          });
          skipped.push({ channel: "slack", reason: "dispatcher_unavailable" });
        }
      } catch (slackErr) {
        console.error("[notification-dispatch] Slack dispatch failed:", slackErr);
        await recordNotificationSkipped(supabase, {
          reason: "dispatcher_unavailable",
          sourceFunction: "notification-dispatch",
          sourceEventType: event_type,
          channel: "slack",
          orgId: orgIdForAudit,
          extra: { error: slackErr instanceof Error ? slackErr.message : String(slackErr) },
        });
        skipped.push({ channel: "slack", reason: "dispatcher_unavailable" });
      }
    } else {
      // No Slack webhook configured
      await recordNotificationSkipped(supabase, {
        reason: "slack_not_configured",
        sourceFunction: "notification-dispatch",
        sourceEventType: event_type,
        channel: "slack",
        orgId: orgIdForAudit,
      });
      skipped.push({ channel: "slack", reason: "slack_not_configured" });
    }


    // Audit log the dispatch
    await supabase.from("audit_logs").insert({
      org_id: (metadata?.org_id as string) || "00000000-0000-0000-0000-000000000000",
      entity_type: "notification",
      action: "notification.dispatched",
      metadata: {
        event_type,
        channels: dispatched,
        skipped,
        subject,
        subject_length: subject != null ? subject.length : null,
        defensive_truncation_fired: defensiveTruncationFired,
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({ ok: true, dispatched, skipped, event_type }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[notification-dispatch] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});
