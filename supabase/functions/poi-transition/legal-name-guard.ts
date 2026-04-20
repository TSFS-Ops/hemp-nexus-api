/**
 * Pure predicate used by the poi-transition guard.
 *
 * Returns true when the actor's profile is NOT permitted to generate a POI
 * because their personal legal name is missing, empty, looks like an email,
 * or is literally equal to their email address.
 *
 * Extracted as a pure function so it is unit-testable in isolation and so
 * the same logic can be reused by other server-side checks.
 */
export function isActorLegalNameMissing(profile: {
  full_name?: string | null;
  email?: string | null;
} | null | undefined): boolean {
  const fullName = (profile?.full_name ?? "").trim();
  if (!fullName) return true;

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRe.test(fullName)) return true;

  const email = (profile?.email ?? "").trim().toLowerCase();
  if (email && fullName.toLowerCase() === email) return true;

  return false;
}
