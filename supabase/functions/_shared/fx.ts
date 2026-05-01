/**
 * fx.ts — USD→ZAR exchange-rate fetcher used by the dual-currency
 * billing path (USD display, ZAR Paystack settlement).
 *
 * Decision (James Davies, 2026-04-30): the platform displays prices
 * in USD but Paystack South Africa settles in ZAR, so each checkout
 * must convert the USD package price to ZAR cents at initialisation
 * time and persist the FX basis in the audit trail.
 *
 * Source: exchangerate.host — free, no API key, returns mid-market
 * rates. We cache the last successful rate in `admin_settings.
 * fx_rate_usd_zar` so a transient FX-API outage does not block
 * checkout (we fall back to the most recent known rate, audited as
 * `cached_fallback`). If neither the live call nor the cache yields
 * a rate we surface a hard error to the caller — never silently
 * default to a hardcoded number.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

const FX_API_URL = "https://api.exchangerate.host/latest?base=USD&symbols=ZAR";
const FX_TIMEOUT_MS = 4_000;

export interface FxRate {
  /** Multiplicative rate: 1 USD = `rate` ZAR. */
  rate: number;
  /** ISO timestamp the rate was obtained. */
  fetched_at: string;
  /** How the rate was obtained — drives audit-log labelling. */
  basis: "live" | "cached_fallback";
  /** Provider identifier (currently always exchangerate.host). */
  source: string;
}

interface CachedFx {
  rate: number | null;
  basis: string | null;
  fetched_at: string | null;
  source: string;
  note?: string;
}

async function fetchLiveRate(): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FX_TIMEOUT_MS);
  try {
    const res = await fetch(FX_API_URL, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: { ZAR?: number } };
    const rate = json?.rates?.ZAR;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
    return rate;
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Returns the current USD→ZAR rate. Tries the live API first, falls
 * back to the cached rate in `admin_settings`. Throws if neither is
 * available so the caller can return a clean 503 to the user instead
 * of silently charging the wrong amount.
 */
export async function getUsdZarRate(admin: AdminClient): Promise<FxRate> {
  const liveRate = await fetchLiveRate();
  const fetchedAt = new Date().toISOString();

  if (liveRate !== null) {
    // Persist the fresh rate as the new fallback. Best-effort — if
    // this write fails we still return the live rate for the current
    // checkout (the next call will simply re-fetch live).
    try {
      await admin
        .from("admin_settings")
        .update({
          value: {
            rate: liveRate,
            basis: "live",
            fetched_at: fetchedAt,
            source: "exchangerate.host",
            note: "Updated by token-purchase edge function on successful FX fetch.",
          },
          updated_at: fetchedAt,
        })
        .eq("key", "fx_rate_usd_zar");
    } catch (e) {
      console.warn("[fx] failed to persist fresh rate", e);
    }
    return {
      rate: liveRate,
      fetched_at: fetchedAt,
      basis: "live",
      source: "exchangerate.host",
    };
  }

  // Live call failed — fall back to the cached rate.
  const { data: row } = await admin
    .from("admin_settings")
    .select("value")
    .eq("key", "fx_rate_usd_zar")
    .maybeSingle();

  const cached = (row?.value ?? null) as CachedFx | null;
  if (cached?.rate && Number.isFinite(cached.rate) && cached.rate > 0 && cached.fetched_at) {
    return {
      rate: cached.rate,
      fetched_at: cached.fetched_at,
      basis: "cached_fallback",
      source: cached.source ?? "exchangerate.host",
    };
  }

  throw new Error(
    "FX rate unavailable: live API returned no rate and no cached USD→ZAR rate is stored.",
  );
}

/**
 * Converts a USD amount to ZAR cents (Paystack's required unit) at
 * the supplied rate. Uses bankers' rounding equivalent (Math.round)
 * because Paystack will reject non-integer cent amounts.
 */
export function usdToZarCents(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`usdToZarCents: invalid usd amount ${usd}`);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`usdToZarCents: invalid rate ${rate}`);
  }
  return Math.round(usd * rate * 100);
}
