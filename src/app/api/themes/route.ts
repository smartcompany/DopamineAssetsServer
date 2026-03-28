import { jsonWithCors } from "@/lib/cors";
import { normalizeThemeLocale } from "@/lib/theme-definitions";
import { getThemes } from "@/lib/themes-service";

const kinds = ["hot", "crashed", "emerging"] as const;
type Kind = (typeof kinds)[number];

function isKind(value: string | null): value is Kind {
  return kinds.includes(value as Kind);
}

function localeFromRequest(request: Request, url: URL): ReturnType<typeof normalizeThemeLocale> {
  const q = url.searchParams.get("locale")?.trim();
  if (q) return normalizeThemeLocale(q);
  const accept = request.headers.get("accept-language");
  const first = accept?.split(",")[0]?.trim();
  return normalizeThemeLocale(first ?? undefined);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!isKind(kind)) {
    return jsonWithCors(
      { error: "Invalid or missing kind (hot|crashed|emerging)" },
      { status: 400 },
    );
  }

  const locale = localeFromRequest(request, url);
  const { items } = await getThemes(kind, locale);
  return jsonWithCors({ kind, locale, items });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
