import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { cacheHeaders } from "../_shared/cache.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

interface HealthCheckResult {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  responseTime?: number;
  details?: any;
}

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if request is authenticated AND caller has platform_admin role.
  // Platform-wide metrics (api_keys, signals, matches, webhook_endpoints,
  // api_request_logs aggregates) are restricted to platform_admin — any
  // other authenticated caller (regular user, org admin, API key) receives
  // the same minimal { status, timestamp } response as unauthenticated
  // callers to prevent platform-wide info leakage.
  const authHeader = req.headers.get("authorization") || req.headers.get("x-api-key");
  let isPlatformAdmin = false;

  if (authHeader) {
    try {
      const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
      isPlatformAdmin = Array.isArray(authCtx.roles) && authCtx.roles.includes("platform_admin");
    } catch {
      isPlatformAdmin = false;
    }
  }

  const checks: HealthCheckResult[] = [];
  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  // 1. Database connectivity check (always performed)
  const dbStart = Date.now();
  try {
    const { error } = await supabase.from("organizations").select("count").limit(1);
    const responseTime = Date.now() - dbStart;
    
    if (error) {
      checks.push({
        name: "database",
        status: "unhealthy",
        message: isPlatformAdmin ? error.message : "Database connection failed",
        responseTime
      });
      overallStatus = "unhealthy";
    } else {
      checks.push({
        name: "database",
        status: responseTime < 1000 ? "healthy" : "degraded",
        message: "Database connection successful",
        responseTime
      });
      if (responseTime >= 1000) overallStatus = "degraded";
    }
  } catch (error) {
    checks.push({
      name: "database",
      status: "unhealthy",
      message: isPlatformAdmin && error instanceof Error ? error.message : "Database check failed",
      responseTime: Date.now() - dbStart
    });
    overallStatus = "unhealthy";
  }

  // If not authenticated, return minimal response with only overall status
  if (!isPlatformAdmin) {
    return new Response(
      JSON.stringify({
        status: overallStatus,
        timestamp: new Date().toISOString(),
      }),
      {
        status: overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 207 : 503,
        headers: { "Content-Type": "application/json", ...headers, ...cacheHeaders("short") }
      }
    );
  }

  // === PLATFORM_ADMIN CHECKS BELOW ===
  // These expose platform-wide internal metrics (counts across all orgs,
  // recent error rates, webhook system status) and are restricted to
  // platform_admin only. Service role client is used to bypass RLS for
  // legitimate aggregate observability.

  // 2. Auth system check
  const authStart = Date.now();
  try {
    const { data, error } = await supabase.auth.getUser();
    const responseTime = Date.now() - authStart;
    
    checks.push({
      name: "auth_system",
      status: error ? "degraded" : "healthy",
      message: error ? "Auth check without token (expected)" : "Auth system operational",
      responseTime
    });
  } catch (error) {
    checks.push({
      name: "auth_system",
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Auth system error",
      responseTime: Date.now() - authStart
    });
    overallStatus = "unhealthy";
  }

  // 3. API Keys table check
  const apiKeysStart = Date.now();
  try {
    const { count, error } = await supabase
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");
    
    const responseTime = Date.now() - apiKeysStart;
    
    if (error) {
      checks.push({
        name: "api_keys_table",
        status: "unhealthy",
        message: error.message,
        responseTime
      });
      overallStatus = "unhealthy";
    } else {
      checks.push({
        name: "api_keys_table",
        status: "healthy",
        message: `${count || 0} active API keys`,
        responseTime,
        details: { activeKeys: count || 0 }
      });
    }
  } catch (error) {
    checks.push({
      name: "api_keys_table",
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - apiKeysStart
    });
    overallStatus = "unhealthy";
  }

  // 4. Signals table check
  const signalsStart = Date.now();
  try {
    const { count, error } = await supabase
      .from("signals")
      .select("*", { count: "exact", head: true });
    
    const responseTime = Date.now() - signalsStart;
    
    if (error) {
      checks.push({
        name: "signals_table",
        status: "unhealthy",
        message: error.message,
        responseTime
      });
      overallStatus = "unhealthy";
    } else {
      checks.push({
        name: "signals_table",
        status: "healthy",
        message: `${count || 0} total signals`,
        responseTime,
        details: { totalSignals: count || 0 }
      });
    }
  } catch (error) {
    checks.push({
      name: "signals_table",
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - signalsStart
    });
    overallStatus = "unhealthy";
  }

  // 5. Matches table check
  const matchesStart = Date.now();
  try {
    const { count, error } = await supabase
      .from("matches")
      .select("*", { count: "exact", head: true });
    
    const responseTime = Date.now() - matchesStart;
    
    if (error) {
      checks.push({
        name: "matches_table",
        status: "unhealthy",
        message: error.message,
        responseTime
      });
      overallStatus = "unhealthy";
    } else {
      checks.push({
        name: "matches_table",
        status: "healthy",
        message: `${count || 0} total matches`,
        responseTime,
        details: { totalMatches: count || 0 }
      });
    }
  } catch (error) {
    checks.push({
      name: "matches_table",
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - matchesStart
    });
    overallStatus = "unhealthy";
  }

  // 6. Recent API request logs check (performance indicator)
  const logsStart = Date.now();
  try {
    const { data, error } = await supabase
      .from("api_request_logs")
      .select("status_code, response_time_ms")
      .gte("created_at", new Date(Date.now() - 60000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    
    const responseTime = Date.now() - logsStart;
    
    if (error) {
      checks.push({
        name: "api_performance",
        status: "degraded",
        message: "Could not fetch recent logs",
        responseTime
      });
    } else if (data && data.length > 0) {
      const errorCount = data.filter(log => log.status_code >= 400).length;
      const avgResponseTime = data.reduce((sum, log) => sum + (log.response_time_ms || 0), 0) / data.length;
      
      const status = errorCount > data.length * 0.1 || avgResponseTime > 2000 ? "degraded" : "healthy";
      
      checks.push({
        name: "api_performance",
        status,
        message: `${data.length} requests in last minute`,
        responseTime,
        details: {
          requestsLastMinute: data.length,
          errorRate: `${((errorCount / data.length) * 100).toFixed(1)}%`,
          avgResponseTime: `${avgResponseTime.toFixed(0)}ms`
        }
      });
      
      if (status === "degraded" && overallStatus === "healthy") {
        overallStatus = "degraded";
      }
    } else {
      checks.push({
        name: "api_performance",
        status: "healthy",
        message: "No recent requests",
        responseTime
      });
    }
  } catch (error) {
    checks.push({
      name: "api_performance",
      status: "degraded",
      message: "Could not analyze performance",
      responseTime: Date.now() - logsStart
    });
  }

  // 7. Webhook system check
  const webhooksStart = Date.now();
  try {
    const { count, error } = await supabase
      .from("webhook_endpoints")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");
    
    const responseTime = Date.now() - webhooksStart;
    
    if (error) {
      checks.push({
        name: "webhook_system",
        status: "degraded",
        message: error.message,
        responseTime
      });
    } else {
      checks.push({
        name: "webhook_system",
        status: "healthy",
        message: `${count || 0} active webhooks`,
        responseTime,
        details: { activeWebhooks: count || 0 }
      });
    }
  } catch (error) {
    checks.push({
      name: "webhook_system",
      status: "degraded",
      message: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - webhooksStart
    });
  }

  const totalResponseTime = checks.reduce((sum, check) => sum + (check.responseTime || 0), 0);

  return new Response(
    JSON.stringify({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalResponseTime: `${totalResponseTime}ms`,
      checks,
      summary: {
        healthy: checks.filter(c => c.status === "healthy").length,
        degraded: checks.filter(c => c.status === "degraded").length,
        unhealthy: checks.filter(c => c.status === "unhealthy").length,
        total: checks.length
      }
    }, null, 2),
    {
      status: overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 207 : 503,
      headers: { "Content-Type": "application/json", ...headers, ...cacheHeaders("short") }
    }
  );
});
