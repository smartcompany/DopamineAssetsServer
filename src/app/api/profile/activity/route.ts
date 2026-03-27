import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveYahooSymbol } from "@/lib/asset-detail-service";
import {
  fetchLikeCountsByCommentIds,
  fetchLikedCommentIdsForUser,
  fetchReplyCountsByParentIds,
} from "@/lib/comment-like-counts";
import { fetchYahooQuoteSummary } from "@/lib/yahoo-quote-summary";
import type { AssetClass } from "@/lib/types";

type ActivityKind =
  | "my_post"
  | "my_reply"
  | "reply_on_my_post"
  | "like_received";

type ActivityItem = {
  kind: ActivityKind;
  at: string;
  commentId: string;
  bodyPreview: string;
  assetSymbol: string;
  assetClass: string;
  /** my_post — Yahoo 등으로 해석한 종목 표시명 */
  assetDisplayName?: string;
  likeCount?: number;
  replyCount?: number;
  /** my_post / my_reply — 커뮤니티 카드와 동일 표시용 */
  body?: string;
  title?: string | null;
  imageUrls?: string[];
  postAuthorDisplayName?: string;
  likedByMe?: boolean;
  /** reply_on_my_post */
  actorUid?: string;
  actorDisplayName?: string | null;
  /** like_received */
  likerUid?: string;
  likerDisplayName?: string | null;
};

const PREVIEW = 160;
const LIMIT_EACH = 24;

function preview(body: string): string {
  const t = body.trim();
  if (t.length <= PREVIEW) return t;
  return `${t.slice(0, PREVIEW)}…`;
}

async function loadProfileNames(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  uids: string[],
): Promise<Map<string, string | null>> {
  const uniq = [...new Set(uids.filter((u) => u.length > 0))];
  const map = new Map<string, string | null>();
  if (uniq.length === 0) return map;
  const { data } = await supabase
    .from("dopamine_user_profiles")
    .select("uid, display_name")
    .in("uid", uniq);
  for (const p of data ?? []) {
    map.set(p.uid as string, (p.display_name as string | null) ?? null);
  }
  return map;
}

function pairKey(symbol: string, assetClass: string): string {
  return `${symbol}\0${assetClass}`;
}

async function resolveAssetDisplayNames(
  pairs: { symbol: string; assetClass: string }[],
): Promise<Map<string, string>> {
  const uniq = new Map<string, { symbol: string; assetClass: AssetClass }>();
  for (const p of pairs) {
    const k = pairKey(p.symbol, p.assetClass);
    if (!uniq.has(k)) {
      uniq.set(k, {
        symbol: p.symbol,
        assetClass: p.assetClass as AssetClass,
      });
    }
  }
  const out = new Map<string, string>();
  await Promise.all(
    [...uniq.values()].map(async (p) => {
      const k = pairKey(p.symbol, p.assetClass);
      const ySym = resolveYahooSymbol(p.assetClass, p.symbol);
      if (!ySym) {
        out.set(k, p.symbol);
        return;
      }
      try {
        const y = await fetchYahooQuoteSummary(ySym);
        out.set(k, y?.displayName?.trim() || p.symbol);
      } catch {
        out.set(k, p.symbol);
      }
    }),
  );
  return out;
}

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const items: ActivityItem[] = [];

    const selfNameMap = await loadProfileNames(supabase, [uid]);
    const selfProfName = selfNameMap.get(uid)?.trim();

    const { data: myRoots } = await supabase
      .from("dopamine_asset_comments")
      .select(
        "id, body, title, image_urls, created_at, asset_symbol, asset_class, author_display_name",
      )
      .eq("author_uid", uid)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT_EACH);

    const myPostIds = (myRoots ?? []).map((r) => r.id as string);
    const [likeMap, replyMap, nameMap, likedRootSet] = await Promise.all([
      fetchLikeCountsByCommentIds(supabase, myPostIds),
      fetchReplyCountsByParentIds(supabase, myPostIds),
      resolveAssetDisplayNames(
        (myRoots ?? []).map((r) => ({
          symbol: r.asset_symbol as string,
          assetClass: r.asset_class as string,
        })),
      ),
      fetchLikedCommentIdsForUser(supabase, myPostIds, uid),
    ]);

    for (const r of myRoots ?? []) {
      const sym = r.asset_symbol as string;
      const cls = r.asset_class as string;
      const pk = pairKey(sym, cls);
      const rawTitle = r.title;
      const title =
        typeof rawTitle === "string" && rawTitle.trim().length > 0
          ? rawTitle.trim().slice(0, 200)
          : null;
      const rawUrls = r.image_urls;
      const imageUrls: string[] = [];
      if (Array.isArray(rawUrls)) {
        for (const u of rawUrls) {
          if (
            typeof u === "string" &&
            u.trim().length > 0 &&
            u.startsWith("https://") &&
            u.length < 2048
          ) {
            imageUrls.push(u.trim());
          }
        }
      }
      const rawStored = r.author_display_name as string | null;
      const stored =
        typeof rawStored === "string" && rawStored.trim().length > 0
          ? rawStored.trim()
          : "User";
      const postAuthorDisplayName =
        selfProfName && selfProfName.length > 0 ? selfProfName : stored;

      items.push({
        kind: "my_post",
        at: r.created_at as string,
        commentId: r.id as string,
        bodyPreview: preview(r.body as string),
        body: r.body as string,
        title,
        imageUrls,
        postAuthorDisplayName,
        likedByMe: likedRootSet.has(r.id as string),
        assetSymbol: sym,
        assetClass: cls,
        assetDisplayName: nameMap.get(pk) ?? sym,
        likeCount: likeMap.get(r.id as string) ?? 0,
        replyCount: replyMap.get(r.id as string) ?? 0,
      });
    }

    const { data: myReplies } = await supabase
      .from("dopamine_asset_comments")
      .select(
        "id, body, title, image_urls, created_at, asset_symbol, asset_class, author_display_name",
      )
      .eq("author_uid", uid)
      .not("parent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT_EACH);

    const myReplyIds = (myReplies ?? []).map((r) => r.id as string);
    const [likeReplyMap, replyToReplyMap, nameMapReplies, likedReplySet] =
      await Promise.all([
        fetchLikeCountsByCommentIds(supabase, myReplyIds),
        fetchReplyCountsByParentIds(supabase, myReplyIds),
        resolveAssetDisplayNames(
          (myReplies ?? []).map((r) => ({
            symbol: r.asset_symbol as string,
            assetClass: r.asset_class as string,
          })),
        ),
        fetchLikedCommentIdsForUser(supabase, myReplyIds, uid),
      ]);

    for (const r of myReplies ?? []) {
      const sym = r.asset_symbol as string;
      const cls = r.asset_class as string;
      const pk = pairKey(sym, cls);
      const rawTitle = r.title;
      const title =
        typeof rawTitle === "string" && rawTitle.trim().length > 0
          ? rawTitle.trim().slice(0, 200)
          : null;
      const rawUrls = r.image_urls;
      const imageUrls: string[] = [];
      if (Array.isArray(rawUrls)) {
        for (const u of rawUrls) {
          if (
            typeof u === "string" &&
            u.trim().length > 0 &&
            u.startsWith("https://") &&
            u.length < 2048
          ) {
            imageUrls.push(u.trim());
          }
        }
      }
      const rawStored = r.author_display_name as string | null;
      const stored =
        typeof rawStored === "string" && rawStored.trim().length > 0
          ? rawStored.trim()
          : "User";
      const postAuthorDisplayName =
        selfProfName && selfProfName.length > 0 ? selfProfName : stored;

      items.push({
        kind: "my_reply",
        at: r.created_at as string,
        commentId: r.id as string,
        bodyPreview: preview(r.body as string),
        body: r.body as string,
        title,
        imageUrls,
        postAuthorDisplayName,
        likedByMe: likedReplySet.has(r.id as string),
        assetSymbol: sym,
        assetClass: cls,
        assetDisplayName: nameMapReplies.get(pk) ?? sym,
        likeCount: likeReplyMap.get(r.id as string) ?? 0,
        replyCount: replyToReplyMap.get(r.id as string) ?? 0,
      });
    }

    const { data: rootRows } = await supabase
      .from("dopamine_asset_comments")
      .select("id")
      .eq("author_uid", uid)
      .is("parent_id", null)
      .limit(200);

    const rootIds = (rootRows ?? []).map((x) => x.id as string);
    if (rootIds.length > 0) {
      const { data: repliesToMe } = await supabase
        .from("dopamine_asset_comments")
        .select(
          "id, body, created_at, asset_symbol, asset_class, author_uid, author_display_name",
        )
        .in("parent_id", rootIds)
        .neq("author_uid", uid)
        .order("created_at", { ascending: false })
        .limit(LIMIT_EACH);

      for (const r of repliesToMe ?? []) {
        items.push({
          kind: "reply_on_my_post",
          at: r.created_at as string,
          commentId: r.id as string,
          bodyPreview: preview(r.body as string),
          assetSymbol: r.asset_symbol as string,
          assetClass: r.asset_class as string,
          actorUid: r.author_uid as string,
          actorDisplayName: (r.author_display_name as string | null) ?? null,
        });
      }
    }

    const { data: myCommentIds } = await supabase
      .from("dopamine_asset_comments")
      .select("id")
      .eq("author_uid", uid)
      .limit(500);

    const mineIds = (myCommentIds ?? []).map((x) => x.id as string);
    if (mineIds.length > 0) {
      const { data: likesIn } = await supabase
        .from("dopamine_comment_likes")
        .select("comment_id, user_uid, created_at")
        .in("comment_id", mineIds)
        .neq("user_uid", uid)
        .order("created_at", { ascending: false })
        .limit(LIMIT_EACH);

      const likerUids = (likesIn ?? []).map((x) => x.user_uid as string);
      const names = await loadProfileNames(supabase, likerUids);

      const commentIds = [...new Set((likesIn ?? []).map((x) => x.comment_id as string))];
      const { data: cRows } = await supabase
        .from("dopamine_asset_comments")
        .select("id, body, asset_symbol, asset_class")
        .in("id", commentIds);
      const cMap = new Map<string, { body: string; asset_symbol: string; asset_class: string }>();
      for (const c of cRows ?? []) {
        cMap.set(c.id as string, {
          body: c.body as string,
          asset_symbol: c.asset_symbol as string,
          asset_class: c.asset_class as string,
        });
      }

      for (const row of likesIn ?? []) {
        const cid = row.comment_id as string;
        const c = cMap.get(cid);
        if (!c) continue;
        const liker = row.user_uid as string;
        items.push({
          kind: "like_received",
          at: row.created_at as string,
          commentId: cid,
          bodyPreview: preview(c.body),
          assetSymbol: c.asset_symbol,
          assetClass: c.asset_class,
          likerUid: liker,
          likerDisplayName: names.get(liker)?.trim() || null,
        });
      }
    }

    items.sort(
      (a, b) =>
        new Date(b.at).getTime() - new Date(a.at).getTime(),
    );

    return jsonWithCors({ items: items.slice(0, 80) });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
