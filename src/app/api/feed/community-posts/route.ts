import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getCommunityPosts } from "@/lib/community-posts-service";

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
  const bodyTerms = parseBodyTerms(url);

  try {
    const viewerUid = await parseBearerUid(request);
    const items = await getCommunityPosts(
      sort,
      {
        assetSymbol: symbol && assetClass ? symbol : undefined,
        assetClass: symbol && assetClass ? assetClass : undefined,
        bodyTerms: bodyTerms.length > 0 ? bodyTerms : undefined,
      },
      viewerUid,
    );
    return jsonWithCors({ sort, items });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
