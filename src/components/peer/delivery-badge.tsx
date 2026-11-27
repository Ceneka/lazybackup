"use client"

import { Badge } from "@/components/ui/badge"
import {
  deliveryBadgeCopy,
  type DeliveryState,
} from "@/lib/backup/delivery-state"
import { cn } from "@/lib/utils"

const TONE_CLASS: Record<string, string> = {
  success: "bg-green-500 hover:bg-green-500",
  warning: "bg-amber-500 hover:bg-amber-500",
  error: "bg-red-500 hover:bg-red-500",
}

/**
 * Composite delivery badge for Bro Space runs. Waiting is amber (saved here,
 * not yet off-site), stored is green, failed is red with the friend's reason.
 */
export function DeliveryBadge({
  state,
  friendName,
  error,
  className,
}: {
  state: DeliveryState
  friendName: string
  error?: string | null
  className?: string
}) {
  const copy = deliveryBadgeCopy({ state, friendName, error })
  if (!copy) return null

  return (
    <Badge
      className={cn(TONE_CLASS[copy.tone], "cursor-help", className)}
      title={copy.title}
    >
      {copy.label}
    </Badge>
  )
}
