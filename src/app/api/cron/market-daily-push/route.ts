import { buildYahooMarketBrief } from "@/lib/yahoo-market-brief";
import { jsonWithCors } from "@/lib/cors";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import {
  loadPushPrefs,
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

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
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

    // 혹시 A/B를 못 구했을 때(캐시 비었을 때)를 대비해서 기본 문장도 한 번 준비
    const { briefingKo, briefingEn } = await buildYahooMarketBrief();
    const supabase = getSupabaseAdmin();
    const dayKst = kstDateString(new Date());

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

    const byUid = new Map<string, string[]>();
    const localeScoreByUid = new Map<string, { ko: number; en: number }>();
    for (const r of tokenRows ?? []) {
      const u = r.uid as string;
      const t = r.fcm_token as string;
      if (!u || !t) continue;
      const arr = byUid.get(u) ?? [];
      arr.push(t);
      byUid.set(u, arr);

      const rawLocale = typeof r.locale === "string" ? r.locale : "";
      const loc = rawLocale.trim().toLowerCase().startsWith("en")
        ? "en"
        : "ko";
      const score = localeScoreByUid.get(u) ?? { ko: 0, en: 0 };
      if (loc === "en") score.en += 1;
      else score.ko += 1;
      localeScoreByUid.set(u, score);
    }

    let attempted = 0;
    let sent = 0;
    let skipped = 0;
    const totalTokenCount = [...byUid.values()].reduce(
      (acc, arr) => acc + (arr?.length ?? 0),
      0,
    );

    for (const [uid, tokens] of byUid) {
      const uniq = [...new Set(tokens)];
      const prefs = await loadPushPrefs(supabase, uid);
      if (!prefs.master_enabled || !prefs.market_daily_brief) {
        skipped += 1;
        continue;
      }

      const { data: already } = await supabase
        .from("dopamine_market_daily_push_sent")
        .select("uid")
        .eq("uid", uid)
        .eq("day_utc", dayKst)
        .maybeSingle();
      if (already) {
        skipped += 1;
        continue;
      }

      const score = localeScoreByUid.get(uid) ?? { ko: 1, en: 0 };
      const preferredLocale = score.en >= score.ko ? "en" : "ko";

      const title =
        preferredLocale === "en"
          ? "Daily market summary"
          : "오늘의 마켓 요약";

      const hasUpDown = upName.length > 0 && downName.length > 0;
      const bodyKo = hasUpDown
        ? `지금 돈이 몰립니다. 불타는 종목: ${upName}. 반대로 파산 직전 분위기: ${downName}.`
        : briefingKo;
      const bodyEn = hasUpDown
        ? `Money is rushing in. Burning pick: ${upName}. Meanwhile, crash vibes are building: ${downName}.`
        : briefingEn;

      const body = preferredLocale === "en"
        ? truncate(bodyEn, 180)
        : truncate(bodyKo, 180);

      attempted += 1;
      await sendFcmToTokens({
        tokens: uniq,
        title,
        body,
        data: { type: "market_daily", dayUtc: dayKst },
      });
      const { error: insErr } = await supabase
        .from("dopamine_market_daily_push_sent")
        .insert({ uid, day_utc: dayKst });
      if (insErr) {
        const code = (insErr as { code?: string }).code;
        if (code !== "23505") console.error(insErr);
      }
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
