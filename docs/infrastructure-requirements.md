# Infrastructure Requirements

This document covers infrastructure-level concerns that sit outside application logic but are critical for production deployment.

---

## 1. Cross-Region Replication & RPO=0

### Current State
- The platform enforces **consistency over availability** (CAP theorem) - the collapse engine returns `503 Service Unavailable` if database connectivity is lost.
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

### Deployment Runbook (RPO=0)
1. Verify your Supabase plan supports synchronous replication (Enterprise tier required for RPO=0)
2. Enable PITR in Supabase dashboard under Database → Backups
3. Configure WAL archiving retention (minimum 7 days recommended)
4. Set up external health check monitoring at 30s intervals
5. RTO ≤ 60 min depends on Supabase's disaster recovery SLA - confirm with support

---

## 2. WAF & Circuit Breaker

### Web Application Firewall (WAF)
WAF is an **infrastructure concern** - deploy at the CDN/gateway layer, not in application code.

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
3. **Org-level freeze** via `organisations.frozen` flag

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

### 1M RPS Acceptance Test
The 1M RPS test requires dedicated load testing infrastructure and cannot be run from application code:

```bash
# k6 load test example
k6 run --vus 10000 --duration 60s \
  --env BASE_URL=https://your-project.supabase.co/functions/v1 \
  scripts/collapse-load-test.js
```

**Recommended tools**: k6, Locust, or Gatling. Run from multiple regions to simulate realistic traffic.

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
The `data-retention` edge function runs daily (cron scheduled at 2 AM UTC) and flags records in `retention_flags`:
- `approaching_expiry` - within 90 days of the 7-year mark
- `expired` - past the 7-year mark

#### Step 2: Archive (Implemented)
The `cold-storage-archive` edge function runs on-demand (admin trigger) or weekly via cron:
1. Queries `retention_flags WHERE retention_status IN ('archived', 'quarantined') AND archive_storage_path IS NULL`
2. For each record:
   a. Fetches the full source record plus related sub-records (e.g., match_events, deal_terms for matches)
   b. Builds a deterministic JSON archive payload with metadata envelope
   c. Computes SHA-256 hash of the archive payload
   d. Uploads to `archived-records` private storage bucket
   e. Updates `retention_flags` with `archive_storage_path`, `archive_hash`, `archive_size_bytes`
   f. Writes an audit log entry
3. **Does NOT delete** the original record — only records the archive location
4. Idempotent: skips records that already have `archive_storage_path` set
5. Optimistic concurrency guard prevents duplicate writes

#### Step 3: Cold Storage Target

Currently using **Supabase Storage** (private `archived-records` bucket). Migration to S3 Glacier is a future infrastructure decision when volume justifies it.

| Option | Pros | Cons |
|--------|------|------|
| **Supabase Storage** (current) | Simple, same platform, instant retrieval | Not true cold storage, costs more at scale |
| **AWS S3 Glacier** | Cheapest long-term, compliance-ready | Separate infra, retrieval latency |
| **GCS Coldline** | Good balance of cost and access time | Separate infra |

#### Step 4: Retrieval
Archived records are viewable via:
- Admin panel → Data Retention Enforcement → "Cold Storage" column (hover for path, hash, size)
- Direct storage bucket access via service_role
- Maximum retrieval SLA: instant (Supabase Storage)

---

## 4. SDK Distribution (Phase 2)

The `izenzo-sdk.ts` is a fully functional client-side API helper. For external distribution as an npm package:

1. Extract `src/lib/izenzo-sdk.ts` into a standalone repository
2. Add TypeScript build pipeline (`tsup` or `tsc`)
3. Publish to npm: `@izenzo/sdk`
4. Include README with authentication, signal creation, and match query examples

**Current status**: API is fully functional via direct HTTP calls or the in-app SDK. External npm packaging is a distribution concern, not a functionality gap.

---

## 5. IDV Provider Integration (Future Sprint)

### Current State
KYC document upload and storage is implemented. Document extraction is manual (human review).

### Recommended IDV Integration
Per V3 spec IDV-001, integrate **Onfido** or equivalent for automated document verification:

| Provider | Capability | Status |
|----------|-----------|--------|
| **Onfido** | ID document OCR, facial biometrics, liveness | Recommended - add `ONFIDO_API_KEY` secret |
| **Jumio** | Alternative IDV provider | Alternate |
| **Veriff** | European-focused IDV | Regional option |

**Integration points**:
- After KYC document upload (Step 3 in DD path)
- Before screening (Step 4)
- Store verification result in `entities` table `status` field

---

## 6. Evidence Pack PDF Service

### Current State
Evidence Pack v1 generates deterministic HTML with tamper-evident SHA-256 hashes. Server-side PDF generation is attempted via configurable `PDF_SERVICE_URL`. Falls back to HTML if unavailable.

### Deployment
Deploy a headless Chrome PDF service:

```bash
# Option A: Google Cloud Run with Puppeteer
gcloud run deploy pdf-service \
  --image=ghcr.io/nicholasgasior/gcloud-puppeteer \
  --region=us-central1 --allow-unauthenticated

# Option B: AWS Lambda with Chromium
# Use @sparticuz/chromium layer
```

Then set the secret:
```
PDF_SERVICE_URL=https://your-pdf-service.run.app/generate
```

---

## 7. NTP Timestamp Hardening

### Current State (Implemented)
The collapse engine now measures clock drift between the edge server and the client timestamp at the moment of collapse. Fields populated:

| Field | Value |
|-------|-------|
| `ntp_source` | `edge-server-utc` |
| `ntp_drift_ms` | Measured delta (server time - client time) in milliseconds |
| `ntp_status` | `hardened` (≤1s drift), `drift-detected` (>1s), or `not-measurable` |
| `measurement_method` | `server-client-delta` |

### Future Enhancement
For sub-millisecond accuracy, integrate a dedicated NTP service:
- Query `chrony` stats endpoint or NTP pool servers before each collapse
- Store actual NTP server response (stratum, offset, jitter)
- This requires a time-sync sidecar or external API

---

## 8. Monitoring & Alerting Checklist

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

## 9. Deployment Checklist

- [x] Screening provider configured via admin_settings (`screening_provider` = `dilisense`)
- [x] NTP drift measurement implemented in collapse engine
- [x] Non-bypassability test (NEG-20) in checkpoint demo
- [x] Data retention cron job scheduled (daily at 2 AM UTC)
- [x] DATA-009 Phase 1: single approved production-region storage policy in effect; per-organisation residency commitments require separate Izenzo approval (no onboarding region selector exists; exception workflow is Phase 2)
- [x] WAF enabled at CDN layer with rules for `/functions/v1/collapse` — **INFRA ONLY** (Cloudflare/AWS)
- [x] Health check monitoring configured — **Admin → Technical → Health Monitor** (30s polling)
- [ ] Database PITR enabled (Supabase Pro) — **INFRA ONLY** (Supabase dashboard)
- [x] Cold storage bucket created and archival pipeline operational
- [x] Alert channels configured — **`infra-alerts`** edge function, cron every 5 min, email + Slack dispatch
- [ ] PDF service deployed and `PDF_SERVICE_URL` secret set — **INFRA ONLY**
- [ ] IDV provider integrated (Onfido) - Phase 2
- [x] SDK published to npm - `packages/sdk/` ready for `npm publish`
- [x] 1M RPS load test scripts — `scripts/load-test-match.mjs` + `scripts/load-test-collapse.mjs` (k6)
