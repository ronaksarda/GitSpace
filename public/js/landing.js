// Front page for signed-out visitors: a scrolling page over the dusk sky.
// Hero, then a timeline of what happens once you sign in, then what's coming next.
// The timeline's line fills as you scroll, so it doubles as the page's scroll indicator.
// API: window.showLanding(), window.hideLanding()
(function () {
  'use strict';

  var root = null, line = null, steps = [], nav = null;

  var TIMELINE = [
    { when: 'Second one', title: 'Sign in with GitHub', body: 'We read your public projects. Nothing private, and we never post anything for you.' },
    { when: 'A few seconds later', title: 'Your island is built', body: 'Every project becomes a building. The more people save a project, the taller it stands.' },
    { when: 'Right away', title: 'Fly around', body: 'Search any developer and fly to their island. Open a building to see the project and a quick health check.' },
    { when: 'Whenever you like', title: 'Share it', body: 'Download a postcard of your island for LinkedIn, your README, or anywhere else.' },
    { when: 'Over time', title: 'Your island grows', body: 'Ship something new and refresh. New buildings appear, and the ones people love keep climbing.' },
    { when: 'Coming next', title: 'Your first open-source PR', body: 'Beginner-friendly issues in languages you already use, with a plain explanation of where to start.', soon: true },
    { when: 'Coming next', title: 'People like you', body: 'Find developers from your college, your city, or who build with the same tools.', soon: true }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function actions(extra) {
    var row = el('div', 'gsl-actions' + (extra ? ' ' + extra : ''));
    var sign = el('a', 'gsl-btn gsl-btn-primary', 'Sign in with GitHub');
    sign.href = '/auth/github';
    sign.addEventListener('click', function (e) {
      if (window.currentUserLogin) { e.preventDefault(); window.hideLanding(); }
    });
    var explore = el('button', 'gsl-btn gsl-btn-quiet', 'Look around first');
    explore.type = 'button';
    explore.addEventListener('click', function () {
      window.hideLanding();
      if (!window.currentUserLogin && window.startGuestExplore) window.startGuestExplore();
    });
    row.appendChild(sign);
    row.appendChild(explore);
    return row;
  }

  function build() {
    root = el('div', 'gsl');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'About GitSpace');
    root.tabIndex = -1;

    nav = el('header', 'gsl-nav');
    nav.appendChild(el('div', 'gsl-logo', 'GitSpace'));
    var navSign = el('a', 'gsl-nav-link', 'Sign in');
    navSign.href = '/auth/github';
    nav.appendChild(navSign);
    root.appendChild(nav);

    var hero = el('section', 'gsl-hero');
    hero.appendChild(el('h1', 'gsl-h1', 'Your GitHub, built into a little world.'));
    hero.appendChild(el('p', 'gsl-lead', 'Every project you make becomes a building on your own floating island. Fly around, drop in on other developers, and share a picture of yours.'));
    hero.appendChild(actions());
    var proof = el('p', 'gsl-proof');
    proof.hidden = true;
    hero.appendChild(proof);
    hero.appendChild(el('p', 'gsl-scroll-hint', 'What happens when you sign in'));
    root.appendChild(hero);

    var tl = el('section', 'gsl-tl');
    tl.setAttribute('aria-label', 'What happens over time');
    var rail = el('div', 'gsl-tl-rail');
    line = el('div', 'gsl-tl-fill');
    rail.appendChild(line);
    tl.appendChild(rail);
    var list = el('ol', 'gsl-tl-list');
    TIMELINE.forEach(function (s) {
      var li = el('li', 'gsl-tl-step' + (s.soon ? ' is-soon' : ''));
      li.appendChild(el('span', 'gsl-tl-dot'));
      li.appendChild(el('p', 'gsl-tl-when', s.when));
      li.appendChild(el('h3', 'gsl-tl-title', s.title));
      li.appendChild(el('p', 'gsl-tl-body', s.body));
      list.appendChild(li);
      steps.push(li);
    });
    tl.appendChild(list);
    root.appendChild(tl);

    var end = el('section', 'gsl-end');
    end.appendChild(el('h2', 'gsl-end-title', 'Make yours.'));
    end.appendChild(el('p', 'gsl-lead', 'It takes one click and a few seconds.'));
    end.appendChild(actions('gsl-center-row'));
    root.appendChild(end);

    var foot = el('footer', 'gsl-foot');
    var priv = el('a', null, 'What we read from GitHub');
    priv.href = '/privacy.html';
    var src = el('a', null, 'Source on GitHub');
    src.href = 'https://github.com/ronaksarda/GitSpace';
    src.target = '_blank';
    src.rel = 'noopener';
    foot.appendChild(priv);
    foot.appendChild(src);
    root.appendChild(foot);

    document.body.appendChild(root);
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    fetch('/api/stats', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.totalUsers) return;
        proof.textContent = s.totalUsers.toLocaleString('en-US') + ' developers and ' + (s.totalRepos || 0).toLocaleString('en-US') + ' projects on the map so far.';
        proof.hidden = false;
      })
      .catch(function () {});
  }

  // Fill the timeline line up to the middle of the screen and light each step as the line reaches it.
  function onScroll() {
    if (!root || root.hidden) return;
    nav.classList.toggle('is-solid', root.scrollTop > 24);
    var rail = line.parentNode.getBoundingClientRect();
    var mid = window.innerHeight * 0.55;
    var filled = Math.max(0, Math.min(rail.height, mid - rail.top));
    line.style.transform = 'scaleY(' + (rail.height ? filled / rail.height : 0) + ')';
    steps.forEach(function (s) {
      var dot = s.querySelector('.gsl-tl-dot').getBoundingClientRect();
      s.classList.toggle('is-on', dot.top + dot.height / 2 <= mid);
    });
  }

  function holdKeys(e) {
    // The world behind must not react while the page is open. Page keys still scroll and activate.
    if (!root || root.hidden) return;
    var pageKeys = ['Tab', 'Enter', ' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'];
    if (pageKeys.indexOf(e.key) === -1) e.stopImmediatePropagation();
    else e.stopPropagation();
  }

  window.showLanding = function () {
    if (window.stopAttractMode) window.stopAttractMode();
    if (!root) build();
    root.hidden = false;
    var signedIn = !!window.currentUserLogin;
    root.querySelectorAll('.gsl-btn-primary').forEach(function (b) { b.textContent = signedIn ? 'Back to the map' : 'Sign in with GitHub'; });
    root.querySelectorAll('.gsl-btn-quiet').forEach(function (b) { b.hidden = signedIn; });
    nav.querySelector('.gsl-nav-link').hidden = signedIn;
    root.scrollTop = 0;
    onScroll();
    window.addEventListener('keydown', holdKeys, true);
    window.addEventListener('keyup', holdKeys, true);
    root.focus({ preventScroll: true });
  };

  window.hideLanding = function () {
    if (!root || root.hidden) return;
    root.hidden = true;
    window.removeEventListener('keydown', holdKeys, true);
    window.removeEventListener('keyup', holdKeys, true);
  };
})();
