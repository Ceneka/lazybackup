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
import { detailActionDestructiveClassName } from "@/components/ui/detail-actions"
import { LoadingButton } from "@/components/ui/loading-button"
import { TrashIcon } from "lucide-react"
import React, { useRef, useState } from "react"

interface DeleteConfirmationDialogProps {
  title?: string
  description?: string
  onDelete: () => void
  isDeleting: boolean
  buttonText?: string
  triggerButtonClassName?: string
  children?: React.ReactNode
}

export function DeleteConfirmationDialog({
  title = "Are you absolutely sure?",
  description = "This action cannot be undone.",
  onDelete,
  isDeleting,
  buttonText = "Delete",
  triggerButtonClassName = detailActionDestructiveClassName,
  children,
}: DeleteConfirmationDialogProps) {
  const [open, setOpen] = useState(false)
  const deleteAfterClose = useRef(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
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
