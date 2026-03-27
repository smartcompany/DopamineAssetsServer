import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("dopamine_user_follows")
      .select("follower_uid, created_at")
      .eq("following_uid", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }

    const ids = (rows ?? []).map((r) => r.follower_uid as string);
    if (ids.length === 0) {
      return jsonWithCors({ items: [] });
    }

    const { data: profiles } = await supabase
      .from("dopamine_user_profiles")
      .select("uid, display_name")
      .in("uid", ids);

    const nameByUid = new Map<string, string | null>();
    for (const p of profiles ?? []) {
      nameByUid.set(p.uid as string, (p.display_name as string | null) ?? null);
    }

    const items = ids.map((id) => ({
      uid: id,
      displayName: nameByUid.get(id)?.trim() || null,
    }));

    return jsonWithCors({ items });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
