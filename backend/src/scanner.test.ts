import { describe, it, expect } from "vitest";
import { parseFilename } from "./scanner.ts";

describe("parseFilename", () => {
  it("B'in MUSIC style with tags, language, genre", () => {
    const r = parseFilename(
      "如果明天世界末日[MTV]-魔幻力量-国语-流行.mkv",
      "魔幻力量",
    );
    expect(r.title).toBe("如果明天世界末日");
    expect(r.artist).toBe("魔幻力量");
    expect(r.lang).toBe("国语");
    expect(r.genre).toBe("流行");
  });

  it("title only, artist from dir", () => {
    const r = parseFilename("稻香.mkv", "周杰伦");
    expect(r.title).toBe("稻香");
    expect(r.artist).toBe("周杰伦");
    expect(r.lang).toBe(null);
    expect(r.genre).toBe(null);
  });

  it("strips multiple tags", () => {
    const r = parseFilename("只有你[MV][HD].mp4", "周周");
    expect(r.title).toBe("只有你");
  });

  it("unknown artist falls back", () => {
    const r = parseFilename("abc.mkv", "");
    expect(r.artist).toBe("unknown");
  });

  it("em-dash separator", () => {
    const r = parseFilename("歌名—歌手—粤语.mkv", "dir");
    expect(r.title).toBe("歌名");
    expect(r.artist).toBe("歌手");
    expect(r.lang).toBe("粤语");
  });
});
