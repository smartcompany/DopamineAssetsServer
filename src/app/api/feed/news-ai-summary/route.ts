import OpenAI from "openai";
import { jsonWithCors } from "@/lib/cors";
import { openAIChatConfig } from "@/lib/openai-config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const MAX_URLS = 5;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const singleUrl = typeof body.url === "string" ? body.url.trim() : "";
    const rawUrls = Array.isArray(body.urls)
      ? body.urls
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
    const urls = [...(singleUrl ? [singleUrl] : []), ...rawUrls]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, MAX_URLS);
    const locale = typeof body.locale === "string" ? body.locale.trim().toLowerCase() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const assetClass = typeof body.assetClass === "string" ? body.assetClass.trim() : "";
    const assetName = typeof body.assetName === "string" ? body.assetName.trim() : "";

    if (urls.length === 0) {
      return jsonWithCors({ error: "missing_url", hint: "pass url or urls[]" }, { status: 400 });
    }
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return jsonWithCors({ error: "invalid_url_protocol", url: u }, { status: 400 });
        }
      } catch {
        return jsonWithCors({ error: "invalid_url", url: u }, { status: 400 });
      }
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return jsonWithCors({ error: "openai_key_missing" }, { status: 500 });
    }

    const outputLanguage = locale.startsWith("en") ? "영어" : "한국어";
    const prompt = `당신은 투자 뉴스 요약 어시스턴트입니다.
아래 URL 목록과 종목 메타 정보만 보고 요약하세요.
중요: URL 원문을 크롤링하거나 본문을 읽었다고 가정하지 마세요.
모르는 내용은 추측하지 말고 반드시 "URL 기반 추정"이라고 명시하세요.
응답 언어는 반드시 ${outputLanguage}로 작성하세요.

[출력 형식]
반드시 JSON 하나만 출력:
{
  "summary": "2~4문장 요약(첫 문장에 'URL 기반 추정' 포함)",
  "impact": ["주가/가격 영향 포인트 최대 3개"],
  "risk": ["리스크/불확실성 최대 2개"]
}

[종목 정보]
- 종목명: ${assetName || "(없음)"}
- 심볼: ${symbol || "(없음)"}
- 자산 클래스: ${assetClass || "(없음)"}
- 기사 URL 목록:
${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;

    const completion = await openai.chat.completions.create({
      model: openAIChatConfig.model,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return jsonWithCors({ error: "empty_ai_response" }, { status: 502 });
    }

    let parsed: { summary?: unknown; impact?: unknown; risk?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { summary?: unknown; impact?: unknown; risk?: unknown };
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return jsonWithCors(
        {
          ok: true,
          summary: raw,
          impact: [],
          risk: [],
          sourceUrl: urls[0] ?? "",
          sourceUrls: urls,
        },
        { status: 200 },
      );
    }

    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : raw;
    const impact = Array.isArray(parsed.impact)
      ? parsed.impact.filter((v): v is string => typeof v === "string").slice(0, 3)
      : [];
    const risk = Array.isArray(parsed.risk)
      ? parsed.risk.filter((v): v is string => typeof v === "string").slice(0, 2)
      : [];

    return jsonWithCors({
      ok: true,
      summary,
      impact,
      risk,
      sourceUrl: urls[0] ?? "",
      sourceUrls: urls,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonWithCors({ error: "news_ai_summary_failed", detail }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
