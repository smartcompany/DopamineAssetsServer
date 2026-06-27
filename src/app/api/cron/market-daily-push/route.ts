import { ai } from "@/lib/ai-client";
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

type MoverInput = { symbol: string; name?: string; priceChangePct: number };
type MoverEntry = { name: string; symbol: string; changePct: string };

function moverEntry(x: MoverInput): MoverEntry {
  // 사람이 읽는 이름을 우선 보여주고, 티커는 보조 표기로만 둔다.
  // name이 비어 있을 때만 티커가 1순위 식별자로 노출된다.
  const cleanName = (x.name ?? "").trim();
  const cleanSymbol = x.symbol.trim();
  const displayName = cleanName.length > 0 ? cleanName : cleanSymbol;
  return {
    name: displayName,
    symbol: cleanSymbol,
    changePct: `${x.priceChangePct >= 0 ? "+" : ""}${x.priceChangePct.toFixed(
      2,
    )}%`,
  };
}

function summarizeMoversForPrompt(
  classLabel: string,
  items: Array<MoverInput>,
): { classLabel: string; gainers: MoverEntry[]; losers: MoverEntry[] } {
  const gainers = items
    .filter((x) => x.priceChangePct > 0)
    .sort((a, b) => b.priceChangePct - a.priceChangePct)
    .slice(0, 4)
    .map(moverEntry);
  const losers = items
    .filter((x) => x.priceChangePct < 0)
    .sort((a, b) => a.priceChangePct - b.priceChangePct)
    .slice(0, 4)
    .map(moverEntry);
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
  const response = await ai.createChatCompletion({
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "당신은 글로벌 시장 분석가이자 똑똑한 마켓 라이터입니다. 사실에 기반하지만, 일반 독자가 끝까지 읽고 싶도록 흥미롭고 또렷한 영어 시장 요약을 작성합니다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "아래 snapshots(자산군별 상승·하락 상위 종목)를 바탕으로 오늘의 시장 요약을 영어로 작성하세요. 단조로운 사실 나열이 아니라, 관심을 끌면서도 정확한 마켓 코멘터리를 목표로 합니다.",
          tone: [
            "후킹은 강하게, 표현은 절제. 첫 문장은 오늘 시장의 캐릭터(예: 위험 선호 회복, 차익실현, 양극화 등)를 또렷하게 짚어 독자가 계속 읽고 싶게 만든다.",
            "스마트하고 자신감 있는 어투. 친근하되 가벼워 보이지 않게.",
            "비유는 1번까지 허용하되 짧고 자연스러운 표현만. '로켓', '폭죽', '색종이 조각' 같은 과장된 비유·이모지·감탄사·뻔한 광고체는 금지.",
          ],
          structure: [
            "분량: 3~4개의 짧은 문장, 합쳐서 약 360자 이내.",
            "1문장: 오늘의 시장 캐릭터 한 줄 — 매크로 분위기 또는 흐름 요약.",
            "2~3문장: 가장 눈에 띄는 지역/자산군 1~2개를 골라, 대표 종목 1~2개를 이름과 변동률(%)로 구체적으로 짚어준다.",
            "마지막 문장(선택): 암호화폐·원자재의 두드러진 흐름이나, 다음 관전 포인트 한 줄로 마무리.",
          ],
          naming_rules: [
            "종목은 항상 사람이 읽기 쉬운 '이름'으로 부른다. 예: 'POSCO Future M', 'Bitcoin', 'Crude Oil'.",
            "필요 시 이름 뒤 괄호로 티커를 덧붙일 수 있다. 예: 'POSCO Future M (003670.KS) +12%'.",
            "'011790.KS', '7162.T' 같이 티커만 단독으로 쓰는 것은 금지. 항상 이름과 함께 표기한다.",
            "snapshots에 들어 있는 이름·티커만 사용한다. 새로 만들어 넣지 않는다.",
          ],
          format: [
            "결과는 한 단락의 영어 평문(plain text).",
            "글머리 기호·마크다운·헤더·이모지 금지.",
          ],
          output_format:
            '{"summaryEn":"string (English, plain text)"}',
          snapshots: blocks,
        }),
      },
    ],
  });
  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = parsed as { summaryEn?: unknown };
  // 길이 안전장치: 모델이 길게 풀어 쓰는 경우에 대비해 480자에서 컷.
  // 일반 케이스에선 프롬프트 가이드(<=360자)에 의해 이보다 짧게 들어온다.
  const summaryEn =
    typeof o.summaryEn === "string" && o.summaryEn.trim() !== ""
      ? o.summaryEn.trim().slice(0, 480)
      : null;
  if (!summaryEn) return null;
  // attribution은 모델에게 생성시키지 않고 고정 문장만 사용한다 (토큰 절약).
  // 본문 아래 작은 글씨 캡션으로 표기되며, 클라이언트가 자동 번역해 노출한다.
  const attributionEn = "Based on daily mover snapshots from cached assets.";
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
