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
  triggerButtonClassName?: string
  children?: React.ReactNode
}

export function DeleteConfirmationDialog({
  title = "Are you absolutely sure?",
  description = "This action cannot be undone.",
  onDelete,
  isDeleting,
  buttonText = "Delete",
  triggerButtonClassName = "cursor-pointer flex w-full items-center space-x-2 p-3 rounded-md bg-destructive/10 text-destructive-foreground hover:bg-destructive/20 transition-colors",
  children,
}: DeleteConfirmationDialogProps) {
  const [open, setOpen] = useState(false)
  const deleteAfterClose = useRef(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next && deleteAfterClose.current) {
      deleteAfterClose.current = false
      onDelete()
    }
  }

  const handleConfirmDelete = () => {
    deleteAfterClose.current = true
    setOpen(false)
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
            <TrashIcon className="h-5 w-5 mr-2" />
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
