import { MOVE_SUMMARY_SYSTEM_PROMPT } from "./asset-move-summary-prompts";
import { getSupabaseAdmin } from "./supabase-admin";
import type { AssetClass, RankedAssetDto } from "./types";
import { getFeedRankings } from "./feed-rankings-service";

const BATCH_SIZE = Number.parseInt(process.env.MOVE_SUMMARY_BATCH_SIZE ?? "8", 10);
const RANK_LIMIT = Number.parseInt(process.env.MOVE_SUMMARY_RANK_LIMIT ?? "15", 10);

/** USDTSignal `analyze-strategy-cron` 과 동일: Chat Completions + gpt-5-mini 기본값 */
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

type LlmItem = {
  symbol: string;
  assetClass: AssetClass;
  summary: string;
};

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function dedupeRanked(items: RankedAssetDto[]): RankedAssetDto[] {
  const map = new Map<string, RankedAssetDto>();
  for (const r of items) {
    const k = `${r.symbol.trim()}\0${r.assetClass}`;
    if (!map.has(k)) map.set(k, r);
  }
  return [...map.values()];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function callOpenAiForBatch(
  assets: RankedAssetDto[],
): Promise<LlmItem[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const model = DEFAULT_OPENAI_MODEL;

  const payload = assets.map((a) => ({
    symbol: a.symbol,
    assetClass: a.assetClass,
    name: a.name,
    priceChangePct: a.priceChangePct,
    volumeChangePct: a.volumeChangePct,
  }));

  const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MOVE_SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ assets: payload }),
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI empty content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("OpenAI returned non-JSON");
  }

  if (typeof parsed !== "object" || parsed === null || !("items" in parsed)) {
    throw new Error("OpenAI JSON missing items");
  }

  const items = (parsed as { items: unknown }).items;
  if (!Array.isArray(items)) throw new Error("OpenAI items not array");

  const out: LlmItem[] = [];
  for (const row of items) {
    if (typeof row !== "object" || row === null) continue;
    const o = row as Record<string, unknown>;
    const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
    const assetClass = o.assetClass as AssetClass;
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    const validClass =
      assetClass === "us_stock" ||
      assetClass === "kr_stock" ||
      assetClass === "jp_stock" ||
      assetClass === "cn_stock" ||
      assetClass === "crypto" ||
      assetClass === "commodity";
    if (symbol && validClass && summary.length > 0) {
      out.push({ symbol, assetClass, summary: summary.slice(0, 500) });
    }
  }

  return out;
}

export type MoveSummaryJobResult = {
  summaryDate: string;
  uniqueAssets: number;
  llmBatches: number;
  rowsUpserted: number;
  errors: string[];
};

/**
 * 상·하락 랭킹 후보를 모아 배치 LLM 호출 후 Supabase에 일자별로 upsert.
 */
export async function runAssetMoveSummaryJob(): Promise<MoveSummaryJobResult> {
  const summaryDate = utcDateString();
  const errors: string[] = [];

  const baseParams = new URLSearchParams();
  baseParams.set("limit", String(RANK_LIMIT));
  baseParams.set("source", "yahoo_us");

  const [upRes, downRes] = await Promise.all([
    getFeedRankings("up", baseParams),
    getFeedRankings("down", baseParams),
  ]);

  const merged = dedupeRanked([...upRes.items, ...downRes.items]);
  if (merged.length === 0) {
    return {
      summaryDate,
      uniqueAssets: 0,
      llmBatches: 0,
      rowsUpserted: 0,
      errors: ["no_ranked_assets"],
    };
  }

  const supabase = getSupabaseAdmin();
  const batchSize = Number.isFinite(BATCH_SIZE) && BATCH_SIZE > 0 ? BATCH_SIZE : 8;
  const batches = chunk(merged, batchSize);
  const model = DEFAULT_OPENAI_MODEL;
  const batchRunAt = new Date().toISOString();
  let rowsUpserted = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    try {
      const items = await callOpenAiForBatch(batch);
      const byKey = new Map<string, LlmItem>();
      for (const it of items) {
        byKey.set(`${it.symbol}\0${it.assetClass}`, it);
      }

      const rows = batch
        .map((a) => {
          const it = byKey.get(`${a.symbol.trim()}\0${a.assetClass}`);
          if (!it) return null;
          return {
            symbol: a.symbol.trim(),
            asset_class: a.assetClass,
            summary_date: summaryDate,
            summary_ko: it.summary,
            model,
            batch_run_at: batchRunAt,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) {
        errors.push(`batch_${i}:no_matching_llm_rows`);
        continue;
      }

      const { error } = await supabase.from("dopamine_asset_move_summaries").upsert(
        rows,
        { onConflict: "symbol,asset_class,summary_date" },
      );

      if (error) {
        errors.push(`batch_${i}:${error.message}`);
        continue;
      }
      rowsUpserted += rows.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`batch_${i}:${msg}`);
    }
  }

  return {
    summaryDate,
    uniqueAssets: merged.length,
    llmBatches: batches.length,
    rowsUpserted,
    errors,
  };
}

export async function fetchMoveSummaryKo(params: {
  symbol: string;
  assetClass: AssetClass;
  summaryDate?: string;
}): Promise<string | null> {
  const summaryDate = params.summaryDate ?? utcDateString();
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dopamine_asset_move_summaries")
      .select("summary_ko")
      .eq("symbol", params.symbol.trim())
      .eq("asset_class", params.assetClass)
      .eq("summary_date", summaryDate)
      .maybeSingle();

    if (error) {
      console.warn("[move-summary] fetch", error.message);
      return null;
    }
    const text = data?.summary_ko;
    return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
  } catch (e) {
    console.warn("[move-summary] fetch failed", e);
    return null;
  }
}
