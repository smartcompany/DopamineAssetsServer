import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const [{ count: postsCount }, { count: followingCount }, { count: followersCount }] =
      await Promise.all([
        supabase
          .from("dopamine_asset_comments")
          .select("id", { count: "exact", head: true })
          .eq("author_uid", uid)
          .is("parent_id", null),
        supabase
          .from("dopamine_user_follows")
          .select("follower_uid", { count: "exact", head: true })
          .eq("follower_uid", uid),
        supabase
          .from("dopamine_user_follows")
          .select("following_uid", { count: "exact", head: true })
          .eq("following_uid", uid),
      ]);

    return jsonWithCors({
      postsCount: postsCount ?? 0,
      followingCount: followingCount ?? 0,
      followersCount: followersCount ?? 0,
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
