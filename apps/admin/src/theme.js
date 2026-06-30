import { createTheme } from '@mantine/core'

// Deliberately NOT the product theme — a denser, cooler backoffice look.
export const theme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 6, dark: 8 },
  defaultRadius: 'md',
  fontFamily:
    'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  headings: { fontWeight: '650' },
  cursorType: 'pointer',
  components: {
    Table: { defaultProps: { striped: true, highlightOnHover: true, verticalSpacing: 'sm' } },
    Card: { defaultProps: { withBorder: true, radius: 'md' } },
    Button: { defaultProps: { radius: 'md' } },
  },
})

// Sidebar uses a fixed dark slate regardless of color scheme.
export const NAV_BG = '#0b1220'
export const NAV_FG = '#c7d2e0'
export const NAV_ACTIVE = '#1d2b4a'
