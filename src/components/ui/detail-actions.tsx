"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"

/** Shared left-aligned action row for detail page side panels. */
export const detailActionClassName =
  "flex h-auto w-full items-center justify-start gap-2 rounded-md px-3 py-2.5 text-sm font-medium shadow-none transition-colors"

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
  "hover:bg-accent hover:text-accent-foreground"
)

export const detailActionDestructiveClassName = cn(
  detailActionClassName,
  "bg-destructive/10 text-destructive hover:bg-destructive/20"
)

export function DetailActions({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("flex flex-col gap-1", className)}>{children}</div>
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

export function DetailActionsDivider() {
  return <div className="my-2 border-t" role="separator" />
}
