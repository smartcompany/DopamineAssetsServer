import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
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
  const rawCommentId = o["commentId"];
  const commentId =
    typeof rawCommentId === "string" ? rawCommentId.trim() : "";
  if (!commentId) {
    return jsonWithCors({ error: "missing_comment_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error: findErr } = await supabase
      .from("dopamine_asset_comments")
      .select("id")
      .eq("id", commentId)
      .maybeSingle();

    if (findErr || !row) {
      return jsonWithCors({ error: "comment_not_found" }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("dopamine_comment_likes")
      .select("comment_id")
      .eq("comment_id", commentId)
      .eq("user_uid", uid)
      .maybeSingle();

    if (existing) {
      const { error: delErr } = await supabase
        .from("dopamine_comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_uid", uid);
      if (delErr) {
        console.error(delErr);
        return jsonWithCors(
          { error: "supabase_error", detail: delErr.message },
          { status: 500 },
        );
      }
    } else {
      const { error: insErr } = await supabase.from("dopamine_comment_likes").insert({
        comment_id: commentId,
        user_uid: uid,
      });
      if (insErr) {
        console.error(insErr);
        return jsonWithCors(
          { error: "supabase_error", detail: insErr.message },
          { status: 500 },
        );
      }
    }

    const { count, error: cntErr } = await supabase
      .from("dopamine_comment_likes")
      .select("user_uid", { count: "exact", head: true })
      .eq("comment_id", commentId);

    if (cntErr) {
      console.error(cntErr);
    }

    return jsonWithCors({
      liked: !existing,
      likeCount: count ?? 0,
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
