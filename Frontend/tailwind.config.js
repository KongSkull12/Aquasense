export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Hydrographic chart palette: ink, deep water, depth bands, shoal, chart notes
        ink: {
          DEFAULT: '#0f2a3d',
          2: '#3d566a',
          3: '#5b7083',
          soft: '#173a52',
        },
        line: {
          DEFAULT: '#d6e2ea',
          soft: '#e8eff4',
        },
        water: '#f4f8fb',
        band: '#e1eef6',
        contour: '#7aaecb',
        sounding: {
          DEFAULT: '#1d5d86',
          dark: '#164a6c',
        },
        shoal: '#f1e9d2',
        note: '#a3124b',
        ok: '#1d6b47',
        warn: {
          DEFAULT: '#a14e06',
          bg: '#fcf1e1',
        },
        alarm: {
          DEFAULT: '#b42318',
          bg: '#fdecea',
        },
        rail: {
          DEFAULT: '#0f2a3d',
          hover: '#173a52',
          text: '#b6ccda',
        },

        // Legacy keys kept for components not part of the redesign
        primary: '#0f2a3d',
        accent: '#1d5d86',
        background: '#FFFFFF',
        surface: '#f4f8fb',
        success: '#1d6b47',
        warning: '#a14e06',
        danger: '#b42318',
        secondary: '#1d6b47',
        light: '#f4f8fb',
        dark: '#0f2a3d',
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      boxShadow: {
        overlay: '0 8px 24px -6px rgba(15, 42, 61, 0.18), 0 2px 6px -2px rgba(15, 42, 61, 0.12)',
      },
    },
  },
  plugins: [],
};
