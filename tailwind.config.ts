import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bot House neon color system
        bg: {
          primary: "#080810",
          secondary: "#0f0f1a",
          card: "#12121f",
          border: "#1e1e35",
        },
        neon: {
          green: "#00ff88",
          pink: "#ff0080",
          cyan: "#00d4ff",
          orange: "#ff4400",
          purple: "#9000ff",
          yellow: "#ffdd00",
        },
        text: {
          primary: "#e8e8f0",
          secondary: "#9090a8",
          muted: "#5a5a78",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "monospace"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      animation: {
        "glitch-1": "glitch1 0.3s infinite",
        "glitch-2": "glitch2 0.3s infinite",
        "pulse-neon": "pulseNeon 2s ease-in-out infinite",
        "blink": "blink 1s step-end infinite",
        "float": "float 3s ease-in-out infinite",
        "drama-slide": "dramaSlide 0.5s ease-out",
        "chaos-shake": "chaosShake 0.5s ease-in-out",
        "fade-in-up": "fadeInUp 0.3s ease-out",
        "scan-line": "scanLine 3s linear infinite",
      },
      keyframes: {
        glitch1: {
          "0%, 100%": { clipPath: "polygon(0 0, 100% 0, 100% 45%, 0 45%)", transform: "translate(-2px, 0)" },
          "50%": { clipPath: "polygon(0 55%, 100% 55%, 100% 100%, 0 100%)", transform: "translate(2px, 0)" },
        },
        glitch2: {
          "0%, 100%": { clipPath: "polygon(0 55%, 100% 55%, 100% 100%, 0 100%)", transform: "translate(2px, 0)" },
          "50%": { clipPath: "polygon(0 0, 100% 0, 100% 45%, 0 45%)", transform: "translate(-2px, 0)" },
        },
        pulseNeon: {
          "0%, 100%": { opacity: "1", filter: "brightness(1)" },
          "50%": { opacity: "0.8", filter: "brightness(1.3)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        dramaSlide: {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        chaosShake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-2px)" },
          "80%": { transform: "translateX(2px)" },
        },
        fadeInUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scanLine: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      boxShadow: {
        "neon-green": "0 0 20px rgba(0, 255, 136, 0.5), 0 0 40px rgba(0, 255, 136, 0.2)",
        "neon-pink": "0 0 20px rgba(255, 0, 128, 0.5), 0 0 40px rgba(255, 0, 128, 0.2)",
        "neon-cyan": "0 0 20px rgba(0, 212, 255, 0.5), 0 0 40px rgba(0, 212, 255, 0.2)",
        "neon-orange": "0 0 20px rgba(255, 68, 0, 0.5), 0 0 40px rgba(255, 68, 0, 0.2)",
        "card": "0 4px 24px rgba(0, 0, 0, 0.4)",
        "card-hover": "0 8px 32px rgba(0, 0, 0, 0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
