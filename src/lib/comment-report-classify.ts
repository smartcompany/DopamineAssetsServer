import OpenAI from "openai";
import { openAIChatConfig } from "@/lib/openai-config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

/** hide_post: 글을 삭제하지 않고 숨김(차단) 플래그 적용 */
export type CommentReportVerdict = "hide_post" | "needs_review" | "no_issue";

export type ClassifyCommentReportResult = {
  verdict: CommentReportVerdict;
  reason: string;
};

const VERDICT_MAP: Record<string, CommentReportVerdict> = {
  hide_post: "hide_post",
  needs_review: "needs_review",
  no_issue: "no_issue",
};

/**
 * 커뮤니티 글(자산 댓글) + 신고 사유를 AI로 분류.
 * - hide_post: 명백한 위반 → 서버에서 moderation_hidden_at 설정(사용자 비노출)
 * - needs_review: 사람 검토 필요
 * - no_issue: 신고가 부당하거나 문제 없음
 */
export async function classifyCommentReport(params: {
  title: string;
  content: string;
  reportReason: string;
}): Promise<ClassifyCommentReportResult> {
  const { title, content, reportReason } = params;

  const prompt = `당신은 주식·코인 커뮤니티 게시글 신고를 분류하는 심사자입니다.
아래 "신고 대상 글"과 "신고 사유"를 보고 판단해주세요.

[중요] 글을 DB에서 삭제하지 않습니다. 위반이 명백하면 "hide_post"로 분류해, 앱에서는 해당 글이 보이지 않게(숨김/차단) 처리합니다.

[판단 기준]
- hide_post: 숨김(차단)이 타당한 수준 (명백한 스팸·광고, 심한 욕설·혐오·위협, 불법 유도, 음란물, 도배 등)
- needs_review: 맥락이 더 필요하거나 애매한 경우
- no_issue: 신고 사유와 내용이 맞지 않거나 통상적인 의견·토론 수준

[답변 형식] 반드시 아래 두 줄만 출력하세요. 다른 내용 금지.
1줄: hide_post, needs_review, no_issue 중 정확히 하나 (영문 소문자)
2줄: 사유: (한두 문장으로 판단 사유 설명)

예시:
needs_review
사유: 투자 의견과 가벼운 비유가 섞여 있어 맥락 확인이 필요함.

신고 대상 제목(있으면): ${title || "(없음)"}
신고 대상 본문: ${content || "(없음)"}
신고 사유·내용: ${reportReason}`;

  const response = await openai.chat.completions.create({
    model: openAIChatConfig.model,
    max_completion_tokens: openAIChatConfig.max_completion_tokens,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim() || "";
  const lines = raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  let verdict: CommentReportVerdict = "needs_review";
  const firstLine = (lines[0] || "").toLowerCase();
  const normalizedFirst = firstLine.replace(/\s/g, "_");
  for (const [key, v] of Object.entries(VERDICT_MAP)) {
    const k = key.toLowerCase().replace(/\s/g, "_");
    if (
      firstLine.includes(key.toLowerCase()) ||
      normalizedFirst.includes(k)
    ) {
      verdict = v;
      break;
    }
  }
  if (verdict === "needs_review") {
    if (
      firstLine.includes("hide_post") ||
      firstLine.includes("remove_post")
    ) {
      verdict = "hide_post";
    } else if (firstLine.includes("no_issue")) {
      verdict = "no_issue";
    }
  }

  let reason = "";
  const reasonLine = lines
    .slice(1)
    .find((l) => /사유\s*[:：]/.test(l) || l.length > 5);
  if (reasonLine) {
    reason = reasonLine.replace(/^사유\s*[:：]\s*/i, "").trim();
  } else if (lines.length > 1) {
    reason = lines.slice(1).join(" ").trim();
  }
  if (!reason) reason = "(사유 없음)";

  return { verdict, reason };
}
