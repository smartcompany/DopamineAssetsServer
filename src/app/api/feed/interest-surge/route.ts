import { jsonWithCors } from "@/lib/cors";
import { fetchInterestSurgeFromDb } from "@/lib/interest-surge-from-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { snapshotDate, items } = await fetchInterestSurgeFromDb(supabase);
    return jsonWithCors({ snapshotDate, items });
  } catch (e) {
    console.error("[interest-surge]", e);
    return jsonWithCors({ snapshotDate: "", items: [] });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
