"use client"

import { CopyIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { copyText } from "@/lib/clipboard"

export type ManualCopyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  text: string
}

/**
 * Last-resort copy surface for browsers that block both `navigator.clipboard`
 * and `execCommand("copy")`. The text is selected so the user only has to press
 * Ctrl/Cmd+C.
 */
export function ManualCopyDialog({
  open,
  onOpenChange,
  title = "Copy invite",
  text,
}: ManualCopyDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }, 50)
    return () => window.clearTimeout(id)
  }, [open, text])

  const selectAll = () => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }

  const retry = async () => {
    setRetrying(true)
    try {
      const ok = await copyText(text)
      if (ok) {
        toast.success("Copied")
        onOpenChange(false)
      } else {
        selectAll()
        toast.error("Copy is still blocked. Select the text and press Ctrl/Cmd+C.")
      }
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Your browser blocked automatic copying. The text is selected — press
            Ctrl/Cmd+C, or use the button below.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          ref={textareaRef}
          readOnly
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-[180px] font-mono text-xs leading-relaxed"
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={selectAll}>
            Select all
          </Button>
          <LoadingButton
            type="button"
            isLoading={retrying}
            loadingText="Trying…"
            onClick={() => void retry()}
          >
            <CopyIcon className="h-4 w-4" />
            Try again
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
