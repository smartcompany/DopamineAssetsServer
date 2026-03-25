import { getSupabaseAdmin } from "./supabase-admin";
import {
  fetchLikeCountsByCommentIds,
  fetchLikedCommentIdsForUser,
} from "./comment-like-counts";

export type CommunityPostRow = {
  id: string;
  parent_id: null;
  body: string;
  title: string | null;
  image_urls: string[];
  author_uid: string;
  author_display_name: string | null;
  created_at: string;
  asset_symbol: string;
  asset_class: string;
  asset_display_name: string | null;
  reply_count: number;
  like_count: number;
  liked_by_me: boolean;
};

type Sort = "latest" | "popular";

const ROOT_LIMIT_LATEST = 60;
const ROOT_LIMIT_POPULAR_POOL = 200;
const RESPONSE_LIMIT = 50;

export type CommunityPostsFilter = {
  /** Both required to filter by one listing */
  assetSymbol?: string;
  assetClass?: string;
  /** 본문에 이 중 하나라도 포함(대소문자 무시). 심볼 필터와 동시에 쓰이면 OR 로 합칩니다. */
  bodyTerms?: string[];
};

const ROOT_SELECT =
  "id, parent_id, body, title, image_urls, author_uid, author_display_name, created_at, asset_symbol, asset_class, asset_display_name";

type RootRow = {
  id: string;
  body: string;
  title: string | null;
  image_urls: string[];
  author_uid: string;
  author_display_name: string | null;
  created_at: string;
  asset_symbol: string;
  asset_class: string;
  asset_display_name: string | null;
};

function rowMatchesBodyTerms(
  body: string,
  title: string | null | undefined,
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const blob = `${title ?? ""} ${body}`.toLowerCase();
  const lower = terms.map((t) => t.toLowerCase());
  return lower.some((fragment) => blob.includes(fragment));
}

function parseRoot(r: Record<string, unknown>): RootRow {
  const rawUrls = r.image_urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return {
    id: r.id as string,
    body: r.body as string,
    title:
      typeof r.title === "string" && r.title.trim().length > 0
        ? r.title.trim()
        : null,
    image_urls: urls,
    author_uid: r.author_uid as string,
    author_display_name: (r.author_display_name as string | null) ?? null,
    created_at: r.created_at as string,
    asset_symbol: r.asset_symbol as string,
    asset_class: r.asset_class as string,
    asset_display_name: (r.asset_display_name as string | null) ?? null,
  };
}

export async function getCommunityPosts(
  sort: Sort,
  filter: CommunityPostsFilter = {},
  viewerUid?: string | null,
): Promise<CommunityPostRow[]> {
  const supabase = getSupabaseAdmin();

  const symbol = filter.assetSymbol?.trim();
  const assetClass = filter.assetClass?.trim();
  const hasSymbolFilter = Boolean(symbol && assetClass);

  const terms = (filter.bodyTerms ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const hasBodyTerms = terms.length > 0;

  /** 심볼로 좁힌 글 ∪ 본문 검색어에 맞는 글 (둘 중 하나만 만족해도 포함) */
  const unionSymbolOrBody = hasSymbolFilter && hasBodyTerms;

  const poolLimit =
    sort === "latest" ? ROOT_LIMIT_LATEST : ROOT_LIMIT_POPULAR_POOL;

  let roots: RootRow[] = [];
  /** 심볼+본문 동시일 때는 이미 OR 로 합쳤으므로 끝에서 본문 필터를 다시 적용하지 않음 */
  let skipPostBodyFilter = false;

  if (unionSymbolOrBody) {
    const [aRes, poolRes] = await Promise.all([
      supabase
        .from("dopamine_asset_comments")
        .select(ROOT_SELECT)
        .is("parent_id", null)
        .eq("asset_symbol", symbol!)
        .eq("asset_class", assetClass!)
        .order("created_at", { ascending: false })
        .limit(poolLimit),
      supabase
        .from("dopamine_asset_comments")
        .select(ROOT_SELECT)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(poolLimit),
    ]);

    if (aRes.error) {
      console.error("[community-posts]", aRes.error);
      throw new Error(aRes.error.message);
    }
    if (poolRes.error) {
      console.error("[community-posts]", poolRes.error);
      throw new Error(poolRes.error.message);
    }

    const rootsB = (poolRes.data ?? []).filter((row) =>
      rowMatchesBodyTerms(
        row.body as string,
        typeof row.title === "string" ? row.title : null,
        terms,
      ),
    );

    const byId = new Map<string, RootRow>();
    for (const row of [...(aRes.data ?? []), ...rootsB]) {
      const parsed = parseRoot(row as Record<string, unknown>);
      if (!byId.has(parsed.id)) {
        byId.set(parsed.id, parsed);
      }
    }

    roots = [...byId.values()].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    skipPostBodyFilter = true;
  } else {
    let rootsQuery = supabase
      .from("dopamine_asset_comments")
      .select(ROOT_SELECT)
      .is("parent_id", null);

    if (hasSymbolFilter) {
      rootsQuery = rootsQuery.eq("asset_symbol", symbol!).eq("asset_class", assetClass!);
    }

    const { data: rootsRaw, error: rootsErr } = await rootsQuery
      .order("created_at", { ascending: false })
      .limit(poolLimit);

    if (rootsErr) {
      console.error("[community-posts]", rootsErr);
      throw new Error(rootsErr.message);
    }

    if (!rootsRaw?.length) {
      return [];
    }

    roots = rootsRaw.map((r) => parseRoot(r as Record<string, unknown>));
  }

  if (!roots.length) {
    return [];
  }

  const ids = roots.map((r) => r.id);

  const { data: replyRows, error: replyErr } = await supabase
    .from("dopamine_asset_comments")
    .select("parent_id")
    .in("parent_id", ids);

  if (replyErr) {
    console.error("[community-posts] reply count", replyErr);
    throw new Error(replyErr.message);
  }

  const counts = new Map<string, number>();
  for (const row of replyRows ?? []) {
    const p = row.parent_id as string;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }

  const [likeCounts, likedSet] = await Promise.all([
    fetchLikeCountsByCommentIds(supabase, ids),
    viewerUid
      ? fetchLikedCommentIdsForUser(supabase, ids, viewerUid)
      : Promise.resolve(new Set<string>()),
  ]);

  let enriched: CommunityPostRow[] = roots.map((r) => {
    const id = r.id;
    return {
      id,
      parent_id: null,
      body: r.body,
      title: r.title,
      image_urls: r.image_urls,
      author_uid: r.author_uid,
      author_display_name: r.author_display_name,
      created_at: r.created_at,
      asset_symbol: r.asset_symbol,
      asset_class: r.asset_class,
      asset_display_name: r.asset_display_name,
      reply_count: counts.get(id) ?? 0,
      like_count: likeCounts.get(id) ?? 0,
      liked_by_me: likedSet.has(id),
    };
  });

  if (terms.length > 0 && !skipPostBodyFilter) {
    const lower = terms.map((t) => t.toLowerCase());
    enriched = enriched.filter((row) => {
      const blob = `${row.title ?? ""} ${row.body}`.toLowerCase();
      return lower.some((fragment) => blob.includes(fragment));
    });
  }

  if (sort === "latest") {
    return enriched.slice(0, RESPONSE_LIMIT);
  }

  enriched.sort((a, b) => {
    const d = b.reply_count - a.reply_count;
    if (d !== 0) return d;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return enriched.slice(0, RESPONSE_LIMIT);
}
