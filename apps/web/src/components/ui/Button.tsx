import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Shape = "pill" | "rect";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 border border-brand-600",
  outline:
    "bg-white text-brand-700 border border-brand-600 hover:bg-brand-50",
  ghost:
    "bg-transparent text-slate-600 border border-transparent hover:bg-slate-50",
  danger:
    "bg-red-600 text-white hover:bg-red-700 border border-red-600",
};

const shapes: Record<Shape, string> = {
  pill: "rounded-full",
  rect: "rounded-lg",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  shape?: Shape;
  children: ReactNode;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  shape = "pill",
  className = "",
  children,
  loading,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${shapes[shape]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}
