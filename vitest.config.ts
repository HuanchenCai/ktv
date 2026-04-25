import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Don't pick up tests from Claude Code worktrees or any node_modules.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
  },
});
