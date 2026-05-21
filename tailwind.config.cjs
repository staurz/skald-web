/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,svelte,ts,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0a1320',
          2: '#122035',
          3: '#1a2b44',
          4: '#243a58',
        },
        paper: {
          DEFAULT: '#f3ede0',
          soft: 'rgba(243,237,224,0.72)',
          mute: 'rgba(243,237,224,0.46)',
          faint: 'rgba(243,237,224,0.18)',
          line: 'rgba(243,237,224,0.08)',
        },
        copper: {
          DEFAULT: '#cc7c3a',
          dim: 'rgba(204,124,58,0.5)',
          aura: 'rgba(204,124,58,0.18)',
        },
        amber: '#d9a460',
        moss: '#8aa68d',
        rust: '#c25b48',
        pearl: '#d4c8b4',
      },
      fontFamily: {
        display: ['Fraunces', 'Iowan Old Style', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '14px',
        md: '22px',
        lg: '30px',
      },
      letterSpacing: {
        'caps-mono': '0.20em',
        'caps-mono-tight': '0.16em',
        hero: '-0.045em',
        display: '-0.02em',
      },
    },
  },
  plugins: [],
};
