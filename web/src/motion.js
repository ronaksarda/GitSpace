// Motion with anime.js v4. Every helper respects prefers-reduced-motion.
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { cloneElement, createElement } from 'react';
import { useForkRef } from '@mui/material/utils';
import { animate, spring, stagger, createTimeline } from 'animejs';
import { fmt } from './lib.js';

export const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export { animate, stagger, createTimeline };

const openSpring = () => spring({ bounce: 0.18, duration: 360 });

// A MUI transition slot driven by anime.js: springs open, eases out fast on close.
// `enter` is the hidden pose, e.g. { opacity: 0, scale: 0.97, translateY: 8 }.
function makeSpring(enter) {
  return forwardRef(function SpringTransition(props, ref) {
    const { in: open, children, onEnter, onEntered, onExit, onExited } = props;
    const node = useRef(null);
    const handleRef = useForkRef(node, children.props.ref, ref);
    useLayoutEffect(() => {
      const el = node.current;
      if (!el) return;
      const shown = Object.fromEntries(Object.keys(enter).map(k => [k, k === 'opacity' || k === 'scale' ? 1 : 0]));
      let anim;
      if (open) {
        onEnter?.(el, false);
        if (reduced()) { onEntered?.(el); return; }
        el.style.opacity = '0';
        anim = animate(el, { ...Object.fromEntries(Object.keys(enter).map(k => [k, { from: enter[k], to: shown[k] }])), ease: openSpring() });
        anim.then(() => onEntered?.(el));
      } else {
        onExit?.(el);
        if (reduced()) { onExited?.(el); return; }
        anim = animate(el, { ...enter, duration: 140, ease: 'inQuad' });
        anim.then(() => onExited?.(el));
      }
      return () => anim?.pause();
    }, [open]);
    return cloneElement(children, { ref: handleRef });
  });
}

export const DialogSpring = makeSpring({ opacity: 0, scale: 0.97, translateY: 10 });
export const DrawerSpring = makeSpring({ opacity: 0, translateX: 48 });

// Counts a number up from where it was last shown.
export function Count({ value, className = 'num' }) {
  const ref = useRef(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    const to = Number(value) || 0;
    if (reduced() || to === shown.current) { el.textContent = fmt(to); shown.current = to; return; }
    const o = { v: shown.current };
    const anim = animate(o, {
      v: to, duration: 900, ease: 'outExpo',
      onUpdate: () => { el.textContent = fmt(Math.round(o.v)); },
      onComplete: () => { shown.current = to; },
    });
    return () => { anim.pause(); shown.current = Math.round(o.v); };
  }, [value]);
  return createElement('span', { ref, className }, fmt(0));
}
