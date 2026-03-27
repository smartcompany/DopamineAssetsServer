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

  const raw = (body as Record<string, unknown>).targetUid;
  const targetUid = typeof raw === "string" ? raw.trim() : "";
  if (!targetUid || targetUid === uid) {
    return jsonWithCors({ error: "invalid_target" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error: blockErr } = await supabase.from("dopamine_user_blocks").insert({
      blocker_uid: uid,
      blocked_uid: targetUid,
    });
    if (blockErr && blockErr.code !== "23505") {
      console.error(blockErr);
      return jsonWithCors(
        { error: "supabase_error", detail: blockErr.message },
        { status: 500 },
      );
    }

    // 차단 시 상호 팔로우 관계는 정리
    const { error: unfollow1 } = await supabase
      .from("dopamine_user_follows")
      .delete()
      .eq("follower_uid", uid)
      .eq("following_uid", targetUid);
    if (unfollow1) {
      console.error(unfollow1);
    }
    const { error: unfollow2 } = await supabase
      .from("dopamine_user_follows")
      .delete()
      .eq("follower_uid", targetUid)
      .eq("following_uid", uid);
    if (unfollow2) {
      console.error(unfollow2);
    }

    return jsonWithCors({ ok: true, blocked: true });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const targetUid = url.searchParams.get("targetUid")?.trim() ?? "";
  if (!targetUid) {
    return jsonWithCors({ error: "missing_target_uid" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("dopamine_user_blocks")
      .delete()
      .eq("blocker_uid", uid)
      .eq("blocked_uid", targetUid);
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    return jsonWithCors({ ok: true, blocked: false });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
