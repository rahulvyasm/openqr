import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Eye, Pencil, ShieldCheck } from "lucide-react";

const roles = [
  {
    value: "admin",
    label: "Admin",
    description: "Manage codes and the Editor/Viewer team",
    icon: ShieldCheck,
  },
  {
    value: "editor",
    label: "Editor",
    description: "Create and manage codes, media, and designs",
    icon: Pencil,
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "View analytics and download shared codes",
    icon: Eye,
  },
];
export default function RoleSelect({
  value,
  onChange,
  allowAdmin = false,
  disabled = false,
  name,
  label = "Workspace role",
}: {
  value: string;
  onChange: (value: string) => void;
  allowAdmin?: boolean;
  disabled?: boolean;
  name?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = roles.filter((role) => role.value !== "admin" || allowAdmin);
  const selected = roles.find((role) => role.value === value) || roles[1];
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-role="${value}"]`)
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, value]);
  return (
    <div
      className="role-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ) || [],
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          items[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length
          ]?.focus();
        }
      }}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        ref={trigger}
        className="role-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <selected.icon size={16} />
        <span>{selected.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className="role-select-options"
        >
          {options.map(({ value: next, label, description, icon: Icon }) => (
            <button
              key={next}
              data-role={next}
              type="button"
              role="option"
              aria-selected={value === next}
              onClick={() => {
                onChange(next);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              {value === next && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
