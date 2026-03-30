import { jsonWithCors } from "@/lib/cors";

/**
 * Vercel egress → Binance 연결 확인용 (배포 후 한 번 호출해 보고, 필요 없으면 라우트 삭제).
 */
export async function GET() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; DopamineAssets/1.0)",
      },
    });
    const text = await r.text();
    let count: number | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      count = Array.isArray(parsed) ? parsed.length : null;
    } catch {
      count = null;
    }
    return jsonWithCors({
      binanceHttpStatus: r.status,
      ok: r.ok,
      tickerRows: count,
      bodyPrefix: text.slice(0, 120),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
