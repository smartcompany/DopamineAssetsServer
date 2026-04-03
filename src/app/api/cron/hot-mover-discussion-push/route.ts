import { jsonWithCors } from "@/lib/cors";
import {
  configToPayload,
  loadHotMoverDiscussionConfig,
} from "@/lib/hot-mover-discussion-config";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  currentHotMoverDiscussionBucket,
  pickHotMoverDiscussion,
} from "@/lib/hot-mover-discussion-push";
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

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const bucket = currentHotMoverDiscussionBucket();
    const discussionConfig = await loadHotMoverDiscussionConfig(supabase);
    const configPayload = configToPayload(discussionConfig);

    const pick = await pickHotMoverDiscussion(supabase, discussionConfig);
    if (!pick) {
      return jsonWithCors({
        ok: true,
        skipped: "no_candidate",
        bucket: bucket.toString(),
        discussionConfig: configPayload,
      });
    }

    const bucketNum = Number(bucket);
    const { error: claimErr } = await supabase
      .from("dopamine_hot_mover_discussion_push_sent")
      .insert({
        bucket: bucketNum,
        symbol: pick.symbol,
        asset_class: pick.assetClass,
        root_comment_id: pick.rootCommentId,
      });

    if (claimErr) {
      const code = (claimErr as { code?: string }).code ?? "";
      if (code === "23505") {
        return jsonWithCors({
          ok: true,
          skipped: "already_sent_this_window",
          bucket: bucket.toString(),
          symbol: pick.symbol,
          assetClass: pick.assetClass,
        });
      }
      console.error("[hot-mover-discussion-push] claim row", claimErr);
      return jsonWithCors(
        { error: "supabase_error", detail: claimErr.message },
        { status: 500 },
      );
    }

    let tokenRows: Array<{ uid: string; fcm_token: string; locale?: string }> =
      [];
    const { data: tokData1, error: tokErr1 } = await supabase
      .from("dopamine_device_push_tokens")
      .select("uid, fcm_token, locale");

    if (tokErr1) {
      const code = (tokErr1 as { code?: string }).code ?? "";
      if (code === "42703") {
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

    for (const [uid, tokens] of byUid) {
      const uniq = [...new Set(tokens)];
      let prefs;
      try {
        prefs = await loadPushPrefs(supabase, uid);
      } catch {
        skipped += 1;
        continue;
      }
      if (!prefs.master_enabled || !prefs.hot_mover_discussion) {
        skipped += 1;
        continue;
      }

      const score = localeScoreByUid.get(uid) ?? { ko: 1, en: 0 };
      const preferredLocale = score.en >= score.ko ? "en" : "ko";
      const upDown =
        pick.priceChangePct >= 0
          ? preferredLocale === "en"
            ? "surging"
            : "급등"
          : preferredLocale === "en"
            ? "sliding"
            : "급락";

      const title =
        preferredLocale === "en"
          ? "Hot discussion"
          : "지금 뜨는 토론";

      const body =
        preferredLocale === "en"
          ? `${truncate(pick.displayName, 36)} is ${upDown} (${fmtPct(pick.priceChangePct)}) — lively thread in Community.`
          : `${truncate(pick.displayName, 36)} ${upDown} 중 (${fmtPct(pick.priceChangePct)}) · 커뮤니티에서 활발해요.`;

      attempted += 1;
      await sendFcmToTokens({
        tokens: uniq,
        title,
        body: truncate(body, 180),
        data: {
          type: "hot_mover_discussion",
          symbol: pick.symbol,
          assetClass: pick.assetClass,
          rootCommentId: pick.rootCommentId,
        },
      });
      sent += 1;
    }

    console.log("[hot-mover-discussion-push] summary", {
      bucket: bucket.toString(),
      discussionConfig: configPayload,
      pick: {
        symbol: pick.symbol,
        assetClass: pick.assetClass,
        rootCommentId: pick.rootCommentId,
        activityScore: pick.activityScore,
      },
      uids: byUid.size,
      attempted,
      sent,
      skipped,
    });

    return jsonWithCors({
      ok: true,
      bucket: bucket.toString(),
      discussionConfig: configPayload,
      symbol: pick.symbol,
      assetClass: pick.assetClass,
      rootCommentId: pick.rootCommentId,
      activityScore: pick.activityScore,
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
