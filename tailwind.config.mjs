// tailwind.config.mjs  (ESM syntax)
import { fontFamily } from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mjs}',
    './components/**/*.{js,ts,jsx,tsx,mjs}',
  ],
  theme: {
    extend: {
      colors: {
        primary:  { DEFAULT: '#00E8B5' },
        accent:   '#FF55D8',
        surface:  { light: '#F4F7FA', dark: '#0C0F14' },
        secondary:{ DEFAULT: '#161B26', foreground: '#FFFFFF' },
      },
      dropShadow: {
        neon: '0 0 8px rgba(0,232,181,0.65)',
      },
      keyframes: {
        gradient: {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%':     { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'gradient-slow': 'gradient 8s ease infinite',
      },
      fontFamily: {
        sans: ['Inter', ...fontFamily.sans],
      },
    },
  },
  plugins: [],
}
