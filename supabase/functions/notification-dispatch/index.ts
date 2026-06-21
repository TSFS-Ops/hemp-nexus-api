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
import { resolveAdminRecipients } from "../_shared/admin-recipients.ts";

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
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

    // ── Batch C Phase 3A: progression notification suppression ──
    // Any notification whose event_type begins with `progression.` and is
    // scoped to a `match_id` is suppressed while that match has an open
    // (or under-review) challenge. Suppression writes a stable audit row
    // (`challenge.progression_notification_suppressed`); if the audit
    // insert fails we FAIL CLOSED for that notification — it is the only
    // trace that suppression occurred. Suppressed notifications are NOT
    // replayed after closure; fresh progression notifications generated
    // afterwards may dispatch normally.
    if (typeof event_type === "string" && event_type.startsWith("progression.")) {
      const matchIdRaw = (metadata?.match_id ?? metadata?.matchId) as
        | string
        | undefined;
      if (matchIdRaw) {
        const { data: openChallenge, error: chErr } = await supabase
          .from("match_challenges")
          .select("id, status")
          .eq("match_id", matchIdRaw)
          .in("status", ["open", "under_review"])
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (chErr) {
          console.error(
            "[notification-dispatch] Challenge lookup failed; failing closed:",
            chErr,
          );
          return new Response(
            JSON.stringify({
              ok: false,
              error: "challenge_lookup_failed",
              event_type,
            }),
            { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
          );
        }

        if (openChallenge) {
          const intendedRecipientGroup =
            (metadata?.intended_recipient_group as string | undefined) ??
            (metadata?.recipient_group as string | undefined) ??
            "unspecified";

          const { error: auditErr } = await supabase.from("audit_logs").insert({
            org_id: orgIdForAudit ?? "00000000-0000-0000-0000-000000000000",
            entity_type: "match_challenge",
            entity_id: openChallenge.id,
            action: "challenge.progression_notification_suppressed",
            metadata: {
              match_id: matchIdRaw,
              challenge_id: openChallenge.id,
              challenge_status: openChallenge.status,
              notification_type: event_type,
              intended_recipient_group: intendedRecipientGroup,
              suppressed_at: new Date().toISOString(),
            },
          });

          if (auditErr) {
            // FAIL CLOSED: without the audit, suppression is invisible.
            console.error(
              "[notification-dispatch] Suppression audit insert failed; failing closed:",
              auditErr,
            );
            return new Response(
              JSON.stringify({
                ok: false,
                error: "suppression_audit_failed",
                event_type,
              }),
              { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
            );
          }

          return new Response(
            JSON.stringify({
              ok: true,
              suppressed: true,
              reason: "challenge_open",
              challenge_id: openChallenge.id,
              challenge_status: openChallenge.status,
              event_type,
            }),
            { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Email dispatch via Resend (if configured)
    if (settings.emailAlerts) {
      // Batch M Fix 5: resolve recipients by role policy. Never hardcode
      // admin@izenzo.co.za. Never route platform-admin alerts to org_member.
      const routing = await resolveAdminRecipients(supabase, event_type);
      const resendKey = Deno.env.get("RESEND_API_KEY");

      if (routing.routingFailed || routing.recipients.length === 0) {
        await recordNotificationSkipped(supabase, {
          reason: "admin_routing_failed",
          sourceFunction: "notification-dispatch",
          sourceEventType: event_type,
          channel: "email",
          orgId: orgIdForAudit,
          extra: {
            policy_key: routing.policy.policyKey,
            primary_role: routing.policy.primary,
            fallback_role: routing.policy.fallback,
          },
        });
        skipped.push({ channel: "email", reason: "admin_routing_failed" });
      } else if (!resendKey) {
        await recordNotificationSkipped(supabase, {
          reason: "dispatcher_unavailable",
          sourceFunction: "notification-dispatch",
          sourceEventType: event_type,
          channel: "email",
          orgId: orgIdForAudit,
          extra: { detail: "RESEND_API_KEY not configured" },
        });
        skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
      } else {
        for (const recip of routing.recipients) {
          if (!recip.email) continue;
          let dispatchStatus: "dispatched" | "failed" = "failed";
          let errMsg: string | null = null;
          try {
            const emailRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${resendKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "Izenzo Alerts <alerts@notify.izenzo.co.za>",
                to: [recip.email],
                subject: subject || `[Alert] ${event_type}`,
                text:
                  `${message}\n\nEvent: ${event_type}\nTime: ${new Date().toISOString()}\n` +
                  (metadata ? `\nDetails: ${JSON.stringify(metadata, null, 2)}` : ""),
              }),
            });
            if (emailRes.ok) {
              dispatchStatus = "dispatched";
              dispatched.push("email");
            } else {
              errMsg = `http_${emailRes.status}`;
              await recordNotificationSkipped(supabase, {
                reason: "dispatcher_unavailable",
                sourceFunction: "notification-dispatch",
                sourceEventType: event_type,
                channel: "email",
                orgId: orgIdForAudit,
                recipientId: recip.userId,
                recipientEmail: recip.email,
                extra: { http_status: emailRes.status, role: recip.role },
              });
              skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
            }
          } catch (emailErr) {
            errMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
            await recordNotificationSkipped(supabase, {
              reason: "dispatcher_unavailable",
              sourceFunction: "notification-dispatch",
              sourceEventType: event_type,
              channel: "email",
              orgId: orgIdForAudit,
              recipientId: recip.userId,
              recipientEmail: recip.email,
              extra: { error: errMsg, role: recip.role },
            });
            skipped.push({ channel: "email", reason: "dispatcher_unavailable" });
          }

          // Persist per-recipient dispatch row with role + policy.
          try {
            await supabase.from("notification_dispatches").insert({
              event_type,
              reference_type: "admin_alert",
              reference_id: crypto.randomUUID(),
              recipient_user_id: recip.userId,
              recipient_address: recip.email,
              recipient_role: recip.role,
              routing_policy_key: routing.policy.policyKey,
              channel: "email",
              status: dispatchStatus === "dispatched" ? "dispatched" : "failed",
              dispatched_at: dispatchStatus === "dispatched" ? new Date().toISOString() : null,
              failed_at: dispatchStatus === "failed" ? new Date().toISOString() : null,
              error_message: errMsg,
              metadata: {
                policy_fallback: recip.fallback,
                event_type,
              },
            });
          } catch (insErr) {
            console.error("[notification-dispatch] dispatch insert failed", insErr);
          }
        }
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
