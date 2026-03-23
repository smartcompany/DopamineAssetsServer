import { jsonWithCors } from "@/lib/cors";
import { fetchYahooDailyBars } from "@/lib/yahoo-chart";

export async function GET() {
  let usdKrw: number | null = null;
  try {
    const bars = await fetchYahooDailyBars("KRW=X", 8);
    const last = bars[bars.length - 1];
    if (last && Number.isFinite(last.close)) {
      usdKrw = Math.round(last.close * 100) / 100;
    }
  } catch (e) {
    console.error("[market-summary] KRW=X", e);
  }

  return jsonWithCors({
    kimchiPremiumPct: null,
    usdKrw,
    marketStatus:
      usdKrw !== null
        ? `USD/KRW 환율은 Yahoo Finance(KRW=X) 최근 일봉 종가 기준입니다. 집계 시각은 서버 응답 시점과 다를 수 있습니다.`
        : "환율 데이터를 가져오지 못했습니다.",
  });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
