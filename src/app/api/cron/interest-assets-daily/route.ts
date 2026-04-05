import { jsonWithCors } from "@/lib/cors";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import { fetchInterestAssetsFromOpenAI } from "@/lib/interest-assets-openai";
import { persistInterestAssetsPayloadToSupabase } from "@/lib/interest-assets-supabase-sync";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 120;

/**
 * 일 1회: OpenAI 관심 TOP50 생성 → Supabase `dopamine_interest_asset_scores` 병합.
 * GitHub `daily-event.yml` 에서 `CRON_SECRET` Bearer 로 호출.
 */
export async function POST(request: Request) {
  if (!isCronAuthorizedRequest(request)) {
    return jsonWithCors({ error: "cron_unauthorized" }, { status: 401 });
  }

  try {
    const payload = await fetchInterestAssetsFromOpenAI();
    const supabase = getSupabaseAdmin();
    const { rowCount, date } = await persistInterestAssetsPayloadToSupabase(
      supabase,
      payload,
    );
    return jsonWithCors({ ok: true, date, rowCount });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.includes("OPENAI_API_KEY")) {
      return jsonWithCors({ error: "openai_key_missing", detail }, { status: 503 });
    }
    console.error("[interest-assets-daily]", e);
    return jsonWithCors({ error: "interest_assets_daily_failed", detail }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
