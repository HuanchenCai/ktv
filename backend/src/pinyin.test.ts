import { describe, it, expect } from "vitest";
import { toPinyinInitials, matchesPinyin } from "./pinyin.ts";

describe("toPinyinInitials", () => {
  it("single characters", () => {
    expect(toPinyinInitials("你")).toBe("n");
    expect(toPinyinInitials("好")).toBe("h");
  });

  it("简单例子", () => {
    expect(toPinyinInitials("只有你")).toBe("zyn");
    expect(toPinyinInitials("我承担得起你")).toBe("wcddqn");
  });

  it("strips punctuation and whitespace", () => {
    expect(toPinyinInitials("只有  你")).toBe("zyn");
    expect(toPinyinInitials("只有，你")).toBe("zyn");
  });

  it("keeps latin / digits lowercased inline", () => {
    expect(toPinyinInitials("Nice 2 meet 你")).toBe("nice2meetn");
  });

  it("handles empty", () => {
    expect(toPinyinInitials("")).toBe("");
  });

  it("如果明天世界末日", () => {
    // 如 r, 果 g, 明 m, 天 t, 世 s, 界 j, 末 m, 日 r
    expect(toPinyinInitials("如果明天世界末日")).toBe("rgmtsjmr");
  });
});

describe("matchesPinyin", () => {
  it("empty query matches all", () => {
    expect(matchesPinyin("zyn", "")).toBe(true);
  });
  it("exact match", () => {
    expect(matchesPinyin("zyn", "zyn")).toBe(true);
  });
  it("substring match", () => {
    expect(matchesPinyin("rgmtsjmr", "mts")).toBe(true);
  });
  it("no match", () => {
    expect(matchesPinyin("zyn", "abc")).toBe(false);
  });
  it("case-insensitive", () => {
    expect(matchesPinyin("zyn", "ZYN")).toBe(true);
  });
});
