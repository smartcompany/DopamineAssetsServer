import { jsonWithCors } from "@/lib/cors";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin-app";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const CLASSES = new Set(["us_stock", "kr_stock", "crypto", "commodity"]);

type AssetClass = "us_stock" | "kr_stock" | "crypto" | "commodity";

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
    const { data, error } = await supabase
      .from("dopamine_asset_comments")
      .select("id, parent_id, body, author_uid, author_display_name, created_at")
      .eq("asset_symbol", symbol)
      .eq("asset_class", assetClass)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }

    return jsonWithCors({ items: data ?? [] });
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

  if (!symbol || !assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_symbol_or_class" }, { status: 400 });
  }
  if (text.length < 1 || text.length > 2000) {
    return jsonWithCors({ error: "invalid_body_length" }, { status: 400 });
  }
  if (parentId !== null && parentId.length === 0) {
    return jsonWithCors({ error: "invalid_parent_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    if (parentId) {
      const { data: parentRow, error: parentErr } = await supabase
        .from("dopamine_asset_comments")
        .select("id, asset_symbol, asset_class")
        .eq("id", parentId)
        .maybeSingle();

      if (parentErr || !parentRow) {
        return jsonWithCors({ error: "parent_not_found" }, { status: 400 });
      }
      if (parentRow.asset_symbol !== symbol || parentRow.asset_class !== assetClass) {
        return jsonWithCors({ error: "parent_mismatch" }, { status: 400 });
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("dopamine_asset_comments")
      .insert({
        asset_symbol: symbol,
        asset_class: assetClass as AssetClass,
        parent_id: parentId,
        body: text,
        author_uid: uid,
        author_display_name: displayName,
      })
      .select("id, parent_id, body, author_uid, author_display_name, created_at")
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
