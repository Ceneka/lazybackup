"use client"

import { PageHeader, PageLayout } from "@/components/page-layout"
import { QueryState } from "@/components/ui/query-state"
import { useS3Profiles } from "@/lib/hooks/useS3Profiles"
import { CloudIcon, PlusIcon } from "lucide-react"
import Link from "next/link"

export default function S3ProfilesPage() {
  const query = useS3Profiles()

  return (
    <PageLayout>
      <PageHeader
        title="S3 Profiles"
        actions={
          <Link
            href="/s3-profiles/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Profile
          </Link>
        }
      />

      <QueryState
        query={query}
        dataLabel="S3 profiles"
        errorIcon={<CloudIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<CloudIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="No S3 profiles found"
      >
        {query.data && query.data.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {query.data.map((profile) => (
              <Link
                key={profile.id}
                href={`/s3-profiles/${profile.id}/edit`}
                className="group block rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center">
                    <CloudIcon className="mr-2 h-5 w-5 text-muted-foreground" />
                    <h3 className="font-medium">{profile.name}</h3>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p className="truncate">{profile.endpoint}</p>
                  <p>
                    Bucket: {profile.bucket}
                  </p>
                  <p>Region: {profile.region}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </PageLayout>
  )
}
