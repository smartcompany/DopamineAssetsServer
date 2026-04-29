import { jsonWithCors } from "@/lib/cors";
import { BADGE_CATALOG, BADGE_CATALOG_VERSION } from "@/lib/badge-engine";

export async function GET() {
  return jsonWithCors({
    version: BADGE_CATALOG_VERSION,
    badges: BADGE_CATALOG,
  });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
