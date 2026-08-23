/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        canvas: "#FDFBF7",
        primary: "#09261E",
        neutral900: "#1A1A1A",
        neutral800: "#2E2E2E",
        slate500: "#64748B",
        borderfaint: "#E2E8F0",
        cardsurf: "#FFFDF8",
        amberbg: "#F1E2B2",
        ambertext: "#6D5513",
        redbg: "#F6DED3",
        redtext: "#7F2E14",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
}

