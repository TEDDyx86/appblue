/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        blue3: {
          50: '#F0F7FF',
          100: '#E0EFFF',
          200: '#BAE0FF',
          300: '#7CC4FF',
          400: '#38A8FF',
          500: '#0092FF', // Blue3 Official Brand Blue
          600: '#007AFF',
          700: '#005AC2',
          800: '#002060', // Blue3 Corporate Navy
          900: '#000D38', // Blue3 Midnight
          950: '#00061A',
          cyan: '#00FFFF',
          royal: '#001D99',
          navy: '#002060',
          midnight: '#000D38',
        },
        brand: {
          50: '#F0F7FF',
          100: '#E0EFFF',
          200: '#BAE0FF',
          300: '#7CC4FF',
          400: '#38A8FF',
          500: '#0092FF',
          600: '#007AFF',
          700: '#001D99',
          800: '#002060',
          900: '#000D38',
          950: '#00061A',
        },
        primary: {
          50: '#F0F7FF',
          100: '#E0EFFF',
          200: '#BAE0FF',
          300: '#7CC4FF',
          400: '#38A8FF',
          500: '#0092FF',
          600: '#007AFF',
          700: '#001D99',
          800: '#002060',
          900: '#000D38',
        },
        wealth: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B', // Wealth Gold
          600: '#D97706',
          700: '#B45309',
        },
      },
      boxShadow: {
        'blue3-sm': '0 2px 8px -1px rgba(0, 146, 255, 0.12), 0 1px 3px -1px rgba(0, 146, 255, 0.08)',
        'blue3-md': '0 4px 16px -2px rgba(0, 146, 255, 0.20), 0 2px 6px -2px rgba(0, 146, 255, 0.12)',
        'blue3-glow': '0 0 20px rgba(0, 146, 255, 0.35)',
        'cyan-glow': '0 0 16px rgba(0, 255, 255, 0.40)',
        'wealth-glow': '0 0 16px rgba(245, 158, 11, 0.30)',
        'card-light': '0 2px 12px rgba(0, 29, 153, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
        'card-dark': '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 32, 96, 0.8)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
