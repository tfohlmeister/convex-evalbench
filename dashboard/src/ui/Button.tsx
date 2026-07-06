import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "destructive"
  | "destructiveSolid"
  | "ghost";

/**
 * The semantic-intent-to-class map. Exported so a test can assert the
 * mapping without rendering, and so the semantics live in exactly one
 * place: `primary` is the main action, `secondary`/`ghost` are cancel
 * and non-primary actions, `destructive` deletes or discards.
 */
export const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-ghost",
  accent: "btn-accent",
  destructive: "btn-danger",
  destructiveSolid: "btn-danger-solid",
  ghost: "btn-ghost",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "default" | "sm";
}

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "btn",
    VARIANT_CLASS[variant],
    size === "sm" ? "btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...props} />;
}
