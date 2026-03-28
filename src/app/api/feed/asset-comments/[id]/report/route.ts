import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  classifyCommentReport,
  type CommentReportVerdict,
} from "@/lib/comment-report-classify";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id || id.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  let reason: string | null = null;
  try {
    const body = await request.json();
    if (typeof body === "object" && body !== null) {
      const raw = (body as Record<string, unknown>).reason;
      if (typeof raw === "string") {
        const t = raw.trim();
        reason = t.length > 0 ? t.slice(0, 8000) : null;
      }
    }
  } catch {
    /* optional body */
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error: fetchErr } = await supabase
      .from("dopamine_asset_comments")
      .select("id, author_uid, body, title, image_urls")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) {
      console.error(fetchErr);
      return jsonWithCors(
        { error: "supabase_error", detail: fetchErr.message },
        { status: 500 },
      );
    }
    if (!row) {
      return jsonWithCors({ error: "not_found" }, { status: 404 });
    }

    const authorUid = row.author_uid as string;
    if (authorUid === uid) {
      return jsonWithCors({ error: "cannot_report_own" }, { status: 400 });
    }

    const bodyText = typeof row.body === "string" ? row.body : "";
    const titleText =
      typeof row.title === "string" && row.title.trim().length > 0
        ? row.title.trim()
        : null;

    const { data: inserted, error: insErr } = await supabase
      .from("dopamine_comment_reports")
      .insert({
        comment_id: id,
        reporter_uid: uid,
        reason,
        comment_body_snapshot: bodyText.slice(0, 12000),
        comment_title_snapshot: titleText,
        target_author_uid: authorUid,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      if (insErr.code === "23505") {
        return jsonWithCors({ ok: true, duplicate: true });
      }
      console.error(insErr);
      return jsonWithCors(
        { error: "supabase_error", detail: insErr.message },
        { status: 500 },
      );
    }

    const reportRowId = inserted?.id as string | undefined;
    if (!reportRowId) {
      return jsonWithCors(
        { error: "report_insert_failed" },
        { status: 500 },
      );
    }

    let aiVerdict: CommentReportVerdict = "needs_review";
    let aiReason = "";
    const reportReasonForAi =
      reason && reason.length > 0 ? reason : "(사유 없음)";
    if (process.env.OPENAI_API_KEY?.trim()) {
      try {
        const classified = await classifyCommentReport({
          title: titleText ?? "",
          content: bodyText.slice(0, 12000),
          reportReason: reportReasonForAi,
        });
        aiVerdict = classified.verdict;
        aiReason = classified.reason || "";
      } catch (e) {
        console.error("[report] AI classify error:", e);
      }
    }

    await supabase
      .from("dopamine_comment_reports")
      .update({
        ai_verdict: aiVerdict,
        ai_verdict_at: new Date().toISOString(),
        ai_reason: aiReason || null,
      })
      .eq("id", reportRowId);

    if (aiVerdict === "hide_post") {
      const { error: hideErr } = await supabase
        .from("dopamine_asset_comments")
        .update({ moderation_hidden_at: new Date().toISOString() })
        .eq("id", id);
      if (hideErr) {
        console.error("[report] auto-hide comment:", hideErr);
      }
    }

    return jsonWithCors({ ok: true, ai_verdict: aiVerdict });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
