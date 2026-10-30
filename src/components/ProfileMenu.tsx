import { useEffect, useRef, useState } from "react";
import { Ellipsis, LogOut, Settings, UserRound, Users } from "lucide-react";

export default function ProfileMenu({
  name,
  role,
  onAccount,
  onWorkspace,
  onTeam,
  onSignOut,
}: {
  name: string;
  role: string;
  onAccount: () => void;
  onWorkspace: () => void;
  onTeam: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(".profile-menu button")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const actions = [
    { label: "My account", icon: UserRound, run: onAccount },
    { label: "Workspace settings", icon: Settings, run: onWorkspace },
    { label: "Team", icon: Users, run: onTeam },
    { label: "Sign out", icon: LogOut, run: onSignOut },
  ];
  return (
    <div
      ref={root}
      className="profile-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (
          open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              ".profile-menu button",
            ) || [],
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        className="profile"
        ref={trigger}
        aria-label={`Account menu for ${name}`}
        aria-expanded={open}
        aria-controls="account-menu"
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <span className="profile-avatar">{name[0].toUpperCase()}</span>
        <span>
          <strong>{name}</strong>
          <small>{role} access</small>
        </span>
        <Ellipsis size={18} />
      </button>
      {open && (
        <div
          id="account-menu"
          className="profile-menu"
          role="menu"
          aria-label="Account actions"
        >
          {actions.map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                run();
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
