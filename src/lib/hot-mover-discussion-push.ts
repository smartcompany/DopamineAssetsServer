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

/** 크론/대시보드에서 no_candidate 원인 추적용 */
export type HotMoverDiscussionDiagnostics = {
  noPickReason: string;
  useTimeWindow: boolean;
  windowHours: number;
  minThreadComments: number;
  minRootViewCount: number;
  upItemsCount: number;
  downItemsCount: number;
  moverCount: number;
  moversPreview: Array<{ symbol: string; assetClass: string; pct: number }>;
  feedAsOfUp?: string;
  feedAsOfDown?: string;
  activityRowCount: number;
  /** rows 비어 있고 minThreadComments > 0 이면 true */
  abortedEmptyRowsWithMinGt0: boolean;
  /** byRoot 가 비어 있지 않은 급등·급락 종목 수 */
  assetsWithThreadHits: number;
  /** minThreadComments===0 백필로 최신 루트를 넣은 종목 수 */
  latestRootBackfillCount: number;
  qualifyingCount: number;
  qualifyingPreview: Array<{
    symbol: string;
    assetClass: string;
    score: number;
    rootIdsInOrder: number;
  }>;
  uniqueRootIdsForMeta: number;
  rootMetaRowCount: number;
  rootBatchError?: string;
  /** 최종 루트 검사에서 탈락한 예시(최대 15건) */
  rejectionSamples: Array<{ rootId: string; reason: string }>;
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

/** `min_thread_comments === 0`일 때, 집계 창에 잡힌 활동이 없는 급등·급락 종목은 최신 루트 글 1건을 후보로 넣습니다. */
async function fillLatestRootForMoversWithNoActivity(
  supabase: SupabaseClient,
  perAsset: Map<
    string,
    { mover: MoverRow; byRoot: Map<string, number> }
  >,
): Promise<number> {
  const tasks = [...perAsset.values()]
    .filter(({ byRoot }) => byRoot.size === 0)
    .map(async ({ mover, byRoot }) => {
      const { data, error } = await supabase
        .from("dopamine_asset_comments")
        .select("id")
        .eq("asset_symbol", mover.symbol)
        .eq("asset_class", mover.assetClass)
        .is("parent_id", null)
        .is("moderation_hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data?.id) return 0;
      byRoot.set(data.id as string, 1);
      return 1;
    });
  const results = await Promise.all(tasks);
  return results.reduce<number>((a, b) => a + b, 0);
}

type QualifyingAsset = {
  mover: MoverRow;
  score: number;
  rootsByHits: string[];
};

/**
 * 캐시 랭킹 급등·급락 상위 종목 중, 커뮤니티 활동(대시보드 설정)을 만족하는 종목·스레드를 고릅니다.
 * @returns pick 이 null 이면 diagnostics.noPickReason 과 나머지 필드로 원인 추적.
 */
export async function pickHotMoverDiscussion(
  supabase: SupabaseClient,
  config: HotMoverDiscussionConfig,
): Promise<{
  pick: HotMoverDiscussionPick | null;
  diagnostics: HotMoverDiscussionDiagnostics;
}> {
  const minComments = config.min_thread_comments;
  const minViews = config.min_root_view_count;

  const diagnostics: HotMoverDiscussionDiagnostics = {
    noPickReason: "unknown",
    useTimeWindow: config.use_time_window,
    windowHours: config.window_hours,
    minThreadComments: minComments,
    minRootViewCount: minViews,
    upItemsCount: 0,
    downItemsCount: 0,
    moverCount: 0,
    moversPreview: [],
    activityRowCount: 0,
    abortedEmptyRowsWithMinGt0: false,
    assetsWithThreadHits: 0,
    latestRootBackfillCount: 0,
    qualifyingCount: 0,
    qualifyingPreview: [],
    uniqueRootIdsForMeta: 0,
    rootMetaRowCount: 0,
    rejectionSamples: [],
  };

  const params = new URLSearchParams({
    limit: String(MOVER_RANK_LIMIT),
    source: "yahoo_us",
  });
  const [upRes, downRes] = await Promise.all([
    getFeedRankings("up", params),
    getFeedRankings("down", params),
  ]);
  diagnostics.upItemsCount = upRes.items.length;
  diagnostics.downItemsCount = downRes.items.length;
  diagnostics.feedAsOfUp = upRes.asOf;
  diagnostics.feedAsOfDown = downRes.asOf;

  const movers = mergeMovers(upRes.items, downRes.items);
  diagnostics.moverCount = movers.length;
  diagnostics.moversPreview = movers.slice(0, 8).map((m) => ({
    symbol: m.symbol,
    assetClass: m.assetClass,
    pct: m.priceChangePct,
  }));

  if (movers.length === 0) {
    diagnostics.noPickReason = "empty_feed_rankings";
    return { pick: null, diagnostics };
  }

  const orParts = movers.map(
    (m) =>
      `and(asset_symbol.eq.${m.symbol},asset_class.eq.${m.assetClass})`,
  );
  const rows = await fetchMoverActivityRows(supabase, orParts, config);
  diagnostics.activityRowCount = rows.length;

  if (rows.length === 0 && minComments > 0) {
    diagnostics.abortedEmptyRowsWithMinGt0 = true;
    diagnostics.noPickReason = "no_comment_rows_and_min_thread_gt_0";
    return { pick: null, diagnostics };
  }

  const byId =
    rows.length > 0
      ? await fetchCommentChain(
          supabase,
          rows.map((r) => r.id),
        )
      : new Map<string, IdRow>();

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

  let unresolvedRootRows = 0;
  for (const r of rows) {
    const k = assetKey(r.asset_symbol, r.asset_class);
    const bucket = perAsset.get(k);
    if (!bucket) continue;
    const root = resolveRoot(r.id, byId);
    if (!root) {
      unresolvedRootRows += 1;
      continue;
    }
    bucket.byRoot.set(root, (bucket.byRoot.get(root) ?? 0) + 1);
  }

  diagnostics.assetsWithThreadHits = [...perAsset.values()].filter(
    (b) => b.byRoot.size > 0,
  ).length;

  if (minComments === 0) {
    diagnostics.latestRootBackfillCount =
      await fillLatestRootForMoversWithNoActivity(supabase, perAsset);
  }

  const qualifying: QualifyingAsset[] = [];
  for (const { mover, byRoot } of perAsset.values()) {
    let score = 0;
    for (const n of byRoot.values()) score += n;
    if (minComments > 0 && score < minComments) continue;
    const rootsByHits = [...byRoot.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    if (rootsByHits.length === 0) continue;
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

  diagnostics.qualifyingCount = qualifying.length;
  diagnostics.qualifyingPreview = qualifying.slice(0, 6).map((q) => ({
    symbol: q.mover.symbol,
    assetClass: q.mover.assetClass,
    score: q.score,
    rootIdsInOrder: q.rootsByHits.length,
  }));

  const rootIds = new Set<string>();
  for (const q of qualifying) {
    for (const rid of q.rootsByHits) rootIds.add(rid);
  }
  diagnostics.uniqueRootIdsForMeta = rootIds.size;

  if (rootIds.size === 0) {
    diagnostics.noPickReason = "no_qualifying_asset_with_root";
    return {
      pick: null,
      diagnostics: {
        ...diagnostics,
        rejectionSamples: [
          ...(unresolvedRootRows > 0
            ? [
                {
                  rootId: "-",
                  reason: `activity_rows_had_unresolved_parent_chain count=${unresolvedRootRows}`,
                },
              ]
            : []),
          {
            rootId: "-",
            reason:
              "no_mover_had_a_root_post_try_community_posts_on_mover_symbols_or_lower_min_thread",
          },
        ],
      },
    };
  }

  const { data: rootRows, error: rootListErr } = await supabase
    .from("dopamine_asset_comments")
    .select(
      "id,parent_id,moderation_hidden_at,asset_symbol,asset_class,view_count",
    )
    .in("id", [...rootIds]);

  diagnostics.rootMetaRowCount = rootRows?.length ?? 0;
  if (rootListErr) {
    diagnostics.rootBatchError = rootListErr.message;
    diagnostics.noPickReason = "root_meta_query_failed";
    console.warn("[hot-mover-discussion] root batch", rootListErr);
    return { pick: null, diagnostics };
  }
  if (!rootRows?.length) {
    diagnostics.noPickReason = "root_meta_empty";
    return { pick: null, diagnostics };
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

  const rejectionSamples: Array<{ rootId: string; reason: string }> = [];

  function noteReject(rootId: string, reason: string) {
    if (rejectionSamples.length >= 15) return;
    rejectionSamples.push({ rootId, reason });
  }

  for (const q of qualifying) {
    for (const rid of q.rootsByHits) {
      const meta = metaById.get(rid);
      if (!meta) {
        noteReject(rid, "no_meta_row");
        continue;
      }
      if (meta.parent_id != null) {
        noteReject(rid, "not_root_parent_id_set");
        continue;
      }
      if (meta.moderation_hidden_at != null) {
        noteReject(rid, "moderation_hidden");
        continue;
      }
      if (
        meta.asset_symbol !== q.mover.symbol ||
        meta.asset_class !== q.mover.assetClass
      ) {
        noteReject(
          rid,
          `asset_mismatch meta=${meta.asset_symbol}/${meta.asset_class} mover=${q.mover.symbol}/${q.mover.assetClass}`,
        );
        continue;
      }
      if (meta.view_count < minViews) {
        noteReject(
          rid,
          `view_count ${meta.view_count} < min ${minViews}`,
        );
        continue;
      }

      diagnostics.noPickReason = "picked";
      return {
        pick: {
          symbol: q.mover.symbol,
          assetClass: q.mover.assetClass,
          displayName: q.mover.name,
          priceChangePct: q.mover.priceChangePct,
          rootCommentId: rid,
          activityScore: q.score,
        },
        diagnostics: {
          ...diagnostics,
          rejectionSamples,
        },
      };
    }
  }

  diagnostics.rejectionSamples = rejectionSamples;
  diagnostics.noPickReason = "all_candidate_roots_failed_filters";
  return { pick: null, diagnostics };
}

export function currentHotMoverDiscussionBucket(): bigint {
  return BigInt(Math.floor(Date.now() / (4 * 60 * 60 * 1000)));
}
