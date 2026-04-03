import type { SupabaseClient } from "@supabase/supabase-js";
import type { HotMoverDiscussionConfig } from "@/lib/hot-mover-discussion-config";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import type { RankedAssetDto } from "@/lib/types";

export type HotMoverDiscussionPick = {
  symbol: string;
  assetClass: string;
  displayName: string;
  priceChangePct: number;
  rootCommentId: string;
  activityScore: number;
};

const MOVER_RANK_LIMIT = 22;
/** 시간 창 없음일 때 최근 글만 스캔 (DB 부하 방지) */
const NO_WINDOW_ROW_LIMIT = 8000;
const WITH_WINDOW_ROW_LIMIT = 12000;

type MoverRow = {
  symbol: string;
  assetClass: string;
  name: string;
  priceChangePct: number;
};

function assetKey(symbol: string, assetClass: string): string {
  return `${symbol}\n${assetClass}`;
}

function mergeMovers(
  up: RankedAssetDto[],
  down: RankedAssetDto[],
): MoverRow[] {
  const map = new Map<string, MoverRow>();
  const ingest = (items: RankedAssetDto[]) => {
    for (const it of items) {
      const sym = (it.symbol ?? "").trim();
      const cls = (it.assetClass ?? "").trim();
      if (!sym || !cls) continue;
      const k = assetKey(sym, cls);
      const abs = Math.abs(it.priceChangePct);
      const cur = map.get(k);
      if (!cur || abs > Math.abs(cur.priceChangePct)) {
        map.set(k, {
          symbol: sym,
          assetClass: cls,
          name: (it.name ?? "").trim() || sym,
          priceChangePct: it.priceChangePct,
        });
      }
    }
  };
  ingest(up);
  ingest(down);
  return [...map.values()];
}

type IdRow = { id: string; parent_id: string | null };

async function fetchCommentChain(
  supabase: SupabaseClient,
  seedIds: string[],
): Promise<Map<string, IdRow>> {
  const byId = new Map<string, IdRow>();
  let pending = [...new Set(seedIds.filter((x) => x.length > 0))];
  for (let depth = 0; depth < 48 && pending.length > 0; depth++) {
    const { data, error } = await supabase
      .from("dopamine_asset_comments")
      .select("id,parent_id")
      .in("id", pending);
    if (error) {
      console.error("[hot-mover-discussion] fetchCommentChain", error);
      break;
    }
    const next = new Set<string>();
    for (const r of data ?? []) {
      const id = r.id as string;
      const pid = r.parent_id as string | null;
      byId.set(id, { id, parent_id: pid });
      if (pid && !byId.has(pid)) next.add(pid);
    }
    pending = [...next];
  }
  return byId;
}

function resolveRoot(
  id: string,
  byId: Map<string, IdRow>,
): string | null {
  let cur: string | null = id;
  const seen = new Set<string>();
  for (let i = 0; i < 64 && cur; i++) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const row = byId.get(cur);
    if (!row) return null;
    if (!row.parent_id) return row.id;
    cur = row.parent_id;
  }
  return null;
}

type WindowRow = {
  id: string;
  parent_id: string | null;
  asset_symbol: string;
  asset_class: string;
};

async function fetchMoverActivityRows(
  supabase: SupabaseClient,
  orParts: string[],
  config: HotMoverDiscussionConfig,
): Promise<WindowRow[]> {
  const base = supabase
    .from("dopamine_asset_comments")
    .select("id,parent_id,asset_symbol,asset_class,created_at")
    .or(orParts.join(","));

  if (config.use_time_window) {
    const sinceIso = new Date(
      Date.now() - config.window_hours * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await base
      .gte("created_at", sinceIso)
      .limit(WITH_WINDOW_ROW_LIMIT);
    if (error) {
      console.error("[hot-mover-discussion] window rows", error);
      return [];
    }
    return (data ?? []) as WindowRow[];
  }

  const { data, error } = await base
    .order("created_at", { ascending: false })
    .limit(NO_WINDOW_ROW_LIMIT);
  if (error) {
    console.error("[hot-mover-discussion] no-window rows", error);
    return [];
  }
  return (data ?? []) as WindowRow[];
}

type QualifyingAsset = {
  mover: MoverRow;
  score: number;
  rootsByHits: string[];
};

/**
 * 캐시 랭킹 급등·급락 상위 종목 중, 커뮤니티 활동(대시보드 설정)을 만족하는 종목·스레드를 고릅니다.
 */
export async function pickHotMoverDiscussion(
  supabase: SupabaseClient,
  config: HotMoverDiscussionConfig,
): Promise<HotMoverDiscussionPick | null> {
  const minComments = config.min_thread_comments;
  const minViews = config.min_root_view_count;

  const params = new URLSearchParams({
    limit: String(MOVER_RANK_LIMIT),
    source: "yahoo_us",
  });
  const [upRes, downRes] = await Promise.all([
    getFeedRankings("up", params),
    getFeedRankings("down", params),
  ]);
  const movers = mergeMovers(upRes.items, downRes.items);
  if (movers.length === 0) return null;

  const orParts = movers.map(
    (m) =>
      `and(asset_symbol.eq.${m.symbol},asset_class.eq.${m.assetClass})`,
  );
  const rows = await fetchMoverActivityRows(supabase, orParts, config);
  if (rows.length < minComments) return null;

  const byId = await fetchCommentChain(
    supabase,
    rows.map((r) => r.id),
  );

  const perAsset = new Map<
    string,
    { mover: MoverRow; byRoot: Map<string, number> }
  >();
  for (const m of movers) {
    perAsset.set(assetKey(m.symbol, m.assetClass), {
      mover: m,
      byRoot: new Map(),
    });
  }

  for (const r of rows) {
    const k = assetKey(r.asset_symbol, r.asset_class);
    const bucket = perAsset.get(k);
    if (!bucket) continue;
    const root = resolveRoot(r.id, byId);
    if (!root) continue;
    bucket.byRoot.set(root, (bucket.byRoot.get(root) ?? 0) + 1);
  }

  const qualifying: QualifyingAsset[] = [];
  for (const { mover, byRoot } of perAsset.values()) {
    let score = 0;
    for (const n of byRoot.values()) score += n;
    if (score < minComments) continue;
    const rootsByHits = [...byRoot.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    qualifying.push({ mover, score, rootsByHits });
  }

  qualifying.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTop = a.rootsByHits[0]
      ? (perAsset
          .get(assetKey(a.mover.symbol, a.mover.assetClass))
          ?.byRoot.get(a.rootsByHits[0]) ?? 0)
      : 0;
    const bTop = b.rootsByHits[0]
      ? (perAsset
          .get(assetKey(b.mover.symbol, b.mover.assetClass))
          ?.byRoot.get(b.rootsByHits[0]) ?? 0)
      : 0;
    return bTop - aTop;
  });

  const rootIds = new Set<string>();
  for (const q of qualifying) {
    for (const rid of q.rootsByHits) rootIds.add(rid);
  }
  if (rootIds.size === 0) return null;

  const { data: rootRows, error: rootListErr } = await supabase
    .from("dopamine_asset_comments")
    .select(
      "id,parent_id,moderation_hidden_at,asset_symbol,asset_class,view_count",
    )
    .in("id", [...rootIds]);

  if (rootListErr || !rootRows?.length) {
    console.warn("[hot-mover-discussion] root batch", rootListErr);
    return null;
  }

  const metaById = new Map<
    string,
    {
      parent_id: string | null;
      moderation_hidden_at: string | null;
      asset_symbol: string;
      asset_class: string;
      view_count: number;
    }
  >();
  for (const r of rootRows) {
    metaById.set(r.id as string, {
      parent_id: r.parent_id as string | null,
      moderation_hidden_at: r.moderation_hidden_at as string | null,
      asset_symbol: r.asset_symbol as string,
      asset_class: r.asset_class as string,
      view_count: Number(r.view_count) || 0,
    });
  }

  for (const q of qualifying) {
    for (const rid of q.rootsByHits) {
      const meta = metaById.get(rid);
      if (!meta) continue;
      if (meta.parent_id != null) continue;
      if (meta.moderation_hidden_at != null) continue;
      if (
        meta.asset_symbol !== q.mover.symbol ||
        meta.asset_class !== q.mover.assetClass
      ) {
        continue;
      }
      if (meta.view_count < minViews) continue;

      return {
        symbol: q.mover.symbol,
        assetClass: q.mover.assetClass,
        displayName: q.mover.name,
        priceChangePct: q.mover.priceChangePct,
        rootCommentId: rid,
        activityScore: q.score,
      };
    }
  }

  return null;
}

export function currentHotMoverDiscussionBucket(): bigint {
  return BigInt(Math.floor(Date.now() / (4 * 60 * 60 * 1000)));
}
