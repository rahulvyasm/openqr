import { ArrowUpRight, CalendarClock, Radio } from "lucide-react";
import { formatNumber, type Analytics, type Code } from "../lib";

export default function CampaignPulse({
  analytics,
  codes,
  onCode,
  onAnalytics,
}: {
  analytics: Analytics | null;
  codes: Code[];
  onCode: (code: Code) => void;
  onAnalytics: () => void;
}) {
  const top = analytics?.topCodes[0];
  const topCode = top ? codes.find((code) => code.id === top.id) : undefined;
  const busiest = analytics?.total
    ? analytics.daily.reduce(
        (best, day) => (day.scans > best.scans ? day : best),
        analytics.daily[0],
      )
    : null;
  const upcoming = codes
    .filter(
      (code) =>
        code.dynamic &&
        code.active &&
        code.campaign.startsAt &&
        Date.parse(code.campaign.startsAt) > Date.now(),
    )
    .sort(
      (a, b) =>
        Date.parse(a.campaign.startsAt!) - Date.parse(b.campaign.startsAt!),
    )[0];
  return (
    <aside className="campaign-pulse" aria-label="Campaign pulse">
      <div className="pulse-heading">
        <span>
          <Radio size={15} /> CAMPAIGN PULSE
        </span>
        <span>{analytics ? `${analytics.days}D` : "—"}</span>
      </div>
      <span className="pulse-label">LEADING CONNECTION</span>
      {top && topCode ? (
        <button className="pulse-leader" onClick={() => onCode(topCode)}>
          <strong>{top.name}</strong>
          <ArrowUpRight size={18} />
          <span>
            {formatNumber(top.scans)} scans ·{" "}
            {analytics?.total
              ? Math.round((top.scans / analytics.total) * 100)
              : 0}
            % of this period
          </span>
        </button>
      ) : (
        <div className="pulse-no-data">
          <strong>
            Your next standout
            <br />
            starts with a scan.
          </strong>
          <p>Your leading QR code will appear here as people connect.</p>
        </div>
      )}
      <div className="pulse-detail">
        <span>Most active day</span>
        <strong>
          {busiest
            ? new Date(busiest.date + "T12:00:00Z").toLocaleDateString(
                undefined,
                { month: "short", day: "numeric", timeZone: "UTC" },
              )
            : "No activity yet"}
          {busiest && <small>{formatNumber(busiest.scans)} scans</small>}
        </strong>
      </div>
      <div className="pulse-detail">
        <span>
          <CalendarClock size={13} /> Next scheduled launch
        </span>
        {upcoming ? (
          <button onClick={() => onCode(upcoming)}>
            <strong>{upcoming.name}</strong>
            <small>
              {new Date(upcoming.campaign.startsAt!).toLocaleString()}
            </small>
          </button>
        ) : (
          <strong>Nothing scheduled</strong>
        )}
      </div>
      <button className="pulse-analytics" onClick={onAnalytics}>
        Explore the full picture <ArrowUpRight size={15} />
      </button>
    </aside>
  );
}
