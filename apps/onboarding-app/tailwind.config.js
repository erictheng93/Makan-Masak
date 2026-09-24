import { iosColors, iosShadows } from "../../design-tokens.js";

import forms from "@tailwindcss/forms";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        ...iosShadows,
        card: "0 4px 16px rgba(0, 0, 0, 0.06)",
      },
      colors: {
        ...iosColors,
        // Cloudflare orange (#F38020) at 500. Fills sit on 500/600; text on
        // white uses 700+, since #F38020 is only 2.65:1 against white.
        primary: {
          50: "#fef4ea",
          100: "#fde4cc",
          200: "#fac999",
          300: "#f7ac66",
          400: "#f5963f",
          500: "#f38020",
          600: "#e06d10",
          700: "#b04f09",
          800: "#8f430c",
          900: "#6e350d",
        },
      },
    },
  },
  plugins: [forms],
};
