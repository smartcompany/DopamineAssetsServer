import { NextResponse } from "next/server";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type UpdateItem = {
  report_id: string;
  /** 글 차단(숨김) 확정 — moderation_hidden_at 설정 */
  admin_verdict?: "content_hidden" | "no_issue";
  /** 작성자 계정 사용정지 처리 */
  user_action?: "none" | "suspend" | "unsuspend";
};

/**
 * POST /api/dashboard/reports/update-status
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
  const validUserAction = ["none", "suspend", "unsuspend"] as const;
  for (const u of updates) {
    if (
      !u.report_id ||
      (u.admin_verdict != null && !valid.includes(u.admin_verdict)) ||
      (u.user_action != null && !validUserAction.includes(u.user_action))
    ) {
      return NextResponse.json(
        {
          error:
            "Each update must have report_id and optional admin_verdict/content_hidden|no_issue and user_action/none|suspend|unsuspend",
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
        .select("id, comment_id, target_author_uid")
        .eq("id", u.report_id)
        .maybeSingle();

      if (fetchErr || !report) continue;

      if (u.admin_verdict) {
        await supabase
          .from("dopamine_comment_reports")
          .update({
            admin_verdict: u.admin_verdict,
            admin_verdict_at: now,
          })
          .eq("id", u.report_id);
      }

      const commentId = report.comment_id as string | null;
      let targetAuthorUid =
        (report.target_author_uid as string | null) ?? null;
      if (!targetAuthorUid && commentId) {
        const { data: cRow } = await supabase
          .from("dopamine_asset_comments")
          .select("author_uid")
          .eq("id", commentId)
          .maybeSingle();
        targetAuthorUid = (cRow?.author_uid as string | null) ?? null;
      }

      if (commentId && u.admin_verdict) {
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

      const userAction = u.user_action ?? "none";
      if (targetAuthorUid && userAction !== "none") {
        if (userAction === "suspend") {
          const until = "9999-12-31T23:59:59.000Z";
          const { error: suspendErr } = await supabase
            .from("dopamine_user_profiles")
            .upsert(
              {
                uid: targetAuthorUid,
                suspended_until: until,
                updated_at: now,
              },
              { onConflict: "uid" },
            );
          if (suspendErr) {
            console.error("[dashboard update-status] suspend user", suspendErr);
          }
        } else if (userAction === "unsuspend") {
          const { error: unsuspendErr } = await supabase
            .from("dopamine_user_profiles")
            .upsert(
              {
                uid: targetAuthorUid,
                suspended_until: null,
                updated_at: now,
              },
              { onConflict: "uid" },
            );
          if (unsuspendErr) {
            console.error(
              "[dashboard update-status] unsuspend user",
              unsuspendErr,
            );
          }
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
