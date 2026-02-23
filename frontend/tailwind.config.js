/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "ui-monospace", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        cw: {
          bg:       "#0d1117",
          surface:  "#161b22",
          border:   "#21262d",
          muted:    "#30363d",
          text:     "#e6edf3",
          subtle:   "#8b949e",
          accent:   "#388bfd",
          green:    "#3fb950",
          yellow:   "#d29922",
          red:      "#f85149",
          purple:   "#bc8cff",
          orange:   "#ffa657",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in":    "fadeIn 0.25s ease-out",
        "slide-up":   "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
