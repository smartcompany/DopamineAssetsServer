import { jsonWithCors } from "@/lib/cors";
import { FEED_CACHE_ID } from "@/lib/feed-cache-constants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildYahooMarketBrief } from "@/lib/yahoo-market-brief";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const {
    briefingKo,
    briefingEn,
    attributionKo,
    attributionEn,
  } = await buildYahooMarketBrief();

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("dopamine_feed_cache")
    .select("items")
    .eq("id", FEED_CACHE_ID.market_summary)
    .maybeSingle();

  const cached = (data?.items ?? null) as
    | { summaryEn?: unknown; attributionEn?: unknown }
    | null;
  const cachedSummaryEn =
    cached && typeof cached.summaryEn === "string" && cached.summaryEn.trim() !== ""
      ? cached.summaryEn.trim()
      : null;
  const cachedAttributionEn =
    cached &&
    typeof cached.attributionEn === "string" &&
    cached.attributionEn.trim() !== ""
      ? cached.attributionEn.trim()
      : null;

  return jsonWithCors({
    briefing: cachedSummaryEn ?? briefingKo,
    briefingEn: cachedSummaryEn ?? briefingEn,
    attribution: cachedAttributionEn ?? attributionKo,
    attributionEn: cachedAttributionEn ?? attributionEn,
    kimchiPremiumPct: null,
    usdKrw: null,
    marketStatus: null,
  });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
