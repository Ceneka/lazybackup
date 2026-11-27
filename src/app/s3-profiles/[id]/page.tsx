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
import { s3ProfileKeys, useDeleteS3Profile, useS3Profile } from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import { CableIcon, CloudIcon, FolderPlusIcon, PencilIcon } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function S3ProfilePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()
  const query = useS3Profile(id)
  const deleteProfile = useDeleteS3Profile()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestOutcome | null>(null)
  const [deleteBlockers, setDeleteBlockers] = useState<UsedByBackup[] | null>(null)

  useEffect(() => {
    if (query.error?.message === "S3 profile not found") {
      toast.error("S3 profile not found")
      router.push("/connections?tab=s3")
    }
  }, [query.error, router])

  const usedByBackups = query.data?.usedByBackups ?? []

  async function handleTest() {
    if (!query.data) return
    setTesting(true)
    setTestResult(null)
    const testedLabel = `Saved profile · ${query.data.name}`
    try {
      const response = await fetch(`/api/s3-profiles/${query.data.id}/test`)
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
        message: body.message || body.error || "S3 connection OK",
        testedAt: Date.now(),
        testedLabel,
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "S3 connection failed",
        testedAt: Date.now(),
        testedLabel,
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = () => {
    setDeleteBlockers(null)
    deleteProfile.mutate(id, {
      onSuccess: () => {
        router.push("/connections?tab=s3")
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
          queryClient.invalidateQueries({ queryKey: s3ProfileKeys.detail(id) })
        }
      },
    })
  }

  return (
    <QueryState
      query={query}
      dataLabel="S3 profile"
      errorIcon={<CloudIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<CloudIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="S3 profile not found"
      isDataEmpty={(data) => !data}
    >
      {query.data ? (
        <ResourceDetailLayout
          backHref="/connections?tab=s3"
          backLabel="Back to S3 profiles"
          title={query.data.name}
          detailsTitle="S3 details"
          details={
            <DetailFields>
              <DetailField label="Endpoint" mono>{query.data.endpoint}</DetailField>
              <DetailField label="Bucket">{query.data.bucket}</DetailField>
              <DetailField label="Region">{query.data.region}</DetailField>
              <DetailField label="Access Key ID" mono>{query.data.accessKeyId}</DetailField>
              <DetailField label="Path-style URLs">
                {query.data.forcePathStyle !== false ? "On" : "Off"}
              </DetailField>
            </DetailFields>
          }
          actions={
            <DetailActions>
              <DetailActionLink href={`/s3-profiles/${id}/edit`} variant="secondary">
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
              <DetailActionLink href={`/backups/new?s3ProfileId=${query.data.id}`}>
                <FolderPlusIcon />
                Create backup
              </DetailActionLink>
              <DetailActionsDivider />
              <DeleteConfirmationDialog
                title="Delete this S3 profile?"
                description={
                  usedByBackups.length > 0
                    ? "This profile is still referenced by backup configurations. Delete will be blocked until those backups are removed or reassigned."
                    : "This will permanently delete this S3 profile. This action cannot be undone."
                }
                onDelete={handleDelete}
                isDeleting={deleteProfile.isPending}
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
            description="Backup configurations that use this profile as a source or destination."
            backups={usedByBackups}
          />
        </ResourceDetailLayout>
      ) : null}
    </QueryState>
  )
}
