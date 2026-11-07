// Search developers and repos on the map; picking one flies there (and opens it on arrival).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Autocomplete, Avatar, Box, InputAdornment, TextField, useMediaQuery } from '@mui/material';
import { t } from '../theme.js';
import { avatarUrl, getJSON, world } from '../lib.js';

function distance(m) {
  const p = world()?.player;
  if (!p) return '';
  const d = Math.hypot((m.x || 0) - p.x, (m.y || 0) - p.y);
  return d < 40 ? 'Here' : d < 1000 ? Math.round(d) + ' u' : (d / 1000).toFixed(1) + ' ku';
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

export default forwardRef(function SearchBox({ onPick }, ref) {
  const input = useRef(null);
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const narrow = useMediaQuery('(max-width:599px)');

  useImperativeHandle(ref, () => ({
    focus(seed = '') { setText(seed); setOpen(true); input.current?.focus(); },
  }));

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setOptions([]); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await getJSON('/api/search?q=' + encodeURIComponent(q));
        setOptions(Array.isArray(res) ? res.slice(0, 8) : []);
        setFailed(false);
      } catch (e) {
        setOptions([]);
        setFailed(true);
      }
      setLoading(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [text]);

  const q = text.trim();
  const noOptionsText = q.length < 2 ? 'Type at least two letters of a username or repo.'
    : failed ? 'Search is not answering. Try again in a moment.'
    : `Nothing on the map matches "${q}".`;

  return (
    <Autocomplete
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      loading={loading}
      loadingText="Searching the map"
      noOptionsText={noOptionsText}
      filterOptions={x => x}
      autoHighlight
      forcePopupIcon={false}
      disableClearable
      blurOnSelect
      clearOnBlur
      value={null}
      inputValue={text}
      onInputChange={(e, v, reason) => { if (reason !== 'reset') setText(v); }}
      onChange={(e, m) => { if (m) { setText(''); setOpen(false); onPick(m); } }}
      getOptionLabel={m => (m.type === 'user' ? m.login : `${m.login}/${m.name}`)}
      isOptionEqualToValue={(a, b) => a === b}
      getOptionKey={m => m.type + ':' + m.login + ':' + (m.name || '')}
      sx={{ width: '100%', maxWidth: 520 }}
      renderOption={({ key, ...props }, m) => (
        <Box component="li" key={key} {...props}>
          {m.type === 'user'
            ? <Avatar src={avatarUrl(m.avatar, m.login)} alt="" sx={{ width: 28, height: 28, borderRadius: '6px' }} variant="rounded" />
            : <Box aria-hidden sx={{ width: 28, height: 28, borderRadius: '6px', border: `1px solid ${t.line}`, display: 'grid', placeItems: 'center', color: t.muted }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 20V9l7-5 7 5v11z" /><path d="M10 20v-5h4v5" /></svg>
            </Box>}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box className={m.type === 'repo' ? 'num' : undefined} sx={{ fontSize: m.type === 'repo' ? 13 : 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.type === 'user' ? m.login : m.name}
            </Box>
            <Box sx={{ fontSize: 12, color: t.muted }}>{m.type === 'user' ? 'Developer' : `Repo by ${m.login}`}</Box>
          </Box>
          <Box className="num" sx={{ fontSize: 12, color: t.muted }}>{distance(m)}</Box>
        </Box>
      )}
      renderInput={params => (
        <TextField
          {...params}
          inputRef={input}
          placeholder={narrow ? 'Search' : 'Search developers and repos'}
          size="small"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Search developers and repos' },
            input: {
              ...params.slotProps.input,
              startAdornment: <InputAdornment position="start" sx={{ color: t.muted, ml: 0.5 }}><SearchIcon /></InputAdornment>,
              endAdornment: <Box component="kbd" className="num" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 11, color: t.muted, border: `1px solid ${t.line}`, borderRadius: '4px', px: 0.75, lineHeight: '18px', mr: 0.5 }}>/</Box>,
            },
          }}
          sx={{ '& .MuiOutlinedInput-root': { height: 36, py: 0, background: t.surface } }}
        />
      )}
    />
  );
});
