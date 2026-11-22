"use client"

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { TrashIcon } from "lucide-react"
import React, { useRef, useState } from "react"

interface DeleteConfirmationDialogProps {
  title?: string
  description?: string
  /**
   * Legacy synchronous delete. Runs after the dialog closes.
   * Pair with `isDeleting` from the mutation.
   */
  onDelete?: () => void
  /**
   * Async confirm. While the promise is pending the dialog stays open and the
   * confirm button shows a spinner; a rejection keeps the dialog open so the
   * user can retry or cancel. Takes precedence over `onDelete`.
   */
  onConfirm?: () => void | Promise<void>
  isDeleting?: boolean
  /**
   * External pending state (e.g. `mutation.isPending`). While true the dialog
   * stays open with a spinner. Pair it with a parent that closes the dialog
   * when the mutation settles (`open`/`onOpenChange`).
   */
  isPending?: boolean
  buttonText?: string
  /** Override trigger styles (e.g. detailActionDestructiveClassName in action tile grids). */
  triggerButtonClassName?: string
  children?: React.ReactNode
  /** Controlled open (e.g. overflow menus). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Skip the default trigger — pair with controlled `open`. */
  hideTrigger?: boolean
}

export function DeleteConfirmationDialog({
  title = "Are you absolutely sure?",
  description = "This action cannot be undone.",
  onDelete,
  onConfirm,
  isDeleting = false,
  isPending,
  buttonText = "Delete",
  triggerButtonClassName,
  children,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: DeleteConfirmationDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen
  const busy = Boolean(isPending) || isDeleting || confirming
  const deleteAfterClose = useRef(false)
  const allowClose = useRef(false)

  const handleOpenChange = (next: boolean) => {
    // Keep the dialog open while a delete is in flight (Escape/cancel included).
    if (!next && busy && !allowClose.current) return
    allowClose.current = false
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
    if (!next && deleteAfterClose.current) {
      deleteAfterClose.current = false
      // Run after close so Radix can unlock pointer-events before route changes.
      onDelete?.()
    }
  }

  const handleConfirmDelete = () => {
    if (onConfirm) {
      setConfirming(true)
      void (async () => {
        try {
          await onConfirm()
          allowClose.current = true
          setConfirming(false)
          handleOpenChange(false)
        } catch {
          // Stay open so the user can retry or cancel. Callers that need a
          // message should surface it themselves (toast/inline).
          setConfirming(false)
        }
      })()
      return
    }

    if (isPending !== undefined) {
      // The parent owns the pending lifecycle (e.g. a mutation) and closes the
      // dialog when it settles. Fire the action immediately and keep it open.
      onDelete?.()
      return
    }

    // Controlled `setOpen(false)` alone does not fire Radix `onOpenChange`,
    // so go through handleOpenChange or onDelete never runs.
    deleteAfterClose.current = true
    handleOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : (
        <AlertDialogTrigger asChild>
          {children || (
            <Button
              variant="destructive"
              className={triggerButtonClassName}
              disabled={busy}
            >
              <TrashIcon className="h-4 w-4" />
              <span>{busy ? "Deleting..." : buttonText}</span>
            </Button>
          )}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <LoadingButton 
            variant="destructive"
            onClick={handleConfirmDelete}
            isLoading={busy}
            loadingText="Deleting..."
            className="bg-red-500 hover:bg-red-600"
          >
            Delete
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
