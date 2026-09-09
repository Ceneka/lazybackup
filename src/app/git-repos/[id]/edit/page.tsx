"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { GitRepoForm } from "@/components/git-repo-form"
import { gitRepoKeys, useGitRepo, type GitRepoInput } from "@/lib/hooks/useGitRepos"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
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

  async function handleSubmit(data: GitRepoInput) {
    setSubmitting(true)
    try {
      const response = await fetch(`/api/git-repos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to update Git repository")
      }
      await queryClient.invalidateQueries({ queryKey: gitRepoKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: gitRepoKeys.detail(id) })
      toast.success("Git repository updated")
      router.push(`/git-repos/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update Git repository")
    } finally {
      setSubmitting(false)
    }
  }

  if (repoQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!repoQuery.data) {
    return (
      <div className="py-8 text-center">
        <h2 className="text-2xl font-bold">Git repository not found</h2>
        <p className="mt-2 mb-4 text-muted-foreground">
          The repository you&apos;re trying to edit doesn&apos;t exist or has been deleted.
        </p>
        <Link
          href="/connections?tab=git"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Back to Git repositories
        </Link>
      </div>
    )
  }

  const repo = repoQuery.data
  const initial: GitRepoInput = {
    name: repo.name,
    url: repo.url,
    sshKeyId: repo.sshKeyId,
  }

  return (
    <ResourceEditLayout
      backHref={`/git-repos/${id}`}
      backLabel="Back to Git repository"
      title="Edit Git repository"
    >
      <GitRepoForm
        initial={initial}
        submitting={submitting}
        submitLabel="Save Changes"
        cancelHref={`/git-repos/${id}`}
        testStoredRepo={async () => {
          const response = await fetch(`/api/git-repos/${id}/test`)
          const body = await response.json()
          if (!response.ok) {
            throw new Error(body.error || "Git connection failed")
          }
        }}
        onSubmit={handleSubmit}
      />
    </ResourceEditLayout>
  )
}
