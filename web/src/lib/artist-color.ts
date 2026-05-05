/**
 * Stable accent color for an artist's fallback avatar — derived from
 * the name so the same artist always gets the same tile color across
 * pages. Pure function, kept here so SongList / Artists / future
 * artist-tile callers don't drift apart.
 */
export function artistColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hues = [340, 200, 160, 280, 30, 0, 220, 50, 100, 320];
  return `hsl(${hues[Math.abs(h) % hues.length]}, 60%, 22%)`;
}
