"use client"

import {
  ConnectionTestResultPanel,
  type ConnectionTestOutcome,
} from "@/components/connections/connection-test-result"
import {
  DetailField,
  DetailFields,
  ResourceDetailLayout,
} from "@/components/resource-detail-layout"
import { InUseBlockers, UsedByBackupsCard, type UsedByBackup } from "@/components/used-by-backups"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
  detailActionDestructiveClassName,
  detailActionGhostClassName,
} from "@/components/ui/detail-actions"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { readApiError } from "@/lib/api/client-error"
import { isResourceInUseError } from "@/lib/api/resource-in-use"
import { gitRepoKeys, useDeleteGitRepo, useGitRepo } from "@/lib/hooks/useGitRepos"
import { useQueryClient } from "@tanstack/react-query"
import { CableIcon, FolderPlusIcon, GitBranchIcon, PencilIcon } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function GitRepoPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()
  const query = useGitRepo(id)
  const deleteRepo = useDeleteGitRepo()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestOutcome | null>(null)
  const [deleteBlockers, setDeleteBlockers] = useState<UsedByBackup[] | null>(null)

  useEffect(() => {
    if (query.error?.message === "Git repository not found") {
      toast.error("Git repository not found")
      router.push("/connections?tab=git")
    }
  }, [query.error, router])

  const usedByBackups = query.data?.usedByBackups ?? []

  async function handleTest() {
    if (!query.data) return
    setTesting(true)
    setTestResult(null)
    const testedLabel = `Saved repository · ${query.data.name}`
    try {
      const response = await fetch(`/api/git-repos/${query.data.id}/test`)
      if (!response.ok) {
        const { message } = await readApiError(response)
        setTestResult({
          success: false,
          message,
          testedAt: Date.now(),
          testedLabel,
        })
        return
      }
      const body = (await response.json()) as {
        success?: boolean
        message?: string
        error?: string
      }
      setTestResult({
        success: body.success !== false,
        message: body.message || body.error || "Git connection OK",
        testedAt: Date.now(),
        testedLabel,
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Git connection failed",
        testedAt: Date.now(),
        testedLabel,
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = () => {
    setDeleteBlockers(null)
    deleteRepo.mutate(id, {
      onSuccess: () => {
        router.push("/connections?tab=git")
      },
      onError: (error) => {
        if (isResourceInUseError(error)) {
          setDeleteBlockers(
            error.resources.map((resource) => ({
              id: resource.id,
              name: resource.name,
              roles: (resource.roles as UsedByBackup["roles"]) || ["source"],
            }))
          )
          queryClient.invalidateQueries({ queryKey: gitRepoKeys.detail(id) })
        }
      },
    })
  }

  return (
    <QueryState
      query={query}
      dataLabel="Git repository"
      errorIcon={<GitBranchIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<GitBranchIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="Git repository not found"
      isDataEmpty={(data) => !data}
    >
      {query.data ? (
        <ResourceDetailLayout
          backHref="/connections?tab=git"
          backLabel="Back to Git repositories"
          title={query.data.name}
          detailsTitle="Git details"
          details={
            <DetailFields>
              <DetailField label="URL" mono>{query.data.url}</DetailField>
              <DetailField label="SSH key">
                {query.data.sshKey?.name ||
                  (query.data.sshKeyId ? "Unknown key" : "None")}
              </DetailField>
            </DetailFields>
          }
          actions={
            <DetailActions>
              <DetailActionLink href={`/git-repos/${id}/edit`} variant="secondary">
                <PencilIcon />
                Edit
              </DetailActionLink>
              <LoadingButton
                type="button"
                variant="ghost"
                isLoading={testing}
                loadingText="Testing…"
                className={detailActionGhostClassName}
                onClick={() => void handleTest()}
              >
                <CableIcon />
                Test connection
              </LoadingButton>
              <DetailActionLink href={`/backups/new?gitRepoId=${id}`}>
                <FolderPlusIcon />
                Create backup
              </DetailActionLink>
              <DetailActionsDivider />
              <DeleteConfirmationDialog
                title="Delete this Git repository?"
                description={
                  usedByBackups.length > 0
                    ? "This repository is still referenced by backup configurations. Delete will be blocked until those backups are removed or reassigned."
                    : "This will permanently delete this Git repository. This action cannot be undone."
                }
                onDelete={handleDelete}
                isDeleting={deleteRepo.isPending}
                buttonText="Delete"
                triggerButtonClassName={detailActionDestructiveClassName}
              />
            </DetailActions>
          }
          actionsExtra={
            testResult || deleteBlockers?.length ? (
              <div className="mt-3 space-y-3">
                {testResult ? (
                  <ConnectionTestResultPanel
                    result={testResult}
                    onRetry={() => void handleTest()}
                    retrying={testing}
                  />
                ) : null}
                <InUseBlockers blockers={deleteBlockers} />
              </div>
            ) : null
          }
        >
          <UsedByBackupsCard
            description="Backup configurations that use this repository as a source."
            backups={usedByBackups}
          />
        </ResourceDetailLayout>
      ) : null}
    </QueryState>
  )
}
