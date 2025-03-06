import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
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
  emptyIcon,
  errorIcon,
  showRetry = true,
  onRetry,
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
      <div className={cn("flex justify-center items-center py-12", className)}>
        <Loader2Icon className={`h-${spinnerSize} w-${spinnerSize} animate-spin text-muted-foreground`} />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
        {errorIcon || <div className="h-12 w-12 text-red-500 mb-4">{errorIcon}</div>}
        <h3 className="text-lg font-medium">Error loading data</h3>
        <p className="text-muted-foreground mt-2 mb-4">{error}</p>
        {showRetry && onRetry && (
          <Button onClick={onRetry} className="mt-2">
            <Loader2Icon className="mr-2 h-4 w-4" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  // Empty state
  if (isEmpty) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
        {emptyIcon || <div className="h-12 w-12 text-muted-foreground mb-4">{emptyIcon}</div>}
        <h3 className="text-lg font-medium">{emptyMessage}</h3>
      </div>
    )
  }

  // Content state
  return <>{children}</>
} 
