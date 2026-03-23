import { jsonWithCors } from "@/lib/cors";

const BODY = {
  items: [
    {
      id: "us_stock",
      labelKey: "assetClass.usStock",
      defaultEnabled: true,
      order: 10,
    },
    {
      id: "kr_stock",
      labelKey: "assetClass.krStock",
      defaultEnabled: true,
      order: 20,
    },
    {
      id: "crypto",
      labelKey: "assetClass.crypto",
      defaultEnabled: true,
      order: 30,
    },
    {
      id: "commodity",
      labelKey: "assetClass.commodity",
      defaultEnabled: true,
      order: 40,
    },
  ],
  defaultFilter: {
    includeAssetClasses: ["us_stock", "kr_stock", "crypto", "commodity"],
  },
} as const;

export async function GET() {
  return jsonWithCors(BODY);
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
