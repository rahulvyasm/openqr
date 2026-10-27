import { useReducer } from "react";
import type { QRDesign } from "../lib";
type Look = { color: string; design: QRDesign };
type State = { past: Look[]; present: Look; future: Look[] };
export function useDesignHistory(initial: Look) {
  const [state, dispatch] = useReducer(
    (
      s: State,
      a: { kind: "change" | "undo" | "redo"; value?: Look },
    ): State => {
      if (a.kind === "undo")
        return s.past.length
          ? {
              past: s.past.slice(0, -1),
              present: s.past.at(-1)!,
              future: [s.present, ...s.future],
            }
          : s;
      if (a.kind === "redo")
        return s.future.length
          ? {
              past: [...s.past, s.present],
              present: s.future[0],
              future: s.future.slice(1),
            }
          : s;
      if (!a.value || JSON.stringify(a.value) === JSON.stringify(s.present))
        return s;
      return {
        past: [...s.past, s.present].slice(-30),
        present: a.value,
        future: [],
      };
    },
    { past: [], present: initial, future: [] },
  );
  return {
    current: state.present,
    change: (value: Look) => dispatch({ kind: "change", value }),
    undo: () => dispatch({ kind: "undo" }),
    redo: () => dispatch({ kind: "redo" }),
    canUndo: !!state.past.length,
    canRedo: !!state.future.length,
  };
}
