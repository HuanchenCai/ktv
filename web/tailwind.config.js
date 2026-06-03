/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Background tiers
        bg: "#06060c",
        elevated: "#0e0e18",
        panel: "#13131f",
        "panel-hover": "#1c1c2c",
        border: "#27273a",

        // Brand — keep the API stable, refresh the actual colors
        accent: {
          DEFAULT: "#ff2e6b",
          soft: "#ff7aa1",
          hover: "#ff4d80",
        },
        // New neon palette for the V2 look
        neon: {
          pink: "#ff2e6b",
          fuchsia: "#d946ef",
          violet: "#8b5cf6",
          cyan: "#22d3ee",
          amber: "#fbbf24",
        },
        gold: "#fbc02d",
        muted: "#8a8b99",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: "0 0 30px rgba(255, 46, 107, 0.35), 0 0 6px rgba(255, 46, 107, 0.45)",
        "glow-violet":
          "0 0 30px rgba(139, 92, 246, 0.35), 0 0 6px rgba(139, 92, 246, 0.45)",
        "glow-cyan":
          "0 0 30px rgba(34, 211, 238, 0.30), 0 0 6px rgba(34, 211, 238, 0.40)",
        card: "0 4px 16px rgba(0, 0, 0, 0.35)",
        deep: "0 20px 50px rgba(0, 0, 0, 0.55)",
        // Inner glow on glass cards
        "inset-glow": "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "spin-slow": "spin 8s linear infinite",
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
        "marquee": "marquee 22s linear infinite",
        "blob-drift": "blobDrift 18s ease-in-out infinite alternate",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        pulseGlow: {
          "0%, 100%": {
            boxShadow:
              "0 0 24px rgba(255, 46, 107, 0.25), 0 0 4px rgba(255, 46, 107, 0.4)",
          },
          "50%": {
            boxShadow:
              "0 0 40px rgba(255, 46, 107, 0.55), 0 0 8px rgba(255, 46, 107, 0.7)",
          },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        blobDrift: {
          "0%": { transform: "translate(0, 0) scale(1)" },
          "100%": { transform: "translate(40px, -30px) scale(1.15)" },
        },
      },
    },
  },
  plugins: [],
};
