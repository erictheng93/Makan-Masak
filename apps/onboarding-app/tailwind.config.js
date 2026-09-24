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
        primary: {
          50: "#fef7ee",
          100: "#fdecd3",
          200: "#fad5a5",
          300: "#f6b76d",
          400: "#f19332",
          500: "#ed760e",
          600: "#de5c09",
          700: "#b7440a",
          800: "#92370e",
          900: "#762f0f",
        },
      },
    },
  },
  plugins: [forms],
};
