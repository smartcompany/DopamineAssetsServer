import { fetchAssetNews } from "@/lib/asset-news-fetch";
import { jsonWithCors } from "@/lib/cors";

const DEFAULT_LIMIT = 15;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw
    ? Number.parseInt(limitRaw, 10)
    : DEFAULT_LIMIT;

  console.log("[asset-news][q received]", {
    q,
    qHasReplacement: q.includes("�"),
    qLength: q.length,
  });

  if (q.length === 0) {
    return jsonWithCors(
      { error: "missing_q", hint: "Use ?q=BTC or ?q=bitcoin+etf" },
      { status: 400 },
    );
  }
  if (q.length > 200) {
    return jsonWithCors({ error: "q_too_long", max: 200 }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return jsonWithCors({ error: "invalid_limit" }, { status: 400 });
  }

  const assetClass = url.searchParams.get("assetClass")?.trim();
  const result = await fetchAssetNews(q, limit, {
    assetClass: assetClass && assetClass.length > 0 ? assetClass : undefined,
  });
  if (!result.ok) {
    return jsonWithCors(
      { ok: false, error: result.error, detail: result.detail },
      { status: 502 },
    );
  }

  return jsonWithCors({
    ok: true,
    query: result.query,
    source: result.source,
    count: result.items.length,
    items: result.items,
  });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
