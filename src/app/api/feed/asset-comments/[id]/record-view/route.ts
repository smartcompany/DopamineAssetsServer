import { jsonWithCors } from "@/lib/cors";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/feed/asset-comments/[id]/record-view
 * 루트 커뮤니티 글 조회수 +1 (상세 진입 시 클라이언트가 호출).
 */
export async function POST(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id || id.trim().length === 0) {
    return jsonWithCors({ error: "missing_id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: curRow, error: selErr } = await supabase
      .from("dopamine_asset_comments")
      .select("id, parent_id, view_count")
      .eq("id", id)
      .maybeSingle();

    if (selErr) {
      console.error(selErr);
      return jsonWithCors(
        { error: "supabase_error", detail: selErr.message },
        { status: 500 },
      );
    }
    if (!curRow) {
      return jsonWithCors({ error: "not_found" }, { status: 404 });
    }
    if (curRow.parent_id != null) {
      return jsonWithCors({ error: "not_root_comment" }, { status: 400 });
    }

    const vc = Number(curRow.view_count) || 0;
    const { error: upErr } = await supabase
      .from("dopamine_asset_comments")
      .update({ view_count: vc + 1 })
      .eq("id", id)
      .is("parent_id", null);

    if (upErr) {
      console.error(upErr);
      return jsonWithCors(
        { error: "supabase_error", detail: upErr.message },
        { status: 500 },
      );
    }

    return jsonWithCors({ ok: true, viewCount: vc + 1 });
  } catch (e) {
    console.error(e);
    return jsonWithCors({ error: "internal_error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
