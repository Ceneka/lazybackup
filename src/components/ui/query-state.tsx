import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import * as React from "react"

import { Button } from "./button"
import { DataState, DataStateProps } from "./data-state"

/**
 * Minimal structural type accepted by `QueryState`. A TanStack Query
 * `useQuery()` result satisfies it as-is; hand-built wrappers only need to
 * provide the fields they have.
 */
export interface QueryStateQuery<TData = unknown> {
  isLoading?: boolean
  isFetching?: boolean
  isError?: boolean
  error?: unknown
  data?: TData | null
  refetch?: () => unknown
}

export interface QueryStateProps<TData = unknown>
  extends Omit<DataStateProps, "isLoading" | "error" | "isEmpty" | "onRetry"> {
  /**
   * Query result from TanStack/React Query (or a compatible subset).
   */
  query: QueryStateQuery<TData>
  /**
   * Function to check if data is empty
   */
  isDataEmpty?: (data: TData) => boolean
  /**
   * Custom error message
   */
  errorMessage?: string
  /**
   * Error message transformer
   */
  transformError?: (error: unknown) => string
  /**
   * Label for the data type (e.g., "servers", "backups")
   */
  dataLabel?: string
}

/**
 * Handle loading, error, and empty states for a TanStack Query result.
 *
 * Behavior:
 * - Shows the full-page error only when there is no data yet.
 * - With stale data, renders a compact "Couldn't refresh" banner above the
 *   content instead of hiding it.
 * - Retry is disabled (and spins) while `isFetching`.
 * - `showChildrenWhenEmpty` keeps children such as pagination visible on an
 *   empty page (inherited from `DataState`).
 */
export function QueryState<TData = unknown>({
  query,
  isDataEmpty,
  errorMessage,
  transformError,
  dataLabel = "data",
  emptyMessage,
  children,
  ...props
}: QueryStateProps<TData>) {
  const hasData = query.data !== undefined && query.data !== null

  // Check if data is empty
  const isEmpty = React.useMemo(() => {
    if (!hasData) return false
    if (isDataEmpty) return isDataEmpty(query.data as TData)
    if (Array.isArray(query.data)) return query.data.length === 0
    return false
  }, [hasData, query.data, isDataEmpty])

  // Extract error message
  const errorMsg = React.useMemo(() => {
    if (errorMessage) return errorMessage
    if (!query.error) return null

    if (transformError) {
      return transformError(query.error)
    }

    if (query.error instanceof Error) {
      return query.error.message
    }

    if (typeof query.error === "string") {
      return query.error
    }

    return `Error loading ${dataLabel}`
  }, [query.error, errorMessage, transformError, dataLabel])

  const isFetching = Boolean(query.isFetching)
  const blockingError = Boolean(query.isError) && !hasData
  const staleError = Boolean(query.isError) && hasData

  return (
    <>
      {staleError ? (
        <RefreshErrorBanner
          message={errorMsg}
          isRetrying={isFetching}
          onRetry={query.refetch}
        />
      ) : null}
      <DataState
        isLoading={Boolean(query.isLoading) && !hasData}
        error={blockingError ? errorMsg : null}
        isRetrying={isFetching}
        isEmpty={isEmpty}
        emptyMessage={emptyMessage || `No ${dataLabel} found`}
        onRetry={query.refetch}
        {...props}
      >
        {children}
      </DataState>
    </>
  )
}

function RefreshErrorBanner({
  message,
  isRetrying,
  onRetry,
}: {
  message: string | null
  isRetrying: boolean
  onRetry?: () => unknown
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <AlertCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
      <span
        className="min-w-0 flex-1 truncate"
        title={message ? `Couldn't refresh: ${message}` : undefined}
        aria-live="polite"
      >
        Couldn&apos;t refresh
      </span>
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 border-amber-500/40 px-2 text-xs"
          disabled={isRetrying}
          onClick={() => void onRetry()}
        >
          {isRetrying ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          Retry
        </Button>
      ) : null}
    </div>
  )
}
