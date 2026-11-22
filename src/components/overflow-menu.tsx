"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { flashClassName } from "@/lib/resource-actions"
import { cn } from "@/lib/utils"
import { MoreHorizontalIcon, type LucideIcon } from "lucide-react"
import Link from "next/link"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

export type OverflowItem =
  | {
      type: "link"
      href: string
      label: string
      icon?: LucideIcon
    }
  | {
      type: "action"
      label: string
      icon?: LucideIcon
      onSelect: () => void
      disabled?: boolean
    }
  | {
      type: "delete"
      label?: string
      title: string
      description: string
      onDelete: () => void
      isDeleting: boolean
    }
  | { type: "separator" }

const itemClassName =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 4
const MENU_MIN_WIDTH = 176

type MenuPosition = {
  top?: number
  bottom?: number
  left?: number
  right?: number
  maxHeight: number
}

type HorizontalPosition = { left?: number; right?: number }
type VerticalPosition = { top?: number; bottom?: number; maxHeight: number }

function horizontalPosition(
  rect: DOMRect,
  align: "start" | "end"
): HorizontalPosition {
  if (align === "end") {
    return {
      right: Math.max(
        VIEWPORT_MARGIN,
        Math.min(
          window.innerWidth - rect.right,
          window.innerWidth - VIEWPORT_MARGIN - MENU_MIN_WIDTH
        )
      ),
    }
  }
  return {
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN - MENU_MIN_WIDTH)
    ),
  }
}

function verticalPosition(
  rect: DOMRect,
  placeAbove: boolean,
  maxHeight: number
): VerticalPosition {
  if (placeAbove) {
    return {
      bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + TRIGGER_GAP),
      maxHeight,
    }
  }
  return { top: rect.bottom + TRIGGER_GAP, maxHeight }
}

function estimatePosition(
  trigger: HTMLButtonElement,
  align: "start" | "end"
): MenuPosition {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - TRIGGER_GAP
  const spaceAbove = rect.top - VIEWPORT_MARGIN - TRIGGER_GAP
  // Prefer opening below, but flip up when the trigger sits near the bottom.
  const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
  return {
    ...horizontalPosition(rect, align),
    ...verticalPosition(
      rect,
      placeAbove,
      Math.max(120, placeAbove ? spaceAbove : spaceBelow)
    ),
  }
}

function getMenuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
  )
}

export function OverflowMenu({
  items,
  align = "end",
  flash,
}: {
  items: OverflowItem[]
  align?: "start" | "end"
  flash?: "success" | "failed" | null
}) {
  const [open, setOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Extract<OverflowItem, { type: "delete" }> | null>(
    null
  )
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  function closeAndFocusTrigger() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  /**
   * Measure the rendered menu and place it below the trigger, flipping above
   * when there is not enough room below. `maxHeight` keeps the panel inside the
   * viewport with internal scrolling for long item lists.
   */
  function positionMenu(focusFirstItem: boolean) {
    const menuEl = menuRef.current
    const trigger = triggerRef.current
    if (!menuEl || !trigger) return

    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - TRIGGER_GAP
    const spaceAbove = rect.top - VIEWPORT_MARGIN - TRIGGER_GAP
    const contentHeight = menuEl.scrollHeight
    const placeAbove = contentHeight > spaceBelow && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow)

    setPosition({
      ...horizontalPosition(rect, align),
      ...verticalPosition(rect, placeAbove, maxHeight),
    })

    if (focusFirstItem) {
      getMenuItems(menuEl)[0]?.focus({ preventScroll: true })
    }
  }

  // After the portal mounts, refine the estimated position with the real menu
  // height and move focus into the menu.
  useLayoutEffect(() => {
    if (open) positionMenu(true)
    // positionMenu is stable enough for this open/close lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align])

  useEffect(() => {
    if (!open) return

    function onDocMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeAndFocusTrigger()
    }

    function onScroll(event: Event) {
      // Scrolling inside the panel is expected (long lists) — only page-level
      // scroll dismisses the menu.
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    function onResize() {
      positionMenu(false)
    }

    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onDocKeyDown)
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onDocKeyDown)
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align])

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const menuEl = menuRef.current
    if (!menuEl) return

    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      closeAndFocusTrigger()
      return
    }

    const items = getMenuItems(menuEl)
    if (items.length === 0) return
    const active = document.activeElement as HTMLElement | null
    const index = active ? items.indexOf(active) : -1

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault()
        const next = index < 0 ? 0 : (index + 1) % items.length
        items[next]?.focus()
        break
      }
      case "ArrowUp": {
        event.preventDefault()
        const previous = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
        items[previous]?.focus()
        break
      }
      case "Home":
        event.preventDefault()
        items[0]?.focus()
        break
      case "End":
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
      default:
        break
    }
  }

  const menu =
    open && position ? (
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        style={{
          position: "fixed",
          ...position,
          maxWidth: "calc(100vw - 1rem)",
        }}
        className="z-50 min-w-44 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        onKeyDown={handleMenuKeyDown}
      >
        {items.map((item, index) => {
          if (item.type === "separator") {
            return <div key={`sep-${index}`} className="my-1 h-px bg-border" role="separator" />
          }
          if (item.type === "link") {
            const Icon = item.icon
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                className={itemClassName}
                onClick={() => setOpen(false)}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                {item.label}
              </Link>
            )
          }
          if (item.type === "delete") {
            return (
              <button
                key={`delete-${item.title}`}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cn(itemClassName, "text-destructive hover:text-destructive")}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(false)
                  setDeleteItem(item)
                }}
              >
                {item.label ?? "Delete"}
              </button>
            )
          }
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={itemClassName}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {item.label}
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          flashClassName(flash)
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="More actions"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (open) {
            setOpen(false)
            return
          }
          if (triggerRef.current) {
            setPosition(estimatePosition(triggerRef.current, align))
          }
          setOpen(true)
        }}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
        <span className="sr-only">More actions</span>
      </button>
      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
      {deleteItem ? (
        <DeleteConfirmationDialog
          title={deleteItem.title}
          description={deleteItem.description}
          isDeleting={deleteItem.isDeleting}
          onDelete={deleteItem.onDelete}
          hideTrigger
          open
          onOpenChange={(next) => {
            if (!next) setDeleteItem(null)
          }}
        />
      ) : null}
    </div>
  )
}
