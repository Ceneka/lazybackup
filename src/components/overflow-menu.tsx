"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { flashClassName } from "@/lib/resource-actions"
import { cn } from "@/lib/utils"
import { MoreHorizontalIcon, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
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
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"

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
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(
    null
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  function placeMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    if (align === "end") {
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    } else {
      setCoords({ top: rect.bottom + 4, left: rect.left })
    }
  }

  useEffect(() => {
    if (!open) return
    placeMenu()
    function onDoc(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    function onReposition() {
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open])

  const menu =
    open && coords ? (
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          right: coords.right,
        }}
        className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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
          placeMenu()
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
