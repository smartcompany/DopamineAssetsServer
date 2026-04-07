import { NextResponse } from "next/server";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type DashboardReportRow = {
  id: string;
  target_type: "asset_comment";
  target_id: string | null;
  target_title_or_content: string;
  host_or_author_name: string | null;
  host_or_author_id: string | null;
  reason: string | null;
  reporter_user_id: string;
  reporter_name: string | null;
  ai_verdict: string | null;
  ai_reason: string | null;
  ai_verdict_at: string | null;
  created_at: string;
  admin_verdict: string | null;
  target_user_suspended_until: string | null;
};

function previewContent(
  live: { title: string | null; body: string } | null,
  snapshotTitle: string | null,
  snapshotBody: string | null,
): string {
  const title = (live?.title ?? snapshotTitle ?? "").trim();
  const body = (live?.body ?? snapshotBody ?? "").trim();
  if (title.length > 0) {
    return `${title.slice(0, 100)}${body.length > 0 ? ` · ${body.slice(0, 140)}` : ""}`;
  }
  if (body.length > 0) return body.slice(0, 240);
  return "(내용 없음)";
}

/**
 * GET /api/dashboard/reports
 */
export async function GET(request: Request) {
  if (!verifyDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: reports, error: reportsError } = await supabase
      .from("dopamine_comment_reports")
      .select(
        "id, comment_id, reporter_uid, target_author_uid, reason, created_at, ai_verdict, ai_reason, ai_verdict_at, admin_verdict, comment_body_snapshot, comment_title_snapshot",
      )
      .order("created_at", { ascending: false })
      .limit(400);

    if (reportsError) {
      console.error("[dashboard reports]", reportsError);
      return NextResponse.json(
        { error: "Failed to fetch reports" },
        { status: 500 },
      );
    }

    if (!reports?.length) {
      return NextResponse.json({ reports: [] });
    }

    const commentIds = [
      ...new Set(
        reports
          .map((r) => r.comment_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const liveById = new Map<
      string,
      { title: string | null; body: string }
    >();
    if (commentIds.length > 0) {
      const { data: comments, error: cErr } = await supabase
        .from("dopamine_asset_comments")
        .select("id, body, title")
        .in("id", commentIds);
      if (cErr) {
        console.error("[dashboard reports] comments", cErr);
      } else {
        for (const c of comments ?? []) {
          liveById.set(c.id as string, {
            title:
              typeof c.title === "string" && c.title.trim().length > 0
                ? c.title.trim()
                : null,
            body: typeof c.body === "string" ? c.body : "",
          });
        }
      }
    }

    const userIds = new Set<string>();
    for (const r of reports) {
      userIds.add(r.reporter_uid as string);
      const a = r.target_author_uid as string | null;
      if (a) userIds.add(a);
    }

    const usersMap = new Map<string, string | null>();
    const suspendedUntilByUid = new Map<string, string | null>();
    if (userIds.size > 0) {
      const { data: profs, error: pErr } = await supabase
        .from("dopamine_user_profiles")
      .select("uid, display_name, suspended_until")
        .in("uid", [...userIds]);
      if (pErr) {
        console.error("[dashboard reports] profiles", pErr);
      } else {
        for (const p of profs ?? []) {
          const uid = p.uid as string;
          const dn = (p.display_name as string | null)?.trim();
          usersMap.set(uid, dn && dn.length > 0 ? dn : null);
          const su = (p.suspended_until as string | null)?.trim() ?? null;
          suspendedUntilByUid.set(uid, su && su.length > 0 ? su : null);
        }
      }
    }

    const rows: DashboardReportRow[] = reports.map((r) => {
      const cid = r.comment_id as string | null;
      const live = cid ? liveById.get(cid) ?? null : null;
      const authorUid = (r.target_author_uid as string | null) ?? null;
      return {
        id: r.id as string,
        target_type: "asset_comment",
        target_id: cid,
        target_title_or_content: previewContent(
          live,
          r.comment_title_snapshot as string | null,
          r.comment_body_snapshot as string | null,
        ),
        host_or_author_name: authorUid
          ? (usersMap.get(authorUid) ?? null)
          : null,
        host_or_author_id: authorUid,
        reason: (r.reason as string | null) ?? null,
        reporter_user_id: r.reporter_uid as string,
        reporter_name: usersMap.get(r.reporter_uid as string) ?? null,
        ai_verdict: (r.ai_verdict as string | null) ?? null,
        ai_reason: (r.ai_reason as string | null) ?? null,
        ai_verdict_at: (r.ai_verdict_at as string | null) ?? null,
        created_at: r.created_at as string,
        admin_verdict: (r.admin_verdict as string | null) ?? null,
        target_user_suspended_until:
          (authorUid ? (suspendedUntilByUid.get(authorUid) ?? null) : null) ??
          null,
      };
    });

    return NextResponse.json({ reports: rows });
  } catch (e) {
    console.error("[dashboard reports]", e);
    return NextResponse.json(
      { error: "Failed to fetch reports" },
      { status: 500 },
    );
  }
}
