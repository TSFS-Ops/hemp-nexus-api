# SAHPRA License Verification System

## Overview
This system verifies South African Health Products Regulatory Authority (SAHPRA) licenses for organizations in SignalRank.

## Components

### 1. **sahpra-verification** Edge Function
Handles verification logic and CSV caching.

**Endpoints:**
- `GET /sahpra-verification/refresh` - Manually refresh CSV cache
- `POST /sahpra-verification/verify` - Verify a company

**Request Example:**
```json
POST /sahpra-verification/verify
{
  "companyName": "Example Pharma Ltd",
  "licenceNo": "12345678" // optional
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
  "reason": "Valid SAHPRA licence found"
}
```

### 2. **sahpra-refresh** Edge Function
Scheduled cron job that runs daily at 2 AM UTC to refresh the license cache.

### 3. **Database Tables**

**sahpra_licenses** - Cached SAHPRA license data
- `company_name` - Company name
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

## How It Works

### Automatic Verification
When a signal is created:
1. The system checks if the organization has been verified in the last 24 hours
2. If not, it calls the SAHPRA verification endpoint with the organization name
3. The system performs fuzzy matching (≥90% similarity) on company names
4. If a `licenceNo` is provided, it requires an exact match
5. The system verifies that the license hasn't expired
6. Results are stored on the organization record

### Fuzzy Matching
The system uses Levenshtein distance to match company names:
- Normalizes both names (lowercase, removes punctuation, trims whitespace)
- Calculates similarity score (0.0 to 1.0)
- Requires ≥0.9 (90%) similarity for a match
- Returns the best match found

### CSV Cache
- CSV is downloaded from `CONNECTOR_SAHPRA_URL` (configured via secret)
- Cache is refreshed daily at 2 AM UTC via cron job
- Manual refresh available via `/sahpra-verification/refresh` endpoint

## Configuration

### Required Secrets
- `CONNECTOR_SAHPRA_URL` - URL to download SAHPRA CSV file

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
- CSV refresh requires authentication
- Public verification endpoint available for internal use

## Testing

### Manual CSV Refresh
```bash
curl -X GET https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/sahpra-verification/refresh \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Verify a Company
```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/sahpra-verification/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "companyName": "Test Company",
    "licenceNo": "12345678"
  }'
```
