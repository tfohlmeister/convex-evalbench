import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  soft?: boolean;
}

export function Card({ soft = false, className = "", ...props }: CardProps) {
  return (
    <div className={`${soft ? "card-soft" : "card"} ${className}`} {...props} />
  );
}

/** A titled section: mono eyebrow over a serif heading, optional actions. */
export function SectionHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="display text-[26px] leading-none">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
