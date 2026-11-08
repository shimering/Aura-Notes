/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          light: '#fbfbfa',
          dark: '#121214',
        },
        surface: {
          light: '#ffffff',
          dark: '#1c1c1f',
          subtle: {
            light: '#f4f4f3',
            dark: '#26262b'
          }
        },
        ink: {
          light: '#191919',
          dark: '#f0f0f2',
          muted: {
            light: '#787774',
            dark: '#9a9a9f'
          }
        },
        accent: {
          primary: '#3b82f6',
          violet: '#8b5cf6',
          amber: '#f59e0b',
          emerald: '#10b981',
          rose: '#f43f5e'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace']
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
        'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'floating': '0 12px 40px -10px rgba(0,0,0,0.15)'
      }
    },
  },
  plugins: [],
}
