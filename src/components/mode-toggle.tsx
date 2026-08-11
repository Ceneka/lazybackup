"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

const themes = ["light", "dark", "system"] as const

type ThemeChoice = (typeof themes)[number]

function cycleTheme(current: string | undefined): ThemeChoice {
  const index = themes.indexOf((current as ThemeChoice) ?? "system")
  return themes[(index + 1) % themes.length]
}

export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const current = (mounted ? theme : "system") as ThemeChoice
  const next = cycleTheme(current)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-9 w-9 text-foreground/60 hover:text-foreground", className)}
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${current}. Switch to ${next}`}
      title={`Theme: ${current}`}
    >
      {/* Keep all three mounted to avoid icon swap thrashing the button's DOM. */}
      <SunIcon className={cn("h-4 w-4", current !== "light" && "hidden")} />
      <MoonIcon className={cn("h-4 w-4", current !== "dark" && "hidden")} />
      <MonitorIcon className={cn("h-4 w-4", current !== "system" && "hidden")} />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
