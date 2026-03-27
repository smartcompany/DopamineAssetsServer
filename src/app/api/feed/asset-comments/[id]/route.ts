import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin-app";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  fetchLikeCountsByCommentIds,
  fetchLikedCommentIdsForUser,
} from "@/lib/comment-like-counts";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id || id.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const viewerUid = await parseBearerUid(_request);
    const { data: row, error } = await supabase
      .from("dopamine_asset_comments")
      .select(
        "id, parent_id, body, title, image_urls, author_uid, author_display_name, asset_symbol, asset_class, asset_display_name, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    if (!row) {
      return jsonWithCors({ error: "not_found" }, { status: 404 });
    }

    const likeCounts = await fetchLikeCountsByCommentIds(supabase, [id]);
    const likedSet = viewerUid
      ? await fetchLikedCommentIdsForUser(supabase, [id], viewerUid)
      : new Set<string>();

    const authorUid = row.author_uid as string;
    let displayNameByUid = new Map<string, string>();
    if (authorUid) {
      const { data: profs } = await supabase
        .from("user_profiles")
        .select("uid, display_name")
        .eq("uid", authorUid)
        .maybeSingle();
      const dn = (profs?.display_name as string | null)?.trim();
      if (dn && dn.length > 0) {
        displayNameByUid.set(authorUid, dn);
      }
    }
    const fromProfile = displayNameByUid.get(authorUid);
    const rawStored = row.author_display_name;
    const stored =
      typeof rawStored === "string" && rawStored.trim().length > 0
        ? rawStored.trim()
        : "User";
    const author_display_name = fromProfile ?? stored;

    const item = {
      ...row,
      author_display_name,
      like_count: likeCounts.get(id) ?? 0,
      liked_by_me: likedSet.has(id),
    };

    return jsonWithCors({ item });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

async function requireAuthor(
  request: Request,
  commentId: string,
): Promise<
  | { ok: true; uid: string; supabase: ReturnType<typeof getSupabaseAdmin> }
  | { ok: false; response: Response }
> {
  const authHeader = request.headers.get("authorization")?.trim();
  const token =
    authHeader?.toLowerCase().startsWith("bearer ") === true
      ? authHeader.slice(7).trim()
      : null;

  if (!token) {
    return {
      ok: false,
      response: jsonWithCors({ error: "missing_bearer_token" }, { status: 401 }),
    };
  }

  let uid: string;
  try {
    const decoded = await verifyFirebaseIdToken(token);
    uid = decoded.uid;
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      response: jsonWithCors({ error: "invalid_token" }, { status: 401 }),
    };
  }

  const supabase = getSupabaseAdmin();
  const { data: row, error } = await supabase
    .from("dopamine_asset_comments")
    .select("id, author_uid")
    .eq("id", commentId)
    .maybeSingle();

  if (error) {
    console.error(error);
    return {
      ok: false,
      response: jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      ),
    };
  }
  if (!row) {
    return {
      ok: false,
      response: jsonWithCors({ error: "not_found" }, { status: 404 }),
    };
  }
  if ((row.author_uid as string) !== uid) {
    return {
      ok: false,
      response: jsonWithCors({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, uid, supabase };
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id || id.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  const auth = await requireAuthor(request, id);
  if (!auth.ok) return auth.response;

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
  const text = typeof o.body === "string" ? o.body.trim() : "";
  if (text.length < 1 || text.length > 2000) {
    return jsonWithCors({ error: "invalid_body_length" }, { status: 400 });
  }

  const rawTitle = o["title"];
  const titleRaw = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const titleOut =
    titleRaw.length > 0 ? titleRaw.slice(0, 200) : null;

  const rawUrls = o["imageUrls"];
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
  const imageUrlsOut = imageUrls.slice(0, 8);

  try {
    const { data: updated, error: updErr } = await auth.supabase
      .from("dopamine_asset_comments")
      .update({
        body: text,
        title: titleOut,
        image_urls: imageUrlsOut.length > 0 ? imageUrlsOut : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(
        "id, parent_id, body, title, image_urls, author_uid, author_display_name, asset_display_name, created_at",
      )
      .single();

    if (updErr) {
      console.error(updErr);
      return jsonWithCors(
        { error: "supabase_error", detail: updErr.message },
        { status: 500 },
      );
    }

    return jsonWithCors({ item: updated });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id || id.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  const auth = await requireAuthor(request, id);
  if (!auth.ok) return auth.response;

  try {
    const { error: delErr } = await auth.supabase
      .from("dopamine_asset_comments")
      .delete()
      .eq("id", id);

    if (delErr) {
      console.error(delErr);
      return jsonWithCors(
        { error: "supabase_error", detail: delErr.message },
        { status: 500 },
      );
    }

    return jsonWithCors({ ok: true });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
