/**
 * 금지어 목록으로 텍스트 검사 (LetsMeet `server/lib/validate-banned-words.ts` 와 동일).
 * 목록은 `banned-words.json` — 클라이언트 `assets/banned_words.json` 과 동기화 유지.
 */
import bannedWordsJson from "./banned-words.json";

const words: string[] = Array.isArray(bannedWordsJson)
  ? (bannedWordsJson as string[])
  : [];

export function checkBannedWords(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  for (const word of words) {
    const w = (word || "").trim();
    if (!w) continue;
    if (lower.includes(w.toLowerCase())) {
      return w;
    }
  }
  return null;
}
