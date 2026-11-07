import { createTheme } from '@mui/material/styles';

// Near-black surfaces with hairline borders; the islands bring the colour.
// Coral is reserved for the primary action and the current selection.
export const t = {
  bg: '#08080B',
  surface: '#0B0B10',
  raised: '#14141B',
  line: 'rgba(255,255,255,.08)',
  lineStrong: 'rgba(255,255,255,.16)',
  text: '#EDEDF0',
  muted: '#8B8B98',
  faint: '#5E5E6A',
  accent: '#F2765A',
  warn: '#E2B46C',
  good: '#83C5A6',
  sans: "'Satoshi', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
};

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: t.accent, contrastText: '#1A0C07' },
    background: { default: t.bg, paper: t.surface },
    text: { primary: t.text, secondary: t.muted, disabled: t.faint },
    divider: t.line,
    action: { hover: 'rgba(255,255,255,.05)', selected: 'rgba(242,118,90,.12)', focus: 'rgba(255,255,255,.08)' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: t.sans,
    fontSize: 14,
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFamily: t.sans, WebkitFontSmoothing: 'antialiased' },
        '*': { scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,.14) transparent' },
        '.num': { fontFamily: t.mono, fontVariantNumeric: 'tabular-nums' },
        ':focus-visible': { outline: `2px solid ${t.text}`, outlineOffset: 2 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${t.line}` } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, minHeight: 36, paddingInline: 14 },
        outlined: { borderColor: t.lineStrong, color: t.text, '&:hover': { borderColor: 'rgba(255,255,255,.28)', background: 'rgba(255,255,255,.04)' } },
        text: { color: t.text },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 8, color: t.text } } },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12, background: t.surface, margin: 16, width: 'calc(100% - 32px)' },
        paperFullScreen: { margin: 0, width: '100%', borderRadius: 0, border: 0 },
      },
    },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(4,4,7,.6)' }, invisible: { backgroundColor: 'transparent' } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 10, minWidth: 240, marginTop: 6 }, list: { padding: 4 } } },
    MuiMenuItem: {
      styleOverrides: {
        root: { borderRadius: 6, minHeight: 36, fontSize: 14, gap: 12 },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: t.line } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { background: t.raised, border: `1px solid ${t.line}`, color: t.text, fontSize: 12, fontWeight: 500, padding: '4px 8px' },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 44, fontSize: 14, fontWeight: 500, paddingInline: 0, minWidth: 0, marginRight: 24 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 }, indicator: { height: 2 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8, background: t.bg,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: t.lineStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,.28)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.text, borderWidth: 1 },
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { background: t.raised, color: t.text, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: 14, boxShadow: 'none' } },
    },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: 'rgba(255,255,255,.06)' } } },
    MuiSlider: { styleOverrides: { valueLabel: { fontFamily: t.mono, fontSize: 12, background: t.raised, border: `1px solid ${t.line}` } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { borderRadius: 10, marginTop: 6 },
        listbox: { padding: 4, maxHeight: 'min(60vh, 420px)' },
        option: { borderRadius: 6, gap: 12, minHeight: 44 },
        noOptions: { color: t.muted, fontSize: 14 },
        loading: { color: t.muted, fontSize: 14 },
      },
    },
  },
});
