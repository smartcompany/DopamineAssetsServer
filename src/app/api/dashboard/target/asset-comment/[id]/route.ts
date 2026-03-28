import { NextResponse } from "next/server";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/dashboard/target/asset-comment/[id]
 * 신고 대상 글 본문·제목·이미지 (라이브 행)
 */
export async function GET(request: Request, ctx: RouteCtx) {
  if (!verifyDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from("dopamine_asset_comments")
      .select("id, body, title, image_urls")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[dashboard target]", error);
      return NextResponse.json(
        { error: "Failed to load" },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const urls = Array.isArray(row.image_urls)
      ? (row.image_urls as string[])
      : [];

    return NextResponse.json({
      type: "asset_comment",
      title:
        typeof row.title === "string" && row.title.trim().length > 0
          ? row.title.trim()
          : null,
      content: typeof row.body === "string" ? row.body : "",
      image_urls: urls,
    });
  } catch (e) {
    console.error("[dashboard target]", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
