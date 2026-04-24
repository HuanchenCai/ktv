/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b10",
        panel: "#1a1b24",
        accent: "#ff4f8b",
        muted: "#71727a",
      },
    },
  },
  plugins: [],
};
