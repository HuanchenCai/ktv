import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0a0c",
          800: "#121216",
          700: "#1c1c22",
          600: "#2a2a33",
        },
        glow: {
          DEFAULT: "#f5b342",
          soft: "#f7c66d",
        },
        cta: {
          DEFAULT: "#e0395a",
          hover: "#c92e4d",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Microsoft YaHei",
          "Hiragino Sans GB",
          "Noto Sans CJK SC",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "Noto Serif SC",
          "Source Han Serif SC",
          "PingFang SC",
          "serif",
        ],
      },
      backgroundImage: {
        "glow-radial":
          "radial-gradient(ellipse at top, rgba(245,179,66,0.18), transparent 60%)",
        "ktv-grain":
          "linear-gradient(180deg, #0a0a0c 0%, #121216 50%, #0a0a0c 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
