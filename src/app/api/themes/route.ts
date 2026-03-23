import { jsonWithCors } from "@/lib/cors";
import {
  themesCrashed,
  themesEmerging,
  themesHot,
} from "@/lib/themes-mock-data";

const kinds = ["hot", "crashed", "emerging"] as const;
type Kind = (typeof kinds)[number];

function isKind(value: string | null): value is Kind {
  return kinds.includes(value as Kind);
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

  const items =
    kind === "hot"
      ? themesHot
      : kind === "crashed"
        ? themesCrashed
        : themesEmerging;

  return jsonWithCors({ kind, items });
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
