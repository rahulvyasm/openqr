import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/*
 * Motion engine. Components opt in with data attributes and never import GSAP:
 *   data-reveal            fade and rise when scrolled into view
 *   data-stagger           children rise one after another
 *   data-count="1234"      number counts up when visible
 *   data-wipe              reveal left to right (charts)
 *   data-magnetic          element leans toward the pointer
 *   data-tilt              3D tilt that follows the pointer
 *   data-spot              cursor-following light (sets --mx / --my)
 * Everything is skipped when the visitor prefers reduced motion.
 */
const cleanups = new WeakMap<Element, () => void>();
const fmt = new Intl.NumberFormat();
let reduced = false;

function reveal(el: HTMLElement) {
  gsap.fromTo(
    el,
    { autoAlpha: 0, y: 36 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.9,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    },
  );
}
function stagger(el: HTMLElement) {
  const kids = Array.from(el.children);
  if (!kids.length) return;
  gsap.fromTo(
    kids,
    { autoAlpha: 0, y: 28 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.8,
      stagger: 0.07,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    },
  );
}
function count(el: HTMLElement) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;
  const state = { value: 0 };
  el.textContent = "0";
  gsap.to(state, {
    value: target,
    duration: 1.6,
    ease: "power3.out",
    onUpdate: () => {
      el.textContent = fmt.format(Math.round(state.value));
    },
    onComplete: () => {
      el.textContent = fmt.format(target);
    },
    scrollTrigger: { trigger: el, start: "top 95%", once: true },
  });
}
function magnetic(el: HTMLElement) {
  const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
  const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    x((e.clientX - (r.left + r.width / 2)) * 0.28);
    y((e.clientY - (r.top + r.height / 2)) * 0.34);
  };
  const leave = () => {
    gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1,0.4)" });
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
  };
}
function tilt(el: HTMLElement) {
  const rx = gsap.quickTo(el, "rotationX", {
    duration: 0.6,
    ease: "power3.out",
  });
  const ry = gsap.quickTo(el, "rotationY", {
    duration: 0.6,
    ease: "power3.out",
  });
  gsap.set(el, { transformPerspective: 900, transformOrigin: "50% 50%" });
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry(px * 14);
    rx(-py * 14);
    el.style.setProperty("--gx", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--gy", `${(py + 0.5) * 100}%`);
  };
  const leave = () => {
    rx(0);
    ry(0);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
  };
}
function spot(el: HTMLElement) {
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  el.addEventListener("pointermove", move);
  return () => el.removeEventListener("pointermove", move);
}

function wipe(el: HTMLElement) {
  gsap.fromTo(
    el,
    { clipPath: "inset(0 100% 0 0)" },
    {
      clipPath: "inset(-4px -4px -4px -4px)",
      duration: 1.5,
      ease: "power3.inOut",
      clearProps: "clipPath",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    },
  );
}

// Screens that predate the data attributes still get the same treatment.
const autoReveal = [
  ".settings-panel",
  ".operator-card",
  ".operator-metrics > *",
  ".design-gallery-card",
  ".plan-card",
  ".asset-browser",
  ".code-row",
  ".campaign-pulse",
].join(",");

const handlers: [string, (el: HTMLElement) => void | (() => void)][] = [
  [`[data-reveal], ${autoReveal}`, reveal],
  ["[data-stagger]", stagger],
  ["[data-count]", count],
  ["[data-wipe]", wipe],
  ["[data-magnetic]", magnetic],
  ["[data-tilt]", tilt],
  ["[data-spot]", spot],
];
const handled = new WeakMap<Element, Set<string>>();
const pointerEffects = new Set([
  "[data-magnetic]",
  "[data-tilt]",
  "[data-spot]",
]);
function scan(root: ParentNode) {
  const hover = matchMedia("(hover:hover)").matches;
  for (const [selector, run] of handlers) {
    if (reduced && selector !== "[data-spot]") continue;
    if (pointerEffects.has(selector) && !hover) continue;
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root instanceof HTMLElement && root.matches(selector))
      found.unshift(root);
    for (const el of found) {
      const done = handled.get(el) ?? new Set<string>();
      if (done.has(selector)) continue;
      done.add(selector);
      handled.set(el, done);
      const off = run(el);
      if (off) cleanups.set(el, off);
    }
  }
}

let started = false;
export function startMotion() {
  if (started || typeof window === "undefined") return;
  started = true;
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  gsap.defaults({ overwrite: "auto" });
  scan(document);
  let queued = false;
  new MutationObserver((records) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement) scan(node);
      ScrollTrigger.refresh();
    });
  }).observe(document.body, { childList: true, subtree: true });
}

// Play a short entrance on the element that holds a freshly opened page.
export function pageIn(el: HTMLElement | null) {
  if (!el || reduced) return;
  gsap.fromTo(
    el,
    { autoAlpha: 0, y: 24, filter: "blur(6px)" },
    {
      autoAlpha: 1,
      y: 0,
      filter: "blur(0px)",
      duration: 0.7,
      ease: "expo.out",
      clearProps: "all",
    },
  );
}
export { gsap, ScrollTrigger };
