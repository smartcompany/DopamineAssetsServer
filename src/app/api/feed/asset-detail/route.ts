import { jsonWithCors } from "@/lib/cors";
import { getAssetDetail } from "@/lib/asset-detail-service";
import type { AssetClass, CommodityKind } from "@/lib/types";

const CLASSES = new Set<AssetClass>(["us_stock", "kr_stock", "crypto", "commodity"]);

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

  try {
    const data = await getAssetDetail({
      symbol,
      assetClass,
      name: name.length > 0 ? name : symbol,
      commodityKind: commodityKindRaw
        ? (commodityKindRaw as CommodityKind)
        : undefined,
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
