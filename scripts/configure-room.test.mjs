import { describe, expect, it } from "vitest";
import { configureRoomConfig } from "./configure-room.mjs";

describe("configureRoomConfig", () => {
  it("preserves song settings and creates separate room credentials", () => {
    const config = { library_path: "./library", openlist: { api_token: "existing" } };
    const updated = configureRoomConfig(config, "https://party.example.ts.net/");

    expect(updated.library_path).toBe("./library");
    expect(updated.openlist).toEqual({ api_token: "existing" });
    expect(updated.room.public_url).toBe("https://party.example.ts.net");
    expect(updated.room.guest_code).toMatch(/^KTV-[A-HJ-NP-Z2-9]{8}$/);
    expect(updated.room.admin_code.length).toBeGreaterThanOrEqual(24);
    expect(updated.room.admin_code).not.toBe(updated.room.guest_code);
  });

  it.each([
    "http://party.example.ts.net",
    "https://party.example.ts.net/ktv",
    "https://party.example.ts.net/?token=secret",
    "https://user:pass@party.example.ts.net",
  ])("rejects invalid public address %s", (address) => {
    expect(() => configureRoomConfig({}, address)).toThrow("HTTPS root URL");
  });
});
