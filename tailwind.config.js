/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
    "./node_modules/flowbite/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        vc: {
          primary: {
            DEFAULT: '#14b8a6',
            light: '#2dd4bf',
            dark: '#0d9488',
          },
          accent: {
            DEFAULT: '#d97706',
            light: '#fbbf24',
            dark: '#b45309',
          },
        },
      },
    },
  },
  plugins: [
    require('flowbite/plugin'),
    require('@tailwindcss/forms'),
    require('tailwindcss-animate'),
  ],
}
