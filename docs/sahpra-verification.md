# SAHPRA License Verification System

## Overview
This system verifies South African Health Products Regulatory Authority (SAHPRA) licenses for organizations in SignalRank. SignalRank backend is the source of truth for all verification logic and data.

## Architecture

**SignalRank Backend (Source of Truth)**
- Owns the connector, verification logic, storage, and API
- Daily CSV ingestion from Google Sheet cached in `sahpra_licenses` table
- Provides verification API protected by `BST3_API_KEY`
- Auto-runs verification during signal creation
- Optional enforcement toggle via `REQUIRE_BUYER_VERIFIED` environment variable

## Components

### 1. **sahpra-verification** Edge Function
Handles verification logic and CSV caching.

**Endpoints:**
- `GET /sahpra-verification/refresh` - Manually refresh CSV cache (internal only)
- `POST /v1/verify/sahpra` - Verify a company (protected by BST3_API_KEY)

**Request Example:**
```json
POST /v1/verify/sahpra
Headers:
  X-API-Key: <BST3_API_KEY>
  Content-Type: application/json

Body:
{
  "companyName": "Example Pharma Ltd",
  "licenceNo": "12345678" // optional - requires exact match if provided
}
```

**Response:**
```json
{
  "verified": true,
  "match": {
    "company_name": "Example Pharma Ltd",
    "licence_no": "12345678",
    "licence_type": "Wholesale",
    "responsible_pharmacist": "John Doe",
    "province": "Gauteng",
    "date_issued": "2020-01-15",
    "expiry_date": "2025-01-15"
  },
  "reason": "Valid SAHPRA licence found",
  "checkedAt": "2025-01-14T10:30:00.000Z"
}
```

### 2. **sahpra-refresh** Edge Function
Scheduled cron job that runs daily at 2 AM UTC to refresh the license cache.

### 3. **Database Tables**

**sahpra_licenses** - Cached SAHPRA license data
- `company_name` - Company name
- `company_name_norm` - Normalized company name for fuzzy matching
- `licence_no` - License number (unique)
- `licence_type` - Type of license
- `responsible_pharmacist` - Name of pharmacist
- `province` - SA province
- `date_issued` - Issue date
- `expiry_date` - Expiry date

**organizations** - Extended with verification fields
- `sahpra_verified` (boolean) - Verification status
- `sahpra_verification_data` (jsonb) - Matched license data
- `sahpra_verified_at` (timestamp) - Last verification time
- `sahpra_licence_no` (text) - Quick reference to licence number

## How It Works

### Automatic Verification During Signal Creation
When `POST /v1/signals` is called:
1. **Optional Enforcement Check**: If `REQUIRE_BUYER_VERIFIED=true`, rejects unverified/stale buyers with 403 `BUYER_NOT_VERIFIED`
2. **Create Signal**: Signal is created in database
3. **Run Verification**: System checks if organization verification is stale (> 24 hours)
   - If stale or missing, calls SAHPRA verification endpoint
   - If fresh (< 24 hours), uses cached result
4. **Fuzzy Match**: Performs fuzzy matching (≥90% similarity) on company names using normalized fields
5. **Exact Match**: If `licenceNo` is provided, requires exact match
6. **Expiry Check**: Verifies that license hasn't expired
7. **Persist Results**: Stores verification result on organization record
8. **Return Response**: Includes verification status in response:
```json
{
  "signalId": "...",
  "options": [],
  "verification": {
    "sahpra": {
      "verified": true,
      "checkedAt": "2025-01-14T10:30:00.000Z",
      "licenceNo": "12345678",
      "reason": "Valid SAHPRA licence found"
    }
  }
}
```

### Fuzzy Matching
The system uses Levenshtein distance to match company names:
- Normalizes both names (lowercase, removes punctuation, trims whitespace)
- Precomputes `company_name_norm` field during CSV ingestion for performance
- Calculates similarity score (0.0 to 1.0)
- Requires ≥0.9 (90%) similarity for a match
- Returns the best match found

### CSV Cache
- CSV is downloaded from `CONNECTOR_SAHPRA_URL` (configured via secret)
- Normalized company names are precomputed and indexed
- Cache is refreshed daily at 2 AM UTC via cron job
- Manual refresh available via `/sahpra-verification/refresh` endpoint

## Configuration

### Required Secrets
- `CONNECTOR_SAHPRA_URL` - URL to download SAHPRA CSV file
- `BST3_API_KEY` - API key for protecting verification endpoint

### Optional Environment Variables
- `REQUIRE_BUYER_VERIFIED` - Set to `"true"` to enforce verification before signal creation (default: not enforced)

### CSV Format
The CSV should have these columns (exact names may vary):
- Company Name / company_name
- Licence No / licence_no
- Licence Type / licence_type
- Responsible Pharmacist / responsible_pharmacist
- Province / province
- Date Issued / date_issued
- Expiry Date / expiry_date

## Security
- All secret values (URLs, keys) are never logged
- Edge functions use service role key for database access
- Verification endpoint protected by `BST3_API_KEY`
- CSV refresh endpoint is internal only (no API key required)
- Cached verification results valid for 24 hours to reduce load

## Testing

### Manual CSV Refresh
```bash
curl -X GET https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/sahpra-verification/refresh \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Verify a Company (Protected Endpoint)
```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/verify/sahpra \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_BST3_API_KEY" \
  -d '{
    "companyName": "Test Company",
    "licenceNo": "12345678"
  }'
```

### Create Signal (Includes Verification)
```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/signals \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_BST3_API_KEY" \
  -d '{
    "product": "Medical supplies",
    "quantity": 100,
    "unit": "boxes"
  }'
```
