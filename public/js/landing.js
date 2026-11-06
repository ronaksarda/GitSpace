// Front page for signed-out visitors: a six-step scroll story played on the live world behind it.
// Each step moves the real camera (autopilotTarget / targetCamera from engine.js). The overlay covers
// the canvas, so visitors scroll the story instead of steering; keys are held back while it's open.
// API: window.showLanding(), window.hideLanding()
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var STEPS = [
    { h: 'Your GitHub, as a little world.', p: 'Sign in and your projects become an island you can fly around.', cta: true },
    { h: 'Every project is a building.', p: 'The more people save a project, the taller it gets.' },
    { h: 'Find people like you.', p: 'Same college, same city, same languages.', soon: true },
    { h: 'Your first open-source PR.', p: 'We\'ll point you to beginner-friendly issues and show where to start.', soon: true },
    { h: 'Post your island.', p: 'Get a picture of your world to share anywhere.', postcard: true },
    { h: 'Make yours.', p: 'Sign in with GitHub and your island gets built from your projects.', cta: true, big: true }
  ];

  var root = null, fill = null, observer = null, active = -1;
  var hero = null, other = null; // { login, x, y } picked at random from real islands

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- picking islands, neutrally ----------
  function pickIslands() {
    return fetch('/api/citizens', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (list) {
        list = Array.isArray(list) ? list.filter(function (c) { return c && c.login && isFinite(c.x) && isFinite(c.y); }) : [];
        var good = list.filter(function (c) { return c.repoCount >= 15 && c.repoCount <= 60; });
        if (good.length < 2) good = list.filter(function (c) { return c.repoCount >= 3; });
        if (!good.length) good = list;
        var a = good.splice(Math.floor(Math.random() * good.length), 1)[0];
        var b = good.length ? good[Math.floor(Math.random() * good.length)] : null;
        hero = a ? { login: a.login, x: a.x, y: a.y } : null;
        other = b ? { login: b.login, x: b.x, y: b.y } : hero;
      });
  }
  function loaded(spot) {
    if (!spot || typeof islands === 'undefined') return null;
    for (var i = 0; i < islands.length; i++) if (islands[i].login === spot.login) return islands[i];
    return null;
  }

  // ---------- camera ----------
  function fly(x, y, zoom) {
    targetCamera.zoom = zoom;
    if (REDUCED) {
      // no flights: cut straight there
      autopilotTarget = null;
      player.x = x; player.y = y; player.vx = player.vy = 0;
      camera.x = targetCamera.x = x; camera.y = targetCamera.y = y;
      camera.zoom = zoom;
      return;
    }
    autopilotTarget = { x: x, y: y };
  }
  function hold(zoom) {
    autopilotTarget = null;
    targetCamera.zoom = zoom;
    if (REDUCED) camera.zoom = zoom;
  }

  function enter(i) {
    if (i === active) return;
    active = i;
    fill.style.transform = 'scaleY(' + ((i + 1) / STEPS.length) + ')';
    var isl;
    switch (i) {
      case 0: hold(0.45); break;
      case 1:
        if (!hero) { hold(0.9); break; }
        isl = loaded(hero);
        if (isl && isl.buildings && isl.buildings.length) {
          // close in on its tallest building
          var tall = isl.buildings.reduce(function (m, b) { return (b.height || 0) > (m.height || 0) || ((b.height || 0) === (m.height || 0) && (b.stars || 0) > (m.stars || 0)) ? b : m; });
          fly(tall.x, tall.y + 30, 1.3);
          if (window.startArrival && Math.hypot(player.x - tall.x, player.y - tall.y) < 1200) window.startArrival(isl);
        } else {
          fly(hero.x, hero.y, 1.0); // engine plays the arrival beat itself after a long flight
        }
        break;
      case 2: hold(0.12); break;
      case 3: if (other) fly(other.x, other.y, 0.6); else hold(0.6); break;
      case 4: if (hero) fly(hero.x, hero.y, 0.8); else hold(0.8); drawPostcard(); break;
      case 5: hold(0.35); break;
    }
  }

  function drawPostcard(tries) {
    var card = root && root.querySelector('.gsl-postcard');
    if (!card) return;
    var isl = loaded(hero);
    var snap = isl && typeof window.renderIslandSnapshot === 'function'
      ? window.renderIslandSnapshot(hero.login, 300, 188) : null;
    var pic = card.querySelector('.gsl-pc-pic');
    if (!snap) {
      // the island streams in as the camera gets close; try again shortly
      if ((tries || 0) < 8 && active === 4) setTimeout(function () { drawPostcard((tries || 0) + 1); }, 700);
      return;
    }
    pic.textContent = '';
    pic.appendChild(snap);
    card.querySelector('.gsl-pc-name').textContent = isl.login;
    card.querySelector('.gsl-pc-line').textContent =
      isl.repoCount + (isl.repoCount === 1 ? ' project, ' : ' projects, ') +
      (isl.totalStars || 0).toLocaleString('en-US') + ((isl.totalStars || 0) === 1 ? ' star' : ' stars');
    card.hidden = false;
  }

  // ---------- DOM ----------
  function actions(big) {
    var row = el('div', 'gsl-actions' + (big ? ' gsl-actions-big' : ''));
    var sign = el('a', 'gsl-btn gsl-btn-primary', 'Sign in with GitHub');
    sign.href = '/auth/github';
    var explore = el('button', 'gsl-btn gsl-btn-quiet', 'Explore first');
    explore.type = 'button';
    explore.addEventListener('click', function () {
      window.hideLanding();
      if (window.startGuestExplore) window.startGuestExplore();
    });
    row.appendChild(sign);
    row.appendChild(explore);
    return row;
  }

  function build() {
    root = el('div', 'gsl');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'What GitSpace is');
    root.tabIndex = -1;

    STEPS.forEach(function (s, i) {
      var sec = el('section', 'gsl-step' + (s.postcard ? ' gsl-step-postcard' : ''));
      sec.dataset.i = i;
      var card = el('div', 'gsl-card' + (i === 0 ? ' gsl-drop' : '') + (s.big ? ' gsl-card-big' : ''));
      card.appendChild(el(i === 0 ? 'h1' : 'h2', 'gsl-h', s.h));
      card.appendChild(el('p', 'gsl-p', s.p));
      if (s.soon) card.appendChild(el('p', 'gsl-soon', 'Coming soon'));
      if (s.cta) card.appendChild(actions(s.big));
      if (i === 0) {
        var cue = el('p', 'gsl-cue', 'Scroll to see how it works');
        card.appendChild(cue);
      }
      if (s.postcard) {
        var pc = el('figure', 'gsl-postcard');
        pc.hidden = true;
        pc.setAttribute('aria-label', 'Example postcard of a real island');
        pc.appendChild(el('div', 'gsl-pc-pic'));
        var cap = el('figcaption', 'gsl-pc-cap');
        cap.appendChild(el('span', 'gsl-pc-name'));
        cap.appendChild(el('span', 'gsl-pc-line'));
        pc.appendChild(cap);
        sec.appendChild(pc);
      }
      sec.appendChild(card);
      root.appendChild(sec);
    });

    var track = el('div', 'gsl-track');
    track.setAttribute('aria-hidden', 'true');
    fill = el('span', 'gsl-fill');
    track.appendChild(fill);
    root.appendChild(track);

    document.body.appendChild(root);

    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) enter(+e.target.dataset.i); });
    }, { root: root, threshold: 0.55 });
    root.querySelectorAll('.gsl-step').forEach(function (s) { observer.observe(s); });
  }

  // The world's own keyboard controls (arrows, WASD, shortcuts) stay off while the story is open.
  // Default actions still run, so arrow keys and Space scroll the story and Enter activates buttons.
  function holdKeys(e) {
    if (root && !root.hidden) e.stopImmediatePropagation();
  }

  window.showLanding = function () {
    if (window.stopAttractMode) window.stopAttractMode();
    if (!root) build();
    root.hidden = false;
    root.scrollTop = 0;
    active = -1;
    window.addEventListener('keydown', holdKeys, true);
    window.addEventListener('keyup', holdKeys, true);
    root.focus({ preventScroll: true });
    pickIslands().then(function () {
      // re-run the step we're on now that we know where to fly
      var cur = active; active = -1; enter(cur < 0 ? 0 : cur);
    });
  };

  window.hideLanding = function () {
    if (!root || root.hidden) return;
    root.hidden = true;
    active = -1;
    autopilotTarget = null;
    window.removeEventListener('keydown', holdKeys, true);
    window.removeEventListener('keyup', holdKeys, true);
  };
})();
