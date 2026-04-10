/**
 * infra-alerts - Checks platform health metrics and dispatches alerts
 * when thresholds are exceeded.
 *
 * Designed to be called by pg_cron every 5 minutes.
 *
 * Thresholds (from infrastructure-requirements.md §8):
 *  - /healthz != 200 for 2+ consecutive checks → page on-call
 *  - Collapse error rate > 5% in 5-min window → alert
 *  - API P95 response time > 2000ms → alert
 *  - Webhook delivery failure rate > 10% over 1 hour → alert
 *  - Rate limit rejections spike > 100/min → alert
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";

interface AlertPayload {
  metric: string;
  threshold: string;
  actual: string;
  severity: "warning" | "critical";
  details?: string;
}

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const alerts: AlertPayload[] = [];
  const now = new Date();

  // ── 1. Health check ──────────────────────────────────────────────
  try {
    const healthRes = await fetch(`${supabaseUrl}/functions/v1/healthz`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });

    if (healthRes.status !== 200) {
      alerts.push({
        metric: "Platform Health",
        threshold: "HTTP 200",
        actual: `HTTP ${healthRes.status}`,
        severity: "critical",
        details: `healthz returned ${healthRes.status}. Platform may be degraded or down.`,
      });
    }

    const healthBody = await healthRes.json();
    if (healthBody.status === "unhealthy") {
      const unhealthyChecks = (healthBody.checks || [])
        .filter((c: any) => c.status === "unhealthy")
        .map((c: any) => c.name)
        .join(", ");
      alerts.push({
        metric: "Subsystem Health",
        threshold: "All healthy",
        actual: `Unhealthy: ${unhealthyChecks}`,
        severity: "critical",
        details: `Subsystems reporting unhealthy: ${unhealthyChecks}`,
      });
    }
  } catch (err) {
    alerts.push({
      metric: "Health Check Reachability",
      threshold: "Reachable",
      actual: "Unreachable",
      severity: "critical",
      details: err instanceof Error ? err.message : "healthz fetch failed",
    });
  }

  // ── 2. API error rate (5-min window) ─────────────────────────────
  try {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    const { count: totalCount } = await supabase
      .from("api_request_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", fiveMinAgo);

    const { count: errorCount } = await supabase
      .from("api_request_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", fiveMinAgo)
      .gte("status_code", 500);

    const total = totalCount ?? 0;
    const errors = errorCount ?? 0;

    if (total > 10) {
      const errorRate = (errors / total) * 100;
      if (errorRate > 5) {
        alerts.push({
          metric: "API 5xx Error Rate (5 min)",
          threshold: "≤ 5%",
          actual: `${errorRate.toFixed(1)}% (${errors}/${total})`,
          severity: errorRate > 20 ? "critical" : "warning",
        });
      }

      // P95 response time
      const { data: p95Data } = await supabase
        .from("api_request_logs")
        .select("response_time_ms")
        .gte("created_at", fiveMinAgo)
        .order("response_time_ms", { ascending: false })
        .limit(Math.max(1, Math.ceil(total * 0.05)));

      if (p95Data && p95Data.length > 0) {
        const p95 = p95Data[p95Data.length - 1]?.response_time_ms ?? 0;
        if (p95 > 2000) {
          alerts.push({
            metric: "API P95 Response Time",
            threshold: "≤ 2000ms",
            actual: `${p95}ms`,
            severity: p95 > 5000 ? "critical" : "warning",
          });
        }
      }
    }
  } catch (err) {
    console.error("API error rate check failed:", err);
  }

  // ── 3. Webhook delivery failures (1-hour window) ─────────────────
  try {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const { count: webhookTotal } = await supabase
      .from("webhook_delivery_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneHourAgo);

    const { count: webhookFails } = await supabase
      .from("webhook_delivery_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneHourAgo)
      .neq("status", "success");

    const wTotal = webhookTotal ?? 0;
    const wFails = webhookFails ?? 0;

    if (wTotal > 5) {
      const failRate = (wFails / wTotal) * 100;
      if (failRate > 10) {
        alerts.push({
          metric: "Webhook Delivery Failure Rate (1 hr)",
          threshold: "≤ 10%",
          actual: `${failRate.toFixed(1)}% (${wFails}/${wTotal})`,
          severity: failRate > 50 ? "critical" : "warning",
        });
      }
    }
  } catch (err) {
    console.error("Webhook failure check failed:", err);
  }

  // ── 4. Rate limit rejection spike ────────────────────────────────
  try {
    const oneMinAgo = new Date(now.getTime() - 60 * 1000).toISOString();

    const { count: rateLimitCount } = await supabase
      .from("api_request_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneMinAgo)
      .eq("status_code", 429);

    const rlCount = rateLimitCount ?? 0;
    if (rlCount > 100) {
      alerts.push({
        metric: "Rate Limit Rejections (1 min)",
        threshold: "≤ 100",
        actual: `${rlCount}`,
        severity: rlCount > 500 ? "critical" : "warning",
      });
    }
  } catch (err) {
    console.error("Rate limit check failed:", err);
  }

  // ── Dispatch alerts ──────────────────────────────────────────────
  if (alerts.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, message: "All metrics within thresholds", checked_at: now.toISOString() }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  // Log alerts to admin_audit_logs
  for (const alert of alerts) {
    await supabase.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: `infra.alert.${alert.severity}`,
      target_type: "metric",
      target_id: alert.metric,
      details: alert,
    }).then(() => {}, (err: unknown) => console.error("Audit log insert failed:", err));
  }

  // Fetch notification settings for email dispatch
  const { data: settingsRow } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "notifications")
    .single();

  // Default emailAlerts to true so alerts fire even before admin configures settings
  const settings = (settingsRow?.value as Record<string, unknown>) || { emailAlerts: true };
  if (settings.emailAlerts === undefined) settings.emailAlerts = true;
  const dispatched: string[] = ["audit_log"];

  // Email via Resend (if configured)
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (lovableApiKey && resendApiKey && settings.emailAlerts) {
    const criticalCount = alerts.filter(a => a.severity === "critical").length;
    const subject = criticalCount > 0
      ? `🚨 CRITICAL: ${criticalCount} infrastructure alert${criticalCount > 1 ? "s" : ""} — Izenzo Platform`
      : `⚠️ WARNING: ${alerts.length} infrastructure alert${alerts.length > 1 ? "s" : ""} — Izenzo Platform`;

    const alertRows = alerts.map(a =>
      `<tr>
        <td style="padding:8px;border:1px solid #ddd;font-weight:bold">${a.metric}</td>
        <td style="padding:8px;border:1px solid #ddd">${a.threshold}</td>
        <td style="padding:8px;border:1px solid #ddd;color:${a.severity === 'critical' ? '#dc2626' : '#d97706'}">${a.actual}</td>
        <td style="padding:8px;border:1px solid #ddd">${a.severity.toUpperCase()}</td>
      </tr>`
    ).join("");

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#111">Izenzo Infrastructure Alert</h2>
        <p>The following metrics have exceeded their thresholds:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Metric</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Threshold</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Actual</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Severity</th>
            </tr>
          </thead>
          <tbody>${alertRows}</tbody>
        </table>
        <p style="color:#666;font-size:12px">
          Checked at ${now.toISOString()} • Izenzo Sovereign Infrastructure
        </p>
      </div>
    `;

    try {
      const emailRes = await fetch(`${RESEND_GATEWAY}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": resendApiKey,
        },
        body: JSON.stringify({
          from: "Izenzo Alerts <alerts@notify.izenzo.co.za>",
          to: [(settings.alertEmail as string) || "ops@izenzo.co.za"],
          subject,
          html,
        }),
      });
      if (emailRes.ok) dispatched.push("email");
      await emailRes.text(); // consume body
    } catch (err) {
      console.error("Email dispatch failed:", err);
    }
  }

  // Slack webhook (if configured)
  if (settings.slackWebhook && typeof settings.slackWebhook === "string" && settings.slackWebhook.startsWith("https://")) {
    const slackText = alerts.map(a =>
      `${a.severity === "critical" ? "🚨" : "⚠️"} *${a.metric}*: ${a.actual} (threshold: ${a.threshold})`
    ).join("\n");

    try {
      const slackRes = await fetch(settings.slackWebhook as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Izenzo Infrastructure Alert\n${slackText}` }),
      });
      if (slackRes.ok) dispatched.push("slack");
      await slackRes.text();
    } catch (err) {
      console.error("Slack dispatch failed:", err);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      alerts_fired: alerts.length,
      alerts,
      dispatched,
      checked_at: now.toISOString(),
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
});
