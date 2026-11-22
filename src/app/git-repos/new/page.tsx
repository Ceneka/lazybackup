"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { GitRepoForm } from "@/components/git-repo-form"
import { readApiError } from "@/lib/api/client-error"
import { gitRepoKeys, type GitRepoInput } from "@/lib/hooks/useGitRepos"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

const empty: GitRepoInput = {
  name: "",
  url: "",
  sshKeyId: null,
}

export default function NewGitRepoPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(data: GitRepoInput) {
    setSubmitting(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const response = await fetch("/api/git-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        setFormError(message)
        setFieldErrors(fieldErrors)
        return
      }
      await queryClient.invalidateQueries({ queryKey: gitRepoKeys.lists() })
      toast.success("Git repository added")
      router.push("/connections?tab=git")
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create Git repository")
      toast.error(err instanceof Error ? err.message : "Failed to create Git repository")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResourceEditLayout
      backHref="/connections?tab=git"
      backLabel="Back to Git repositories"
      title="Add Git repository"
    >
      <GitRepoForm
        initial={empty}
        submitting={submitting}
        submitLabel="Add repository"
        cancelHref="/connections?tab=git"
        formError={formError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
      />
    </ResourceEditLayout>
  )
}
