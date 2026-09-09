"use client"

import { ResourceListCard } from "@/components/resource-list-card"
import { s3OverflowItems } from "@/components/resource-overflow"
import { Button } from "@/components/ui/button"
import { QueryState } from "@/components/ui/query-state"
import { useDeleteS3Profile, useS3Profiles } from "@/lib/hooks/useS3Profiles"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { CloudIcon, PlusIcon } from "lucide-react"
import Link from "next/link"

export function ConnectionsS3ProfilesList() {
  const query = useS3Profiles()
  const actions = useResourceQuickActions()
  const deleteProfile = useDeleteS3Profile()

  return (
    <QueryState
      query={query}
      dataLabel="S3 profiles"
      errorIcon={<CloudIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<CloudIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="No S3 profiles found"
      emptyDescription="Add a MinIO, R2, B2, or AWS-compatible profile to use as a backup source or destination."
      emptyAction={
        <Button asChild>
          <Link href="/s3-profiles/new">
            <PlusIcon className="h-4 w-4" />
            Add your first S3 profile
          </Link>
        </Button>
      }
    >
      {query.data && query.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {query.data.map((profile) => (
            <ResourceListCard
              key={profile.id}
              href={`/s3-profiles/${profile.id}`}
              editHref={`/s3-profiles/${profile.id}/edit`}
              icon={CloudIcon}
              title={profile.name}
              overflow={s3OverflowItems({
                id: profile.id,
                name: profile.name,
                actions,
                onDelete: () => deleteProfile.mutate(profile.id),
                isDeleting: deleteProfile.isPending && deleteProfile.variables === profile.id,
              })}
              flash={actions.flashFor(`s3:${profile.id}`)}
            >
              <p className="truncate">{profile.endpoint}</p>
              <p>Bucket: {profile.bucket}</p>
              <p>Region: {profile.region}</p>
            </ResourceListCard>
          ))}
        </div>
      )}
    </QueryState>
  )
}
