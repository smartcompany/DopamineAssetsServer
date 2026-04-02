import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const ASSET_CLASSES = new Set([
  "us_stock",
  "kr_stock",
  "crypto",
  "commodity",
  "theme",
]);

function normalizeAssetClass(raw: string): string | null {
  const t = raw.trim();
  return ASSET_CLASSES.has(t) ? t : null;
}

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const symQ = url.searchParams.get("symbol")?.trim() ?? "";
  const acQ = url.searchParams.get("assetClass")?.trim() ?? "";

  const supabase = getSupabaseAdmin();

  if (symQ.length > 0 && acQ.length > 0) {
    const assetClass = normalizeAssetClass(acQ);
    if (!assetClass) {
      return jsonWithCors({ error: "invalid_asset_class" }, { status: 400 });
    }
    const symbol = symQ.slice(0, 128);
    const { data, error } = await supabase
      .from("dopamine_user_favorite_assets")
      .select("user_uid")
      .eq("user_uid", uid)
      .eq("symbol", symbol)
      .eq("asset_class", assetClass)
      .maybeSingle();
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    return jsonWithCors({ favored: data != null });
  }

  const { data, error } = await supabase
    .from("dopamine_user_favorite_assets")
    .select("symbol, asset_class, display_name, created_at")
    .eq("user_uid", uid)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return jsonWithCors(
      { error: "supabase_error", detail: error.message },
      { status: 500 },
    );
  }

  const items = (data ?? []).map((row) => ({
    symbol: row.symbol as string,
    assetClass: row.asset_class as string,
    name: (row.display_name as string) ?? "",
  }));
  return jsonWithCors({ items });
}

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
  const symbol =
    typeof o.symbol === "string" ? o.symbol.trim().slice(0, 128) : "";
  const assetClass = normalizeAssetClass(
    typeof o.assetClass === "string" ? o.assetClass : "",
  );
  const name =
    typeof o.name === "string" ? o.name.trim().slice(0, 200) : "";
  if (!symbol || !assetClass) {
    return jsonWithCors({ error: "invalid_symbol_or_class" }, { status: 400 });
  }
  if (assetClass === "theme") {
    return jsonWithCors({ error: "theme_not_allowed" }, { status: 400 });
  }

  const row = {
    user_uid: uid,
    symbol,
    asset_class: assetClass,
    display_name: name,
  };

  try {
    const supabase = getSupabaseAdmin();
    const { error: insErr } = await supabase
      .from("dopamine_user_favorite_assets")
      .insert(row);
    if (insErr?.code === "23505") {
      const { error: updErr } = await supabase
        .from("dopamine_user_favorite_assets")
        .update({ display_name: name })
        .eq("user_uid", uid)
        .eq("symbol", symbol)
        .eq("asset_class", assetClass);
      if (updErr) {
        console.error(updErr);
        return jsonWithCors(
          { error: "supabase_error", detail: updErr.message },
          { status: 500 },
        );
      }
      return jsonWithCors({ ok: true, updated: true });
    }
    if (insErr) {
      console.error(insErr);
      return jsonWithCors(
        { error: "supabase_error", detail: insErr.message },
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

export async function DELETE(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const symbol =
    url.searchParams.get("symbol")?.trim().slice(0, 128) ?? "";
  const assetClass = normalizeAssetClass(
    url.searchParams.get("assetClass")?.trim() ?? "",
  );
  if (!symbol || !assetClass) {
    return jsonWithCors({ error: "missing_symbol_or_class" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("dopamine_user_favorite_assets")
      .delete()
      .eq("user_uid", uid)
      .eq("symbol", symbol)
      .eq("asset_class", assetClass);
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
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
