/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vibe: {
          bg: '#0a0a0a',
          card: '#141414',
          border: '#262626',
          accent: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
