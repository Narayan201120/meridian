/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Single source of truth for the Meridian palette.
        // Use these semantic classes everywhere; never hardcode hex
        // in classNames or StyleSheets (see global.css :root mirror).
        canvas: "#FDFBF7",
        primary: "#09261E",
        primarypressed: "#0A2F25",
        neutral900: "#1A1A1A",
        neutral800: "#2E2E2E",
        ink: "#1D2A2C",
        slate500: "#64748B",
        borderfaint: "#E2E8F0",
        cardsurf: "#FFFDF8",
        amberbg: "#F1E2B2",
        ambertext: "#6D5513",
        redbg: "#F6DED3",
        redbgpressed: "#F3C9B8",
        redtext: "#7F2E14",
        // Status tints
        inboxbg: "#E4F0E7",
        inboxtext: "#204636",
        scheduledbg: "#F3E2B8",
        scheduledtext: "#7B5D17",
        duenowbg: "#F7D9BD",
        duenowtext: "#8A4A16",
        completedbg: "#D7E1EF",
        completedtext: "#324F75",
        // Warm sand neutrals
        sandbg: "#F6EFE1",
        sandborder: "#E2D8C3",
        sandtext: "#5B615D",
        sandmuted: "#6A6258",
        chipbg: "#F5EADB",
        chipborder: "#E0D0B5",
        chiptext: "#26413C",
        chipcountbg: "#33594F",
        // Brand accents
        kicker: "#DAB785",
        eyebrow: "#B45A36",
        creamtext: "#FFF8EE",
        herosub: "#D9E3DC",
        bodytext: "#415255",
        captiontext: "#4C4A43",
        placeholder: "#7D7A70",
        secondarybtn: "#E8EEE8",
        secondarybtntext: "#27443E",
        secondarybtnpressed: "#DBE7DB",
        suggestbg: "#DCE8F5",
        suggesttext: "#2A4A6B",
        successbg: "#E5F1DE",
        successtext: "#355B22",
        successborder: "#B8D4AA",
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

