import { jsonWithCors } from "@/lib/cors";
import settings from "./settings.json" assert { type: "json" };

export async function GET() {
  try {
    return jsonWithCors(settings);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonWithCors({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
