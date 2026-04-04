import { jsonWithCors } from "@/lib/cors";
import settings from "./settings.json" assert { type: "json" };

/** `GIPHY_API_KEYS` JSON 예: `{"ios":"...","android":"...","web":"..."}` */
function giphyApiKeyFromEnv(): Record<string, string> | null {
  const raw = process.env.GIPHY_API_KEYS?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") {
        out[k] = v.trim();
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const base = { ...(settings as Record<string, unknown>) };
    const giphy = giphyApiKeyFromEnv();
    if (giphy) {
      base.giphy_api_key = giphy;
    }
    return jsonWithCors(base);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonWithCors({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
