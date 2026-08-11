"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"

/**
 * Detail-page action tiles: 2-column grid of equal cells so the panel
 * reads as a filled toolbar, not a skinny label with empty space beside it.
 */
export const detailActionClassName =
  "flex h-auto min-h-20 w-full cursor-pointer flex-col items-center justify-center gap-1.5 whitespace-normal rounded-lg border border-transparent px-2 py-3 text-center text-sm font-medium leading-tight shadow-none transition-colors [&_svg]:size-5"

export const detailActionPrimaryClassName = cn(
  detailActionClassName,
  "bg-primary text-primary-foreground hover:bg-primary/90"
)

export const detailActionSecondaryClassName = cn(
  detailActionClassName,
  "bg-secondary text-secondary-foreground hover:bg-secondary/80"
)

export const detailActionGhostClassName = cn(
  detailActionClassName,
  "bg-muted/60 hover:bg-accent hover:text-accent-foreground"
)

export const detailActionDestructiveClassName = cn(
  detailActionClassName,
  "col-span-2 bg-destructive/10 text-destructive hover:bg-destructive/20"
)

export function DetailActions({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>{children}</div>
  )
}

export function DetailActionLink({
  href,
  children,
  className,
  variant = "ghost",
}: {
  href: string
  children: ReactNode
  className?: string
  variant?: "ghost" | "secondary" | "primary"
}) {
  const variantClass =
    variant === "primary"
      ? detailActionPrimaryClassName
      : variant === "secondary"
        ? detailActionSecondaryClassName
        : detailActionGhostClassName

  return (
    <Link href={href} className={cn(variantClass, className)}>
      {children}
    </Link>
  )
}

export function DetailActionButton({
  className,
  variant = "ghost",
  ...props
}: ComponentProps<typeof Button>) {
  const variantClass =
    variant === "default"
      ? detailActionPrimaryClassName
      : variant === "secondary"
        ? detailActionSecondaryClassName
      : variant === "destructive"
          ? detailActionDestructiveClassName
          : detailActionGhostClassName

  return (
    <Button
      variant={variant === "default" ? "default" : variant === "destructive" ? "destructive" : "ghost"}
      className={cn(variantClass, className)}
      {...props}
    />
  )
}

/** Full-width break between tile groups (e.g. before Delete). */
export function DetailActionsDivider() {
  return <div className="col-span-2 my-0.5 border-t" role="separator" />
}
