const BYBIT_BASE = "https://api.bybit.com";

export type BybitSpotInstrumentDetail = {
  baseCoin: string;
  quoteCoin: string;
  status?: string;
};

type InstrumentsResult = {
  retCode?: number;
  retMsg?: string;
  result?: { list?: Array<{ baseCoin?: string; quoteCoin?: string; status?: string }> };
};

/**
 * Bybit V5 spot instruments-info (심볼 메타).
 */
export async function fetchBybitSpotInstrumentDetail(
  symbol: string,
): Promise<BybitSpotInstrumentDetail | null> {
  const u = new URL(`${BYBIT_BASE}/v5/market/instruments-info`);
  u.searchParams.set("category", "spot");
  u.searchParams.set("symbol", symbol.trim());

  const response = await fetch(u.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Bybit instruments HTTP ${response.status}`);
  }

  const data = (await response.json()) as InstrumentsResult;
  if (data.retCode !== 0) {
    throw new Error(`Bybit instruments retCode ${data.retCode} ${data.retMsg ?? ""}`);
  }

  const row = data.result?.list?.[0];
  if (!row?.baseCoin || !row?.quoteCoin) {
    return null;
  }

  return {
    baseCoin: row.baseCoin,
    quoteCoin: row.quoteCoin,
    status: row.status,
  };
}
