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
  onDelete: () => void
  isDeleting: boolean
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
  isDeleting,
  buttonText = "Delete",
  triggerButtonClassName,
  children,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: DeleteConfirmationDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen
  const deleteAfterClose = useRef(false)

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
    if (!next && deleteAfterClose.current) {
      deleteAfterClose.current = false
      // Run after close so Radix can unlock pointer-events before route changes.
      onDelete()
    }
  }

  const handleConfirmDelete = () => {
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
              disabled={isDeleting}
            >
              <TrashIcon className="h-4 w-4" />
              <span>{isDeleting ? "Deleting..." : buttonText}</span>
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
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <LoadingButton 
            variant="destructive"
            onClick={handleConfirmDelete}
            isLoading={isDeleting}
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
