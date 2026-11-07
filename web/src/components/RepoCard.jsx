// Repo card: opens when you click a building. Overview, plus a health check that runs the first time its tab opens.
import { useEffect, useState } from 'react';
import { Box, Button, DialogContent, Tab, Tabs } from '@mui/material';
import { t } from '../theme.js';
import { Count } from '../motion.js';
import { formatSize, timeAgo } from '../lib.js';
import { Fact, FactGrid, LangDot, Muted, Panel } from './common.jsx';
import HealthReport, { useReview } from './HealthReport.jsx';

export default function RepoCard({ item, onClose, onOpenOwner, onFind }) {
  const open = !!item;
  const [kept, setKept] = useState(item);
  if (item && item !== kept) setKept(item);
  const repo = item || kept;
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState(null);
  const [review, retry] = useReview(query);

  useEffect(() => { if (item) { setTab(item.tab || 'overview'); setQuery(item.tab === 'health' ? `${item.login}/${item.name}` : null); } }, [item]);
  const showHealth = () => { setTab('health'); if (!query) setQuery(`${repo.login}/${repo.name}`); };

  if (!repo) return null;
  const header = (
    <Box sx={{ minWidth: 0 }}>
      <Box component="h2" className="num" sx={{ m: 0, fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.name}</Box>
      {repo.login && (
        <Box component="button" type="button" onClick={() => onOpenOwner(repo.login)} sx={{
          p: 0, border: 0, background: 'none', font: 'inherit', fontSize: 13, color: t.muted, cursor: 'pointer', '&:hover': { color: t.text },
        }}>by {repo.login}</Box>
      )}
    </Box>
  );

  return (
    <Panel open={open} onClose={onClose} header={header} label={`Repo ${repo.name}`}>
      <Box sx={{ px: 3, borderBottom: `1px solid ${t.line}` }}>
        <Tabs value={tab} onChange={(e, v) => (v === 'health' ? showHealth() : setTab(v))} aria-label="Repo sections">
          <Tab value="overview" label="Overview" id="repo-tab-overview" aria-controls="repo-panel" />
          <Tab value="health" label="Health check" id="repo-tab-health" aria-controls="repo-panel" />
        </Tabs>
      </Box>
      <DialogContent id="repo-panel" role="tabpanel" aria-labelledby={`repo-tab-${tab}`} sx={{ px: 3, py: 3, minHeight: 280 }}>
        {tab === 'overview' ? (
          <Box>
            {repo.description ? <Box component="p" sx={{ m: 0, fontSize: 15, lineHeight: 1.55 }}>{repo.description}</Box> : <Muted>No description on GitHub.</Muted>}
            <Box sx={{ mt: 3 }}>
              <FactGrid>
                <Fact label="Stars"><Count value={repo.stars || 0} /></Fact>
                <Fact label="Language"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}><LangDot lang={repo.language} />{repo.language || 'Unknown'}{repo.isFork ? ', fork' : ''}</Box></Fact>
                <Fact label="Size"><span className="num">{formatSize(repo.size)}</span></Fact>
                <Fact label="Updated">{repo.updatedAt ? timeAgo(repo.updatedAt) : 'Unknown'}</Fact>
              </FactGrid>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 4 }}>
              <Button variant="contained" onClick={showHealth}>Run health check</Button>
              {repo.url && <Button variant="outlined" href={repo.url} target="_blank" rel="noopener noreferrer">Open on GitHub</Button>}
            </Box>
          </Box>
        ) : <HealthReport state={review} onRetry={retry} onFind={onFind} />}
      </DialogContent>
    </Panel>
  );
}
