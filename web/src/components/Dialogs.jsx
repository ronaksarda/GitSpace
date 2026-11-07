// The smaller panels: review a repo, citizens, keyboard shortcuts, guest sign-in prompt, fatal error.
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Box, Button, ButtonBase, DialogActions, DialogContent, IconButton, TextField } from '@mui/material';
import { t } from '../theme.js';
import { avatarUrl, getJSON, plural } from '../lib.js';
import { CloseIcon, Muted, Panel, SideDrawer } from './common.jsx';
import HealthReport, { useReview } from './HealthReport.jsx';

export function ReviewDialog({ open, onClose, onFind }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState(null);
  const [state, retry] = useReview(query);
  useEffect(() => { if (open) { setText(''); setQuery(null); } }, [open]);
  const submit = e => { e.preventDefault(); if (text.trim()) { if (text.trim() === query) retry(); else setQuery(text.trim()); } };
  return (
    <Panel open={open} onClose={onClose} title="Review a repo">
      <DialogContent sx={{ px: 3, py: 3 }}>
        <Muted sx={{ mb: 2 }}>Paste any public repo to get a health score, what is working, and what to fix next.</Muted>
        <Box component="form" onSubmit={submit} sx={{ display: 'flex', gap: 1, mb: 3 }}>
          <TextField autoFocus fullWidth size="small" value={text} onChange={e => setText(e.target.value)}
            placeholder="owner/name or a GitHub link" slotProps={{ htmlInput: { 'aria-label': 'Repository' } }} sx={{ '& input': { fontFamily: t.mono, fontSize: 13 } }} />
          <Button type="submit" variant="contained" disabled={!text.trim()}>Check</Button>
        </Box>
        <HealthReport state={state} onRetry={retry} onFind={onFind} />
      </DialogContent>
    </Panel>
  );
}

export function Citizens({ open, onClose, onOpen }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('');
  const load = () => {
    setError(false);
    getJSON('/api/citizens').then(d => setList(Array.isArray(d) ? d : [])).catch(() => setError(true));
  };
  useEffect(() => { if (open && !list) load(); }, [open]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list || []).filter(c => !q || c.login.toLowerCase().includes(q)).slice(0, 100);
  }, [list, filter]);

  return (
    <SideDrawer open={open} onClose={onClose}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2, pl: 3, pr: 1.5, borderBottom: `1px solid ${t.line}` }}>
        <Box component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700, flex: 1 }}>
          Citizens {list && <span className="num" style={{ color: t.muted, fontWeight: 400, fontSize: 14 }}>{list.length}</span>}
        </Box>
        <IconButton onClick={onClose} aria-label="Close" sx={{ color: t.muted }}><CloseIcon /></IconButton>
      </Box>
      <Box sx={{ p: 2, px: 3 }}>
        <TextField fullWidth size="small" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by username" slotProps={{ htmlInput: { 'aria-label': 'Filter by username' } }} />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 2 }}>
        {error ? (
          <Box sx={{ px: 1.5 }}>
            <Muted>Could not load the list of citizens. The server did not answer.</Muted>
            <Button variant="outlined" size="small" onClick={load} sx={{ mt: 1.5 }}>Try again</Button>
          </Box>
        ) : !list ? <Muted sx={{ px: 1.5 }}>Loading everyone on the map.</Muted>
          : shown.length === 0 ? <Muted sx={{ px: 1.5 }}>{filter ? `No username contains "${filter}".` : 'Nobody is on the map yet. Sign in to be the first island.'}</Muted>
          : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {shown.map(c => (
                <li key={c.login}>
                  <ButtonBase onClick={() => onOpen({ type: 'user', login: c.login, avatar: c.avatar, x: c.x, y: c.y, repoCount: c.repoCount, totalStars: c.totalStars })}
                    sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 1.5, py: 1, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: 'rgba(255,255,255,.04)' } }}>
                    <Avatar variant="rounded" src={avatarUrl(c.avatar, c.login)} alt="" sx={{ width: 32, height: 32, borderRadius: '7px' }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ fontSize: 14, fontWeight: 500 }}>{c.login}</Box>
                      <Box className="num" sx={{ fontSize: 12, color: t.muted }}>
                        {plural(c.repoCount || 0, 'repo', 'repos')}  {plural(c.totalStars || 0, 'star', 'stars')}{c.primaryLanguage ? `  ${c.primaryLanguage}` : ''}
                      </Box>
                    </Box>
                  </ButtonBase>
                </li>
              ))}
            </Box>
          )}
      </Box>
    </SideDrawer>
  );
}

const SHORTCUTS = [
  [['W', 'A', 'S', 'D'], 'Fly (arrow keys work too)'],
  [['Shift'], 'Boost while flying'],
  [['Space'], 'Ship controls (or click the ship)'],
  [['/'], 'Search, or just start typing a name'],
  [['M'], 'Map'],
  [['R'], 'Review a repo'],
  [['P'], 'Screenshot'],
  [['F'], 'Frame rate counter'],
  [['H'], 'Show or hide this list'],
  [['Esc'], 'Close panels'],
];
export function Shortcuts({ open, onClose }) {
  return (
    <Panel open={open} onClose={onClose} title="Keyboard shortcuts" maxWidth={440}>
      <DialogContent sx={{ px: 3, py: 2 }}>
        <Box component="dl" sx={{ m: 0 }}>
          {SHORTCUTS.map(([keys, what]) => (
            <Box key={what} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, '& + div': { borderTop: `1px solid ${t.line}` } }}>
              <Box component="dt" sx={{ display: 'flex', gap: 0.5, order: 2 }}>
                {keys.map(k => <Box key={k} component="kbd" className="num" sx={{ fontSize: 12, minWidth: 24, textAlign: 'center', px: 0.75, lineHeight: '22px', border: `1px solid ${t.lineStrong}`, borderRadius: '5px', color: t.text }}>{k}</Box>)}
              </Box>
              <Box component="dd" sx={{ m: 0, flex: 1, fontSize: 14 }}>{what}</Box>
            </Box>
          ))}
        </Box>
        <Muted sx={{ mt: 2 }}>Scroll to zoom. Click a building to open the repo, click an island to open the developer.</Muted>
      </DialogContent>
    </Panel>
  );
}

export function GuestGate({ open, onClose, peek }) {
  return (
    <Panel open={open} onClose={onClose} title="Sign in to open more islands" maxWidth={440}>
      <DialogContent sx={{ px: 3, py: 3 }}>
        <Muted>
          Without an account you can fly anywhere and open one developer{peek ? ` (you opened ${peek})` : ''}.
          Sign in with GitHub to open everyone else, and to get an island of your own.
        </Muted>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, pt: 0, gap: 1 }}>
        <Button onClick={onClose}>Keep flying</Button>
        <Button variant="contained" href="/auth/github">Sign in with GitHub</Button>
      </DialogActions>
    </Panel>
  );
}

export function ErrorDialog({ message }) {
  return (
    <Panel open={!!message} onClose={() => {}} title="Something went wrong" maxWidth={440}>
      <DialogContent sx={{ px: 3, py: 3 }}>
        <Box component="p" className="num" sx={{ m: 0, fontSize: 13, color: t.muted, overflowWrap: 'anywhere' }}>{message}</Box>
        <Muted sx={{ mt: 1.5 }}>Reloading the page usually fixes it.</Muted>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, pt: 0 }}>
        <Button variant="contained" onClick={() => window.location.reload()}>Reload</Button>
      </DialogActions>
    </Panel>
  );
}
