"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { GitRepoForm } from "@/components/git-repo-form"
import { DataState } from "@/components/ui/data-state"
import { ApiError, readApiError } from "@/lib/api/client-error"
import { gitRepoKeys, useGitRepo, type GitRepoInput } from "@/lib/hooks/useGitRepos"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export default function EditGitRepoPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const queryClient = useQueryClient()
  const repoQuery = useGitRepo(id)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const notFound =
    repoQuery.isError &&
    repoQuery.error instanceof ApiError &&
    repoQuery.error.status === 404
  const fetchError =
    repoQuery.isError && !notFound
      ? repoQuery.error instanceof Error
        ? repoQuery.error.message
        : "Failed to fetch Git repository"
      : null

  async function handleSubmit(data: GitRepoInput) {
    setSubmitting(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const response = await fetch(`/api/git-repos/${id}`, {
        method: "PUT",
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
      await queryClient.invalidateQueries({ queryKey: gitRepoKeys.detail(id) })
      toast.success("Git repository updated")
      router.push(`/git-repos/${id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update Git repository")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResourceEditLayout
      backHref={`/git-repos/${id}`}
      backLabel="Back to Git repository"
      title="Edit Git repository"
    >
      <DataState
        isLoading={repoQuery.isLoading}
        error={fetchError}
        isEmpty={notFound}
        emptyMessage="Git repository not found"
        emptyDescription="The repository you're trying to edit doesn't exist or has been deleted."
        emptyAction={
          <Link
            href="/connections?tab=git"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to Git repositories
          </Link>
        }
        onRetry={() => void repoQuery.refetch()}
        isRetrying={repoQuery.isFetching}
      >
        {repoQuery.data ? (
          <GitRepoForm
            initial={{
              name: repoQuery.data.name,
              url: repoQuery.data.url,
              sshKeyId: repoQuery.data.sshKeyId,
            }}
            submitting={submitting}
            submitLabel="Save changes"
            cancelHref={`/git-repos/${id}`}
            formError={formError}
            fieldErrors={fieldErrors}
            testStoredRepo={async () => {
              const response = await fetch(`/api/git-repos/${id}/test`)
              if (!response.ok) {
                const { message, fieldErrors } = await readApiError(response)
                throw new ApiError(message, {
                  status: response.status,
                  fieldErrors,
                })
              }
            }}
            onSubmit={handleSubmit}
          />
        ) : null}
      </DataState>
    </ResourceEditLayout>
  )
}
