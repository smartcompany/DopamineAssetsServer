import { jsonWithCors } from "@/lib/cors";
import { fetchInterestSurgeFromDb } from "@/lib/interest-surge-from-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("locale")?.trim().toLowerCase() ?? "";
    const acceptLanguage = request.headers.get("accept-language") ?? "";
    const firstLang = acceptLanguage.split(",")[0]?.trim().toLowerCase() ?? "";
    const locale = q || firstLang || "en";
    const supabase = getSupabaseAdmin();
    const { snapshotDate, items } = await fetchInterestSurgeFromDb(
      supabase,
      locale,
    );
    return jsonWithCors({ snapshotDate, items });
  } catch (e) {
    console.error("[interest-surge]", e);
    return jsonWithCors({ snapshotDate: "", items: [] });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
