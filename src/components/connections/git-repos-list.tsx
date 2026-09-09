"use client"

import { ResourceListCard } from "@/components/resource-list-card"
import { gitOverflowItems } from "@/components/resource-overflow"
import { Button } from "@/components/ui/button"
import { QueryState } from "@/components/ui/query-state"
import { useDeleteGitRepo, useGitRepos } from "@/lib/hooks/useGitRepos"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { GitBranchIcon, PlusIcon } from "lucide-react"
import Link from "next/link"

export function ConnectionsGitReposList() {
  const query = useGitRepos()
  const actions = useResourceQuickActions()
  const deleteRepo = useDeleteGitRepo()

  return (
    <QueryState
      query={query}
      dataLabel="Git repositories"
      errorIcon={<GitBranchIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<GitBranchIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="No Git repositories found"
      emptyDescription="Add a remote to clone as a bare mirror on each backup run."
      emptyAction={
        <Button asChild>
          <Link href="/git-repos/new">
            <PlusIcon className="h-4 w-4" />
            Add your first Git repository
          </Link>
        </Button>
      }
    >
      {query.data && query.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {query.data.map((repo) => (
            <ResourceListCard
              key={repo.id}
              href={`/git-repos/${repo.id}`}
              editHref={`/git-repos/${repo.id}/edit`}
              icon={GitBranchIcon}
              title={repo.name}
              overflow={gitOverflowItems({
                id: repo.id,
                name: repo.name,
                actions,
                onDelete: () => deleteRepo.mutate(repo.id),
                isDeleting: deleteRepo.isPending && deleteRepo.variables === repo.id,
              })}
              flash={actions.flashFor(`git:${repo.id}`)}
            >
              <p className="truncate font-mono text-xs">{repo.url}</p>
              <p>{repo.sshKey?.name ? `SSH key: ${repo.sshKey.name}` : "HTTPS (no SSH key)"}</p>
            </ResourceListCard>
          ))}
        </div>
      )}
    </QueryState>
  )
}
