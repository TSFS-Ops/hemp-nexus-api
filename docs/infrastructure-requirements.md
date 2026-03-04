# Infrastructure Requirements

This document covers infrastructure-level concerns that sit outside application logic but are critical for production deployment.

---

## 1. Cross-Region Replication & RPO=0

### Current State
- The platform enforces **consistency over availability** (CAP theorem) — the collapse engine returns `503 Service Unavailable` if database connectivity is lost.
- The `/healthz` endpoint probes database write availability and reports partition state.

### Requirements for RPO=0
RPO=0 (zero data loss) is **infrastructure-dependent** and requires:

| Component | Recommendation |
|-----------|---------------|
| **Database replication** | Supabase uses PostgreSQL streaming replication. For RPO=0, ensure synchronous replication is enabled in your hosting tier. |
| **Multi-region** | Deploy read replicas in secondary regions. Write path must remain single-primary to preserve consistency. |
| **Backup strategy** | Point-in-time recovery (PITR) with WAL archiving. Supabase Pro plan includes PITR. |

### Health Check Endpoint
The `/healthz` endpoint includes a partition probe that:
1. Attempts a write to detect connectivity issues
2. Reports `503` if partition is detected
3. Measures response time per subsystem

**Recommended monitoring**: Poll `/healthz` every 30s from an external monitor (e.g. UptimeRobot, Datadog).

---

## 2. WAF & Circuit Breaker

### Web Application Firewall (WAF)
WAF is an **infrastructure concern** — deploy at the CDN/gateway layer, not in application code.

**Recommended deployment**:

| Provider | Configuration |
|----------|---------------|
| **Cloudflare** | Enable WAF rules, rate limiting, bot detection. Set custom rules for `/functions/v1/collapse` (critical path). |
| **AWS CloudFront + WAF** | Attach WAF ACL with managed rule groups (SQL injection, XSS, known bad inputs). |
| **Vercel/Netlify** | Use built-in DDoS protection + edge middleware for rate limiting. |

**Application-level protections already implemented**:
- Per-endpoint rate limiting (`rate_limits` table + `checkRateLimit`)
- Request body size limits (1 MB max on collapse)
- UUID validation on all ID parameters
- Input sanitisation via Zod schemas
- Auth rate limiting with exponential backoff (`auth_rate_limits`)

### Circuit Breaker Pattern
The collapse engine implements a **soft circuit breaker** via:
1. **Partition health check** before every collapse write
2. **Global freeze** via `admin_settings.collapse_freeze` (break-glass protocol)
3. **Org-level freeze** via `organizations.frozen` flag

For a full circuit breaker (automatic trip on error threshold), implement at the API gateway level:
```yaml
# Example: Kong circuit breaker plugin
plugins:
  - name: circuit-breaker
    config:
      error_threshold: 5
      window_size: 60
      half_open_timeout: 30
      excluded_status_codes: [400, 401, 403, 404, 422]
```

---

## 3. Cold Storage Archival Pipeline

### Design: Post-7-Year Record Archival

Records exceeding the 7-year BRD retention requirement should be archived to cold storage rather than deleted, preserving audit trail integrity.

#### Pipeline Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  data-retention  │───▶│  retention_flags  │───▶│  archival job   │
│  (daily cron)    │    │  table            │    │  (weekly cron)  │
└─────────────────┘    └──────────────────┘    └────────┬────────┘
                                                         │
                                                         ▼
                                              ┌─────────────────┐
                                              │  Cold Storage    │
                                              │  (S3/GCS bucket) │
                                              └─────────────────┘
```

#### Step 1: Flag (Implemented)
The `data-retention` edge function runs daily and flags records in `retention_flags`:
- `approaching_expiry` — within 90 days of the 7-year mark
- `expired` — past the 7-year mark

#### Step 2: Archive (To Implement)
Create an archival edge function that:
1. Queries `retention_flags WHERE flag_type = 'expired' AND archived_at IS NULL`
2. For each record:
   a. Export the full record as JSON (including all related records)
   b. Compute SHA-256 hash of the archive payload
   c. Upload to cold storage bucket with metadata
   d. Update `retention_flags.archived_at = now()`
3. **Do NOT delete** the original record — mark it as archived

#### Step 3: Cold Storage Target

| Option | Pros | Cons |
|--------|------|------|
| **Supabase Storage** (private bucket) | Simple, same platform | Not true cold storage, costs more at scale |
| **AWS S3 Glacier** | Cheapest long-term, compliance-ready | Separate infra, retrieval latency |
| **GCS Coldline** | Good balance of cost and access time | Separate infra |
| **Azure Blob Archive** | Compliance certifications | Retrieval can take hours |

**Recommended**: Start with a private Supabase Storage bucket (`archived-records`), migrate to S3 Glacier when volume justifies it.

#### Step 4: Retrieval
Archived records should be retrievable via:
- Admin panel search (queries `retention_flags` + fetches from cold storage)
- API endpoint with admin-only access
- Maximum retrieval SLA: 24 hours for Glacier, instant for Supabase Storage

---

## 4. Monitoring & Alerting Checklist

| Metric | Threshold | Action |
|--------|-----------|--------|
| `/healthz` response | `!= 200` for 2 minutes | Page on-call |
| Collapse error rate | `> 5%` in 5-minute window | Alert Slack channel |
| API response time P95 | `> 2000ms` | Alert + investigate |
| Retention flags `expired` count | `> 0` | Trigger archival pipeline |
| Webhook delivery failure rate | `> 10%` over 1 hour | Alert + check webhook-retry |
| Database connection pool | `> 80%` utilisation | Scale up |
| Rate limit rejections | Spike `> 100/min` | Investigate potential abuse |

---

## 5. Deployment Checklist

- [ ] WAF enabled at CDN layer with rules for `/functions/v1/collapse`
- [ ] Health check monitoring configured (30s interval)
- [ ] Database PITR enabled (Supabase Pro)
- [ ] `data-retention` cron job scheduled (daily at 2 AM UTC)
- [ ] Cold storage bucket created for archival
- [ ] Alert channels configured for all metrics above
- [ ] Screening provider configured via admin_settings (`screening_provider`)
- [ ] NTP source documented for timestamp audit trail
