import { jsonWithCors } from "@/lib/cors";
import { getFeedRankings } from "@/lib/feed-rankings-service";

export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const data = await getFeedRankings("down", url.searchParams);
    return jsonWithCors(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (
      msg.startsWith("invalid_asset_class") ||
      msg === "empty_include"
    ) {
      return jsonWithCors(
        { error: "invalid_asset_class", detail: msg },
        { status: 400 },
      );
    }
    console.error(e);
    return jsonWithCors(
      { error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
