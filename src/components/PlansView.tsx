import { useEffect, useState } from "react";
import {
  Check,
  CreditCard,
  HardDrive,
  Loader2,
  QrCode,
  Users,
} from "lucide-react";
import { api, formatNumber } from "../lib";

export type Plan = {
  id: string;
  name: string;
  description: string;
  codes: number;
  storageBytes: number;
  members: number;
  monthlyINR: number | null;
};
export type PlanSummary = {
  hosted: boolean;
  currency: string;
  current: {
    id: string;
    name: string;
    codes: number | null;
    members: number | null;
    storageBytes: number;
    status: string;
    source: string;
  };
  usage: {
    codes: number;
    members: number;
    storageBytes: number;
    pendingInvites: number;
  };
  plans: Plan[];
  checkoutAvailable: boolean;
  checkoutMessage: string;
  maxOwnedWorkspaces: number | null;
};
export const planSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toLocaleString()} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
export default function PlansView() {
  const [summary, setSummary] = useState<PlanSummary | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<PlanSummary>("/billing")
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="studio-kicker">
            <CreditCard size={14} /> ROOM FOR WHAT COMES NEXT
          </span>
          <h1>
            Same studio. More room<span>.</span>
          </h1>
          <p>
            Every QR type. Every design tool. Hosted plans grow with your
            workspace.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!summary && !error ? (
        <p className="operator-loading">
          <Loader2 className="spin" />
          Loading plans and usage…
        </p>
      ) : (
        summary && (
          <>
            <section className="plan-current">
              <div>
                <span className="studio-kicker">YOUR WORKSPACE</span>
                <h2>{summary.current.name}</h2>
                <p>
                  {summary.hosted
                    ? summary.current.source === "manual"
                      ? "Operator-provisioned access · No online payment was collected."
                      : "Free hosted workspace"
                    : "Self-hosted edition · The complete app, on your infrastructure."}
                </p>
              </div>
              <span className="plan-status">{summary.current.status}</span>
            </section>
            <div className="plan-usage-grid">
              {[
                {
                  label: "QR codes",
                  icon: QrCode,
                  used: summary.usage.codes,
                  limit: summary.current.codes,
                  description:
                    summary.current.codes === null
                      ? "No plan cap"
                      : `${formatNumber(summary.current.codes)} included`,
                },
                {
                  label: "Media storage",
                  icon: HardDrive,
                  used: summary.usage.storageBytes,
                  limit: summary.current.storageBytes,
                  description: `${planSize(summary.current.storageBytes)} available`,
                },
                {
                  label: "Team seats",
                  icon: Users,
                  used: summary.usage.members + summary.usage.pendingInvites,
                  limit: summary.current.members,
                  description: `${summary.usage.members} members · ${summary.usage.pendingInvites} pending invitations`,
                },
              ].map(({ label, icon: Icon, used, limit, description }) => (
                <article key={label}>
                  <span>
                    <Icon size={16} />
                    {label}
                  </span>
                  <strong>
                    {label === "Media storage"
                      ? planSize(used)
                      : formatNumber(used)}
                  </strong>
                  <small>{description}</small>
                  {limit !== null && (
                    <progress
                      max={limit}
                      value={Math.min(used, limit)}
                      aria-label={`${label} used`}
                    />
                  )}{" "}
                  {limit !== null && used >= limit && (
                    <p className="plan-limit-note">
                      New additions are limited. Existing content remains
                      available.
                    </p>
                  )}
                </article>
              ))}
            </div>
            <div className="plan-section-heading">
              <h2>
                {summary.hosted ? "Hosted plans" : "Hosted plans preview"}
              </h2>
              <span>INR / MONTHLY</span>
            </div>
            <div className="plan-grid">
              {summary.plans.map((plan) => (
                <article
                  className={`plan-card ${summary.current.id === plan.id ? "current" : ""}`}
                  key={plan.id}
                >
                  <span className="studio-kicker">
                    {plan.id === "free"
                      ? "START HERE"
                      : plan.id === "creator"
                        ? "BUILD MOMENTUM"
                        : "GO FURTHER"}
                  </span>
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                  <div className="plan-price">
                    {plan.monthlyINR === null ? (
                      <>
                        <strong>INR pricing</strong>
                        <span>Amount to be announced</span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency: "INR",
                            maximumFractionDigits: 0,
                          }).format(plan.monthlyINR)}
                        </strong>
                        <span>/ workspace / month</span>
                      </>
                    )}
                  </div>
                  <ul>
                    <li>
                      <Check size={14} />
                      {formatNumber(plan.codes)} QR codes
                    </li>
                    <li>
                      <Check size={14} />
                      {planSize(plan.storageBytes)} media storage
                    </li>
                    <li>
                      <Check size={14} />
                      {plan.members} team seats
                    </li>
                    <li>
                      <Check size={14} />
                      All QR types and studio features
                    </li>
                    <li>
                      <Check size={14} />
                      Analytics, exports, and hosted pages
                    </li>
                  </ul>
                  <div className="plan-card-footer">
                    {summary.current.id === plan.id
                      ? "Your current plan"
                      : plan.id === "free"
                        ? "Free hosted tier"
                        : "Checkout not configured"}
                  </div>
                </article>
              ))}
            </div>
            <div className="info-note">
              <CreditCard size={19} />
              <div>
                <strong>Payments are not active on this installation.</strong>
                <p>
                  {summary.checkoutMessage} Paid plan access can currently be
                  provisioned only by authorized OpenQR Billing staff or a
                  company Super Admin.
                </p>
              </div>
            </div>
            <p className="hint plan-footnote">
              {summary.hosted
                ? `Each workspace has its own plan. Hosted accounts can own up to ${summary.maxOwnedWorkspaces} workspaces. `
                : "Hosted subscriptions pay for the managed service. The open-source self-hosted app includes the full feature set. "}
              Plan limits never pause printed links or delete existing codes.
              Campaign scan caps remain optional choices made by the code owner.
            </p>
          </>
        )
      )}
    </>
  );
}
