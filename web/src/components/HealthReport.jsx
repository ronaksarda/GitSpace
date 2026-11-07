// Repo health check: loads /api/review and shows grade, findings, next steps and facts.
import { useEffect, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, LinearProgress } from '@mui/material';
import { t } from '../theme.js';
import { Count } from '../motion.js';
import { getJSON, toast } from '../lib.js';
import { Fact, FactGrid, LangDot, Muted, Section } from './common.jsx';

const GROUPS = [
  { type: 'warning', title: 'To fix', tone: t.warn },
  { type: 'info', title: 'Worth a look', tone: t.muted },
  { type: 'strength', title: 'Working well', tone: t.good },
];

export function useReview(query) {
  const [state, setState] = useState({ status: 'idle' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!query) { setState({ status: 'idle' }); return; }
    let live = true;
    setState({ status: 'loading' });
    const clean = query.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    getJSON('/api/review?repo=' + encodeURIComponent(clean))
      .then(data => live && setState({ status: 'done', data }))
      .catch(error => live && setState({ status: 'error', error }));
    return () => { live = false; };
  }, [query, nonce]);
  return [state, () => setNonce(n => n + 1)];
}

function ErrorBox({ error, onRetry }) {
  const msg = String(error?.message || '');
  const notFound = error?.status === 404 || /not found/i.test(msg);
  const busy = error?.status === 503 || /rate|limit|unavailable/i.test(msg);
  return (
    <Box role="alert" sx={{ border: `1px solid ${t.line}`, borderRadius: '10px', p: 2 }}>
      <Box sx={{ fontWeight: 500, mb: 0.5 }}>Could not check this repo</Box>
      <Muted>
        {notFound ? 'GitHub could not find it. It may be private, renamed, or misspelled. Check the owner/name and try again.'
          : busy ? 'GitHub is not answering right now, or we hit its rate limit. Wait a minute, then try again.'
          : `The check did not finish (${msg}). Try again.`}
      </Muted>
      <Button variant="outlined" size="small" onClick={onRetry} sx={{ mt: 1.5 }}>Try again</Button>
    </Box>
  );
}

export default function HealthReport({ state, onRetry, onFind }) {
  const [done, setDone] = useState({});
  useEffect(() => setDone({}), [state.data]);

  if (state.status === 'idle') return null;
  if (state.status === 'loading') return (
    <Box role="status" sx={{ py: 2 }}>
      <Muted sx={{ mb: 1.5 }}>Reading the repo on GitHub. This takes a few seconds.</Muted>
      <LinearProgress sx={{ height: 2, borderRadius: 1, bgcolor: t.line, '& .MuiLinearProgress-bar': { bgcolor: t.text } }} />
    </Box>
  );
  if (state.status === 'error') return <ErrorBox error={state.error} onRetry={onRetry} />;

  const { repo: r, analysis: a } = state.data;
  const m = a.metrics || {};
  const insights = a.insights || [];
  const recs = a.recommendations || [];
  const days = Number(m.daysSincePush);
  const lastPush = !Number.isFinite(days) ? 'Unknown' : days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  const status = [m.activityStatus, m.isArchived ? 'Archived' : null].filter(Boolean).join(', ');
  const copy = () => navigator.clipboard?.writeText(`GitSpace health check for ${r.fullName}: grade ${a.grade}, ${a.score}/100.`)
    .then(() => toast('Report copied'), () => toast('Could not copy the report'));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
        <Box className="num" aria-label={`Grade ${a.grade}`} sx={{ fontSize: 48, fontWeight: 700, lineHeight: 1, minWidth: 64 }}>{a.grade}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, fontSize: 14 }}>
            <Box className="num" sx={{ fontSize: 18 }}><Count value={a.score} /></Box>
            <Box sx={{ color: t.muted }}>of 100{status ? `, ${status}` : ''}</Box>
          </Box>
          <Box role="progressbar" aria-label="Health score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.score}
            sx={{ mt: 1, height: 4, borderRadius: 2, bgcolor: t.line, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${Math.max(0, Math.min(100, a.score))}%`, bgcolor: t.text }} />
          </Box>
        </Box>
      </Box>
      {a.verdict && <Box component="p" sx={{ m: 0, mt: 2.5, fontSize: 15, lineHeight: 1.55 }}>{a.verdict}</Box>}

      {GROUPS.map(g => {
        const items = insights.filter(i => (GROUPS.some(x => x.type === i.type) ? i.type : 'info') === g.type);
        if (!items.length) return null;
        return (
          <Section key={g.type} title={<>{g.title} <span className="num" style={{ color: t.faint }}>{items.length}</span></>}>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
              {items.map((i, n) => (
                <Box component="li" key={n} sx={{ display: 'grid', gridTemplateColumns: '8px 1fr', gap: 1.5, alignItems: 'baseline' }}>
                  <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: g.tone, transform: 'translateY(-1px)' }} />
                  <Box>
                    <Box sx={{ fontWeight: 500, fontSize: 14 }}>{i.label}</Box>
                    {i.detail && <Muted sx={{ mt: 0.25 }}>{i.detail}</Muted>}
                  </Box>
                </Box>
              ))}
            </Box>
          </Section>
        );
      })}

      {recs.length > 0 && (
        <Section title="Next steps">
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {recs.map((rec, n) => (
              <li key={n}>
                <FormControlLabel
                  control={<Checkbox size="small" checked={!!done[n]} onChange={e => setDone(d => ({ ...d, [n]: e.target.checked }))} sx={{ py: 0.5 }} />}
                  label={rec}
                  sx={{ alignItems: 'flex-start', mr: 0, '& .MuiFormControlLabel-label': { fontSize: 14, pt: 0.6, lineHeight: 1.5, color: done[n] ? t.muted : t.text, textDecoration: done[n] ? 'line-through' : 'none' } }}
                />
              </li>
            ))}
          </Box>
        </Section>
      )}

      <Section title="Repo facts">
        <FactGrid>
          <Fact label="Stars"><Count value={m.stars} /></Fact>
          <Fact label="Forks"><Count value={m.forks} /></Fact>
          <Fact label="Open issues"><Count value={m.openIssues} /></Fact>
          {m.fileCount != null && <Fact label="Files"><Count value={m.fileCount} /></Fact>}
          <Fact label="Language"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}><LangDot lang={m.primaryLanguage} />{m.primaryLanguage || 'Unknown'}</Box></Fact>
          <Fact label="Size"><span className="num">{m.sizeFormatted || '0 KB'}</span></Fact>
          <Fact label="Last push">{lastPush}</Fact>
          <Fact label="License">{m.license || 'None'}</Fact>
        </FactGrid>
      </Section>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 3.5 }}>
        {/^https:\/\/github\.com\//.test(r.htmlUrl || '') && <Button variant="outlined" href={r.htmlUrl} target="_blank" rel="noopener noreferrer">Open on GitHub</Button>}
        {onFind && <Button variant="outlined" onClick={() => onFind(r)}>Find on map</Button>}
        <Button onClick={copy}>Copy report</Button>
      </Box>
    </Box>
  );
}
