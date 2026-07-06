import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="text-[var(--color-soft)] mb-3">{icon}</div>}
      <p className="font-serif text-[20px] text-[var(--color-ink)]">{title}</p>
      {hint && (
        <p className="text-[13px] text-[var(--color-soft)] mt-1.5 max-w-sm">
          {hint}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
