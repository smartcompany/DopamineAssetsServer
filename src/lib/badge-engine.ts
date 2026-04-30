export type BadgeCounters = Record<string, number>;

export type BadgeState = {
  unlockedKeys: string[];
  counters: BadgeCounters;
};

export type BadgeCatalogItem = {
  key: string;
  label: string;
  imageUrl: string;
};

export const BADGE_CATALOG_VERSION = 1;

export const BADGE_CATALOG: BadgeCatalogItem[] = [
  { key: "first", label: "첫걸음", imageUrl: "/badges/badge_first.png" },
  { key: "explorer", label: "커뮤니티 탐험가", imageUrl: "/badges/badge_explorer.png" },
  { key: "write_first", label: "첫 작성자", imageUrl: "/badges/badge_write_first.png" },
  { key: "comment_first", label: "첫 댓글러", imageUrl: "/badges/badge_comment_first.png" },
  { key: "radar_on", label: "레이더 ON", imageUrl: "/badges/badge_rader_on.png" },
  { key: "scan_assets", label: "스캐너", imageUrl: "/badges/badge_scan_assets.png" },
  { key: "talk_king", label: "토론가", imageUrl: "/badges/badge_talk_king.png" },
  { key: "heart_king", label: "공감왕", imageUrl: "/badges/badge_hart_king.png" },
  { key: "visit_7", label: "연속 7일", imageUrl: "/badges/badge_visit_7.png" },
  { key: "level_5", label: "레벨 5", imageUrl: "/badges/badge_5_level.png" },
  { key: "level_10", label: "레벨 10", imageUrl: "/badges/badge_level_10.png" },
  { key: "multi_market", label: "멀티마켓", imageUrl: "/badges/badge_multi_market.png" },
];

function toSet(keys: string[]) {
  return new Set(keys.filter((v) => typeof v === "string" && v.length > 0));
}

function inc(counters: BadgeCounters, key: string) {
  counters[key] = (counters[key] ?? 0) + 1;
}

function unlock(
  unlocked: Set<string>,
  key: string,
  newlyUnlocked: string[],
) {
  if (unlocked.has(key)) return;
  unlocked.add(key);
  newlyUnlocked.push(key);
}

export function sanitizeBadgeState(input: unknown): BadgeState {
  const o = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const unlockedRaw = Array.isArray(o.unlockedKeys) ? o.unlockedKeys : [];
  const countersRaw =
    typeof o.counters === "object" && o.counters !== null
      ? (o.counters as Record<string, unknown>)
      : {};
  const unlockedKeys = unlockedRaw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  const counters: BadgeCounters = {};
  for (const [k, v] of Object.entries(countersRaw)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      counters[k] = Math.max(0, Math.floor(v));
    }
  }
  return {
    unlockedKeys: Array.from(new Set(unlockedKeys)).sort(),
    counters,
  };
}

function isTrue(value: unknown) {
  return value === true;
}

export function applyBadgeEvent({
  state,
  eventName,
  params,
}: {
  state: BadgeState;
  eventName: string;
  params: Record<string, unknown>;
}): { state: BadgeState; newlyUnlocked: string[] } {
  const unlocked = toSet(state.unlockedKeys);
  const counters = { ...state.counters };
  const newlyUnlocked: string[] = [];

  switch (eventName) {
    case "home_view":
      inc(counters, "home_view_count");
      unlock(unlocked, "first", newlyUnlocked);
      if ((counters.home_view_count ?? 0) >= 7) unlock(unlocked, "visit_7", newlyUnlocked);
      break;
    case "community_view":
      inc(counters, "community_view_count");
      unlock(unlocked, "explorer", newlyUnlocked);
      break;
    case "community_post_submit":
      if (isTrue(params.is_edit)) break;
      inc(counters, "post_count");
      unlock(unlocked, "write_first", newlyUnlocked);
      if ((counters.post_count ?? 0) + (counters.reply_count ?? 0) >= 20) {
        unlock(unlocked, "talk_king", newlyUnlocked);
      }
      break;
    case "community_reply_submit":
      inc(counters, "reply_count");
      unlock(unlocked, "comment_first", newlyUnlocked);
      if ((counters.post_count ?? 0) + (counters.reply_count ?? 0) >= 20) {
        unlock(unlocked, "talk_king", newlyUnlocked);
      }
      break;
    case "favorite_toggled":
      if (isTrue(params.favored)) {
        inc(counters, "favored_count");
        if ((counters.favored_count ?? 0) >= 3) unlock(unlocked, "radar_on", newlyUnlocked);
      }
      break;
    case "asset_detail_open":
      inc(counters, "asset_open_count");
      if ((counters.asset_open_count ?? 0) >= 50) unlock(unlocked, "scan_assets", newlyUnlocked);
      break;
    case "community_like_toggled":
      if (isTrue(params.liked)) {
        inc(counters, "like_given_count");
        if ((counters.like_given_count ?? 0) >= 100) {
          unlock(unlocked, "heart_king", newlyUnlocked);
        }
      }
      break;
    default:
      break;
  }

  const levelScore =
    (counters.post_count ?? 0) * 12 +
    (counters.reply_count ?? 0) * 6 +
    (counters.like_given_count ?? 0) * 2;
  if (levelScore >= 80) unlock(unlocked, "level_5", newlyUnlocked);
  if (levelScore >= 220) unlock(unlocked, "level_10", newlyUnlocked);

  const nextState: BadgeState = {
    unlockedKeys: Array.from(unlocked).sort(),
    counters,
  };
  return { state: nextState, newlyUnlocked };
}
