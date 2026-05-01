import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { checkMaintenanceMode } from "../_shared/test-mode-bypass.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Stage 2A CORS hardening (2026-05-01): replaced local wildcard `corsHeaders`
// with the shared `_shared/cors.ts` helper. This stub keeps the existing
// `{ ...corsHeaders, "Content-Type": "application/json" }` spreads producing
// a valid Content-Type header; CORS headers are attached at the wrapper.
const corsHeaders = { "Content-Type": "application/json" } as Record<string, string>;

const inviteEmailSchema = z.object({
  email: z.string().email().max(255),
  role: z.string().max(50),
  org_name: z.string().max(200),
  inviter_name: z.string().max(200).optional(),
  signup_url: z.string().url().max(2048),
});

// Simple in-memory rate limiting per email
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(email);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(email, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  return withCors(req, await _serve(req));
});

async function _serve(req: Request): Promise<Response> {

  try {
    if (req.method === "POST") {
      try { assertIdempotencyKey(req); } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.statusCode || 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    // Authenticate caller
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Maintenance gate (platform admins are exempt) ──
    const maintenance = await checkMaintenanceMode(supabase, {
      source: "send-team-invite",
      actorUserId: user.id,
      action: "send_team_invite",
    });
    if (maintenance.blocked) {
      return new Response(
        JSON.stringify({
          error: "Service temporarily unavailable — platform is in maintenance mode.",
          code: "MAINTENANCE_MODE",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Server-side role enforcement ──
    // The client-side ALLOWED_INVITE_ROLES guard is bypassable. Verify the caller
    // actually holds org_admin or platform_admin via user_roles.
    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roleNames = (callerRoles || []).map((r: { role: string }) => r.role);
    const canInvite = roleNames.includes("org_admin") || roleNames.includes("platform_admin");
    if (!canInvite) {
      console.warn(`[send-team-invite] Forbidden: user ${user.id} attempted invite without admin role`);
      return new Response(JSON.stringify({ error: "Only organisation admins can send invitations." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate input
    const body = await req.json();
    const parsed = inviteEmailSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.issues }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, role, org_name, inviter_name, signup_url } = parsed.data;

    // ── Validate signup_url is on a trusted host ──
    // Prevents the platform's branded transactional template from carrying a
    // phishing link to attacker-controlled infrastructure.
    const ALLOWED_HOSTS = [
      "izenzo.co.za",
      "www.izenzo.co.za",
      "compliance-matching.lovable.app",
    ];
    let signupHost: string;
    try {
      signupHost = new URL(signup_url).hostname.toLowerCase();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid signup_url." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hostAllowed =
      ALLOWED_HOSTS.includes(signupHost) ||
      signupHost.endsWith(".izenzo.co.za") ||
      signupHost.endsWith(".lovable.app");
    if (!hostAllowed) {
      console.warn(`[send-team-invite] Rejected signup_url host: ${signupHost}`);
      return new Response(JSON.stringify({ error: "signup_url must point to an Izenzo domain." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Validate org_name matches caller's actual organisation ──
    // Prevents impersonation of any org name in the email subject/body.
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.org_id) {
      return new Response(JSON.stringify({ error: "Caller has no organisation." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", profile.org_id)
      .maybeSingle();
    const actualOrgName = orgRow?.name?.trim() ?? "";
    if (!actualOrgName || actualOrgName.toLowerCase() !== org_name.trim().toLowerCase()) {
      console.warn(
        `[send-team-invite] org_name mismatch: caller-org="${actualOrgName}" supplied="${org_name}"`,
      );
      return new Response(
        JSON.stringify({ error: "org_name does not match your organisation on record." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit
    if (!checkRateLimit(email)) {
      return new Response(JSON.stringify({ error: "Too many invitations sent to this email. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roleDisplay = role === "org_admin" ? "Admin" : "Member";
    const inviterDisplay = inviter_name || "A team member";

    const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="padding:40px 32px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">You've been invited to join ${escapeHtml(org_name)}</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#71717a;line-height:1.6;">
            ${escapeHtml(inviterDisplay)} has invited you to join <strong>${escapeHtml(org_name)}</strong> on izenzo as a <strong>${roleDisplay}</strong>.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background-color:#09090b;border-radius:8px;padding:12px 28px;">
              <a href="${escapeHtml(signup_url)}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">
                Accept Invitation
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;line-height:1.5;">
            If you don't have an account yet, clicking the link above will take you to sign up. Your invitation will be applied automatically.
          </p>
          <p style="margin:0;font-size:13px;color:#a1a1aa;line-height:1.5;">
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background-color:#fafafa;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">
            izenzo · Trusted commodity trade infrastructure
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "izenzo <noreply@izenzo.co.za>",
        to: [email],
        subject: clampSubject(`${inviterDisplay} invited you to join ${org_name} on izenzo`),
        html: htmlContent,
      }),
    });

    if (!resendRes.ok) {
      const errorBody = await resendRes.text();
      console.error(`[send-team-invite] Resend error ${resendRes.status}:`, errorBody);
      throw new Error(`Email delivery failed: ${resendRes.status}`);
    }

    const result = await resendRes.json();
    console.log(`[send-team-invite] Sent to ${email} for org ${org_name}, resend_id: ${result.id}`);

    return new Response(JSON.stringify({ success: true, email_id: result.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-team-invite] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}