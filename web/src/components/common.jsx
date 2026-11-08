// Pieces shared by the panels.
import { Box, Dialog, DialogTitle, Drawer, IconButton, useMediaQuery } from '@mui/material';
import { t } from '../theme.js';
import { DialogSpring, DrawerSpring } from '../motion.js';

export const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export function Panel({ open, onClose, title, label, children, maxWidth = 640, header, ...rest }) {
  const full = useMediaQuery('(max-width:599px)');
  return (
    <Dialog open={open} onClose={onClose} fullScreen={full} slots={{ transition: DialogSpring }} aria-label={label}
      slotProps={{ paper: { sx: { maxWidth: full ? '100%' : maxWidth } } }} {...rest}>
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, pl: 3, pr: 1.5, borderBottom: `1px solid ${t.line}` }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{header || <Box component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>{title}</Box>}</Box>
        <IconButton onClick={onClose} aria-label="Close" sx={{ color: t.muted, alignSelf: 'flex-start' }}><CloseIcon /></IconButton>
      </DialogTitle>
      {children}
    </Dialog>
  );
}

export function SideDrawer({ open, onClose, children, width = 380 }) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slots={{ transition: DrawerSpring }}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: width }, borderTop: 0, borderRight: 0, borderBottom: 0 } } }}>
      {children}
    </Drawer>
  );
}

export const Section = ({ title, aside, children, sx }) => (
  <Box component="section" sx={{ mt: 3.5, ...sx }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1.25 }}>
      <Box component="h3" sx={{ m: 0, fontSize: 13, fontWeight: 500, color: t.muted }}>{title}</Box>
      {aside}
    </Box>
    {children}
  </Box>
);

// Label above a value; numbers are mono.
export const Fact = ({ label, children }) => (
  <Box>
    <Box component="dt" sx={{ fontSize: 12, color: t.muted, mb: 0.5 }}>{label}</Box>
    <Box component="dd" sx={{ m: 0, fontSize: 15 }}>{children}</Box>
  </Box>
);

export const FactGrid = ({ children, min = 120 }) => (
  <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 2 }}>{children}</Box>
);

export const LangDot = ({ lang }) => (
  <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: window.langColor ? window.langColor(lang || 'Other') : t.faint, flex: 'none' }} />
);

export const Muted = ({ children, sx }) => <Box component="p" sx={{ m: 0, color: t.muted, fontSize: 14, lineHeight: 1.55, ...sx }}>{children}</Box>;

// Brand: the owner's planet logo next to the wordmark. full = the wide ringed-planet art, otherwise the square mark.
export function Brand({ full = false, size = 28, fontSize = 16, sx }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 700, fontSize, letterSpacing: '-0.01em', ...sx }}>
      <Box component="img" src={full ? '/logo.svg' : '/logo-mark.svg'} alt="" aria-hidden
        sx={{ height: size, width: full ? 'auto' : size, display: 'block' }} />
      GitSpace
    </Box>
  );
}
