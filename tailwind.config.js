/**
 * Tailwind 配置（本工程 type:module，配置必须用 ESM 默认导出）。
 * 关闭 preflight，把基线重置交给 MUI <CssBaseline />，避免两套 reset 互相覆盖。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          300: '#93C5FD',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          900: '#1E3A5F',
        },
        ink: {
          500: '#6B7280',
          700: '#374151',
          900: '#1F2937',
        },
      },
    },
  },
  plugins: [],
};
