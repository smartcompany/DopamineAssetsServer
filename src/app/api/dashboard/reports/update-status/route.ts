import { NextResponse } from "next/server";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type UpdateItem = {
  report_id: string;
  /** 글 차단(숨김) 확정 — moderation_hidden_at 설정 */
  admin_verdict: "content_hidden" | "no_issue";
};

/**
 * POST /api/dashboard/reports/update-status
 * - content_hidden: 해당 신고 대상 글에 숨김 플래그 설정
 * - no_issue: 신고 기각 + 숨김 해제(번복·AI 오판 정정)
 */
export async function POST(request: Request) {
  if (!verifyDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { updates?: UpdateItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json(
      { error: "updates array is required" },
      { status: 400 },
    );
  }

  const valid = ["content_hidden", "no_issue"] as const;
  for (const u of updates) {
    if (!u.report_id || !valid.includes(u.admin_verdict)) {
      return NextResponse.json(
        {
          error:
            "Each update must have report_id and admin_verdict (content_hidden | no_issue)",
        },
        { status: 400 },
      );
    }
  }

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    for (const u of updates) {
      const { data: report, error: fetchErr } = await supabase
        .from("dopamine_comment_reports")
        .select("id, comment_id")
        .eq("id", u.report_id)
        .maybeSingle();

      if (fetchErr || !report) continue;

      await supabase
        .from("dopamine_comment_reports")
        .update({
          admin_verdict: u.admin_verdict,
          admin_verdict_at: now,
        })
        .eq("id", u.report_id);

      const commentId = report.comment_id as string | null;
      if (!commentId) continue;

      if (u.admin_verdict === "content_hidden") {
        const { error: upErr } = await supabase
          .from("dopamine_asset_comments")
          .update({ moderation_hidden_at: now })
          .eq("id", commentId);
        if (upErr) {
          console.error("[dashboard update-status] hide comment", upErr);
        }
      } else {
        const { error: upErr } = await supabase
          .from("dopamine_asset_comments")
          .update({ moderation_hidden_at: null })
          .eq("id", commentId);
        if (upErr) {
          console.error("[dashboard update-status] unhide comment", upErr);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[dashboard update-status]", e);
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 },
    );
  }
}
