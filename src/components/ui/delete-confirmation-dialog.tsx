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
import React from "react"

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
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {children || (
          <Button variant="destructive" className={triggerButtonClassName}>
            <TrashIcon className="h-5 w-5 mr-2" />
            <span>{buttonText}</span>
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
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <LoadingButton 
            variant="destructive"
            onClick={onDelete}
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
