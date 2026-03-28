import { jsonWithCors } from "@/lib/cors";
import { getThemeAverageOhlcBars } from "@/lib/theme-chart-service";

/** `3mo` | `1mo` | `1y` — 일봉 구간 */
function rangeDays(raw: string | null): number {
  switch (raw) {
    case "1mo":
      return 32;
    case "1y":
      return 370;
    case "3mo":
    default:
      return 92;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("themeId")?.trim() ?? "";
  const range = url.searchParams.get("range")?.trim() ?? "3mo";

  if (!themeId) {
    return jsonWithCors({ error: "missing_theme_id" }, { status: 400 });
  }

  const r = range === "1mo" || range === "1y" || range === "3mo" ? range : "3mo";
  const days = rangeDays(r);

  try {
    const bars = await getThemeAverageOhlcBars(themeId, days);
    return jsonWithCors({
      themeId,
      interval: "1d",
      range: r,
      bars,
    });
  } catch (e) {
    console.error("[theme-chart]", themeId, e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "upstream_failed", detail: msg }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
