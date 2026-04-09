import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getCommunityPostsPaged } from "@/lib/community-posts-service";

function isSort(v: string | null): v is "latest" | "popular" {
  return v === "latest" || v === "popular";
}

function parseBodyTerms(url: URL): string[] {
  const raw = url.searchParams.get("q")?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("sort")?.trim() ?? "latest";
  const sort = isSort(raw) ? raw : "latest";

  const symbol = url.searchParams.get("symbol")?.trim();
  const assetClass = url.searchParams.get("assetClass")?.trim();
  const authorUid = url.searchParams.get("authorUid")?.trim();
  const bodyTerms = parseBodyTerms(url);
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const limit = Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20);

  try {
    const viewerUid = await parseBearerUid(request);
    const result = await getCommunityPostsPaged(
      sort,
      {
        assetSymbol: symbol && assetClass ? symbol : undefined,
        assetClass: symbol && assetClass ? assetClass : undefined,
        authorUid: authorUid && authorUid.length > 0 ? authorUid : undefined,
        bodyTerms: bodyTerms.length > 0 ? bodyTerms : undefined,
      },
      viewerUid,
      { page, limit },
    );
    return jsonWithCors({ sort, page: result.page, limit: result.limit, hasMore: result.hasMore, items: result.items });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
