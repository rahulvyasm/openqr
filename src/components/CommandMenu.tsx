import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CornerDownLeft,
  Palette,
  Plus,
  QrCode,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import Modal from "./Modal";
import type { Code } from "../lib";

export default function CommandMenu({
  codes,
  canEdit,
  onNavigate,
  onCreate,
  onCode,
  onClose,
}: {
  codes: Code[];
  canEdit: boolean;
  onNavigate: (page: string) => void;
  onCreate: () => void;
  onCode: (code: Code) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    document
      .getElementById(`command-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  const actions = [
    ...(canEdit
      ? [
          {
            id: "create",
            label: "Create a QR code",
            description: "Start something new",
            icon: Plus,
            run: onCreate,
          },
        ]
      : []),
    ...[
      { id: "codes", label: "QR workspace", icon: QrCode },
      { id: "analytics", label: "Scan analytics", icon: BarChart3 },
      { id: "designs", label: "Design studio", icon: Palette },
      { id: "media", label: "Media library", icon: Upload },
      { id: "settings", label: "Workspace settings", icon: Settings },
    ].map((item) => ({
      ...item,
      description: "Go to page",
      run: () => onNavigate(item.id),
    })),
    ...codes.map((code) => ({
      id: code.id,
      label: code.name,
      description: code.dynamic
        ? "Open scan analytics"
        : canEdit
          ? "Edit QR code"
          : "Download QR code",
      icon: QrCode,
      run: () => onCode(code),
    })),
  ]
    .filter((item) =>
      `${item.label} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 12);
  const execute = (index: number) => {
    const action = actions[index];
    if (action) {
      onClose();
      action.run();
    }
  };
  return (
    <Modal title="Jump to anything" onClose={onClose}>
      <div
        className="command-menu"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index) =>
              actions.length
                ? (index + (e.key === "ArrowDown" ? 1 : -1) + actions.length) %
                  actions.length
                : 0,
            );
          }
          if (e.key === "Enter" && e.target === input.current) {
            e.preventDefault();
            execute(active);
          }
        }}
      >
        <label className="command-input">
          <Search size={21} />
          <input
            ref={input}
            aria-label="Find a code, page or action"
            placeholder="Find a code, page or action…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            aria-controls="command-results"
            aria-activedescendant={
              actions[active] ? `command-${active}` : undefined
            }
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
          />
        </label>
        <div
          id="command-results"
          className="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {actions.map((action, index) => (
            <button
              id={`command-${index}`}
              key={action.id}
              role="option"
              aria-selected={active === index}
              className={active === index ? "is-active" : ""}
              onMouseMove={() => setActive(index)}
              onClick={() => execute(index)}
            >
              <action.icon size={18} />
              <span>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!actions.length && (
            <p>No matches. Try a code name or “analytics”.</p>
          )}
        </div>
        <div className="command-hints">
          <span>↑ ↓ to explore</span>
          <span>
            <CornerDownLeft size={12} /> to open
          </span>
          <span>esc to close</span>
        </div>
      </div>
    </Modal>
  );
}
