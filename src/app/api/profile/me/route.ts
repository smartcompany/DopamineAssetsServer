import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { checkBannedWords } from "@/lib/validate-banned-words";

const MAX_NAME = 80;

function isMissingTableError(error: { code?: string } | null | undefined) {
  return error?.code === "42P01";
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
  const hasDisplayName = typeof o.displayName === "string";
  const hasPhotoUrl = Object.prototype.hasOwnProperty.call(o, "photoUrl");
  const rawName = hasDisplayName ? (o.displayName as string).trim() : "";
  const rawPhoto =
    hasPhotoUrl && typeof o.photoUrl === "string" ? o.photoUrl.trim() : null;
  const photoUrl =
    rawPhoto != null && rawPhoto.length > 0 ? rawPhoto.slice(0, 2048) : null;
  if (!hasDisplayName && !hasPhotoUrl) {
    return jsonWithCors({ error: "nothing_to_update" }, { status: 400 });
  }
  if (hasDisplayName && (rawName.length < 1 || rawName.length > MAX_NAME)) {
    return jsonWithCors(
      { error: "invalid_display_name", max: MAX_NAME },
      { status: 400 },
    );
  }
  if (hasDisplayName) {
    const banned = checkBannedWords(rawName);
    if (banned) {
      return jsonWithCors(
        {
          error: "banned_words",
          field: "displayName",
          message: `허용되지 않는 표현이 포함되어 있습니다: ${banned}`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("dopamine_user_profiles").upsert(
      {
        uid,
        ...(hasDisplayName ? { display_name: rawName } : {}),
        ...(hasPhotoUrl ? { photo_url: photoUrl } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "uid" },
    );
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    return jsonWithCors({
      ok: true,
      ...(hasDisplayName ? { displayName: rawName } : {}),
      ...(hasPhotoUrl ? { photoUrl } : {}),
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dopamine_user_profiles")
      .select("uid, display_name, photo_url")
      .eq("uid", uid)
      .maybeSingle();
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return jsonWithCors({ profile: null });
    }
    const displayName = (data.display_name as string | null)?.trim();
    if (!displayName) {
      return jsonWithCors({ profile: null });
    }
    const photoUrl = (data.photo_url as string | null)?.trim() || null;
    return jsonWithCors({
      profile: {
        uid,
        displayName,
        photoUrl,
      },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    console.warn("[profile/me][DELETE] missing_or_invalid_token");
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  try {
    console.info(`[profile/me][DELETE] start uid=${uid}`);
    const supabase = getSupabaseAdmin();

    // 1) 내가 쓴 댓글/게시글 삭제 (이 단계는 반드시 성공해야 함)
    const { error: commentErr } = await supabase
      .from("dopamine_asset_comments")
      .delete()
      .eq("author_uid", uid);
    if (commentErr) {
      console.error(commentErr);
      return jsonWithCors(
        { error: "supabase_error", detail: commentErr.message },
        { status: 500 },
      );
    }

    // 2) 내가 남긴 좋아요 삭제 (타인 글 포함)
    // social 테이블 누락 시에도 탈퇴/게시글 삭제는 진행
    const { error: likeErr } = await supabase
      .from("dopamine_comment_likes")
      .delete()
      .eq("user_uid", uid);
    if (likeErr && !isMissingTableError(likeErr)) {
      console.error(likeErr);
      return jsonWithCors(
        { error: "supabase_error", detail: likeErr.message },
        { status: 500 },
      );
    }
    if (isMissingTableError(likeErr)) {
      console.warn("[profile/me][DELETE] dopamine_comment_likes missing; skip");
    }

    // 3) 팔로우/차단 관계 정리 (양방향)
    const [f1, f2, b1, b2] = await Promise.all([
      supabase
        .from("dopamine_user_follows")
        .delete()
        .eq("follower_uid", uid),
      supabase
        .from("dopamine_user_follows")
        .delete()
        .eq("following_uid", uid),
      supabase
        .from("dopamine_user_blocks")
        .delete()
        .eq("blocker_uid", uid),
      supabase
        .from("dopamine_user_blocks")
        .delete()
        .eq("blocked_uid", uid),
    ]);
    const relationErrs = [f1.error, f2.error, b1.error, b2.error].filter(
      (e): e is NonNullable<typeof e> => !!e,
    );
    const hardRelationErr = relationErrs.find((e) => !isMissingTableError(e));
    if (hardRelationErr) {
      console.error(hardRelationErr);
      return jsonWithCors(
        { error: "supabase_error", detail: hardRelationErr.message },
        { status: 500 },
      );
    }
    if (relationErrs.length > 0) {
      console.warn("[profile/me][DELETE] some relation tables missing; skip");
    }

    // 4) 프로필 삭제
    const { error: profileErr } = await supabase
      .from("dopamine_user_profiles")
      .delete()
      .eq("uid", uid);
    if (profileErr && !isMissingTableError(profileErr)) {
      console.error(profileErr);
      return jsonWithCors(
        { error: "supabase_error", detail: profileErr.message },
        { status: 500 },
      );
    }
    if (isMissingTableError(profileErr)) {
      console.warn("[profile/me][DELETE] dopamine_user_profiles missing; skip");
    }

    console.info(`[profile/me][DELETE] done uid=${uid}`);
    return jsonWithCors({ ok: true });
  } catch (e) {
    console.error(`[profile/me][DELETE] failed uid=${uid}`, e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
