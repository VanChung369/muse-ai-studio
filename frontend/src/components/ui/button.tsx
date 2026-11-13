import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

// Sizes and variants follow the .btn classes in design/design-system/muse.css.
// Focus uses the global :focus-visible outline from index.css.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors select-none motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary font-semibold text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:border-primary-press active:bg-primary-press",
        outline:
          "border-input bg-secondary text-foreground hover:bg-accent active:bg-surface-4 aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:bg-surface-4 aria-expanded:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        destructive:
          "border-destructive/45 bg-transparent text-destructive hover:bg-destructive-soft",
        danger:
          "border-danger bg-danger font-semibold text-white hover:border-danger-hover hover:bg-danger-hover",
        link: "text-primary underline-offset-4 hover:text-primary-hover hover:underline",
      },
      size: {
        default: "h-9 gap-2 px-3.5 max-tablet:h-11",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7.5 gap-1.5 px-2.5 text-[13px] max-tablet:h-9 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[15px]",
        icon: "size-9 max-tablet:size-11",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7.5 max-tablet:size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
