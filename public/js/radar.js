// GitSpace repo health check (Review a repo + repo modal tab)
// Ponytail principle: Zero external charting dependencies, clean vanilla DOM.

(function () {
  let activeAuditRepo = null;

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function getGradeClass(grade) {
    if (grade === 'A+' || grade === 'A') return 'grade-a';
    if (grade === 'B') return 'grade-b';
    if (grade === 'C') return 'grade-c';
    return 'grade-d';
  }

  const INSIGHT_LABEL = { strength: 'Good', warning: 'Watch', info: 'Note' };

  function errorHTML(err, action, dataAttrs) {
    const msg = String(err && err.message || '');
    const notFound = /not found|404/i.test(msg);
    const unavailable = /503|unavailable|rate|limit/i.test(msg);
    const cause = notFound ? 'GitHub could not find that repo. It may be private, renamed, or misspelled.'
      : unavailable ? 'GitHub is not answering right now, or we hit its rate limit.'
      : 'The check did not finish: ' + msg;
    const next = notFound ? 'Check the owner/repo name and try again.' : 'Wait a minute, then try again.';
    return `
      <wa-callout class="audit-error" variant="warning" role="alert">
        <strong>Could not check this repo.</strong>
        <p>${escapeHTML(cause)} ${escapeHTML(next)}</p>
        <wa-button size="s" appearance="outlined" variant="neutral" data-radar-action="${action}" ${dataAttrs}>Try again</wa-button>
      </wa-callout>`;
  }

  function renderAuditHTML(data) {
    const r = data.repo;
    const a = data.analysis;
    const m = a.metrics;
    const gradeClass = getGradeClass(a.grade);

    // Warnings first: they are what the reader acts on
    const ORDER = { warning: 0, info: 1, strength: 2 };
    const insights = (a.insights || []).map(i => ({ ...i, kind: INSIGHT_LABEL[i.type] ? i.type : 'info' }))
      .sort((x, y) => ORDER[x.kind] - ORDER[y.kind]);
    const insightsHTML = insights.map(i => `
        <li class="insight">
          <wa-tag size="s" class="insight-badge" data-tone="${i.kind}">${INSIGHT_LABEL[i.kind]}</wa-tag>
          <div>
            <div class="insight-label">${escapeHTML(i.label)}</div>
            ${i.detail ? `<p class="insight-desc">${escapeHTML(i.detail)}</p>` : ''}
          </div>
        </li>`).join('');

    const recs = a.recommendations || [];
    const recsHTML = recs.map((rec, n) => `
        <li><label class="rec-item"><input type="checkbox" id="rec-${n}"><span>${escapeHTML(rec)}</span></label></li>`).join('');
    const days = Number(m.daysSincePush);
    const updated = !Number.isFinite(days) ? 'Unknown' : days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days + ' days ago';
    const num = v => (Number(v) || 0).toLocaleString();
    const rows = [
      ['Stars', num(m.stars)], ['Forks', num(m.forks)], ['Language', m.primaryLanguage || 'Unknown'],
      ['Size', m.sizeFormatted || '0 KB'], ['Files', m.fileCount != null ? num(m.fileCount) : null],
      ['Last push', updated], ['License', m.license || 'None'], ['Open issues', num(m.openIssues)]
    ].filter(([, v]) => v != null);
    const statusLine = [m.activityStatus, m.isArchived ? 'Archived' : null].filter(Boolean).join(', ');

    return `
      <div class="audit">
        <div class="audit-score">
          <div class="audit-grade ${gradeClass}" aria-label="Grade ${escapeHTML(a.grade)}">${escapeHTML(a.grade)}</div>
          <div class="audit-score-text">
            <div class="audit-title">${escapeHTML(r.fullName)}</div>
            <div class="muted">${a.score} of 100${statusLine ? '. ' + escapeHTML(statusLine) : ''}</div>
            <div class="progress audit-meter" role="progressbar" aria-label="Health score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.score}"><div style="width:${Math.max(0, Math.min(100, a.score))}%"></div></div>
          </div>
        </div>
        ${a.verdict ? `<p class="audit-verdict">${escapeHTML(a.verdict)}</p>` : ''}

        ${insights.length ? `<h3 class="audit-section-title">What we found</h3>
        <ul class="insight-list">${insightsHTML}</ul>` : ''}

        ${recs.length ? `<h3 class="audit-section-title">What to do next</h3>
        <ul class="audit-recs-list">${recsHTML}</ul>` : ''}

        <h3 class="audit-section-title">Repo facts</h3>
        <dl class="kv-list">
          ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHTML(String(v))}</dd></div>`).join('')}
        </dl>

        <div class="modal-buttons">
          <wa-button variant="brand" data-radar-action="open" data-url="${escapeHTML(r.htmlUrl)}">Open on GitHub</wa-button>
          <wa-button appearance="outlined" variant="neutral" data-radar-action="warp" data-name="${escapeHTML(r.name)}" data-owner="${escapeHTML(r.owner)}">Find on map</wa-button>
          <wa-button appearance="outlined" variant="neutral" data-radar-action="copy" data-name="${escapeHTML(r.fullName)}" data-score="${escapeHTML(a.score)}" data-grade="${escapeHTML(a.grade)}">Copy report</wa-button>
        </div>
      </div>
    `;
  }

  async function fetchRepoReview(query) {
    const clean = query.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const res = await fetch('/api/review?repo=' + encodeURIComponent(clean));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to analyze repository (Status: ' + res.status + ')');
    }
    return await res.json();
  }

  // Tabs are a Web Awesome <wa-tab-group>; setting `active` switches panel and ARIA state together.
  function setRepoTab(audit) {
    const group = document.getElementById('rm-tabs');
    if (group) group.setAttribute('active', audit ? 'health' : 'overview');
  }
  window.setRepoTab = setRepoTab;

  window.openRepoRadar = function (prefillQuery = '') {
    const modal = document.getElementById('radar-modal');
    if (!modal) return;

    // Close others
    ['repo-modal', 'profile-modal', 'citizens-sidebar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    if (window.closeShipUI) window.closeShipUI();

    modal.classList.remove('hidden');
    const input = document.getElementById('radar-input');
    if (input) {
      if (prefillQuery) input.value = prefillQuery;
      input.focus();
    }

    if (prefillQuery) {
      window.executeRadarAudit(prefillQuery);
    }
  };

  window.closeRepoRadar = function () {
    const modal = document.getElementById('radar-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.executeRadarAudit = async function (repoQuery) {
    if (!repoQuery || !repoQuery.trim()) return;
    const loader = document.getElementById('radar-audit-loading');
    const resultBox = document.getElementById('radar-audit-result');

    if (loader) loader.classList.remove('hidden');
    if (resultBox) resultBox.innerHTML = '';

    try {
      const data = await fetchRepoReview(repoQuery);
      if (loader) loader.classList.add('hidden');
      if (resultBox) {
        resultBox.innerHTML = renderAuditHTML(data);
      }
      activeAuditRepo = data.repo;
    } catch (err) {
      if (loader) loader.classList.add('hidden');
      if (resultBox) {
        resultBox.innerHTML = errorHTML(err, 'retry', 'data-query="' + escapeHTML(repoQuery) + '"');
      }
    }
  };

  window.runModalRepoAudit = async function (repoName, repoOwner) {
    const container = document.getElementById('rm-audit-content');
    const loader = document.getElementById('rm-audit-loading');
    setRepoTab(true);

    if (loader) loader.classList.remove('hidden');
    if (container) container.innerHTML = '';

    const query = repoOwner ? `${repoOwner}/${repoName}` : repoName;

    try {
      const data = await fetchRepoReview(query);
      if (loader) loader.classList.add('hidden');
      if (container) {
        container.innerHTML = renderAuditHTML(data);
      }
    } catch (err) {
      if (loader) loader.classList.add('hidden');
      if (container) {
        container.innerHTML = errorHTML(err, 'retry-modal', 'data-name="' + escapeHTML(repoName) + '" data-owner="' + escapeHTML(repoOwner || '') + '"');
      }
    }
  };

  window.warpToRepoIsland = function (repoName, repoOwner) {
    // Hide modals
    ['radar-modal', 'repo-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    if (window.flyTo && repoName) {
      fetch('/api/search?q=' + encodeURIComponent(repoName))
        .then(r => {
          if (!r.ok) throw new Error('Search failed (Status: ' + r.status + ')');
          return r.json();
        })
        .then(matches => {
          const lc = s => String(s || '').toLowerCase();
          const match = Array.isArray(matches) && matches.find(m => m.type === 'repo' && lc(m.name) === lc(repoName) &&
            (!repoOwner || lc(m.login) === lc(repoOwner)));
          if (match && typeof match.x === 'number') {
            window.flyTo(match.x, match.y, null);
            if (window.showToast) window.showToast('Flying to ' + repoName);
          } else {
            if (window.showToast) window.showToast(repoName + ' is not on the map yet');
          }
        })
        .catch(() => {
          if (window.showToast) window.showToast('Could not search the map. Try again.');
        });
    }
  };

  window.copyAuditReport = function (repoName, score, grade) {
    const text = `GitSpace health check for ${repoName}: grade ${grade}, ${score}/100.`;
    navigator.clipboard?.writeText(text).then(() => {
      if (window.showToast) window.showToast('Report copied');
    }).catch(() => {
      if (window.showToast) window.showToast('Copy failed');
    });
  };

  // Wire up DOM listeners
  document.addEventListener('DOMContentLoaded', () => {
    // Close button for radar modal
    const btnCloseRadar = document.getElementById('btn-close-radar-modal');
    if (btnCloseRadar) btnCloseRadar.addEventListener('click', window.closeRepoRadar);

    // Radar submit button
    const btnRadarAudit = document.getElementById('btn-radar-audit');
    const radarInput = document.getElementById('radar-input');
    if (btnRadarAudit && radarInput) {
      btnRadarAudit.addEventListener('click', () => {
        window.executeRadarAudit(radarInput.value);
      });
      radarInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          window.executeRadarAudit(radarInput.value);
        }
      });
    }

    // Audit action buttons (delegated; values come from data-* so no inline JS)
    document.addEventListener('click', e => {
      const act = e.target.closest('[data-radar-action]');
      if (act) {
        const d = act.dataset;
        if (d.radarAction === 'open' && /^https:\/\/github\.com\//.test(d.url || '')) window.open(d.url, '_blank', 'noopener');
        else if (d.radarAction === 'warp') window.warpToRepoIsland(d.name, d.owner);
        else if (d.radarAction === 'copy') window.copyAuditReport(d.name, d.score, d.grade);
        else if (d.radarAction === 'retry') window.executeRadarAudit(d.query);
        else if (d.radarAction === 'retry-modal') window.runModalRepoAudit(d.name, d.owner);
      }
    });

    // The tab group switches panels itself; start the check the first time Health check is shown for a repo.
    const tabGroup = document.getElementById('rm-tabs');
    if (tabGroup) {
      tabGroup.addEventListener('wa-tab-show', e => {
        if (e.detail?.name !== 'health') return;
        const content = document.getElementById('rm-audit-content');
        const loading = !document.getElementById('rm-audit-loading')?.classList.contains('hidden');
        if (!content || content.innerHTML.trim() || loading) return;
        window.runModalRepoAudit(document.getElementById('rm-name')?.textContent || '', window.currentModalRepoOwner || '');
      });
    }

    // "Run health check" button inside overview panel
    const btnRunAuditFromOverview = document.getElementById('rm-btn-run-audit');
    if (btnRunAuditFromOverview) {
      btnRunAuditFromOverview.addEventListener('click', () => {
        const repoName = document.getElementById('rm-name')?.textContent || '';
        const repoOwner = window.currentModalRepoOwner || '';
        window.runModalRepoAudit(repoName, repoOwner);
      });
    }
  });

  // Global keydown: 'R' key triggers Repo Radar
  document.addEventListener('keydown', e => {
    // Only if not focused in an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'r' || e.key === 'R') {
      const modal = document.getElementById('radar-modal');
      if (modal && !modal.classList.contains('hidden')) {
        window.closeRepoRadar();
      } else {
        window.openRepoRadar();
      }
    }
  });
})();
