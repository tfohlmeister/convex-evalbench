import type { ReactNode } from "react";

/**
 * Table scaffolding: a horizontally scrollable wrapper around a `.table`.
 * Views supply `<thead>`/`<tbody>`; the styling comes from the `.table`
 * component class in styles.css.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">{children}</table>
    </div>
  );
}
