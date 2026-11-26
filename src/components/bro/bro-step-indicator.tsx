"use client"

import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type BroStepIndicatorProps = {
  current: number
  steps?: string[]
}

const DEFAULT_STEPS = ["Address", "Friend", "Send", "Done"]

export function BroStepIndicator({
  current,
  steps = DEFAULT_STEPS,
}: BroStepIndicatorProps) {
  return (
    <div className="space-y-2">
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((label, index) => {
          const done = index < current
          const active = index === current
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className="flex flex-1 items-center gap-2"
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-sm",
                  active ? "font-medium" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={cn(
                    "h-px flex-1",
                    done ? "bg-primary" : "bg-border"
                  )}
                />
              ) : null}
            </li>
          )
        })}
      </ol>

      <p className="text-xs text-muted-foreground sm:hidden">
        Step {Math.min(current + 1, steps.length)} of {steps.length} ·{" "}
        <span className="font-medium text-foreground">{steps[current]}</span>
      </p>
    </div>
  )
}
