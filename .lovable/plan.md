
# Security Hardening Plan: Email Address Exposure Prevention

## Root Cause Analysis

### What's Wrong
The security scanner correctly identified that **email addresses in the `profiles` table could potentially be accessed by authenticated users from other organizations**. While the current RLS policies *are actually correct* (`id = auth.uid()` for self-only access), there are two architectural patterns that create risk:

1. **Frontend querying `profiles.email` directly** (in `AdminApiKeys.tsx` lines 90-94) — relies on RLS working correctly
2. **No defense-in-depth** — if RLS is accidentally weakened in a future migration, emails could leak across organizations

### Current State (Actually Secure, But Fragile)
```sql
-- Current policy: Users can ONLY see their own profile
USING (auth.uid() IS NOT NULL AND id = auth.uid())
```

This is correct! But the problem is:
- Frontend code **directly queries** `profiles.email` assuming RLS will block
- If someone accidentally adds a policy like "Users can view profiles in their org", emails leak
- No server-side enforcement layer exists as a backup

---

## Site-Wide Pattern Changes

### Pattern 1: Never Query PII from Frontend — Use Edge Functions

**Current (Fragile):**
```typescript
// AdminApiKeys.tsx — directly queries profiles for email
const { data: profile } = await supabase
  .from("profiles")
  .select("email")
  .eq("id", key.created_by)
  .single();
```

**New Pattern (Defense-in-Depth):**
```typescript
// Call an Edge Function that explicitly checks admin role server-side
const { data } = await supabase.functions.invoke("admin-lookup-email", {
  body: { user_ids: [key.created_by] }
});
```

**Rule**: PII fields (email, phone, full_name, address) must NEVER be selected directly from frontend. Always go through an Edge Function that:
1. Verifies caller is admin OR is requesting their own data
2. Uses service_role client to fetch
3. Applies redaction before returning

### Pattern 2: Database-Level Deny for Email Column

Add a **database function** that wraps email access:

```sql
-- Security Definer function: Only returns email for self or admin
CREATE OR REPLACE FUNCTION public.get_user_email(target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_is_admin boolean;
  result_email text;
BEGIN
  -- Self-access is always allowed
  IF caller_id = target_user_id THEN
    SELECT email INTO result_email FROM profiles WHERE id = target_user_id;
    RETURN result_email;
  END IF;
  
  -- Admin access is allowed
  SELECT has_role(caller_id, 'admin') INTO caller_is_admin;
  IF caller_is_admin THEN
    SELECT email INTO result_email FROM profiles WHERE id = target_user_id;
    RETURN result_email;
  END IF;
  
  -- Everyone else gets redacted
  RETURN '***@***.***';
END;
$$;
```

### Pattern 3: Create `profiles_safe` View

Create a view that **never exposes email** to non-admin callers:

```sql
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = true)
AS
SELECT 
  id,
  org_id,
  full_name,
  status,
  created_at,
  -- Email is always redacted in this view
  CASE 
    WHEN id = auth.uid() THEN email
    WHEN public.has_role(auth.uid(), 'admin') THEN email
    ELSE '***@***.***'
  END as email
FROM public.profiles;

-- Revoke direct profiles access from authenticated role
-- (Optional: aggressive hardening)
```

---

## Implementation Steps

### Step 1: Create `admin-lookup-profiles` Edge Function
Create a new Edge Function that:
- Accepts a list of user IDs
- Verifies caller is admin
- Returns enriched profile data (email, name, org)
- This replaces all frontend profile email lookups

### Step 2: Refactor `AdminApiKeys.tsx`
Replace direct `profiles.email` query with call to the new Edge Function

### Step 3: Add Database Function `get_user_email`
Security Definer function that returns email only for self/admin

### Step 4: Add Guardrail Check
Add a new function `check_frontend_pii_exposure()` that:
- Scans for SELECT policies on profiles that could expose email cross-org
- Runs as part of Phase 2 Verification

### Step 5: Update Security Constants
Add `profiles.email` to a new `BACKEND_ONLY_FIELDS` constant

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/functions/admin-lookup-profiles/index.ts` | **NEW** — Admin-only profile enrichment |
| `src/components/admin/AdminApiKeys.tsx` | Replace direct profiles query with Edge Function call |
| `supabase/migrations/XXXXX_email_access_hardening.sql` | Add `get_user_email()` function |
| `src/lib/security/constants.ts` | Add `BACKEND_ONLY_FIELDS` constant |
| `src/components/admin/Phase2Verification.tsx` | Add check for PII exposure patterns |

---

## Technical Details

### New Edge Function: `admin-lookup-profiles`

```typescript
// supabase/functions/admin-lookup-profiles/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // 1. Verify caller is admin (using is_admin RPC)
  // 2. Accept { user_ids: string[] }
  // 3. Query profiles using service_role
  // 4. Return enriched data with org names
});
```

### Migration: Email Access Hardening

```sql
-- Create secure email accessor
CREATE OR REPLACE FUNCTION public.get_user_email(target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- ... (as described above)
$$;

-- Grant execute to authenticated (controlled access)
GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_user_email IS 
'Security: Returns email only for self or admin. Prevents email enumeration.';
```

---

## Verification Checklist

After implementation:

1. **Test non-admin user**:
   - Query `profiles` directly → should only return own profile
   - Call `get_user_email(other_user_id)` → should return `***@***.***`

2. **Test admin user**:
   - Call `admin-lookup-profiles` → should return emails
   - Call `get_user_email(any_id)` → should return actual email

3. **Regression check**:
   - `AdminApiKeys.tsx` still shows creator emails for admins
   - `UsersManagement.tsx` still works (already uses Edge Function)

4. **Run guardrail**:
   - `check_anon_grants()` passes
   - `check_view_security_invoker()` passes
   - New `check_frontend_pii_exposure()` passes

---

## Prevention: Site-Wide Standards

To prevent this class of error from recurring:

1. **Code Review Checklist Item**: "Does this query select email/phone from profiles? If yes, use Edge Function."

2. **ESLint Rule** (future): Flag `.from("profiles").select("email")` patterns

3. **Memory Entry**: Add to project memory:
   > "PII fields (email, phone, full_name) must NEVER be queried directly from frontend components. All PII lookups must go through Edge Functions that verify authorization server-side."

4. **Phase 2 Verification**: Add automated check that scans for frontend PII exposure patterns

This approach provides **defense-in-depth**: even if RLS is accidentally weakened, the Edge Function layer prevents email leakage.
