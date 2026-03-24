import { jsonWithCors } from "@/lib/cors";
import { getCommunityPosts } from "@/lib/community-posts-service";

function isSort(v: string | null): v is "latest" | "popular" {
  return v === "latest" || v === "popular";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("sort")?.trim() ?? "latest";
  const sort = isSort(raw) ? raw : "latest";

  try {
    const items = await getCommunityPosts(sort);
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
