import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureFirebaseAdmin } from "@/lib/firebase-admin-app";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type PushPrefs = {
  master_enabled: boolean;
  social_reply: boolean;
  social_like: boolean;
  followed_new_post: boolean;
  moderation_notice: boolean;
  market_daily_brief: boolean;
  market_watchlist: boolean;
  market_theme: boolean;
};

const defaultPrefs: PushPrefs = {
  master_enabled: true,
  social_reply: true,
  social_like: true,
  followed_new_post: true,
  moderation_notice: true,
  market_daily_brief: true,
  market_watchlist: true,
  market_theme: true,
};

export async function loadPushPrefs(
  supabase: SupabaseClient,
  uid: string,
): Promise<PushPrefs> {
  const { data } = await supabase
    .from("dopamine_user_push_prefs")
    .select(
      "master_enabled, social_reply, social_like, followed_new_post, moderation_notice, market_daily_brief, market_watchlist, market_theme",
    )
    .eq("uid", uid)
    .maybeSingle();
  if (!data) return { ...defaultPrefs };
  return {
    master_enabled: data.master_enabled !== false,
    social_reply: data.social_reply !== false,
    social_like: data.social_like !== false,
    followed_new_post: data.followed_new_post !== false,
    moderation_notice: data.moderation_notice !== false,
    market_daily_brief: data.market_daily_brief !== false,
    market_watchlist: data.market_watchlist !== false,
    market_theme: data.market_theme !== false,
  };
}

export async function findRootCommentId(
  supabase: SupabaseClient,
  commentId: string,
): Promise<string> {
  let cur = commentId;
  for (let i = 0; i < 64; i++) {
    const { data } = await supabase
      .from("dopamine_asset_comments")
      .select("id, parent_id")
      .eq("id", cur)
      .maybeSingle();
    if (!data) return cur;
    const pid = data.parent_id as string | null;
    if (!pid) return data.id as string;
    cur = pid;
  }
  return cur;
}

async function usersAreBlockedPair(
  supabase: SupabaseClient,
  uidA: string,
  uidB: string,
): Promise<boolean> {
  if (uidA === uidB) return true;
  const { data: a } = await supabase
    .from("dopamine_user_blocks")
    .select("blocker_uid")
    .eq("blocker_uid", uidA)
    .eq("blocked_uid", uidB)
    .maybeSingle();
  if (a) return true;
  const { data: b } = await supabase
    .from("dopamine_user_blocks")
    .select("blocker_uid")
    .eq("blocker_uid", uidB)
    .eq("blocked_uid", uidA)
    .maybeSingle();
  return !!b;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function getFcmTokensForUid(
  supabase: SupabaseClient,
  uid: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("dopamine_device_push_tokens")
    .select("fcm_token")
    .eq("uid", uid);
  if (error || !data) return [];
  const out: string[] = [];
  for (const row of data) {
    const t = row.fcm_token as string;
    if (t && t.length > 0) out.push(t);
  }
  return [...new Set(out)];
}

async function deleteInvalidFcmTokens(
  supabase: SupabaseClient,
  invalidTokens: string[],
): Promise<void> {
  if (invalidTokens.length === 0) return;
  await supabase
    .from("dopamine_device_push_tokens")
    .delete()
    .in("fcm_token", invalidTokens);
}

function hasFirebaseCredentials(): boolean {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  return !!(b64 && b64.length > 0) || !!(raw && raw.length > 0);
}

export async function sendFcmToTokens(params: {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<void> {
  const { tokens, title, body, data } = params;
  if (tokens.length === 0) return;
  if (!hasFirebaseCredentials()) {
    console.warn("[push] skip: no FIREBASE_SERVICE_ACCOUNT_JSON* env");
    return;
  }

  const admin = ensureFirebaseAdmin();
  const messaging = admin.messaging();
  const chunkSize = 500;
  const invalid: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data,
      });
      successCount += res.successCount ?? 0;
      failureCount += res.failureCount ?? 0;
      res.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error?.code ?? "";
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          const t = chunk[idx];
          if (t) invalid.push(t);
        }
      });
    } catch (e) {
      console.error("[push] sendEachForMulticast", e);
    }
  }

  if (invalid.length > 0) {
    const supabase = getSupabaseAdmin();
    await deleteInvalidFcmTokens(supabase, [...new Set(invalid)]);
  }

  console.log("[push] fcm multicast summary", {
    title,
    totalTokens: tokens.length,
    successCount,
    failureCount,
    invalidRemoved: invalid.length > 0 ? [...new Set(invalid)].length : 0,
  });
}

export async function notifyCommentReply(params: {
  recipientUid: string;
  actorUid: string;
  actorDisplayName: string;
  replyBody: string;
  symbol: string;
  assetClass: string;
  parentId: string;
  newCommentId: string;
}): Promise<void> {
  const {
    recipientUid,
    actorUid,
    actorDisplayName,
    replyBody,
    symbol,
    assetClass,
    parentId,
    newCommentId,
  } = params;
  if (recipientUid === actorUid) return;

  const supabase = getSupabaseAdmin();
  if (await usersAreBlockedPair(supabase, recipientUid, actorUid)) return;

  const prefs = await loadPushPrefs(supabase, recipientUid);
  if (!prefs.master_enabled || !prefs.social_reply) return;

  const tokens = await getFcmTokensForUid(supabase, recipientUid);
  if (tokens.length === 0) return;

  const rootId = await findRootCommentId(supabase, parentId);
  const title = "새 답글";
  const body = `${truncate(actorDisplayName, 40)}님이 답글을 남겼습니다: ${truncate(replyBody, 80)}`;

  await sendFcmToTokens({
    tokens,
    title,
    body,
    data: {
      type: "social_reply",
      symbol,
      assetClass,
      rootCommentId: rootId,
      newCommentId,
      actorDisplayName: truncate(actorDisplayName, 80),
    },
  });
}

export async function notifyCommentLiked(params: {
  recipientUid: string;
  likerUid: string;
  likerDisplayName: string;
  commentId: string;
  symbol: string;
  assetClass: string;
}): Promise<void> {
  const {
    recipientUid,
    likerUid,
    likerDisplayName,
    commentId,
    symbol,
    assetClass,
  } = params;
  if (recipientUid === likerUid) return;

  const supabase = getSupabaseAdmin();
  if (await usersAreBlockedPair(supabase, recipientUid, likerUid)) return;

  const prefs = await loadPushPrefs(supabase, recipientUid);
  if (!prefs.master_enabled || !prefs.social_like) return;

  const tokens = await getFcmTokensForUid(supabase, recipientUid);
  if (tokens.length === 0) return;

  const rootId = await findRootCommentId(supabase, commentId);
  const title = "댓글 좋아요";
  const body = `${truncate(likerDisplayName, 40)}님이 내 댓글에 좋아요를 눌렀습니다.`;

  await sendFcmToTokens({
    tokens,
    title,
    body,
    data: {
      type: "social_like",
      symbol,
      assetClass,
      rootCommentId: rootId,
      commentId,
      actorDisplayName: truncate(likerDisplayName, 80),
    },
  });
}
