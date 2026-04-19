import { jsonWithCors } from "@/lib/cors";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import { buildInsightPost } from "@/lib/market-insight/build-insight-post";
import { loadXCreds, postToX, truncateForTweet } from "@/lib/x-post";

// ────────────────────────────────────────────────────────────────────────────
// "AI 인사이트" 포스트 cron.
//   - 하루 1회 (기본: KST 14:05, UTC 05:05) 실행.
//   - coinpang.org 최근 게시글을 OpenAI로 재미있게 축약 → 해당 글 permalink 첨부.
//   - 랭킹 템플릿 포스트와 완전히 분리된 채널.
//     · 컨텐츠 소스 실패(DB 미접속/OpenAI 실패/최근 글 없음) 시 에러 응답하며
//       템플릿 fallback은 하지 않는다. 해당 슬롯은 스킵되는 편이 노이즈가 적음.
//
// 환경변수(인사이트 빌더 측):
//   COINPANG_SUPABASE_URL / COINPANG_SUPABASE_ANON_KEY
//   COINPANG_SITE_URL (기본 https://coinpang.org)
//   COINPANG_INSIGHT_BOARD_TYPES (기본 coin_news)
//   OPENAI_API_KEY
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!isCronAuthorizedRequest(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
    console.log("[x-insight-post] cron request accepted", {
      at: new Date().toISOString(),
    });
    const creds = loadXCreds("x-insight-post");

    const insight = await buildInsightPost();
    if (!insight) {
      console.warn("[x-insight-post] insight builder returned null; skipping post");
      return jsonWithCors(
        {
          ok: true,
          posted: false,
          skipped: true,
          reason: "no_insight_available",
          at: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    const text = truncateForTweet(insight.text);
    console.log("[x-insight-post] insight built", {
      sourceName: insight.sourceName,
      sourceTitle: insight.sourceTitle.slice(0, 80),
      sourcePostId: insight.sourcePostId,
      textLen: text.length,
    });

    const posted = await postToX(text, [], creds, "x-insight-post");
    return jsonWithCors({
      ok: true,
      posted: true,
      mode: "insight",
      text,
      tweetId: posted.id,
      sourceUrl: insight.sourceUrl,
      sourceTitle: insight.sourceTitle,
      sourceName: insight.sourceName,
      sourcePostId: insight.sourcePostId,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    console.error("[x-insight-post] failed:", {
      error: msg,
      at: new Date().toISOString(),
    });
    return jsonWithCors(
      {
        ok: false,
        posted: false,
        error: msg,
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
