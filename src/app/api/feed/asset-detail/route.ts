import { jsonWithCors } from "@/lib/cors";
import { getAssetDetail, getThemeAssetDetail } from "@/lib/asset-detail-service";
import { resolveRankingsLocale } from "@/lib/feed-rankings-service";
import { resolveThemeIdByDisplayName } from "@/lib/theme-definitions";
import type { AssetClass, CommodityKind } from "@/lib/types";

const CLASSES = new Set<AssetClass>([
  "us_stock",
  "kr_stock",
  "jp_stock",
  "cn_stock",
  "crypto",
  "commodity",
  "theme",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.trim();
  const assetClass = url.searchParams.get("assetClass")?.trim() as AssetClass | undefined;
  const name = url.searchParams.get("name")?.trim() ?? "";
  const commodityKindRaw = url.searchParams.get("commodityKind")?.trim();

  if (!symbol || symbol.length === 0) {
    return jsonWithCors({ error: "missing_symbol" }, { status: 400 });
  }
  if (!assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_asset_class" }, { status: 400 });
  }

  if (assetClass === "theme") {
    let themeId = url.searchParams.get("themeId")?.trim() ?? "";
    if (!themeId) {
      themeId =
        resolveThemeIdByDisplayName(symbol) ??
        resolveThemeIdByDisplayName(name) ??
        "";
    }
    if (!themeId) {
      return jsonWithCors(
        { error: "missing_theme_id", hint: "Pass themeId or a known theme display name" },
        { status: 400 },
      );
    }
    try {
      const displayName =
        name.length > 0 ? name : symbol.length > 0 ? symbol : themeId;
      const data = getThemeAssetDetail(themeId, displayName);
      return jsonWithCors(data);
    } catch {
      return jsonWithCors({ error: "unknown_theme" }, { status: 404 });
    }
  }

  try {
    const locale = resolveRankingsLocale(request, url.searchParams);
    const data = await getAssetDetail({
      symbol,
      assetClass,
      name: name.length > 0 ? name : symbol,
      commodityKind: commodityKindRaw
        ? (commodityKindRaw as CommodityKind)
        : undefined,
      locale,
    });
    return jsonWithCors(data);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
