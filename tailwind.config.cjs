module.exports = {
  content: ['./index.html', './App.tsx', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { gray: { 750: '#2d3748', 850: '#1a202c', 950: '#0d1117' } }, fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'] } } },
  safelist: [{pattern: /^(bg|text|border|shadow|ring)-(indigo|emerald|amber)-(400|500|600|700|900)$/, variants: ['hover','focus']}],
  plugins: [],
};
