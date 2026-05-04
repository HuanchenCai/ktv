/**
 * Curated set of artists most likely to appear on a Chinese-language KTV
 * front page. Order is roughly "you'll probably recognize them" — the API
 * preserves this order so the UI can render the chips with the most-known
 * names first.
 *
 * Selection rule: well-represented in any decent Chinese KTV library
 * (heavy KTV-track catalogs from B'in / 雷石 / 视易 etc.), spans Mandopop
 * and Cantopop, mixes 80s/90s legends with current-decade artists.
 */
export const POPULAR_ARTISTS: readonly string[] = [
  // Mandopop staples
  "周杰伦",
  "林俊杰",
  "王力宏",
  "陶喆",
  "五月天",
  "苏打绿",
  "任贤齐",
  "周华健",
  "李宗盛",
  "罗大佑",

  // Mandopop newer / very popular
  "邓紫棋",
  "薛之谦",
  "毛不易",
  "周深",
  "张杰",
  "华晨宇",

  // Mandopop female
  "蔡依林",
  "张惠妹",
  "孙燕姿",
  "梁静茹",
  "田馥甄",
  "莫文蔚",
  "王菲",
  "邓丽君",
  "杨千嬅",

  // Cantopop heavyweights
  "张学友",
  "陈奕迅",
  "刘德华",
  "谭咏麟",
  "张国荣",
  "Beyond",
  "容祖儿",
  "黎明",
  "郭富城",
];

/**
 * Filter the curated list down to artists that actually exist in the
 * provided set (i.e. have at least one cached song in the local DB).
 * Preserves curated ordering.
 */
export function popularArtistsInLibrary(
  presentArtists: ReadonlySet<string>,
): string[] {
  return POPULAR_ARTISTS.filter((a) => presentArtists.has(a));
}
