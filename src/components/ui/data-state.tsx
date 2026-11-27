import { cn } from "@/lib/utils"
import { AlertCircleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { Button } from "./button"

export interface DataStateProps {
  /**
   * Whether the data is loading
   */
  isLoading?: boolean
  /**
   * Error message if there is an error
   */
  error?: string | null
  /**
   * Whether to show the empty state
   */
  isEmpty?: boolean
  /**
   * Message to show when there is no data
   */
  emptyMessage?: string
  /**
   * Optional body copy under the empty heading
   */
  emptyDescription?: React.ReactNode
  /**
   * Optional CTA rendered under the empty copy (links, buttons)
   */
  emptyAction?: React.ReactNode
  /**
   * Icon to show in the empty state
   */
  emptyIcon?: React.ReactNode
  /**
   * Icon to show in the error state
   */
  errorIcon?: React.ReactNode
  /**
   * Whether to show a retry button in the error state
   */
  showRetry?: boolean
  /**
   * Function to call when the retry button is clicked
   */
  onRetry?: () => void
  /**
   * Whether a retry request is currently in flight (spinner + disabled Retry).
   */
  isRetrying?: boolean
  /**
   * Also render `children` below the empty state. Useful when controls such as
   * pagination must stay visible on an empty page.
   */
  showChildrenWhenEmpty?: boolean
  /**
   * Custom loading component or element
   */
  loadingComponent?: React.ReactNode
  /**
   * Additional class names for the container
   */
  className?: string
  /**
   * Custom loading spinner size
   */
  spinnerSize?: number
  /**
   * Children to render when not in loading, error, or empty state
   */
  children: React.ReactNode
}

/**
 * A component to handle loading, error, and empty states consistently
 */
export function DataState({
  isLoading = false,
  error = null,
  isEmpty = false,
  emptyMessage = "No data found",
  emptyDescription,
  emptyAction,
  emptyIcon,
  errorIcon,
  showRetry = true,
  onRetry,
  isRetrying = false,
  showChildrenWhenEmpty = false,
  loadingComponent,
  className,
  spinnerSize = 8,
  children,
}: DataStateProps) {
  // Loading state
  if (isLoading) {
    if (loadingComponent) {
      return <div className={cn("py-8", className)}>{loadingComponent}</div>
    }
    
    return (
      <div
        className={cn("flex justify-center items-center py-12", className)}
        role="status"
        aria-live="polite"
      >
        <Loader2Icon
          className={`h-${spinnerSize} w-${spinnerSize} animate-spin text-muted-foreground`}
          aria-hidden
        />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
        {errorIcon ?? (
          <AlertCircleIcon className="mb-4 h-12 w-12 text-destructive" aria-hidden />
        )}
        <h3 className="text-lg font-medium">Error loading data</h3>
        <p className="text-muted-foreground mt-2 mb-4">{error}</p>
        {showRetry && onRetry && (
          <Button onClick={onRetry} className="mt-2" disabled={isRetrying}>
            {isRetrying ? (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCwIcon className="mr-2 h-4 w-4" aria-hidden />
            )}
            {isRetrying ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
    )
  }

  // Empty state
  if (isEmpty) {
    const emptyState = (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
        {emptyIcon ? <div className="mb-4">{emptyIcon}</div> : null}
        <h3 className="text-lg font-medium">{emptyMessage}</h3>
        {emptyDescription ? (
          <div className="mt-2 max-w-md text-sm text-muted-foreground">{emptyDescription}</div>
        ) : null}
        {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
      </div>
    )

    if (!showChildrenWhenEmpty) return emptyState

    return (
      <>
        {emptyState}
        {children}
      </>
    )
  }

  // Content state
  return <>{children}</>
} 
