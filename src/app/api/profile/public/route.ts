import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetUid = url.searchParams.get("uid")?.trim() ?? "";
  if (!targetUid) {
    return jsonWithCors({ error: "missing_uid" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const viewerUid = await parseBearerUid(request);

    const [
      { data: prof, error: profErr },
      { count: postsCount },
      { count: followingCount },
      { count: followersCount },
    ] = await Promise.all([
      supabase
        .from("dopamine_user_profiles")
        .select("display_name, photo_url, bio")
        .eq("uid", targetUid)
        .maybeSingle(),
      supabase
        .from("dopamine_asset_comments")
        .select("id", { count: "exact", head: true })
        .eq("author_uid", targetUid)
        .is("parent_id", null)
        .is("moderation_hidden_at", null),
      supabase
        .from("dopamine_user_follows")
        .select("follower_uid", { count: "exact", head: true })
        .eq("follower_uid", targetUid),
      supabase
        .from("dopamine_user_follows")
        .select("following_uid", { count: "exact", head: true })
        .eq("following_uid", targetUid),
    ]);

    if (profErr) {
      console.error(profErr);
      return jsonWithCors(
        { error: "supabase_error", detail: profErr.message },
        { status: 500 },
      );
    }

    const photoUrl = (prof?.photo_url as string | null)?.trim() || null;

    let isFollowing = false;
    let blockedByMe = false;
    if (viewerUid && viewerUid !== targetUid) {
      const [{ data: f }, { data: b }] = await Promise.all([
        supabase
          .from("dopamine_user_follows")
          .select("follower_uid")
          .eq("follower_uid", viewerUid)
          .eq("following_uid", targetUid)
          .maybeSingle(),
        supabase
          .from("dopamine_user_blocks")
          .select("blocker_uid")
          .eq("blocker_uid", viewerUid)
          .eq("blocked_uid", targetUid)
          .maybeSingle(),
      ]);
      isFollowing = !!f;
      blockedByMe = !!b;
    }

    const rawDn = (prof?.display_name as string | null)?.trim();
    const rawBio = (prof?.bio as string | null | undefined)?.trim() ?? "";
    return jsonWithCors({
      uid: targetUid,
      displayName: rawDn && rawDn.length > 0 ? rawDn : null,
      photoUrl,
      bio: rawBio.length > 0 ? rawBio : null,
      postsCount: postsCount ?? 0,
      followingCount: followingCount ?? 0,
      followersCount: followersCount ?? 0,
      isFollowing,
      blockedByMe,
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
