import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import { ArrowUpRight, X } from "lucide-react";
import { gsap } from "../motion";
import "../landing.css";

const types = [
  "Website",
  "PDF",
  "Contact card",
  "Wi-Fi",
  "Event",
  "Gallery",
  "Audio",
  "Video",
  "App store",
  "Social links",
  "Menu",
  "Coupon page",
];
const steps = [
  {
    n: "01",
    title: "Square",
    text: "Sharp, scannable, classic.",
    rx: 0,
    hue: "#e8eee4",
  },
  {
    n: "02",
    title: "Soft",
    text: "Rounded modules with a friendlier voice.",
    rx: 0.28,
    hue: "#d7fa70",
  },
  {
    n: "03",
    title: "Dots",
    text: "Your brand, in every single module.",
    rx: 0.5,
    hue: "#ff7a45",
  },
];

const experiences = [
  {
    key: "product",
    label: "Product",
    title: "Meet the Aero kettle",
    lines: ["Set-up guide", "Descale in 3 steps", "Watch: first boil"],
    form: "Register your warranty",
  },
  {
    key: "event",
    label: "Event",
    title: "Welcome to Forma 26",
    lines: ["Full schedule", "Venue map", "Speaker directory"],
    form: "Will you join us?",
  },
  {
    key: "menu",
    label: "Café",
    title: "Breakfast until 11",
    lines: ["Cardamom bun", "Flat white", "Get directions"],
    form: "Tell us how we did",
  },
];

function useQrCells(content: string) {
  return useMemo(() => {
    const qr = QRCode.create(content, { errorCorrectionLevel: "H" });
    const { size, data } = qr.modules;
    const cells: { x: number; y: number; eye: boolean }[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (data[y * size + x]) {
          const eye =
            (x < 8 && y < 8) ||
            (x >= size - 8 && y < 8) ||
            (x < 8 && y >= size - 8);
          cells.push({ x, y, eye });
        }
    return { size, cells };
  }, [content]);
}

function QrField({
  cells,
  size,
  className,
}: {
  cells: { x: number; y: number; eye: boolean }[];
  size: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      aria-hidden="true"
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          data-cell={c.eye ? "eye" : "dot"}
          x={c.x + 0.04}
          y={c.y + 0.04}
          width={0.92}
          height={0.92}
          rx={0}
        />
      ))}
    </svg>
  );
}

export default function Landing({
  setup,
  brand,
  children,
}: {
  setup: boolean;
  brand: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(setup);
  const hero = useQrCells("https://openqr.dev/hello");
  const demo = useQrCells("https://openqr.dev/design");
  const panel = useRef<HTMLElement>(null);
  const [xp, setXp] = useState(0);
  const [xpPaused, setXpPaused] = useState(false);
  const xpQr = useQrCells("https://openqr.dev/r/aero");

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.from(
          ".l-line > span",
          { yPercent: 115, duration: 1.2, stagger: 0.12 },
          0.1,
        )
          .from(
            ".l-fade",
            { autoAlpha: 0, y: 24, duration: 1, stagger: 0.1 },
            0.5,
          )
          .from(
            ".l-hero-qr rect",
            {
              x: () => gsap.utils.random(-260, 260),
              y: () => gsap.utils.random(-260, 260),
              rotation: () => gsap.utils.random(-180, 180),
              transformOrigin: "50% 50%",
              autoAlpha: 0,
              duration: 1.6,
              ease: "power4.out",
              stagger: { amount: 1.4, from: "random" },
            },
            0.2,
          );
        gsap.to(".l-scan", {
          top: "100%",
          yPercent: -100,
          duration: 2.6,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: 2,
        });
        gsap.to(".l-marquee-track", {
          xPercent: -50,
          duration: 38,
          ease: "none",
          repeat: -1,
        });
        gsap.to(".l-orb", {
          rotation: 360,
          duration: 60,
          ease: "none",
          repeat: -1,
        });

        // Pinned scene: the same QR code changes character as the page scrolls.
        const scene = gsap.timeline({
          scrollTrigger: {
            trigger: ".l-scene",
            start: "top top",
            end: "+=240%",
            scrub: 0.6,
            pin: true,
            anticipatePin: 1,
          },
        });
        const rects = gsap.utils.toArray<SVGRectElement>(
          ".l-demo-qr rect[data-cell='dot']",
        );
        const eyes = gsap.utils.toArray<SVGRectElement>(
          ".l-demo-qr rect[data-cell='eye']",
        );
        steps.slice(1).forEach((step, i) => {
          scene
            .to(
              rects,
              {
                attr: { rx: step.rx },
                fill: step.hue,
                duration: 1,
                ease: "none",
                stagger: { amount: 0.6, from: "center", grid: "auto" },
              },
              i * 1.4,
            )
            .to(eyes, { fill: step.hue, duration: 1 }, i * 1.4)
            .to(
              `.l-step-${i}`,
              { autoAlpha: 0.25, y: -14, duration: 0.5 },
              i * 1.4 + 0.2,
            )
            .fromTo(
              `.l-step-${i + 1}`,
              { autoAlpha: 0.25, y: 14 },
              { autoAlpha: 1, y: 0, duration: 0.5 },
              i * 1.4 + 0.4,
            );
        });
        scene.from(
          ".l-demo-qr",
          { rotate: -6, scale: 0.92, duration: 1, ease: "none" },
          0,
        );

        // Sparkline draws as it enters.
        gsap.from(".l-spark path", {
          strokeDashoffset: 1,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: { trigger: ".l-spark", start: "top 85%" },
        });
        gsap.from(".l-bento > *", {
          autoAlpha: 0,
          y: 50,
          duration: 1,
          stagger: 0.1,
          ease: "expo.out",
          scrollTrigger: { trigger: ".l-bento", start: "top 82%" },
        });
        gsap.from(".l-cta h2 span", {
          yPercent: 110,
          duration: 1.2,
          stagger: 0.1,
          ease: "expo.out",
          scrollTrigger: { trigger: ".l-cta", start: "top 75%" },
        });
      });
    }, root);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (xpPaused || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const timer = setInterval(
      () => setXp((n) => (n + 1) % experiences.length),
      3800,
    );
    return () => clearInterval(timer);
  }, [xpPaused]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".l-xp-screen > *",
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.07, ease: "expo.out" },
      );
    }, root);
    return () => ctx.revert();
  }, [xp]);

  useLayoutEffect(() => {
    if (panel.current) gsap.set(panel.current, { xPercent: 105 });
  }, []);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    gsap.to(el, {
      xPercent: open ? 0 : 105,
      duration: open ? 0.7 : 0.5,
      ease: open ? "expo.out" : "power3.in",
    });
    if (open)
      el.querySelector<HTMLInputElement>("input")?.focus({
        preventScroll: true,
      });
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  return (
    <div className="landing" ref={root}>
      <div className="l-grain" aria-hidden="true" />
      <header className="l-nav">
        {brand}
        <nav>
          <a href="#features">Features</a>
          <a href="https://github.com/rahulvyasm/openqr" rel="noreferrer">
            Source
          </a>
          <button
            className="l-pill"
            data-magnetic
            onClick={() => setOpen(true)}
          >
            {setup ? "Create your workspace" : "Sign in"}{" "}
            <ArrowUpRight size={16} />
          </button>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-hero-copy">
          <span className="l-kicker l-fade">
            <i /> OPEN SOURCE QR STUDIO / V1.0
          </span>
          <h1>
            <span className="l-line">
              <span>Make the</span>
            </span>
            <span className="l-line">
              <span>physical</span>
            </span>
            <span className="l-line l-accent">
              <span>clickable.</span>
            </span>
          </h1>
          <p className="l-fade">
            Codes you can edit after they are printed. Pages that load in a
            blink. Analytics that stay yours.
          </p>
          <div className="l-actions l-fade">
            <button
              className="l-cta-btn"
              data-magnetic
              onClick={() => setOpen(true)}
            >
              {setup ? "Set up your studio" : "Open your studio"}{" "}
              <ArrowUpRight size={20} />
            </button>
            <span className="l-note">
              MIT licensed · self-hosted · no scan limits
            </span>
          </div>
        </div>
        <div className="l-hero-art" aria-hidden="true">
          <div className="l-orb" />
          <div className="l-card" data-tilt>
            <QrField
              className="l-hero-qr"
              cells={hero.cells}
              size={hero.size}
            />
            <span className="l-scan" />
            <span className="l-card-tag">/001 — LIVE</span>
          </div>
        </div>
      </section>

      <div className="l-marquee" aria-hidden="true">
        <div className="l-marquee-track">
          {[...types, ...types].map((t, i) => (
            <span key={i}>
              {t}
              <b>✳</b>
            </span>
          ))}
        </div>
      </div>

      <section className="l-scene">
        <div className="l-scene-copy">
          <span className="l-kicker">
            <i /> DESIGN
          </span>
          <h2>
            Make it look like <em>you</em>.
          </h2>
          <ol>
            {steps.map((s, i) => (
              <li
                key={s.n}
                className={`l-step-${i}`}
                style={{ opacity: i ? 0.25 : 1 }}
              >
                <small>{s.n}</small>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="l-hint">
            Keep scrolling. It is the same code every time.
          </p>
        </div>
        <div className="l-scene-art" aria-hidden="true">
          <QrField className="l-demo-qr" cells={demo.cells} size={demo.size} />
        </div>
      </section>

      <section className="l-xp" aria-labelledby="xp-title">
        <div className="l-xp-copy">
          <span className="l-kicker" data-reveal>
            <i /> EXPERIENCES
          </span>
          <h2 id="xp-title" data-reveal>
            One code. <em>Any</em> experience.
          </h2>
          <p data-reveal>
            Build the whole page behind your code: story, video, files, forms.
            Visitors take action, you see the results, and the printed code
            never changes.
          </p>
          <div className="l-xp-tabs" role="tablist" aria-label="Examples">
            {experiences.map((e, i) => (
              <button
                key={e.key}
                role="tab"
                aria-selected={xp === i}
                className={xp === i ? "on" : ""}
                onClick={() => {
                  setXp(i);
                  setXpPaused(true);
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
        <div className="l-xp-art" aria-hidden="true">
          <div className="l-xp-qr">
            <QrField cells={xpQr.cells} size={xpQr.size} />
          </div>
          <div className="l-xp-phone">
            <i />
            <div className="l-xp-screen" key={experiences[xp].key}>
              <h3>{experiences[xp].title}</h3>
              {experiences[xp].lines.map((line) => (
                <span key={line}>
                  {line} <b>↗</b>
                </span>
              ))}
              <div className="l-xp-form">
                <strong>{experiences[xp].form}</strong>
                <u />
                <u />
                <em>Send</em>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="l-features" id="features">
        <span className="l-kicker" data-reveal>
          <i /> WHAT IS INSIDE
        </span>
        <h2 data-reveal>
          One square. <em>Everything</em> behind it.
        </h2>
        <div className="l-bento">
          <article data-spot className="b-wide">
            <small>01 / DYNAMIC</small>
            <h3>Change where it goes. Never reprint.</h3>
            <p>
              Edit the destination after the code is on the box, the menu, or
              the wall. Pause, schedule, or retire it in a click.
            </p>
          </article>
          <article data-spot>
            <small>02 / ANALYTICS</small>
            <h3>See every scan.</h3>
            <svg
              className="l-spark"
              viewBox="0 0 200 60"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0 50 C20 48 30 20 55 28 S90 52 110 30 150 6 200 10"
                pathLength={1}
              />
            </svg>
          </article>
          <article data-spot>
            <small>03 / EXPERIENCES</small>
            <h3>Pages that do things.</h3>
            <p>Forms, RSVPs and enquiries, with results next to your scans.</p>
          </article>
          <article data-spot className="b-wide b-dark">
            <small>04 / YOURS</small>
            <h3>Open source. Your server. Your data.</h3>
            <p>
              No subscriptions to run it. No limits on scans. Take it anywhere,
              change anything.
            </p>
          </article>
        </div>
      </section>

      <section className="l-cta">
        <h2>
          <span>Your next</span>{" "}
          <span>
            <em>connection</em>
          </span>{" "}
          <span>starts here.</span>
        </h2>
        <button
          className="l-cta-btn"
          data-magnetic
          onClick={() => setOpen(true)}
        >
          {setup ? "Set up your studio" : "Open your studio"}{" "}
          <ArrowUpRight size={20} />
        </button>
      </section>
      <footer className="l-foot">
        <span>openqr.</span>
        <span>Crafted for the open web</span>
      </footer>

      <div
        className={`l-scrim ${open ? "on" : ""}`}
        onClick={() => setOpen(false)}
      />
      <aside
        className="l-panel"
        ref={panel}
        role="dialog"
        aria-label={setup ? "Create your workspace" : "Sign in"}
        inert={!open}
      >
        <button
          className="l-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <X size={20} />
        </button>
        {children}
      </aside>
    </div>
  );
}
