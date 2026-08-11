"use client"

import { cn } from "@/lib/utils"
import { useId } from "react"

type LogoProps = {
  className?: string
  /** Show wordmark next to the mark */
  withWordmark?: boolean
  wordmarkClassName?: string
}

/** LazyBackup mark: cloud → local storage on an emerald→cyan tile. */
export function Logo({
  className,
  withWordmark = false,
  wordmarkClassName,
}: LogoProps) {
  const uid = useId().replace(/:/g, "")
  const bgId = `${uid}-bg`
  const glowId = `${uid}-glow`

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        fill="none"
        className="h-7 w-7 shrink-0"
        aria-hidden={withWordmark ? true : undefined}
        role={withWordmark ? undefined : "img"}
        aria-label={withWordmark ? undefined : "LazyBackup"}
      >
        <defs>
          <linearGradient
            id={bgId}
            x1="3"
            y1="2"
            x2="29"
            y2="30"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#6ee7b7" />
            <stop offset=".5" stopColor="#34d399" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient
            id={glowId}
            x1="16"
            y1="0"
            x2="16"
            y2="20"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff" stopOpacity=".3" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#${bgId})`} />
        <path
          d="M9 0h14a9 9 0 0 1 9 9v5H0V9a9 9 0 0 1 9-9Z"
          fill={`url(#${glowId})`}
        />
        <path
          d="M10.25 14.25a3.25 3.25 0 0 1-.15-6.5A5.75 5.75 0 0 1 21 8.9a2.75 2.75 0 1 1 .75 5.35h-11.5Z"
          fill="#071018"
        />
        <path
          d="M16 14.75v5.1m-2.5-2.1L16 20.3l2.5-2.55"
          stroke="#071018"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="7" y="21" width="18" height="5.5" rx="2" fill="#071018" />
        <circle cx="21.75" cy="23.75" r="1" fill="#6ee7b7" />
        <path
          d="M10.25 23.75h6.5"
          stroke="#6ee7b7"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark && (
        <span className={cn("font-bold tracking-tight", wordmarkClassName)}>
          LazyBackup
        </span>
      )}
    </span>
  )
}
