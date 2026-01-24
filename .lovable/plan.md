
# Implementation Plan: Fix Search → Confirm Intent Pipeline End-to-End

## Executive Summary
This plan addresses 4 major issues in the Compliance Matching API:
1. **Search → Confirm Intent pipeline is broken** - CounterpartySearch has a TODO and doesn't create matches
2. **Console Logs shows wrong data** - LogsSection reads from `api_request_logs` (technical) instead of `audit_logs` (business events)
3. **Admin visibility is incomplete** - Admin can only see technical request logs, not business audit events
4. **Invite flow is missing** - No counterparty accept/decline gate before Confirm Intent

---

## Part 1: Fix Search → Confirm Intent Pipeline

### Current State
- `src/components/CounterpartySearch.tsx:222-224` has a TODO comment: "Navigate to match creation flow"
- When user clicks "Confirm Intent", it only shows a toast message but doesn't:
  - Create a match record
  - Confirm intent on that match
  - Generate evidence pack
  - Navigate to proof page

### Implementation

#### 1.1 Update CounterpartySearch.tsx to create match + confirm intent

**File: `src/components/CounterpartySearch.tsx`**

Changes:
- Import `useNavigate` from react-router-dom
- Add `isConfirming` state for loading indicator
- Update `handleConfirmIntent` to:
  1. Get authenticated session
  2. For each selected counterparty, call `/match` endpoint to create match
  3. Then call `/match/:id/settle` endpoint to confirm intent
  4. Navigate to match details page with success toast
- Demo mode continues to show demo dialog only (no DB writes)

Key logic:
```typescript
const handleConfirmIntent = async () => {
  if (selectedResults.size === 0) { toast.error(...); return; }
  if (isDemoMode) { setShowDemoConfirm(true); return; }
  
  setIsConfirming(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Please sign in");
    
    // Get user's org profile for buyer info
    const { data: profile } = await supabase.from("profiles")
      .select("org_id").single();
    
    // Create match for first selected result (or batch)
    const selectedResult = results.find(r => selectedResults.has(r.id));
    
    // Create match via edge function
    const matchResponse = await supabase.functions.invoke("match", {
      body: {
        buyer: { id: profile.org_id, name: "Your Organization" },
        seller: { id: selectedResult.id, name: selectedResult.title },
        commodity: parsedQuery?.product || query,
        quantity: { amount: 1, unit: "lot" },
        price: { amount: 0, currency: "USD" },
        terms: "Intent confirmation only - not a binding agreement",
        metadata: { searchQuery: query, parsedQuery }
      }
    });
    
    // Confirm intent on the match
    const settleResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/match/${matchResponse.data.id}/settle`,
      { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }}
    );
    
    toast.success("Intent confirmed. Proof generated.");
    navigate(`/dashboard/matches/${matchResponse.data.id}`);
  } catch (error) {
    toast.error(error.message);
  } finally {
    setIsConfirming(false);
  }
};
```

#### 1.2 Add success confirmation with "Open Proof" button

After successful confirmation, the user is navigated to `/dashboard/matches/:matchId` which already shows:
- Match details with status CONFIRMED
- Timeline tab with hash-chained events
- Documents tab
- WaD tab for evidence bundle

The existing `MatchDetails.tsx` page already has the evidence pack download in `MatchTimeline.tsx`.

---

## Part 2: Fix Console "Logs" Tab to Show Business Events

### Current State
- `src/components/dashboard/sections/LogsSection.tsx` reads from `api_request_logs` table
- This shows technical HTTP request logs (endpoints, status codes, latency)
- Users cannot see business events like `intent.confirmed`, `match.created`

### Implementation

#### 2.1 Create dual-view Logs section with tabs

**File: `src/components/dashboard/sections/LogsSection.tsx`**

Changes:
- Add `Tabs` component with two tabs:
  - "Activity / Proof Events" - fetches from `/audit-logs` edge function
  - "API Request Logs" - keeps existing `api_request_logs` query
- For Activity tab:
  - Call `/audit-logs` endpoint using JWT auth
  - Display `intent.confirmed`, `match.created`, `search.completed` events
  - Add "Open Proof" link for `intent.confirmed` entries pointing to `/dashboard/matches/:entityId`
  - Show hash from metadata for proof verification

Key structure:
```typescript
<Tabs defaultValue="activity">
  <TabsList>
    <TabsTrigger value="activity">Activity / Proof Events</TabsTrigger>
    <TabsTrigger value="requests">API Request Logs</TabsTrigger>
  </TabsList>
  
  <TabsContent value="activity">
    {/* Fetch from /audit-logs edge function */}
    {activityLogs.map(log => (
      <TableRow>
        <TableCell>{log.action}</TableCell>
        <TableCell>{log.entity_id}</TableCell>
        <TableCell>{log.metadata?.hash?.substring(0,8)}...</TableCell>
        <TableCell>
          {log.action === "intent.confirmed" && (
            <Link to={`/dashboard/matches/${log.entity_id}`}>Open Proof</Link>
          )}
        </TableCell>
      </TableRow>
    ))}
  </TabsContent>
  
  <TabsContent value="requests">
    {/* Existing api_request_logs table */}
  </TabsContent>
</Tabs>
```

#### 2.2 Fetch activity logs via edge function

Use the existing `/audit-logs` edge function which:
- Authenticates via JWT (no API key needed for console users)
- Returns org-scoped audit logs
- Already supports filtering by action, entity_type, date range

```typescript
const fetchActivityLogs = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/audit-logs?limit=50`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const data = await response.json();
  setActivityLogs(data.items);
};
```

---

## Part 3: Fix Admin Visibility for Intent Confirmations

### Current State
- `src/components/admin/GlobalApiLogs.tsx` reads from `api_request_logs`
- `src/components/admin/AdminAuditLogs.tsx` reads from `audit_logs` directly via RLS
- However, AdminAuditLogs is a separate route (`/admin/audit`), not prominently shown

### Implementation

#### 3.1 Add "Business Events" tab to GlobalApiLogs

**File: `src/components/admin/GlobalApiLogs.tsx`**

Changes:
- Add tabs similar to console LogsSection:
  - "API Requests" - existing `api_request_logs` query
  - "Business Events (Audit)" - queries `audit_logs` table (admin has RLS access)
- For Business Events tab:
  - Query `audit_logs` ordered by `created_at` desc
  - Filter by action (`intent.confirmed`, `match.created`, etc.)
  - Show "Open Proof" link for each intent confirmation
  - Include org name via join with `organizations` table

Key query for admin:
```typescript
const { data: businessLogs } = await supabase
  .from("audit_logs")
  .select(`
    *,
    organizations:org_id (name)
  `)
  .order("created_at", { ascending: false })
  .limit(100);
```

Admin has RLS access via:
```sql
Policy Name: Admins can view all audit logs
Command: SELECT
Using Expression: has_role(auth.uid(), 'admin'::app_role)
```

---

## Part 4: Counterparty Invite Flow (Simplified MVP)

### Current State
- No `invites` table exists
- `notifyCounterpartyIntent` in `webhooks.ts` sends notifications AFTER intent is confirmed
- No gate requiring counterparty acceptance before confirming intent

### Implementation

#### 4.1 Create `invites` table

**Database Migration:**
```sql
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_user_id UUID REFERENCES auth.users(id),
  from_org_id UUID NOT NULL REFERENCES organizations(id),
  to_email TEXT,
  to_org_id UUID REFERENCES organizations(id),
  search_query TEXT,
  search_results JSONB DEFAULT '[]',
  selected_result_id TEXT NOT NULL,
  selected_result_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  declined_reason TEXT,
  match_id UUID REFERENCES matches(id),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

-- RLS Policies
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Sender can view/create invites from their org
CREATE POLICY "Users can view their org's sent invites" ON invites
  FOR SELECT USING (from_org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create invites for their org" ON invites
  FOR INSERT WITH CHECK (from_org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));

-- Recipients can view/update invites sent to them
CREATE POLICY "Recipients can view invites sent to them" ON invites
  FOR SELECT USING (
    to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    OR to_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Recipients can accept/decline invites" ON invites
  FOR UPDATE USING (
    to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    OR to_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Admin can view all
CREATE POLICY "Admins can view all invites" ON invites
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
```

#### 4.2 Create Invite Edge Function

**File: `supabase/functions/invites/index.ts`**

Endpoints:
- `POST /invites` - Create invite (from search results)
- `GET /invites` - List invites (sent + received)
- `POST /invites/:id/accept` - Accept invite
- `POST /invites/:id/decline` - Decline invite

Flow:
1. User searches and selects counterparties
2. User clicks "Invite" → creates invite record with status=pending
3. Counterparty sees invite in their inbox
4. Counterparty clicks Accept/Decline
5. Only after acceptance can the inviter confirm intent

#### 4.3 Update CounterpartySearch UI

Add two-button flow:
- "Invite Selected" - Creates invite, shows confirmation
- "Confirm Intent" - Only enabled if there's an accepted invite for this search

```typescript
<Button onClick={handleInvite} disabled={selectedResults.size === 0}>
  <Send className="h-4 w-4 mr-2" />
  Invite ({selectedResults.size})
</Button>

{hasAcceptedInvite && (
  <Button onClick={handleConfirmIntent}>
    <CheckCircle className="h-4 w-4 mr-2" />
    Confirm Intent
  </Button>
)}
```

#### 4.4 Create Invites Inbox Page

**File: `src/pages/Invites.tsx`**

Simple page showing:
- Received invites (pending) with Accept/Decline buttons
- Sent invites with status
- Link to match when invite leads to confirmed intent

#### 4.5 Add to sidebar navigation

**File: `src/components/AppSidebar.tsx`**

Add "Invites" menu item under Data section with notification badge for pending invites.

---

## Files to Create/Modify

### Create New Files:
1. `supabase/functions/invites/index.ts` - Invite management endpoints
2. `src/pages/Invites.tsx` - Invites inbox page

### Modify Existing Files:
1. `src/components/CounterpartySearch.tsx` - Add match creation + intent confirmation + invite flow
2. `src/components/dashboard/sections/LogsSection.tsx` - Add Activity/Proof Events tab
3. `src/components/admin/GlobalApiLogs.tsx` - Add Business Events tab
4. `src/components/AppSidebar.tsx` - Add Invites menu item
5. `src/App.tsx` - Add /invites route
6. `supabase/config.toml` - Register invites function

### Database Migration:
1. Create `invites` table with RLS policies

---

## Acceptance Test Walkthrough

### Test 1: Search → Confirm Intent Pipeline
1. Sign in as James (james@test.com)
2. Go to Dashboard → Search
3. Enter "coffee buyers in Kenya"
4. Wait for results
5. Select one counterparty
6. Click "Confirm Intent"
7. **Expected**: Match created, intent confirmed, navigated to match details page
8. Verify: Timeline shows `match.created` and `intent.confirmed` events
9. Verify: Can download evidence pack JSON

### Test 2: Console Logs Show Proof Events
1. After confirming intent (Test 1)
2. Go to Dashboard → Logs
3. Click "Activity / Proof Events" tab
4. **Expected**: See `intent.confirmed` entry with timestamp and hash
5. Click "Open Proof" link
6. **Expected**: Navigated to match details page
7. Refresh page
8. **Expected**: Same entry still visible

### Test 3: Admin Can See Intent Confirmations
1. Sign in as Admin
2. Go to Admin Panel → API Logs
3. Click "Business Events" tab
4. **Expected**: See James's `intent.confirmed` entry
5. Can see org name, timestamp, match ID
6. Click "View Proof"
7. **Expected**: Can access match details

### Test 4: Invite Flow (MVP)
1. Sign in as User A
2. Search and select counterparty
3. Click "Invite"
4. Sign in as User B (counterparty email)
5. Go to Invites page
6. See pending invite from User A
7. Click "Accept"
8. Sign in as User A
9. See accepted invite
10. Click "Confirm Intent"
11. **Expected**: Match and proof created

---

## Technical Notes

### Security Considerations
- Demo mode NEVER writes to database - only shows simulated UI
- Invites table has proper RLS - users only see their sent/received invites
- Audit logs accessed via edge function (JWT auth) or RLS (admin direct query)
- No SECURITY DEFINER views for user-facing data

### Logging Events Written
All these events are already written by `supabase/functions/match/index.ts`:
- `match.created` → audit_logs + match_events
- `intent.confirmed` → audit_logs + match_events
- `intent.denied` → audit_logs (if eligibility fails)

New events for invites:
- `invite.created` → audit_logs
- `invite.accepted` → audit_logs
- `invite.declined` → audit_logs

### Evidence Pack Retrieval
The existing `supabase/functions/evidence-pack/index.ts` generates complete JSON with:
- Match details
- Hash chain verification
- Document list
- Timeline events
- Audit trail

---

## Implementation Order

1. **Phase 1** (Critical - fixes broken pipeline):
   - Update CounterpartySearch.tsx with match creation flow
   - Update LogsSection.tsx with Activity tab

2. **Phase 2** (Admin visibility):
   - Update GlobalApiLogs.tsx with Business Events tab

3. **Phase 3** (Invite flow - full SOW compliance):
   - Create invites table migration
   - Create invites edge function
   - Create Invites page
   - Update CounterpartySearch with invite button
   - Update sidebar navigation
