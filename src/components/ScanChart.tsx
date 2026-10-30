import { useId, useState } from "react";
import { Loader2, MoveUpRight } from "lucide-react";
import { formatNumber, type Analytics } from "../lib";

export default function ScanChart({
  analytics,
}: {
  analytics: Analytics | null;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  if (!analytics)
    return (
      <div className="chart-loading">
        <Loader2 className="spin" aria-label="Loading scan analytics" />
      </div>
    );
  const values = analytics.daily;
  const max = Math.max(4, ...values.map((d) => d.scans));
  const width = 800,
    height = 170;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  const y = (n: number) => height - (n / max) * (height - 18);
  const points = values.map((d, i) => `${x(i)},${y(d.scans)}`).join(" ");
  const selectedIndex =
    hovered === null ? null : Math.min(hovered, values.length - 1);
  const selected = selectedIndex === null ? null : values[selectedIndex];
  const date = (value: string) =>
    new Date(value + "T12:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return (
    <>
      <div className="chart-summary">
        <strong>
          {formatNumber(selected?.scans ?? analytics.total)}
          <span>{selected ? "scans on this day" : "scans in this period"}</span>
        </strong>
        <span className="chart-caption">
          <MoveUpRight size={15} />
          {selected
            ? date(selected.date)
            : `${analytics.days}-day overview · UTC`}
        </span>
      </div>
      <div className="chart-wrap interactive-chart">
        <div className="chart-axis">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-body">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${analytics.total} scans over ${analytics.days} days`}
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c6ed69" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#c6ed69" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((n) => (
              <line
                key={n}
                x1="0"
                x2={width}
                y1={height * n}
                y2={height * n}
                stroke="#e7e9e4"
                strokeDasharray="3 6"
              />
            ))}
            <polygon
              points={`0,${height} ${points} ${width},${height}`}
              fill={`url(#${id})`}
            />
            <polyline
              className="scan-line"
              points={points}
              fill="none"
              stroke="#344c35"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
            {selected && selectedIndex !== null && (
              <g>
                <line
                  x1={x(selectedIndex)}
                  x2={x(selectedIndex)}
                  y1={0}
                  y2={height}
                  stroke="#809175"
                  strokeDasharray="3 4"
                />
                <circle
                  cx={x(selectedIndex)}
                  cy={y(selected.scans)}
                  r="4"
                  fill="#182521"
                  stroke="white"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
          <div
            className="chart-hit-area"
            tabIndex={0}
            role="slider"
            aria-label="Explore daily scans"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, values.length - 1)}
            aria-valuenow={Math.max(0, selectedIndex ?? 0)}
            aria-valuetext={
              selected
                ? `${date(selected.date)}: ${selected.scans} scans`
                : "Use arrow keys to explore each day"
            }
            onFocus={() => setHovered(0)}
            onBlur={() => setHovered(null)}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHovered(
                Math.min(
                  values.length - 1,
                  Math.max(
                    0,
                    Math.round(
                      ((e.clientX - rect.left) / rect.width) *
                        (values.length - 1),
                    ),
                  ),
                ),
              );
            }}
            onPointerLeave={() => setHovered(null)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                setHovered((i) =>
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? values.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            values.length - 1,
                            (i ?? 0) + (e.key === "ArrowRight" ? 1 : -1),
                          ),
                        ),
                );
              }
            }}
          />
          <div className="chart-dates">
            {[
              values[0],
              values[Math.floor(values.length / 2)],
              values.at(-1),
            ].map((d, i) => (
              <span key={i}>{d && date(d.date)}</span>
            ))}
          </div>
        </div>
      </div>
      {!analytics.total && (
        <p className="chart-empty-note">
          Ready for the first scan. Activity appears when someone opens a
          dynamic QR link.
        </p>
      )}
    </>
  );
}
