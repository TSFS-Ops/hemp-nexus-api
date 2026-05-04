# Compliance Matching API Product Guide

**Last Updated**: 2025-12-06

---

## Overview

Compliance Matching API is a **B2B API platform** for verified trade intent in regulated sectors. The platform provides:

1. **Developer Portal** - Manage API keys, test endpoints, view analytics
2. **Compliance Matching API** - Create signals, record matches, track compliance events
3. **Admin Dashboard** - Manage users, organisations, and system settings

**Important Note**: This is an API platform with a developer portal, not an end-user marketplace. There are no buyer/seller listing pages, shopping carts, or public product catalogs.

---

## User Journeys

### 1. Developer Journey (API Integration)

This is the primary user journey for the platform.

#### Step 1: Sign Up & Verify Email

1. **Navigate** to the signup page
2. **Enter** email and password (min 8 characters)
3. **Check email** for verification link
4. **Click** verification link to activate account
5. **Redirected** to login page

**Why email verification?**  
Prevents spam and ensures legitimate organisations only.

---

#### Step 2: First Login

1. **Enter** verified email and password
2. **Redirected** to Dashboard

**What happens on first login?**
- Auto-creates organisation for your account
- Assigns you admin role
- Shows welcome guide with onboarding steps

---

#### Step 3: Create API Key

1. **Navigate** to Dashboard → API Keys tab
2. **Click** "Create API Key"
3. **Enter**:
   - Key name (e.g., "Production API")
   - Expiry period (Never, 30, 90, 180, 365 days)
   - Scopes (permissions)
4. **Click** "Create API Key"
5. **Copy** the generated key (shown only once!)
6. **Store** securely in your environment variables

**Recommended Scopes for Getting Started**:
- `signals:write` - Create buyer signals
- `signals:read` - View signal results
- `match:write` - Record matches
- `match:read` - View matches

---

#### Step 4: Test the API

1. **Navigate** to Dashboard → Testing tab
2. **Paste** your API key
3. **Try** the smoke tests (automated health checks)
4. **Test** the signal tester:
   - Enter product name
   - Set quantity and location
   - Click "Create Signal"
   - View returned options
5. **Test** the match tester:
   - Fill in buyer, seller, commodity details
   - Create match
   - View match with cryptographic hash

**What do the testers show?**
- Real API requests/responses
- Validation error messages
- Success indicators
- Response times

---

#### Step 5: Integrate with Your Application

1. **Navigate** to Dashboard → Documentation tab
2. **Review** API reference for your use case
3. **Implement** in your application using the API key
4. **Monitor** via Dashboard → Analytics tab

Example integration:

```javascript
// Create a buyer signal
const response = await fetch(
  'https://api.trade.izenzo.co.za/functions/v1/signals',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${YOUR_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      product: 'Industrial Equipment Parts',
      quantity: 10000,
      unit: 'units',
      location: 'Regional Hub'
    })
  }
);

const data = await response.json();
console.log('Signal created:', data.signal.id);
console.log('Matched options:', data.options);
```

---

#### Step 6: Set Up Webhooks (Optional)

1. **Navigate** to Dashboard → Create webhook endpoint
2. **Enter** your webhook URL
3. **Select** events to subscribe to
4. **Generate** or provide webhook secret
5. **Implement** webhook handler in your app
6. **Verify** webhook signatures for security

Example webhook handler:

```javascript
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  if (!verifySignature(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process event
  const { event, data } = req.body;
  console.log(`Received ${event}:`, data);
  
  res.status(200).send('OK');
});
```

---

#### Step 7: Monitor & Analyze

1. **Navigate** to Dashboard → Analytics tab
2. **View**:
   - API request volumes
   - Response times
   - Error rates
   - Most used endpoints
3. **Navigate** to Dashboard → Audit Logs tab
4. **Review**:
   - All API actions
   - Match creation events
   - API key usage
   - Webhook deliveries

---

#### Step 8: Automation Setup (Optional)

For production deployments, set up automated jobs:

1. **Navigate** to Dashboard → Automation tab
2. **Follow** the 3-step setup guide:
   - Enable pg_cron and pg_net extensions
   - Schedule webhook retry job (every 5 minutes)
   - Schedule API key expiry job (daily)
3. **Copy/paste** SQL scripts into Supabase SQL Editor
4. **Replace** `YOUR_ANON_KEY` with your actual anon key
5. **Verify** jobs are running via cron logs

---

### 2. Admin Journey (User & Organisation Management)

Admins have additional capabilities for managing the platform.

#### Admin Access

1. **Assigned** admin role (first user gets admin automatically)
2. **Click** "Admin Panel" button in Dashboard header
3. **Access** admin-only features

---

#### Manage Users

1. **Navigate** to Admin Panel → Users tab
2. **View** all users across organisations:
   - Email addresses
   - Organisation membership
   - Assigned roles
   - Account status
   - Registration dates
3. **Search/filter** users
4. **View** detailed user information

**Actions Available**:
- View user profile
- Check organisation membership
- Review user roles
- See account creation date

---

#### Manage Organisations

1. **Navigate** to Admin Panel → Organisations tab
2. **View** all organisations:
   - Organisation names
   - Status (active/inactive)
   - SAHPRA verification status
   - License numbers
3. **Edit** organisation:
   - Update SAHPRA license number
   - Change status (active/inactive)
4. **Save** changes

**Why manage organisations?**
- Ensure compliance verification
- Handle inactive accounts
- Update regulatory information
- Monitor organisation health

---

#### Monitor System Health

Admins can:
- View all audit logs (cross-organisation)
- Monitor API key expiry across orgs
- Track webhook delivery failures
- Review data source performance

---

### 3. Password Reset Journey

If you forget your password:

1. **Navigate** to login page
2. **Click** "Forgot Password?"
3. **Enter** your email address
4. **Check email** for reset link
5. **Click** reset link (valid for 24 hours)
6. **Enter** new password (min 8 characters)
7. **Confirm** new password
8. **Redirected** to login with success message
9. **Login** with new password

**Security Features**:
- One-time use reset tokens
- 24-hour token expiration
- Generic error messages (email enumeration protection)
- Secure token generation

---

## Key Features

### API Key Management

**Features**:
- Secure key generation with cryptographic randomness
- Scope-based permissions
- Optional expiry dates (30, 90, 180, 365 days, or never)
- Last used tracking
- One-click revocation
- Expiry warnings (7 days before expiration)

**Best Practices**:
- Set expiry dates for production keys
- Use scope-specific keys (least privilege)
- Rotate keys regularly
- Never commit keys to git
- Store keys in environment variables

---

### Compliance Matching

**Match Creation**:
- Record buyer-seller matches
- Generate SHA-256 hash for immutability
- Store match terms and pricing
- Idempotent (safe to retry)

**Confirm Intent**:
- Signal interest to proceed (no legal obligation)
- Immutable audit trail
- Webhook notifications
- Timestamps for analytics

**SAHPRA Verification**:
- Verify South African pharmacy licenses
- Fuzzy company name matching
- License expiry tracking
- Province and pharmacist information

---

### Audit Trail

**What's Logged**:
- All API key operations (create, use, revoke)
- Match creation and intent confirmation
- Signal creation and selection
- Webhook management
- Organisation changes
- Data source access

**Audit Features**:
- Immutable logs (no deletions)
- Actor tracking (user or API key)
- Metadata with full context
- Filtering and pagination
- Date range queries

---

### Webhooks

**Event Notifications**:
- Real-time event delivery
- HMAC-SHA256 signatures
- Automatic retries with exponential backoff
- Dead letter queue for failed deliveries
- Delivery status tracking

**Retry Schedule**:
1. Immediate delivery
2. Retry after 5 minutes
3. Retry after 30 minutes
4. Retry after 2 hours (up to max retries)

---

### Analytics

**Available Metrics**:
- API request volumes over time
- Response time percentiles
- Error rate tracking
- Endpoint usage distribution
- Data source performance
- Match conversion rates

---

## Common Workflows

### Workflow 1: Create Signal → Match → Confirm Intent

```
1. Developer creates buyer signal via API
   POST /signals { product, quantity, location }

2. System searches data sources
   Returns matched options with scores

3. Developer selects option
   POST /signals/:id/select { option_id }

4. Parties negotiate offline
   (Phone, email, in-person)

5. Developer records match
   POST /match { buyer, seller, commodity, price }
   System generates immutable hash

6. Confirm intent (no legal obligation)
   POST /match/:id/settle
   Signals interest so seller can prepare final terms

7. Webhook notifications sent
   match.created, match.intent_confirmed events
```

---

### Workflow 2: SAHPRA Verification

```
1. Organisation signs up
   Email verification required

2. Configure sandbox settings
   Admin Panel → Organisations → Edit
   Enable/disable sandbox mode

3. API key created
   Dashboard → API Keys → Create
   Select appropriate scopes

4. Integration testing
   Use sandbox environment for development
   Test all endpoints thoroughly
```

---

### Workflow 3: API Key Rotation

```
1. Create new API key
   Dashboard → API Keys → Create
   Set expiry date

2. Update application
   Deploy new key to production
   Test thoroughly

3. Monitor old key usage
   Dashboard → Analytics
   Wait for traffic to migrate

4. Revoke old key
   Dashboard → API Keys → Delete
   Confirms zero usage
```

---

## FAQ

### Q: Is this a marketplace?

**A**: No. The Compliance Matching API is a **B2B API platform**. It provides APIs for compliance matching, not an end-user marketplace with listings or shopping carts.

---

### Q: Can I create buyer/seller listings?

**A**: No. The platform focuses on API-driven matching. You integrate the Compliance Matching API into your own application, which handles the UI/UX for your users.

---

### Q: How do I get started?

**A**: Sign up → Verify email → Create API key → Test in playground → Integrate via API → Monitor via dashboard.

---

### Q: What industries is this for?

**A**: Cross-sector B2B trade where compliance verification and audit trails are required. The API is industry-agnostic and suitable for any regulated vertical.

---

### Q: How is data secured?

**A**: 
- API keys hashed with SHA-256
- Row-Level Security on all tables
- Organisation-scoped data isolation
- Webhook signature verification
- Immutable audit logs
- Email verification required

---

### Q: Can I use this without coding?

**A**: The dashboard provides basic testing tools, but the platform is designed for API integration. You need development capabilities to use it in production.

---

### Q: What happens when my API key expires?

**A**: 
- 7 days before: Email warning sent
- On expiry date: Key automatically disabled
- All attempts with expired key return 401 Unauthorised
- You can create new keys anytime

---

### Q: How do webhooks work?

**A**: Configure a webhook URL in the dashboard. The API sends POST requests when events occur. Verify the HMAC signature to ensure authenticity.

---

### Q: Can I delete audit logs?

**A**: No. Audit logs are immutable for compliance and dispute resolution. They're retained indefinitely.

---

### Q: What if a webhook fails?

**A**: Automatic retries with exponential backoff (5min, 30min, 2hr). After max retries, moved to dead letter queue. View delivery logs in dashboard.

---

## Next Steps

1. **Read** the API Reference (`docs/api-reference.md`)
2. **Review** the Technical Architecture (`docs/architecture.md`)
3. **Check** the Changelog (`CHANGELOG.md`) for recent updates
4. **Join** the community forum (if available)
5. **Contact** support for integration assistance

---

## Support Resources

- **API Reference**: `/docs/api-reference.md`
- **Technical Docs**: `/docs/architecture.md`
- **Changelog**: `/CHANGELOG.md`
- **Cron Setup**: `/docs/cron-setup.md`
- **Dashboard**: Access via login
