import { jsonWithCors } from "@/lib/cors";
import { buildYahooMarketBrief } from "@/lib/yahoo-market-brief";

export async function GET() {
  const {
    briefingKo,
    briefingEn,
    attributionKo,
    attributionEn,
  } = await buildYahooMarketBrief();

  return jsonWithCors({
    briefing: briefingKo,
    briefingEn,
    attribution: attributionKo,
    attributionEn,
    kimchiPremiumPct: null,
    usdKrw: null,
    marketStatus: null,
  });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
