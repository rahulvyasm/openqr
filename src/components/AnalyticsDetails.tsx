import { Globe, Monitor, MousePointer2, Trophy } from "lucide-react";
import { formatNumber, type Analytics } from "../lib";
export default function AnalyticsDetails({
  data,
  onCode,
}: {
  data: Analytics | null;
  onCode: (id: string) => void;
}) {
  return (
    <div className="rich-analytics">
      {[
        { title: "Browsers", icon: Globe, values: data?.browsers },
        {
          title: "Operating systems",
          icon: Monitor,
          values: data?.operatingSystems,
        },
        {
          title: "Referrer websites",
          icon: MousePointer2,
          values: data?.referrers,
        },
      ].map(({ title, icon: Icon, values }) => (
        <div className="analytics-detail-card" key={title}>
          <h3>
            <Icon size={16} />
            {title}
          </h3>
          {Object.keys(values || {}).length ? (
            Object.entries(values || {}).map(([name, n]) => (
              <div className="analytics-breakdown-row" key={name}>
                <span>{name}</span>
                <b>{formatNumber(n)}</b>
                <i
                  style={{
                    width: `${data?.total ? (n / data.total) * 100 : 0}%`,
                  }}
                />
              </div>
            ))
          ) : (
            <p>Your next scan starts the story.</p>
          )}
        </div>
      ))}
      <div className="analytics-detail-card top-codes">
        <h3>
          <Trophy size={16} />
          Top connections
        </h3>
        {data?.topCodes.length ? (
          data.topCodes.map((c, i) => (
            <button key={c.id} onClick={() => onCode(c.id)}>
              <span>{i + 1}</span>
              <strong>{c.name}</strong>
              <b>
                {formatNumber(c.scans)}
                <small> scans</small>
              </b>
            </button>
          ))
        ) : (
          <p>See which QR codes people connect with most.</p>
        )}
      </div>
    </div>
  );
}
