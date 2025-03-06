import * as React from "react"
import { DataState, DataStateProps } from "./data-state"

interface QueryStateProps extends Omit<DataStateProps, 'isLoading' | 'error' | 'isEmpty' | 'onRetry'> {
  /**
   * Query result from TanStack/React Query
   */
  query: {
    isLoading?: boolean
    isError?: boolean
    error?: any
    data?: any | null
    refetch?: () => void
  }
  /**
   * Function to check if data is empty
   */
  isDataEmpty?: (data: any) => boolean
  /**
   * Custom error message
   */
  errorMessage?: string
  /**
   * Error message transformer
   */
  transformError?: (error: any) => string
  /**
   * Label for the data type (e.g., "servers", "backups")
   */
  dataLabel?: string
}

/**
 * A component to handle loading, error, and empty states for TanStack Query results
 */
export function QueryState({
  query,
  isDataEmpty,
  errorMessage,
  transformError,
  dataLabel = "data",
  emptyMessage,
  children,
  ...props
}: QueryStateProps) {
  // Check if data is empty
  const isEmpty = React.useMemo(() => {
    if (!query.data) return false
    if (isDataEmpty) return isDataEmpty(query.data)
    if (Array.isArray(query.data)) return query.data.length === 0
    return false
  }, [query.data, isDataEmpty])

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
    
    if (typeof query.error === 'string') {
      return query.error
    }
    
    return `Error loading ${dataLabel}`
  }, [query.error, errorMessage, transformError, dataLabel])

  return (
    <DataState
      isLoading={query.isLoading}
      error={query.isError ? errorMsg : null}
      isEmpty={isEmpty}
      emptyMessage={emptyMessage || `No ${dataLabel} found`}
      onRetry={query.refetch}
      {...props}
    >
      {children}
    </DataState>
  )
} 
