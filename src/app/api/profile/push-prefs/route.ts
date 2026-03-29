import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { loadPushPrefs } from "@/lib/push-notifications";

const BOOL_KEYS = [
  "masterEnabled",
  "socialReply",
  "socialLike",
  "followedNewPost",
  "moderationNotice",
  "marketDailyBrief",
  "marketWatchlist",
  "marketTheme",
] as const;

type BoolKey = (typeof BOOL_KEYS)[number];

const DB_MAP: Record<BoolKey, string> = {
  masterEnabled: "master_enabled",
  socialReply: "social_reply",
  socialLike: "social_like",
  followedNewPost: "followed_new_post",
  moderationNotice: "moderation_notice",
  marketDailyBrief: "market_daily_brief",
  marketWatchlist: "market_watchlist",
  marketTheme: "market_theme",
};

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const p = await loadPushPrefs(supabase, uid);
    return jsonWithCors({
      prefs: {
        masterEnabled: p.master_enabled,
        socialReply: p.social_reply,
        socialLike: p.social_like,
        followedNewPost: p.followed_new_post,
        moderationNotice: p.moderation_notice,
        marketDailyBrief: p.market_daily_brief,
        marketWatchlist: p.market_watchlist,
        marketTheme: p.market_theme,
      },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return jsonWithCors({ error: "invalid_body" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  let any = false;
  for (const k of BOOL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
    const v = o[k];
    if (typeof v !== "boolean") {
      return jsonWithCors({ error: "invalid_field", field: k }, { status: 400 });
    }
    any = true;
  }
  if (!any) {
    return jsonWithCors({ error: "nothing_to_update" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const cur = await loadPushPrefs(supabase, uid);
    const row: Record<string, unknown> = {
      uid,
      master_enabled: cur.master_enabled,
      social_reply: cur.social_reply,
      social_like: cur.social_like,
      followed_new_post: cur.followed_new_post,
      moderation_notice: cur.moderation_notice,
      market_daily_brief: cur.market_daily_brief,
      market_watchlist: cur.market_watchlist,
      market_theme: cur.market_theme,
      updated_at: new Date().toISOString(),
    };
    for (const k of BOOL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      row[DB_MAP[k]] = o[k] as boolean;
    }
    const { error } = await supabase.from("dopamine_user_push_prefs").upsert(row, {
      onConflict: "uid",
    });
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    const p = await loadPushPrefs(supabase, uid);
    return jsonWithCors({
      ok: true,
      prefs: {
        masterEnabled: p.master_enabled,
        socialReply: p.social_reply,
        socialLike: p.social_like,
        followedNewPost: p.followed_new_post,
        moderationNotice: p.moderation_notice,
        marketDailyBrief: p.market_daily_brief,
        marketWatchlist: p.market_watchlist,
        marketTheme: p.market_theme,
      },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
