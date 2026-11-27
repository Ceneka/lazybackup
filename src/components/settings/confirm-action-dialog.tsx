"use client"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { useState, type ReactNode } from "react"

type ConfirmActionDialogProps = {
  title: string
  description?: ReactNode
  /** Confirm button label, e.g. "Remove password". */
  confirmLabel?: string
  /** Label while the async action is in flight. */
  pendingLabel?: string
  variant?: "default" | "destructive"
  /** Async action; the dialog stays open (and Cancel is disabled) until it settles. */
  onConfirm: () => void | Promise<void>
  /** Trigger element (rendered with asChild). Omit for controlled dialogs. */
  children?: ReactNode
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

/**
 * Styled confirmation dialog for non-delete destructive actions
 * (remove password, revoke token/peer, cancel invite, …).
 *
 * Unlike `DeleteConfirmationDialog` the confirm label is configurable and the
 * action can be async: the dialog stays open with a spinner until it settles,
 * and a rejection keeps it open so the caller can retry.
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel = "Confirm",
  pendingLabel = "Working…",
  variant = "default",
  onConfirm,
  children,
  disabled = false,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: ConfirmActionDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const handleOpenChange = (next: boolean) => {
    // Keep the dialog open while the action is running (Escape included).
    if (!next && pending) return
    setOpen(next)
  }

  const handleConfirm = () => {
    setPending(true)
    void (async () => {
      try {
        await onConfirm()
        setPending(false)
        setOpen(false)
      } catch {
        // Callers surface the error themselves; stay open for retry.
        setPending(false)
      }
    })()
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && children ? (
        <AlertDialogTrigger asChild disabled={disabled}>
          {children}
        </AlertDialogTrigger>
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <LoadingButton
            variant={variant}
            onClick={handleConfirm}
            isLoading={pending}
            loadingText={pendingLabel}
          >
            {confirmLabel}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
