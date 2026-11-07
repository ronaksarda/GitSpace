// Developer card: opens when you click an island (or pick a developer anywhere).
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Box, Button, ButtonBase, Collapse, DialogActions, DialogContent, Skeleton } from '@mui/material';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { t } from '../theme.js';
import { Count } from '../motion.js';
import { avatarUrl, getJSON, islandLanguages, safeHttpUrl, toast, topRepos } from '../lib.js';
import { downloadPostcard } from '../postcard.js';
import { Fact, FactGrid, LangDot, Muted, Panel, Section } from './common.jsx';

const profiles = new Map();

function renderReadme(md, login) {
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true }), { USE_PROFILES: { html: true } });
  holder.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  holder.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    // Relative image paths in a profile README live in the login/login repo
    if (src && !/^(https?:|data:)/i.test(src)) {
      img.setAttribute('src', `https://raw.githubusercontent.com/${encodeURIComponent(login)}/${encodeURIComponent(login)}/HEAD/${src.replace(/^\.?\//, '')}`);
    }
    img.loading = 'lazy';
    img.alt = img.alt || '';
  });
  return holder.innerHTML;
}

function failText(err) {
  if (err.status === 503) return 'GitHub is limiting how often we can ask for profiles. Try again in a few minutes.';
  if (err.status === 404) return 'GitHub does not know this account, so only the island is shown.';
  return 'Could not reach GitHub for the full profile. Open it on GitHub instead.';
}

const md = {
  fontSize: 14, lineHeight: 1.6, color: '#C9C9D1', overflowWrap: 'anywhere',
  '& h1, & h2, & h3': { color: t.text, fontSize: 16, fontWeight: 700, mt: 2.5, mb: 1 },
  '& p': { my: 1 },
  '& a': { color: t.text },
  '& img': { maxWidth: '100%', height: 'auto', verticalAlign: 'middle' },
  '& code': { fontFamily: t.mono, fontSize: 12.5, background: 'rgba(255,255,255,.06)', px: 0.5, borderRadius: '4px' },
  '& pre': { overflowX: 'auto', p: 1.5, background: t.bg, border: `1px solid ${t.line}`, borderRadius: '8px' },
  '& pre code': { background: 'none', p: 0 },
  '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto' },
  '& td, & th': { border: `1px solid ${t.line}`, px: 1, py: 0.5 },
  '& hr': { border: 0, borderTop: `1px solid ${t.line}` },
};

export default function DeveloperCard({ island, onClose, onOpenRepo }) {
  const open = !!island;
  const [kept, setKept] = useState(island); // keep content while the card animates out
  if (island && island !== kept) setKept(island);
  const isl = island || kept;
  const login = isl?.login;

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [readmeOpen, setReadmeOpen] = useState(false);

  useEffect(() => {
    if (!island) return;
    setReadmeOpen(false);
    setError(null);
    const cached = profiles.get(island.login);
    setProfile(cached || null);
    if (cached) return;
    let live = true;
    getJSON('/api/profile/' + encodeURIComponent(island.login))
      .then(p => { profiles.set(island.login, p); if (live) setProfile(p); })
      .catch(e => { if (live) setError(e); });
    return () => { live = false; };
  }, [island]);

  // Live picture of the island, drawn by the engine.
  const placeSnapshot = useCallback(node => {
    if (!node || !island) return;
    node.replaceChildren();
    const w = Math.min(592, window.innerWidth - 48);
    const snap = window.renderIslandSnapshot?.(island.login, w, 200, { fit: 1.9 });
    if (snap) { snap.style.display = 'block'; snap.style.width = '100%'; snap.style.height = '200px'; snap.style.objectFit = 'cover'; node.appendChild(snap); }
    node.hidden = !snap;
  }, [island]);

  if (!isl) return null;
  const buildings = isl.buildings || [];
  const langs = islandLanguages(buildings, 4);
  const repos = topRepos(buildings, 5);
  const joined = profile?.createdAt && new Date(profile.createdAt);
  const blog = safeHttpUrl(profile?.blog);

  const flyThere = () => { onClose(); window.flyTo(isl.cx, isl.cy, null); };
  const copyLink = async () => {
    const url = window.location.origin + '/?fly=' + encodeURIComponent(login);
    try { await navigator.clipboard.writeText(url); toast('Island link copied'); } catch (e) { toast('Could not copy. The link is ' + url); }
  };
  const postcard = async () => {
    try { await downloadPostcard(isl, profile); toast('Postcard saved'); } catch (e) {
      console.error('Postcard export failed:', e);
      toast('Could not make the postcard. An image on it did not load. Try again.');
    }
  };

  const header = (
    <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'center', minWidth: 0 }}>
      <Avatar variant="rounded" src={avatarUrl(profile?.avatar || isl.avatar, login, 120)} alt="" sx={{ width: 48, height: 48, borderRadius: '10px' }} />
      <Box sx={{ minWidth: 0 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 19, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile?.name || login}
        </Box>
        <Box component="a" className="num" href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer"
          sx={{ fontSize: 13, color: t.muted, textDecoration: 'none', '&:hover': { color: t.text } }}>@{login}</Box>
      </Box>
    </Box>
  );

  return (
    <Panel open={open} onClose={onClose} header={header} label={`${login}'s island`}>
      <DialogContent sx={{ px: 3, pt: '20px !important', pb: 3 }}>
        <Box ref={placeSnapshot} key={login} sx={{ borderRadius: '10px', overflow: 'hidden', border: `1px solid ${t.line}`, bgcolor: t.bg, mb: 2.5 }} />

        {!profile && !error && <><Skeleton width="90%" /><Skeleton width="60%" /></>}
        {error && <Muted>{failText(error)}</Muted>}
        {profile?.bio && <Box component="p" sx={{ m: 0, fontSize: 15, lineHeight: 1.55 }}>{profile.bio}</Box>}
        {profile && (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: profile.bio ? 1.25 : 0, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5, fontSize: 14, color: t.muted }}>
            {profile.location && <li>{profile.location}</li>}
            {joined && !isNaN(joined) && <li>Joined {joined.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</li>}
            {blog && <li><Box component="a" href={blog} target="_blank" rel="noopener noreferrer" sx={{ color: t.muted, '&:hover': { color: t.text } }}>{blog.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Box></li>}
          </Box>
        )}

        <Box sx={{ mt: 3 }}>
          <FactGrid min={88}>
            <Fact label="Repos"><Count value={isl.repoCount ?? buildings.length} /></Fact>
            <Fact label="Stars"><Count value={isl.totalStars || 0} /></Fact>
            {profile && <Fact label="Followers"><Count value={profile.followers || 0} /></Fact>}
          </FactGrid>
        </Box>

        {langs.length > 0 && (
          <Section title="Languages">
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 2.5, fontSize: 14 }}>
              {langs.map(l => (
                <Box component="li" key={l.lang} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LangDot lang={l.lang} />{l.lang}<span className="num" style={{ color: t.muted, fontSize: 12 }}>{l.pct}%</span>
                </Box>
              ))}
            </Box>
          </Section>
        )}

        <Section title="Top repos by stars">
          {repos.length === 0 ? <Muted>No public repos on this island yet.</Muted> : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, border: `1px solid ${t.line}`, borderRadius: '10px', overflow: 'hidden' }}>
              {repos.map(r => (
                <Box component="li" key={r.name} sx={{ '& + li': { borderTop: `1px solid ${t.line}` } }}>
                  <ButtonBase onClick={() => onOpenRepo({ ...r, type: 'repo', login })} sx={{
                    width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 2, py: 1.25, textAlign: 'left',
                    '&:hover': { bgcolor: 'rgba(255,255,255,.04)' },
                  }}>
                    <LangDot lang={r.language} />
                    <Box className="num" sx={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</Box>
                    <Box sx={{ fontSize: 12, color: t.muted }}><Count value={r.stars || 0} /> {r.stars === 1 ? 'star' : 'stars'}</Box>
                  </ButtonBase>
                </Box>
              ))}
            </Box>
          )}
        </Section>

        {profile && (
          <Section title="Profile README" aside={profile.readme && (
            <Button size="small" onClick={() => setReadmeOpen(v => !v)} aria-expanded={readmeOpen} sx={{ minHeight: 28, color: t.muted }}>
              {readmeOpen ? 'Hide' : 'Show'}
            </Button>
          )}>
            {profile.readme
              ? <Collapse in={readmeOpen} unmountOnExit>
                <Box sx={md} dangerouslySetInnerHTML={{ __html: renderReadme(profile.readme, login) }}
                  ref={n => n?.querySelectorAll('img').forEach(img => { img.onerror = () => img.remove(); })} />
              </Collapse>
              : <Muted>{login} has no profile README.</Muted>}
          </Section>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${t.line}`, flexWrap: 'wrap', gap: 1, justifyContent: 'flex-start', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
        <Button variant="contained" onClick={flyThere}>Fly there</Button>
        <Button variant="outlined" onClick={postcard}>Download postcard</Button>
        <Button variant="outlined" onClick={copyLink}>Copy link</Button>
        <Button href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer">Open on GitHub</Button>
      </DialogActions>
    </Panel>
  );
}
