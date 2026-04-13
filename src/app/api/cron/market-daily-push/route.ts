import { buildYahooMarketBrief } from "@/lib/yahoo-market-brief";
import { jsonWithCors } from "@/lib/cors";
import { FEED_CACHE_ID } from "@/lib/feed-cache-constants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import {
  loadPushPrefs,
  pushLangFromDeviceLocale,
  sendFcmToTokens,
} from "@/lib/push-notifications";

function authorizeCron(request: Request): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization")?.trim();
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") === true
      ? auth.slice(7).trim()
      : null;
  if (bearer === secret) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

function kstDateString(d: Date): string {
  // KST = UTC+9. toISOString()은 UTC 기준이므로 9시간 더한 뒤 UTC 날짜를 잘라서 "KST 날짜"를 만든다.
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fmtPct(p: number): string {
  const v = Number.isFinite(p) ? p : 0;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-5-mini";

function summarizeMoversForPrompt(
  classLabel: string,
  items: Array<{ symbol: string; priceChangePct: number }>,
): { classLabel: string; gainers: string[]; losers: string[] } {
  const gainers = items
    .filter((x) => x.priceChangePct > 0)
    .sort((a, b) => b.priceChangePct - a.priceChangePct)
    .slice(0, 4)
    .map((x) => `${x.symbol} ${x.priceChangePct.toFixed(2)}%`);
  const losers = items
    .filter((x) => x.priceChangePct < 0)
    .sort((a, b) => a.priceChangePct - b.priceChangePct)
    .slice(0, 4)
    .map((x) => `${x.symbol} ${x.priceChangePct.toFixed(2)}%`);
  return { classLabel, gainers, losers };
}

async function buildMarketSummaryEnFromFeedCache(): Promise<{
  summaryEn: string;
  attributionEn: string;
  generatedAt: string;
  basis: string;
  source: "openai";
} | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[market-daily-push] market_summary skip reason=no_openai_key");
    return null;
  }
  const makeParams = (include: string) =>
    new URLSearchParams({ limit: "50", source: "yahoo_us", include });
  const [us, kr, jp, cn, crypto, commodity] = await Promise.all([
    getFeedRankings("up", makeParams("us_stock")),
    getFeedRankings("up", makeParams("kr_stock")),
    getFeedRankings("up", makeParams("jp_stock")),
    getFeedRankings("up", makeParams("cn_stock")),
    getFeedRankings("up", makeParams("crypto")),
    getFeedRankings("up", makeParams("commodity")),
  ]);
  const blocks = [
    summarizeMoversForPrompt("US stocks", us.items),
    summarizeMoversForPrompt("Korea stocks", kr.items),
    summarizeMoversForPrompt("Japan stocks", jp.items),
    summarizeMoversForPrompt("China stocks", cn.items),
    summarizeMoversForPrompt("Crypto", crypto.items),
    summarizeMoversForPrompt("Commodities", commodity.items),
  ];
  console.log(
    "[market-daily-push] market_summary openai start",
    JSON.stringify(
      blocks.map((b) => ({
        classLabel: b.classLabel,
        gainers: b.gainers.length,
        losers: b.losers.length,
      })),
    ),
  );
  const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "당신은 글로벌 시장 분석가다. 시장 요약을 영어로만 작성하라.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              "아래 급등/급락 데이터를 사용해서 영어로 시장 요약을 작성하라. 니가 판단한 현재 시장의 분위기를 주요 종목을 언급 하면서 재미있게 표현해 줘. 아래 형식의 JSON을 반환하되 응답은 영어로만 작성해 줘. {\"summaryEn\":\"string (English)\",\"attributionEn\":\"string\"}.",
            snapshots: blocks,
          }),
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI market_summary HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = parsed as { summaryEn?: unknown; attributionEn?: unknown };
  const summaryEn =
    typeof o.summaryEn === "string" && o.summaryEn.trim() !== ""
      ? o.summaryEn.trim().slice(0, 1200)
      : null;
  if (!summaryEn) return null;
  const attributionEn =
    typeof o.attributionEn === "string" && o.attributionEn.trim() !== ""
      ? o.attributionEn.trim().slice(0, 420)
      : "Based on daily mover snapshots from cached assets.";
  return {
    summaryEn,
    attributionEn,
    generatedAt: new Date().toISOString(),
    basis: "feed_cache_movers_v1",
    source: "openai",
  };
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
    let marketSummaryGenerated = false;
    let marketSummarySkipReason: string | null = null;

    // "오늘의 마켓 요약"용 A/B (상승 1등/하락 1등)
    // - getFeedRankings는 supabase dopamine_feed_cache만 사용 (네이버/야후 즉시 호출 없음)
    const rankingParams = new URLSearchParams({
      limit: "1",
      source: "yahoo_us",
    });
    const [up, down] = await Promise.all([
      getFeedRankings("up", rankingParams),
      getFeedRankings("down", rankingParams),
    ]);
    const upName = (up.items[0]?.name ?? "").trim();
    const downName = (down.items[0]?.name ?? "").trim();
    const upPct = up.items[0]?.priceChangePct ?? 0;
    const downPct = down.items[0]?.priceChangePct ?? 0;

    // 혹시 A/B를 못 구했을 때(캐시 비었을 때)를 대비해서 기본 문장도 한 번 준비
    const { briefingKo, briefingEn } = await buildYahooMarketBrief();
    const supabase = getSupabaseAdmin();
    const dayKst = kstDateString(new Date());

    // Daily-event(10:00 KST) 경로에서만 시황 캐시를 갱신한다.
    try {
      const summaryRow = await buildMarketSummaryEnFromFeedCache();
      if (summaryRow) {
        const updatedAt = new Date().toISOString();
        const { error: upsertErr } = await supabase.from("dopamine_feed_cache").upsert(
          {
            id: FEED_CACHE_ID.market_summary,
            items: summaryRow,
            updated_at: updatedAt,
          },
          { onConflict: "id" },
        );
        if (upsertErr) {
          marketSummaryGenerated = false;
          marketSummarySkipReason = "upsert_error";
          console.error("[market-daily-push] market_summary upsert failed", upsertErr);
        } else {
          marketSummaryGenerated = true;
          marketSummarySkipReason = null;
        }
        console.log("[market-daily-push] market_summary upserted", {
          id: FEED_CACHE_ID.market_summary,
          summaryLen: summaryRow.summaryEn.length,
        });
      } else {
        marketSummaryGenerated = false;
        marketSummarySkipReason = "empty_summary_or_no_key";
        console.warn("[market-daily-push] market_summary skip reason=empty_summary");
      }
    } catch (e) {
      marketSummaryGenerated = false;
      marketSummarySkipReason = "generation_failed";
      console.error("[market-daily-push] market_summary generation failed", e);
    }

    // NOTE: 기존 DB에 locale 컬럼이 아직 없는 경우(마이그레이션 미적용)도
    // 크론이 죽지 않도록 폴백한다.
    let tokenRows: Array<{ uid: string; fcm_token: string; locale?: string }> =
      [];
    const { data: tokData1, error: tokErr1 } = await supabase
      .from("dopamine_device_push_tokens")
      .select("uid, fcm_token, locale");

    if (tokErr1) {
      const code = (tokErr1 as { code?: string }).code ?? "";
      if (code === "42703") {
        console.warn(
          "[market-daily-push] locale column missing; fallback to default ko",
        );
        const { data: tokData2, error: tokErr2 } = await supabase
          .from("dopamine_device_push_tokens")
          .select("uid, fcm_token");
        if (tokErr2) {
          console.error(tokErr2);
          return jsonWithCors(
            { error: "supabase_error", detail: tokErr2.message },
            { status: 500 },
          );
        }
        tokenRows = (tokData2 ?? []) as Array<{
          uid: string;
          fcm_token: string;
          locale?: string;
        }>;
      } else {
        console.error(tokErr1);
        return jsonWithCors(
          { error: "supabase_error", detail: tokErr1.message },
          { status: 500 },
        );
      }
    } else {
      tokenRows = (tokData1 ?? []) as Array<{
        uid: string;
        fcm_token: string;
        locale?: string;
      }>;
    }

    const byUid = new Map<
      string,
      { fcm_token: string; pushLang: "ko" | "en" }
    >();
    for (const r of tokenRows ?? []) {
      const u = r.uid as string;
      const t = r.fcm_token as string;
      if (!u || !t) continue;
      byUid.set(u, {
        fcm_token: t,
        pushLang: pushLangFromDeviceLocale(r.locale),
      });
    }

    let attempted = 0;
    let sent = 0;
    let skipped = 0;
    const totalTokenCount = byUid.size;

    for (const [uid, row] of byUid) {
      const tokens = [row.fcm_token];
      const prefs = await loadPushPrefs(supabase, uid);
      if (!prefs.master_enabled || !prefs.market_daily_brief) {
        console.warn("[market-daily-push] skip by prefs", {
          dayKst,
          uid,
          masterEnabled: prefs.master_enabled,
          marketDailyBrief: prefs.market_daily_brief,
          tokensCount: tokens.length,
        });
        skipped += 1;
        continue;
      }

      const preferredLocale = row.pushLang;

      const title =
        preferredLocale === "en"
          ? "Money is rushing in."
          : "지금 돈이 몰립니다.";

      const hasUpDown = upName.length > 0 && downName.length > 0;
      const bodyKo = hasUpDown
        ? `불타는 종목: ${upName} (${fmtPct(upPct)}).\n파산 분위기: ${downName} (${fmtPct(downPct)}).`
        : briefingKo;
      const bodyEn = hasUpDown
        ? `Burning pick: ${upName} (${fmtPct(upPct)}).\nCrash vibes: ${downName} (${fmtPct(downPct)}).`
        : briefingEn;

      const body = preferredLocale === "en"
        ? truncate(bodyEn, 180)
        : truncate(bodyKo, 180);

      attempted += 1;
      await sendFcmToTokens({
        tokens,
        title,
        body,
        data: { type: "market_daily", dayUtc: dayKst },
      });
      sent += 1;
    }

    console.log("[market-daily-push] summary", {
      dayKst,
      upName,
      downName,
      uids: byUid.size,
      totalTokens: totalTokenCount,
      attempted,
      sent,
      skipped,
    });

    return jsonWithCors({
      ok: true,
      dayUtc: dayKst,
      marketSummaryGenerated,
      marketSummarySkipReason,
      usersWithTokens: byUid.size,
      attempted,
      sent,
      skipped,
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "job_failed", detail: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
