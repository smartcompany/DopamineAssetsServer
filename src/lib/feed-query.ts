import type { AssetClass } from "./types";

const VALID = new Set<AssetClass>([
  "us_stock",
  "kr_stock",
  "crypto",
  "commodity",
]);

export function resolveAssetClasses(
  include: string | null,
  exclude: string | null,
): Set<AssetClass> {
  const all: AssetClass[] = [
    "us_stock",
    "kr_stock",
    "crypto",
    "commodity",
  ];

  if (include !== null && include.trim() !== "") {
    const parts = include
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as AssetClass[];
    const bad = parts.filter((p) => !VALID.has(p));
    if (bad.length > 0) {
      throw new Error(`invalid_asset_class: ${bad.join(",")}`);
    }
    if (parts.length === 0) {
      throw new Error("empty_include");
    }
    return new Set(parts);
  }

  if (exclude !== null && exclude.trim() !== "") {
    const ex = new Set(
      exclude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const bad = [...ex].filter((x) => !VALID.has(x as AssetClass));
    if (bad.length > 0) {
      throw new Error(`invalid_asset_class: ${bad.join(",")}`);
    }
    return new Set(all.filter((a) => !ex.has(a)));
  }

  return new Set(all);
}

export function clampLimit(raw: string | null, fallback = 10): number {
  const n = raw === null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(50, Math.max(1, n));
}
