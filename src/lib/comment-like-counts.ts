import type { SupabaseClient } from "@supabase/supabase-js";

/** comment_id -> like count */
export async function fetchLikeCountsByCommentIds(
  supabase: SupabaseClient,
  commentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (commentIds.length === 0) {
    return out;
  }
  const { data, error } = await supabase
    .from("dopamine_comment_likes")
    .select("comment_id")
    .in("comment_id", commentIds);

  if (error) {
    console.error("[comment-like-counts]", error);
    return out;
  }
  for (const row of data ?? []) {
    const id = row.comment_id as string;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export async function fetchLikedCommentIdsForUser(
  supabase: SupabaseClient,
  commentIds: string[],
  userUid: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (commentIds.length === 0) {
    return set;
  }
  const { data, error } = await supabase
    .from("dopamine_comment_likes")
    .select("comment_id")
    .eq("user_uid", userUid)
    .in("comment_id", commentIds);

  if (error) {
    console.error("[liked-ids]", error);
    return set;
  }
  for (const row of data ?? []) {
    set.add(row.comment_id as string);
  }
  return set;
}

/** parent_id(루트 댓글 id)별 직접 답글 개수 */
export async function fetchReplyCountsByParentIds(
  supabase: SupabaseClient,
  parentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (parentIds.length === 0) {
    return out;
  }
  const { data, error } = await supabase
    .from("dopamine_asset_comments")
    .select("parent_id")
    .in("parent_id", parentIds)
    .is("moderation_hidden_at", null);

  if (error) {
    console.error("[reply-counts-by-parent]", error);
    return out;
  }
  for (const row of data ?? []) {
    const pid = row.parent_id as string;
    out.set(pid, (out.get(pid) ?? 0) + 1);
  }
  return out;
}
