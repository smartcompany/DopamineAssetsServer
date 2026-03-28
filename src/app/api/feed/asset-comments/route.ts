import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin-app";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  fetchLikeCountsByCommentIds,
  fetchLikedCommentIdsForUser,
} from "@/lib/comment-like-counts";
import { checkBannedWords } from "@/lib/validate-banned-words";

const CLASSES = new Set(["us_stock", "kr_stock", "crypto", "commodity", "theme"]);

type AssetClass = "us_stock" | "kr_stock" | "crypto" | "commodity" | "theme";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.trim();
  const assetClass = url.searchParams.get("assetClass")?.trim();

  if (!symbol || symbol.length === 0) {
    return jsonWithCors({ error: "missing_symbol" }, { status: 400 });
  }
  if (!assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_asset_class" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const viewerUid = await parseBearerUid(request);
    const { data, error } = await supabase
      .from("dopamine_asset_comments")
      .select(
        "id, parent_id, body, title, image_urls, author_uid, author_display_name, asset_display_name, created_at",
      )
      .eq("asset_symbol", symbol)
      .eq("asset_class", assetClass)
      .is("moderation_hidden_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const ids = rows.map((r) => r.id as string);
    const authorUids = [...new Set(rows.map((r) => r.author_uid as string))];
    const displayNameByUid = new Map<string, string>();
    if (authorUids.length > 0) {
      const { data: profs, error: profErr } = await supabase
        .from("dopamine_user_profiles")
        .select("uid, display_name")
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
        }
      }
    }

    const [likeCounts, likedSet] = await Promise.all([
      fetchLikeCountsByCommentIds(supabase, ids),
      viewerUid
        ? fetchLikedCommentIdsForUser(supabase, ids, viewerUid)
        : Promise.resolve(new Set<string>()),
    ]);

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
      return {
        ...r,
        author_display_name,
        like_count: likeCounts.get(id) ?? 0,
        liked_by_me: likedSet.has(id),
      };
    });

    return jsonWithCors({ items });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")?.trim();
  const token =
    authHeader?.toLowerCase().startsWith("bearer ") === true
      ? authHeader.slice(7).trim()
      : null;

  if (!token) {
    return jsonWithCors({ error: "missing_bearer_token" }, { status: 401 });
  }

  let uid: string;
  let displayName: string;
  try {
    const decoded = await verifyFirebaseIdToken(token);
    uid = decoded.uid;
    displayName =
      (typeof decoded.name === "string" && decoded.name.length > 0
        ? decoded.name
        : null) ??
      (typeof decoded.email === "string" && decoded.email.length > 0
        ? decoded.email
        : null) ??
      "User";
  } catch (e) {
    console.error(e);
    return jsonWithCors({ error: "invalid_token" }, { status: 401 });
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
  const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
  const assetClass = typeof o.assetClass === "string" ? o.assetClass.trim() : "";
  const text = typeof o.body === "string" ? o.body.trim() : "";
  const parentId =
    o.parentId === null || o.parentId === undefined
      ? null
      : typeof o.parentId === "string"
        ? o.parentId.trim()
        : "";

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

  const rawAssetDisplayName = o["assetDisplayName"];
  let assetDisplayName: string | null = null;
  if (typeof rawAssetDisplayName === "string") {
    const t = rawAssetDisplayName.trim();
    if (t.length > 0) {
      assetDisplayName = t.slice(0, 200);
    }
  }

  if (!symbol || !assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_symbol_or_class" }, { status: 400 });
  }
  if (text.length < 1 || text.length > 2000) {
    return jsonWithCors({ error: "invalid_body_length" }, { status: 400 });
  }
  const bannedBody = checkBannedWords(text);
  if (bannedBody) {
    return jsonWithCors(
      {
        error: "banned_words",
        field: "body",
        message: `허용되지 않는 표현이 포함되어 있습니다: ${bannedBody}`,
      },
      { status: 400 },
    );
  }
  if (titleOut) {
    const bannedTitle = checkBannedWords(titleOut);
    if (bannedTitle) {
      return jsonWithCors(
        {
          error: "banned_words",
          field: "title",
          message: `허용되지 않는 표현이 포함되어 있습니다: ${bannedTitle}`,
        },
        { status: 400 },
      );
    }
  }
  if (parentId !== null && parentId.length === 0) {
    return jsonWithCors({ error: "invalid_parent_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: profRow } = await supabase
      .from("dopamine_user_profiles")
      .select("display_name")
      .eq("uid", uid)
      .maybeSingle();
    const profileName = (profRow?.display_name as string | null)?.trim();
    if (profileName && profileName.length > 0) {
      displayName = profileName;
    }

    if (parentId) {
      const { data: parentRow, error: parentErr } = await supabase
        .from("dopamine_asset_comments")
        .select("id, asset_symbol, asset_class, asset_display_name")
        .eq("id", parentId)
        .maybeSingle();

      if (parentErr || !parentRow) {
        return jsonWithCors({ error: "parent_not_found" }, { status: 400 });
      }
      if (parentRow.asset_symbol !== symbol || parentRow.asset_class !== assetClass) {
        return jsonWithCors({ error: "parent_mismatch" }, { status: 400 });
      }
      if (!assetDisplayName) {
        const pn = (parentRow.asset_display_name as string | null)?.trim();
        if (pn && pn.length > 0) {
          assetDisplayName = pn.slice(0, 200);
        }
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("dopamine_asset_comments")
      .insert({
        asset_symbol: symbol,
        asset_class: assetClass as AssetClass,
        parent_id: parentId,
        body: text,
        title: titleOut,
        image_urls: imageUrlsOut.length > 0 ? imageUrlsOut : [],
        author_uid: uid,
        author_display_name: displayName,
        asset_display_name: assetDisplayName,
      })
      .select(
        "id, parent_id, body, title, image_urls, author_uid, author_display_name, asset_display_name, created_at",
      )
      .single();

    if (insertErr) {
      console.error(insertErr);
      return jsonWithCors(
        { error: "supabase_error", detail: insertErr.message },
        { status: 500 },
      );
    }

    return jsonWithCors({ item: inserted });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
