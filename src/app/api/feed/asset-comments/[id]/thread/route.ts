import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  fetchLikeCountsByCommentIds,
  fetchLikedCommentIdsForUser,
} from "@/lib/comment-like-counts";

type RouteCtx = { params: Promise<{ id: string }> };

const SELECT_FIELDS =
  "id, parent_id, body, title, image_urls, author_uid, author_display_name, asset_display_name, created_at";

export async function GET(request: Request, ctx: RouteCtx) {
  const { id: rootId } = await ctx.params;
  if (!rootId || rootId.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const viewerUid = await parseBearerUid(request);

    const { data: rootRow, error: rootErr } = await supabase
      .from("dopamine_asset_comments")
      .select(
        `${SELECT_FIELDS}, asset_symbol, asset_class, moderation_hidden_at`,
      )
      .eq("id", rootId)
      .maybeSingle();

    if (rootErr) {
      console.error(rootErr);
      return jsonWithCors(
        { error: "supabase_error", detail: rootErr.message },
        { status: 500 },
      );
    }
    if (!rootRow) {
      return jsonWithCors({ error: "not_found" }, { status: 404 });
    }

    const rootAuthorUid = rootRow.author_uid as string;
    if (rootRow.moderation_hidden_at != null) {
      if (!viewerUid || viewerUid !== rootAuthorUid) {
        return jsonWithCors({ error: "not_found" }, { status: 404 });
      }
    }

    const sym = rootRow.asset_symbol as string;
    const cls = rootRow.asset_class as string;

    const collected = new Map<string, Record<string, unknown>>();
    collected.set(rootRow.id as string, rootRow);

    let frontier: string[] = [rootId];
    for (;;) {
      if (frontier.length === 0) break;
      const { data: children, error: chErr } = await supabase
        .from("dopamine_asset_comments")
        .select(SELECT_FIELDS)
        .eq("asset_symbol", sym)
        .eq("asset_class", cls)
        .in("parent_id", frontier)
        .is("moderation_hidden_at", null);

      if (chErr) {
        console.error(chErr);
        return jsonWithCors(
          { error: "supabase_error", detail: chErr.message },
          { status: 500 },
        );
      }

      const next: string[] = [];
      for (const c of children ?? []) {
        const cid = c.id as string;
        if (!collected.has(cid)) {
          collected.set(cid, c);
          next.push(cid);
        }
      }
      frontier = next;
    }

    const rows = Array.from(collected.values()).sort(
      (a, b) =>
        new Date(a.created_at as string).getTime() -
        new Date(b.created_at as string).getTime(),
    );

    const authorUids = [...new Set(rows.map((r) => r.author_uid as string))];
    const displayNameByUid = new Map<string, string>();
    const photoByUid = new Map<string, string | null>();
    if (authorUids.length > 0) {
      const { data: profs, error: profErr } = await supabase
        .from("dopamine_user_profiles")
        .select("uid, display_name, photo_url")
        .in("uid", authorUids);
      if (profErr) {
        console.error(profErr);
      } else {
        for (const p of profs ?? []) {
          const uid = p.uid as string;
          const dn = (p.display_name as string | null)?.trim();
          if (dn && dn.length > 0) {
            displayNameByUid.set(uid, dn);
          }
          const ph = (p.photo_url as string | null)?.trim();
          photoByUid.set(uid, ph && ph.length > 0 ? ph : null);
        }
      }
    }

    const ids = rows.map((r) => r.id as string);
    const [likeCounts, likedSet] = await Promise.all([
      fetchLikeCountsByCommentIds(supabase, ids),
      viewerUid
        ? fetchLikedCommentIdsForUser(supabase, ids, viewerUid)
        : Promise.resolve(new Set<string>()),
    ]);

    const rootHidden =
      rootRow.moderation_hidden_at != null &&
      viewerUid != null &&
      viewerUid === rootAuthorUid;

    const items = rows.map((r) => {
      const id = r.id as string;
      const uid = r.author_uid as string;
      const fromProfile = displayNameByUid.get(uid);
      const rawStored = r.author_display_name;
      const stored =
        typeof rawStored === "string" && rawStored.trim().length > 0
          ? rawStored.trim()
          : "User";
      const author_display_name = fromProfile ?? stored;
      const author_photo_url = photoByUid.get(uid) ?? null;
      return {
        id: r.id,
        parent_id: r.parent_id,
        body: r.body,
        title: r.title,
        image_urls: r.image_urls,
        author_uid: r.author_uid,
        asset_display_name: r.asset_display_name,
        created_at: r.created_at,
        asset_symbol: sym,
        asset_class: cls,
        author_display_name,
        author_photo_url,
        like_count: likeCounts.get(id) ?? 0,
        liked_by_me: likedSet.has(id),
        moderation_hidden_from_public: rootHidden && id === rootId,
      };
    });

    return jsonWithCors({ items });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
