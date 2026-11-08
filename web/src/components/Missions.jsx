// Open source: beginner issues picked for you, the ones you are on, and a dashboard of everything you got merged.
import { useEffect, useState } from 'react';
import { Box, Button, IconButton, Tab, Tabs } from '@mui/material';
import { t } from '../theme.js';
import { fmt, getJSON, plural, safeHttpUrl, timeAgo, toast } from '../lib.js';
import { CloseIcon, LangDot, Muted, SideDrawer } from './common.jsx';

const STATUS = {
  active: ['Working on it', t.warn],
  pr_open: ['PR open, waiting for review', t.warn],
  merged: ['Merged', t.good],
  expired: ['Expired after 45 days with no PR', t.faint],
  lost: ['Issue closed or given to someone else', t.faint],
};
const link = { color: t.text, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } };
const ext = url => ({ href: safeHttpUrl(url), target: '_blank', rel: 'noopener noreferrer' });

function Row({ title, url, sub, note, children }) {
  return (
    <Box component="li" sx={{ px: 1.5, py: 1.5, '& + li': { borderTop: `1px solid ${t.line}` } }}>
      <Box component="a" {...ext(url)} sx={{ ...link, fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>{title}</Box>
      <Box className="num" sx={{ mt: 0.5, fontSize: 12, color: t.muted, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>{sub}</Box>
      {note && <Muted sx={{ mt: 1, fontSize: 13 }}>{note}</Muted>}
      {children && <Box sx={{ mt: 1.25, display: 'flex', gap: 1 }}>{children}</Box>}
    </Box>
  );
}

const Tile = ({ label, value, hint }) => (
  <Box sx={{ p: 1.5, border: `1px solid ${t.line}`, borderRadius: '8px' }}>
    <Box className="num" sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value === null ? '–' : fmt(value)}</Box>
    <Box sx={{ mt: 0.5, fontSize: 12, color: t.muted }}>{label}</Box>
    {hint && <Box sx={{ fontSize: 11, color: t.faint }}>{hint}</Box>}
  </Box>
);

// Merged PRs per month, last 12 months. One series, so no legend; hover or focus a bar for its number.
function Months({ months }) {
  const max = Math.max(1, ...months.map(m => m.merged));
  const name = m => new Date(m.month + '-01T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return (
    <Box>
      <Box sx={{ fontSize: 13, fontWeight: 500, mb: 1 }}>Merged PRs per month</Box>
      <Box role="list" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 72, borderBottom: `1px solid ${t.line}` }}>
        {months.map(m => (
          <Box key={m.month} role="listitem" tabIndex={0} title={`${name(m)}: ${plural(m.merged, 'PR', 'PRs')}`} aria-label={`${name(m)}: ${plural(m.merged, 'PR', 'PRs')}`}
            sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default', '&:hover > div, &:focus > div': { opacity: 1 }, outline: 'none' }}>
            <Box sx={{ width: '100%', height: m.merged ? `${(m.merged / max) * 100}%` : '2px', minHeight: 2, bgcolor: m.merged ? t.accent : t.line, borderRadius: '4px 4px 0 0', opacity: 0.85 }} />
          </Box>
        ))}
      </Box>
      <Box className="num" sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, fontSize: 11, color: t.faint }}>
        <span>{name(months[0])}</span><span>{name(months[months.length - 1])}</span>
      </Box>
    </Box>
  );
}

function Dashboard({ data, finished }) {
  if (!data.merged && !finished.length) {
    return <Muted sx={{ p: 1.5 }}>Nothing merged into other people's projects yet. Your first merged PR shows up here, with the project, its commits and the date.</Muted>;
  }
  return (
    <Box sx={{ p: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
        <Tile label="PRs merged" value={data.merged} hint={data.viaGitSpace ? `${data.viaGitSpace} through GitSpace` : null} />
        <Tile label="Projects" value={data.projects} />
        <Tile label="Commits" value={data.commitsCounted ? data.commits : null} hint={data.merged > data.commitsCounted ? (data.commitsCounted ? `in your latest ${data.commitsCounted} PRs` : 'GitHub is busy; counted later') : null} />
        <Tile label="PRs open now" value={data.open} />
      </Box>
      {data.merged > 0 && <Box sx={{ mt: 3 }}><Months months={data.months} /></Box>}

      {data.repos.length > 0 && <Box sx={{ mt: 3, fontSize: 13, fontWeight: 500 }}>Where you contributed</Box>}
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {data.repos.map(r => (
          <Box component="li" key={r.repo} sx={{ py: 1.5, '& + li': { borderTop: `1px solid ${t.line}` } }}>
            <Box component="a" {...ext(`https://github.com/${r.repo}`)} sx={{ ...link, fontSize: 14, fontWeight: 600 }}>{r.repo}</Box>
            <Box className="num" sx={{ fontSize: 12, color: t.muted, mt: 0.25 }}>
              {plural(r.prs.length, 'PR', 'PRs')}{r.commits ? ` · ${plural(r.commits, 'commit', 'commits')}` : ''} · last merged {timeAgo(r.prs[0].merged_at).toLowerCase()}
            </Box>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.75, p: 0 }}>
              {r.prs.slice(0, 5).map(p => (
                <Box component="li" key={p.url} sx={{ fontSize: 13, py: 0.25, display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
                  <Box component="a" {...ext(p.url)} sx={{ ...link, color: t.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{p.number} {p.title}</Box>
                  {p.via_gitspace && <Box component="span" sx={{ flex: 'none', fontSize: 11, color: t.good }}>via GitSpace</Box>}
                </Box>
              ))}
              {r.prs.length > 5 && <Box component="li" sx={{ fontSize: 12, color: t.faint }}>and {r.prs.length - 5} more</Box>}
            </Box>
          </Box>
        ))}
      </Box>

      {finished.length > 0 && <>
        <Box sx={{ mt: 3, fontSize: 13, fontWeight: 500 }}>Missions that ended</Box>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {finished.map(m => (
            <Row key={m.id} title={m.title} url={m.url} sub={<>{m.repo} · <Box component="span" sx={{ color: STATUS[m.status][1] }}>{STATUS[m.status][0]}</Box></>} />
          ))}
        </Box>
      </>}
    </Box>
  );
}

export default function Missions({ open, onClose, onMerged }) {
  const [tab, setTab] = useState(null); // null: pick the default once we know if they have merged work
  const [forYou, setForYou] = useState(null);
  const [mine, setMine] = useState(null);
  const [dash, setDash] = useState(null); // data, or { error }
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(false);
    Promise.all([getJSON('/api/missions/for-you'), getJSON('/api/missions/mine')])
      .then(([f, m]) => { setForYou(f); setMine(m); })
      .catch(() => setError(true));
  };
  const loadDash = () => {
    setDash(null);
    getJSON('/api/missions/contributions')
      .then(d => { setDash(d); onMerged?.(d.merged); })
      .catch(e => setDash({ error: e.message }));
  };
  useEffect(() => { if (open) { load(); loadDash(); } }, [open]);

  const act = (path, okMsg, thenTab) => {
    setBusy(true);
    getJSON(path, { method: 'POST' })
      .then(() => { toast(okMsg); if (thenTab) setTab(thenTab); })
      .catch(e => toast(e.message))
      .finally(() => { setBusy(false); load(); });
  };

  // Once something of theirs is merged anywhere in open source, their contributions come first.
  const hasWork = dash?.merged > 0;
  const live = (mine || []).filter(m => m.status === 'active' || m.status === 'pr_open');
  const finished = (mine || []).filter(m => m.status === 'expired' || m.status === 'lost');
  const tabs = [...(hasWork ? [['work', 'Your contributions']] : []), ['foryou', 'For you'], ['live', `In progress${live.length ? ` (${live.length})` : ''}`]];
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];

  const issueRow = i => (
    <Row key={i.id} title={i.title} url={i.url}
      sub={<><LangDot lang={i.language} /> {i.repo} · {timeAgo(i.created_at).toLowerCase()} · {plural(i.comments, 'comment', 'comments')}{i.gs_count ? ' · 1 person from GitSpace is on this' : ''}</>}>
      <Button size="small" variant="contained" disabled={busy || live.length >= 2}
        onClick={() => act(`/api/missions/${i.id}/start`, 'Mission started. Comment on the issue that you are working on it.', 'live')}>I'm on it</Button>
      <Button size="small" variant="outlined" {...ext(i.url)}>Open on GitHub</Button>
    </Row>
  );
  const heading = text => <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5, fontSize: 13, fontWeight: 500 }}>{text}</Box>;

  let body;
  if (current === 'work') {
    body = dash.error ? (
      <Box sx={{ p: 1.5 }}><Muted>{dash.error}</Muted><Button variant="outlined" size="small" onClick={loadDash} sx={{ mt: 1.5 }}>Try again</Button></Box>
    ) : <Dashboard data={dash} finished={finished} />;
  } else if (error) {
    body = <Box sx={{ p: 1.5 }}><Muted>Could not load missions. The server did not answer.</Muted><Button variant="outlined" size="small" onClick={load} sx={{ mt: 1.5 }}>Try again</Button></Box>;
  } else if (!forYou || !mine) {
    body = <Muted sx={{ p: 1.5 }}>Loading missions.</Muted>;
  } else if (current === 'foryou') {
    body = <>
      <Muted sx={{ px: 1.5, pt: 1, fontSize: 13 }}>
        Take one, comment on the issue that you are on it, then open a PR that says "Fixes #" and the issue number. We count it once it is merged.
        {live.length >= 2 && ' You have 2 missions going: finish or drop one to take another.'}
      </Muted>
      {forYou.fromProjects.length > 0 && <>
        {heading('From projects that merged your work')}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>{forYou.fromProjects.map(issueRow)}</Box>
      </>}
      {heading(`Beginner issues in ${forYou.languages.join(', ')}`)}
      {forYou.issues.length
        ? <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>{forYou.issues.map(issueRow)}</Box>
        : <Muted sx={{ p: 1.5 }}>None open right now. The list refreshes every 6 hours.</Muted>}
    </>;
  } else {
    body = !live.length ? <Muted sx={{ p: 1.5 }}>Nothing in progress. Pick one from For you.</Muted> : (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {live.map(m => (
          <Row key={m.id} title={m.title} url={m.pr_url || m.url}
            sub={<><LangDot lang={m.language} /> {m.repo} · <Box component="span" sx={{ color: STATUS[m.status][1] }}>{STATUS[m.status][0]}</Box></>}
            note={m.status === 'active' ? `In your PR description write: Fixes #${m.number}` : null}>
            <Button size="small" variant="outlined" {...ext(m.pr_url || m.url)}>{m.pr_url ? 'Open PR' : 'Open issue'}</Button>
            <Button size="small" disabled={busy} sx={{ color: t.muted }} onClick={() => act(`/api/missions/${m.id}/drop`, 'Mission dropped')}>Drop</Button>
          </Row>
        ))}
      </Box>
    );
  }

  return (
    <SideDrawer open={open} onClose={onClose} width={440}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2, pl: 3, pr: 1.5 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700, flex: 1 }}>{hasWork ? 'Open source' : 'Your first open-source PR'}</Box>
        <IconButton onClick={onClose} aria-label="Close" sx={{ color: t.muted }}><CloseIcon /></IconButton>
      </Box>
      <Tabs value={current} onChange={(e, v) => setTab(v)} variant="fullWidth" sx={{ px: 1.5, borderBottom: `1px solid ${t.line}`, '& .MuiTabs-indicator': { bgcolor: t.accent } }}>
        {tabs.map(([k, label]) => <Tab key={k} value={k} label={label} sx={{ textTransform: 'none' }} />)}
      </Tabs>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1 }}>{body}</Box>
    </SideDrawer>
  );
}
