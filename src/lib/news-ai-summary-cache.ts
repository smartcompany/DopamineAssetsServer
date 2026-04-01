import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

export function normalizeNewsUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    const kept = new URLSearchParams();
    u.searchParams.forEach((v, k) => {
      const kl = k.toLowerCase();
      if (TRACKING_PARAMS.has(kl) || kl.startsWith("utm_")) return;
      kept.set(k, v);
    });
    const q = kept.toString();
    u.search = q ? `?${q}` : "";
    return u.toString();
  } catch {
    return urlStr.trim();
  }
}

export function canonicalizeNewsUrls(urls: string[]): string[] {
  const norm = urls.map((u) => normalizeNewsUrl(u.trim())).filter((u) => u.length > 0);
  const uniq = [...new Set(norm)].sort();
  return uniq.slice(0, 5);
}

/** 캐시 키: 티커 + 제목 지문만 (번역된 제목이 digest에 반영됨). */
export function buildCacheKey(params: { symbol: string; titleDigest: string }): string {
  const sym = params.symbol.trim().toUpperCase();
  const line = ["v2", sym, params.titleDigest].join("|");
  return createHash("sha256").update(line, "utf8").digest("hex");
}

export type CachedNewsAiSummaryRow = {
  summary: string;
  impact: string[];
  risk: string[];
  source_urls: string[];
};

export async function getCachedNewsAiSummary(
  cacheKey: string,
): Promise<CachedNewsAiSummaryRow | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dopamine_news_ai_summary_cache")
      .select("summary, impact, risk, source_urls")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) {
      console.error("[news-ai-summary-cache] select failed:", error.message, error.details);
      return null;
    }
    if (!data) return null;
    const impact = Array.isArray(data.impact)
      ? (data.impact as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const risk = Array.isArray(data.risk)
      ? (data.risk as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const sourceUrls = Array.isArray(data.source_urls)
      ? (data.source_urls as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    return {
      summary: typeof data.summary === "string" ? data.summary : "",
      impact,
      risk,
      source_urls: sourceUrls,
    };
  } catch {
    return null;
  }
}

export async function saveCachedNewsAiSummary(params: {
  cacheKey: string;
  symbol: string;
  titleDigest: string;
  summary: string;
  impact: string[];
  risk: string[];
  sourceUrls: string[];
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await supabase.from("dopamine_news_ai_summary_cache").upsert(
      {
        cache_key: params.cacheKey,
        symbol: params.symbol.trim(),
        title_digest: params.titleDigest,
        summary: params.summary,
        impact: params.impact,
        risk: params.risk,
        source_urls: params.sourceUrls,
        updated_at: now,
      },
      { onConflict: "cache_key" },
    );
    if (error) {
      console.error(
        "[news-ai-summary-cache] upsert failed:",
        error.message,
        error.details,
        error.hint,
        { symbol: params.symbol, cacheKeyPrefix: params.cacheKey.slice(0, 16) },
      );
    }
  } catch (e) {
    console.error("[news-ai-summary-cache] upsert exception:", e);
  }
}
