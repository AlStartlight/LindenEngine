export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./editor/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'engine-dark': '#1e1e1e',
        'engine-darker': '#141414',
        'engine-accent': '#007acc',
        'engine-success': '#4ec9b0',
        'engine-warning': '#dcdcaa',
        'engine-error': '#f48771',
      },
    },
  },
  plugins: [],
}
