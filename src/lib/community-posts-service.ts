import { getSupabaseAdmin } from "./supabase-admin";

export type CommunityPostRow = {
  id: string;
  parent_id: null;
  body: string;
  author_uid: string;
  author_display_name: string | null;
  created_at: string;
  asset_symbol: string;
  asset_class: string;
  reply_count: number;
};

type Sort = "latest" | "popular";

const ROOT_LIMIT_LATEST = 60;
const ROOT_LIMIT_POPULAR_POOL = 200;
const RESPONSE_LIMIT = 50;

export async function getCommunityPosts(sort: Sort): Promise<CommunityPostRow[]> {
  const supabase = getSupabaseAdmin();

  const { data: roots, error: rootsErr } = await supabase
    .from("dopamine_asset_comments")
    .select(
      "id, parent_id, body, author_uid, author_display_name, created_at, asset_symbol, asset_class",
    )
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(sort === "latest" ? ROOT_LIMIT_LATEST : ROOT_LIMIT_POPULAR_POOL);

  if (rootsErr) {
    console.error("[community-posts]", rootsErr);
    throw new Error(rootsErr.message);
  }

  if (!roots?.length) {
    return [];
  }

  const ids = roots.map((r) => r.id as string);

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

  const enriched: CommunityPostRow[] = roots.map((r) => ({
    id: r.id as string,
    parent_id: null,
    body: r.body as string,
    author_uid: r.author_uid as string,
    author_display_name: (r.author_display_name as string | null) ?? null,
    created_at: r.created_at as string,
    asset_symbol: r.asset_symbol as string,
    asset_class: r.asset_class as string,
    reply_count: counts.get(r.id as string) ?? 0,
  }));

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
