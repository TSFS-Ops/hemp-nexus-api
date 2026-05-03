# Compliance Matching API Documentation

**Last updated:** 2026-05-03

Welcome to the Compliance Matching API documentation hub. This guide will help you understand, integrate, and use our API platform effectively — whether you're a developer, business user, or administrator.

> **Terminology:** We use **Counterparty**, **Trade Request**, **Proof of Intent (POI)**, and **WaD** (always written "Without a Doubt" — never "Warrant of Diligence"). We never use "Bid/Offer".

> **Billing:** Platform credits are **USD-native** since 2026-05-01. 1 credit = $1.00 USD. Tier prices: `single` $1, `pack_10` $10, `pack_50` $45 (-10%), `pack_200` $160 (-20%). Trade-side currencies on a Trade Request are commercial terms, not billing claims. <!-- zar-billing-allow -->

---

## 🌟 What Is This Platform?

### In Simple Terms
Think of this as a **secure digital handshake system** for businesses in regulated industries. When two companies agree to trade something (like medical supplies, industrial equipment, or any regulated products), our platform:

1. **Records the agreement** - Like a digital contract that can't be altered
2. **Provides proof** - Creates tamper-proof evidence of the agreement
3. **Sends notifications** - Alerts your systems when important events happen

### Why This Exists
**The Problem**: In regulated industries, companies need to prove they only trade with verified, licensed partners. Manual verification is slow, error-prone, and doesn't scale.

**Our Solution**: An API platform that automates verification, records agreements, and provides cryptographic proof-all in real-time.

### Who This Is For
- **Software developers** building marketplace or ERP systems
- **Compliance officers** needing audit trails
- **Business analysts** tracking trade patterns
- **System administrators** managing integrations

---

## 📚 Documentation Structure

We've organized our documentation to match how different people use the platform:

### 🎯 Start Here (Choose Your Path)

#### Path 1: "I'm New to APIs"
Start with the **[Getting Started Guide](./getting-started.md)** which explains:
- What APIs are (in plain English)
- How to create your first API key
- Step-by-step first integration
- Common mistakes and how to avoid them

Then move to **[Product Guide](./product-guide.md)** for:
- Real-world examples
- Complete user journeys
- Screenshots and tutorials

#### Path 2: "I'm Integrating This Into My System"
Go directly to **[API Reference](./api-reference.md)** which includes:
- All available endpoints (the "commands" you can use)
- Request/response examples
- Code samples in multiple languages
- Error handling guide

#### Path 3: "I'm Managing Operations"
Start with **[Product Guide](./product-guide.md)** then:
- **[Cron Setup Guide](./cron-setup.md)** - Automate background tasks
- **[Webhooks Guide](./webhooks.md)** - Get real-time notifications

#### Path 4: "I Need Technical Details"
Jump to **[Technical Architecture](./architecture.md)** for:
- Database schema
- Security model
- Performance characteristics
- Integration patterns

---

## 📖 Complete Document Index

### Essential Reading

| Document | What It's For | When to Read It |
|----------|---------------|-----------------|
| **[Getting Started Guide](./getting-started.md)** | Your first steps with the platform | Before anything else if you're new |
| **[Core Positioning](./core-positioning.md)** | What the platform does and what it explicitly does *not* do | Aligning expectations with stakeholders |
| **[Product Guide](./product-guide.md)** | Understanding features and workflows | Learning what the platform can do |
| **[API Reference](./api-reference.md)** | Technical API documentation | When building your integration |
| **[End-to-End Walkthrough](../public/docs/end-to-end-walkthrough.md)** | Onboarding → POI mint → sealed WaD in one read | Validating you understand the full lifecycle |

### Feature-Specific Guides

| Document | What It Explains | Who Needs It |
|----------|------------------|--------------|
| **[Webhooks Guide](./webhooks.md)** | Real-time event notifications, replay protection, subject-clamp contract | Developers building automated systems |
| **[POI Engagements Binding Contract](./poi-engagements-binding-contract.md)** | Engagement hold-point, `409 / ENGAGEMENT_PENDING`, attestations | Anyone integrating around POI mint |
| **[How to Test](./how-to-test.md)** | Test-mode bypass flags, test orgs, UAT auto-verification | Anyone running E2E or UAT flows |
| **[Cron Setup Guide](./cron-setup.md)** | Automated background jobs and `lifecycle-scheduler` | System administrators |

### Reference Material

| Document | What It Contains | When You Need It |
|----------|------------------|------------------|
| **[Technical Architecture](./architecture.md)** | System design, SECDEF Stage D1 lockdowns, atomic functions, `trade_requests` split | Troubleshooting, scaling, security reviews |
| **[Caching Strategy](./caching-strategy.md)** | Edge cache windows, rate-limit cache, static asset TTLs | Performance tuning |
| **[Infrastructure Requirements](./infrastructure-requirements.md)** | Resend, Paystack, Supabase, AI Gateway dependencies | Deployment planning |
| **[Programme Governance Proposal](./programme-governance-proposal.md)** | Government programme SHA-256 ledger model | Public-sector integrations |
| **[Changelog](../CHANGELOG.md)** | Version history and updates | Checking what changed recently |
| **[Testing Results](./testing-results.md)** | Test coverage and results | Quality assurance, debugging |

---

## 🔑 Key Concepts Explained

### API Keys (Your Digital Identity)
**What it is**: A secret code that identifies your application to our system.

**In everyday terms**: Like a key to your house-it proves you're authorised to enter. You include this key with every request to prove it's really you.

**Why you need it**: Security. Without requiring keys, anyone could access or modify data. Keys let us track usage, enforce limits, and keep your data safe.

**How to get one**: Sign up → Dashboard → API Keys → Create New Key

### Signals (Expressing Intent)
**What it is**: A way to tell the system "I want to buy/sell something."

**In everyday terms**: Like posting "I need supplies" on a bulletin board. Other systems can see your request and respond with matching options.

**Why this matters**: Instead of manually searching for partners, you express your intent once, and the system finds matches automatically.

### Matches (Recording Agreements)
**What it is**: A permanent record of a trade agreement between two parties.

**In everyday terms**: Like a digital receipt that both parties sign, which can never be altered or deleted.

**Why this matters**: Creates an immutable audit trail for compliance purposes. If anyone asks "Did company A really trade with company B on this date?", the match proves it.

### Webhooks (Automatic Notifications)
**What it is**: A way for our system to notify your system when something happens.

**In everyday terms**: Like getting a text message when your package is delivered, but for software. When a match is created, your system gets automatically notified.

**Why this matters**: No need to constantly check for updates. Your system gets notified immediately when important events occur.

### Cryptographic Hashes (Tamper-Proof Evidence)
**What it is**: A unique digital fingerprint of data that changes if even one character is modified.

**In everyday terms**: Like a wax seal on an envelope. If someone opens it, you know it's been tampered with.

**Why this matters**: Provides mathematical proof that match data hasn't been altered. Perfect for audits and dispute resolution.

---

## 🚀 Quick Start Paths

### For Developers: 5-Minute Integration Test

1. **Get Your Key** (2 minutes)
   - Sign up at the dashboard
   - Create an API key
   - Copy it to your clipboard

2. **Test the Connection** (1 minute)
   ```bash
   curl https://api.izenzo.co.za/functions/v1/healthz \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```

3. **Create Your First Signal** (2 minutes)
   ```bash
   curl -X POST https://api.izenzo.co.za/functions/v1/signals \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"product":"Test Product","quantity":100,"unit":"units"}'
   ```

### For Business Users: Understanding Value

Read these sections in order:
1. [Product Guide](./product-guide.md) - See how it works
2. [Use Cases](#common-use-cases) - Real examples
3. [ROI Calculator](#roi-and-benefits) - Business value

### For Administrators: System Setup

Follow this checklist:
1. ✅ Create organisation account
2. ✅ Generate production API keys
3. ✅ Set up webhook endpoints
4. ✅ Configure automated jobs ([Cron Guide](./cron-setup.md))
5. ✅ Test integration
6. ✅ Monitor analytics

---

## 💡 Common Use Cases

### Use Case 1: Medical Supply Marketplace
**Scenario**: You run a platform where hospitals buy medical supplies.

**How to use this API**:
1. **Hospital creates a signal**: "Need 10,000 surgical masks"
2. **System finds verified suppliers**: Returns only SAHPRA-licensed suppliers
3. **Hospital selects supplier**: Creates a match record
4. **Confirm intent**: Signal interest (no legal obligation) so seller can prepare final terms
5. **For audits**: Provide match records with cryptographic proof

**Benefits**: Automated compliance verification, audit trail, faster matching.

### Use Case 2: Industrial Equipment Trading
**Scenario**: Companies trade heavy machinery and need proof of transactions.

**How to use this API**:
1. **Buyer signals interest**: "Need 5 excavators in Gauteng region"
2. **Sellers respond**: System returns matching equipment offers
3. **Agreement reached**: Record match with all details
4. **Webhook notification**: Both parties' systems get notified
5. **Confirm intent**: Signal interest so seller can prepare final terms (no legal obligation)

**Benefits**: Permanent record, instant notifications, easy integration with ERP.

### Use Case 3: Compliance Reporting
**Scenario**: Need to prove all trades were with licensed partners.

**How to use this API**:
1. **Query audit logs**: Get complete history
2. **Verify hashes**: Prove data integrity
3. **Export matches**: Generate compliance reports
4. **Show SAHPRA verification**: Prove licensing compliance

**Benefits**: Automated compliance reports, tamper-proof evidence.

---

## 🎓 Learning Resources

### Video Tutorials (Coming Soon)
- Setting up your first integration
- Understanding webhooks
- Building a simple marketplace

### Code Examples
Find complete examples in `/examples` directory:
- `client-example.js` - Full workflow in Node.js
- `webhooks-example.js` - Webhook handling
- `trade-izenzo-example.sh` - Bash script integration

### Interactive Testing
Use the Dashboard → Testing tab to:
- Test API calls without writing code
- See real request/response examples
- Understand error messages
- Practice before building

---

## 🛠️ Getting Help

### Documentation Feedback
Found an error or something unclear? Let us know:
- Open an issue in the repository
- Email: support@izenzo.co.za

### Technical Support
- **Dashboard Support**: Available in the dashboard
- **API Status**: Check system health at `/healthz` endpoint
- **Response Times**: View analytics in Dashboard

### Community
- Share integration patterns
- Ask questions
- Contribute improvements

---

## 📊 ROI and Benefits

### Time Savings
- **Manual verification**: 15-30 minutes per partner
- **Automated verification**: < 1 second
- **Annual savings**: 100+ hours for active traders

### Compliance Benefits
- Automated license verification
- Tamper-proof audit trails
- Instant compliance reports
- Reduced regulatory risk

### Operational Benefits
- Real-time notifications
- Integrated workflows
- Reduced errors
- Scalable infrastructure

---

## 🔐 Security First

Every feature is built with security in mind:
- **API Keys**: Encrypted storage, scope-based permissions
- **Cryptographic Hashes**: Mathematical proof of data integrity
- **Rate Limiting**: Protection against abuse
- **Audit Logs**: Complete activity tracking
- **HTTPS Only**: All communications encrypted
- **No SECURITY DEFINER Views**: All database views use `security_invoker = true` to respect RLS policies

### ⚠️ Database View Security Policy

**Rule**: No `SECURITY DEFINER` views are allowed in this project.

All views MUST be created with `security_invoker = true` to ensure they respect the caller's Row Level Security (RLS) permissions:

```sql
-- ✅ CORRECT: Uses security_invoker
CREATE VIEW public.my_view 
WITH (security_invoker = true) AS
SELECT * FROM my_table;

-- ❌ WRONG: Default is SECURITY DEFINER (bypasses RLS)
CREATE VIEW public.my_view AS
SELECT * FROM my_table;
```

**For admin-only data**: Use a `SECURITY DEFINER` function with explicit `is_admin()` checks instead of a view.

**Safety check**: Run `SELECT * FROM check_security_definer_views();` to detect any non-compliant views.

Read more: [Technical Architecture](./architecture.md) → Security section

---

## 📋 Documentation Principles

### 1. Clarity Over Brevity
We'd rather explain something twice in different ways than leave you confused once.

### 2. Real Examples
Every feature includes real-world examples, not just abstract descriptions.

### 3. Why, Not Just How
We explain *why* features exist, not just how to use them.

### 4. Living Documentation
These docs are updated as the system evolves. Check the "Last Updated" date at the top of each page.

### 5. Multiple Learning Styles
- Visual learners: Diagrams and screenshots
- Hands-on learners: Code examples
- Conceptual learners: Detailed explanations

---

## 🗺️ Next Steps

Choose your path:

- **Brand New?** → [Getting Started Guide](./getting-started.md)
- **Ready to Build?** → [API Reference](./api-reference.md)
- **Need Examples?** → [Product Guide](./product-guide.md)
- **Technical Details?** → [Architecture](./architecture.md)
- **Setup Operations?** → [Cron Setup](./cron-setup.md)

---

## 📞 Contact

**General Questions**: support@izenzo.co.za  
**Technical Support**: Dashboard support chat  
**Security Issues**: security@izenzo.co.za (response within 24 hours)
