/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Background tiers
        bg: "#08080d",
        elevated: "#11111a",
        panel: "#181822",
        "panel-hover": "#21212e",
        border: "#2a2a38",

        // Brand
        accent: {
          DEFAULT: "#ff2e6b",
          soft: "#ff5b88",
          hover: "#ff4577",
        },
        gold: "#fbc02d",
        muted: "#7a7b88",
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
        glow: "0 0 30px rgba(255, 46, 107, 0.25)",
        card: "0 4px 16px rgba(0, 0, 0, 0.3)",
        deep: "0 12px 32px rgba(0, 0, 0, 0.5)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
