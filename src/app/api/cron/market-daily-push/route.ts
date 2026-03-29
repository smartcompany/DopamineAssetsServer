import { buildYahooMarketBrief } from "@/lib/yahoo-market-brief";
import { jsonWithCors } from "@/lib/cors";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
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

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    const { briefingKo } = await buildYahooMarketBrief();
    const supabase = getSupabaseAdmin();
    const dayUtc = utcDateString(new Date());

    const { data: tokenRows, error: tokErr } = await supabase
      .from("dopamine_device_push_tokens")
      .select("uid, fcm_token");

    if (tokErr) {
      console.error(tokErr);
      return jsonWithCors(
        { error: "supabase_error", detail: tokErr.message },
        { status: 500 },
      );
    }

    const byUid = new Map<string, string[]>();
    for (const r of tokenRows ?? []) {
      const u = r.uid as string;
      const t = r.fcm_token as string;
      if (!u || !t) continue;
      const arr = byUid.get(u) ?? [];
      arr.push(t);
      byUid.set(u, arr);
    }

    let attempted = 0;
    let sent = 0;
    let skipped = 0;

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
        .eq("day_utc", dayUtc)
        .maybeSingle();
      if (already) {
        skipped += 1;
        continue;
      }

      attempted += 1;
      await sendFcmToTokens({
        tokens: uniq,
        title: "오늘의 마켓 브리프",
        body: truncate(briefingKo, 180),
        data: { type: "market_daily", dayUtc },
      });
      const { error: insErr } = await supabase
        .from("dopamine_market_daily_push_sent")
        .insert({ uid, day_utc: dayUtc });
      if (insErr) {
        const code = (insErr as { code?: string }).code;
        if (code !== "23505") console.error(insErr);
      }
      sent += 1;
    }

    return jsonWithCors({
      ok: true,
      dayUtc,
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
