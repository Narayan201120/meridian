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
        graphite: "#241F19",
        neutral800: "#2E2E2E",
        ink: "#1D2A2C",
        slate500: "#64748B",
        borderfaint: "#E2E8F0",
        cardsurf: "#FFFDF8",
        amberbg: "#F1E2B8",
        ambertext: "#6D5513",
        brass: "#8A5A12",
        brasstint: "#E8D9B0",
        redbg: "#F3DAD0",
        redbgpressed: "#EAC4B4",
        redtext: "#B23A22",
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
      fontFamily: {
        // Display: Space Grotesk 700 for hero headlines and big due-time figures.
        display: ["SpaceGrotesk_700Bold", "System"],
        // Section and card titles: Space Grotesk 600.
        heading: ["SpaceGrotesk_600SemiBold", "System"],
        // Body, labels, buttons, badges: Public Sans.
        sans: ["PublicSans_400Regular", "System"],
        semibold: ["PublicSans_600SemiBold", "System"],
        bold: ["PublicSans_700Bold", "System"],
      },
    },
  },
  plugins: [],
}

