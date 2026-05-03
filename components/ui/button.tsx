import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Charter §4 UI: violet is outbox's brand accent, sibling to inbox's sky.
// All sizes hit the 44px tap-target minimum (charter §3 mobile-first).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary: "bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700",
        ghost:
          "bg-transparent text-slate-900 hover:bg-slate-100 dark:text-slate-50 dark:hover:bg-slate-800",
        danger:
          "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-500",
      },
      size: {
        md: "min-h-11 min-w-11 px-4 py-2",
        sm: "min-h-11 min-w-11 px-3 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
