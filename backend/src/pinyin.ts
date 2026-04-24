import { pinyin } from "pinyin-pro";

/**
 * Convert a Chinese title to pinyin initials.
 *
 *   "只有你"     -> "zyn"
 *   "I love you" -> "iloveyou"  (non-han chars kept lowercased, spaces removed)
 *   "123 abc 你好" -> "123abcnh"
 *
 * Multi-pronunciation characters take the first pronunciation.
 */
export function toPinyinInitials(title: string): string {
  if (!title) return "";

  const hanRegex = /[\u4e00-\u9fff]/;
  let out = "";
  let buf = "";

  const flushBuf = () => {
    if (buf.length > 0) {
      out += buf.toLowerCase();
      buf = "";
    }
  };

  for (const ch of title) {
    if (hanRegex.test(ch)) {
      flushBuf();
      const initial = pinyin(ch, {
        pattern: "first",
        toneType: "none",
        type: "array",
      })[0];
      if (initial) out += initial.toLowerCase();
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      buf += ch;
    } else {
      // punctuation / whitespace — drop
      flushBuf();
    }
  }
  flushBuf();
  return out;
}

/**
 * Returns true if the user query (pinyin initials, lowercased) matches the song's full initials.
 * Matching rule: substring match. "zyn" matches "zhyoun" -> no; matches "zyn" -> yes;
 * matches "wzynjy" (我只有你居然) -> yes (prefix or anywhere).
 * For now we use simple `includes`; can tune later for prefix-preferred ranking.
 */
export function matchesPinyin(fullInitials: string, query: string): boolean {
  if (!query) return true;
  return fullInitials.includes(query.toLowerCase());
}
