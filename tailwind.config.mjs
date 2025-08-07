/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  darkMode: 'media',      // or 'class' if you prefer manual toggle
  theme: {
    extend: {
      borderRadius: { lg: 'var(--radius)' },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card:       'hsl(var(--card))',
        border:     'hsl(var(--border))',
        primary:    'hsl(var(--primary))',
        secondary:  'hsl(var(--secondary))',
      },
    },
  },
  plugins: [],
}
