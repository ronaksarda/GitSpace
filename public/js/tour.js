// ── Onboarding Tour (Feature 12) ─────────────────────
(function() {
  const TOUR_KEY = 'gitspace_tour_completed';

  const tourSteps = [
    {
      target: '#search-wrap',
      title: 'Search the Universe',
      text: 'Find any developer or repository across the entire GitSpace world.',
      position: 'bottom'
    },
    {
      target: '#controls-hint',
      title: 'Navigate Space',
      text: 'Use WASD or Arrow Keys to fly your ship. Scroll to zoom in/out.',
      position: 'top'
    },
    {
      target: '#hud-bl',
      title: 'Track Your Position',
      text: 'Your coordinates and nearby island info are shown here.',
      position: 'top'
    },
    {
      target: '#btn-citizens',
      title: 'Citizens Directory',
      text: 'Browse all registered developers, sorted by stars. Click to travel to their island.',
      position: 'right'
    }
  ];

  let currentStep = 0;

  function shouldShowTour() {
    try {
      return !localStorage.getItem(TOUR_KEY);
    } catch (e) {
      return false;
    }
  }

  function completeTour() {
    try {
      localStorage.setItem(TOUR_KEY, 'true');
    } catch (e) { /* silent */ }
    cleanup();
  }

  function cleanup() {
    const overlay = document.getElementById('tour-overlay');
    if (overlay) overlay.remove();
    const spotlight = document.getElementById('tour-spotlight');
    if (spotlight) spotlight.remove();
  }

  function showStep(index) {
    cleanup();
    if (index >= tourSteps.length) {
      completeTour();
      return;
    }

    const step = tourSteps[index];
    const targetEl = document.querySelector(step.target);
    if (!targetEl) {
      // Skip missing elements
      currentStep++;
      showStep(currentStep);
      return;
    }

    const rect = targetEl.getBoundingClientRect();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'tour-overlay';
    overlay.innerHTML = `
      <div class="tour-backdrop"></div>
      <div class="tour-spotlight" style="
        top: ${rect.top - 8}px;
        left: ${rect.left - 8}px;
        width: ${rect.width + 16}px;
        height: ${rect.height + 16}px;
      "></div>
      <div class="tour-tooltip tour-pos-${step.position}" style="
        ${getTooltipPosition(rect, step.position)}
      ">
        <div class="tour-step-indicator">
          ${tourSteps.map((_, i) => `<span class="tour-dot ${i === index ? 'active' : ''}"></span>`).join('')}
        </div>
        <h3 class="tour-title">${step.title}</h3>
        <p class="tour-text">${step.text}</p>
        <div class="tour-actions">
          <button class="tour-skip" id="tour-skip">Skip Tour</button>
          <button class="tour-next" id="tour-next">${index === tourSteps.length - 1 ? 'Got it!' : 'Next →'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('tour-skip').addEventListener('click', completeTour);
    document.getElementById('tour-next').addEventListener('click', () => {
      currentStep++;
      showStep(currentStep);
    });
  }

  function getTooltipPosition(rect, position) {
    const pad = 16;
    const tooltipWidth = 320; // approximate max-width + padding
    
    let top = 'auto', bottom = 'auto', left = 'auto', right = 'auto';

    switch (position) {
      case 'bottom':
        top = rect.bottom + pad;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        bottom = window.innerHeight - rect.top + pad;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'right':
        top = rect.top;
        left = rect.right + pad;
        break;
      case 'left':
        top = rect.top;
        right = window.innerWidth - rect.left + pad;
        break;
      default:
        top = rect.bottom + pad;
        left = rect.left;
    }

    // Clamp values to screen bounds
    if (left !== 'auto') left = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, left));
    if (right !== 'auto') right = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, right));
    if (top !== 'auto' && typeof top === 'number') top = Math.max(10, Math.min(window.innerHeight - 150, top));
    if (bottom !== 'auto' && typeof bottom === 'number') bottom = Math.max(10, Math.min(window.innerHeight - 150, bottom));

    let style = '';
    if (top !== 'auto') style += `top: ${top}px; `;
    if (bottom !== 'auto') style += `bottom: ${bottom}px; `;
    if (left !== 'auto') style += `left: ${left}px; `;
    if (right !== 'auto') style += `right: ${right}px; `;
    
    return style;
  }

  // Initialize after a delay to let HUD render
  window.initTour = function() {
    if (shouldShowTour()) {
      setTimeout(() => showStep(0), 1500);
    }
  };

  // Allow explicit restart
  window.startTour = function() {
    try {
      localStorage.removeItem(TOUR_KEY);
    } catch (e) { /* silent */ }
    currentStep = 0;
    showStep(0);
  };
})();
