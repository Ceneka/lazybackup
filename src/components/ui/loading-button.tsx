import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import * as React from "react"
import { Button } from "./button"

export interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Whether the button is in a loading state
   */
  isLoading?: boolean
  /**
   * The text to display when the button is loading
   */
  loadingText?: string
  /**
   * The icon to display when the button is loading
   */
  loadingIcon?: React.ReactNode
  /**
   * Whether to hide the button text when loading
   */
  hideTextWhenLoading?: boolean
  /**
   * Button variant
   */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  /**
   * Button size
   */
  size?: "default" | "sm" | "lg" | "icon"
}

/**
 * A button component that shows a loading spinner
 */
export function LoadingButton({
  isLoading = false,
  loadingText,
  loadingIcon,
  hideTextWhenLoading = false,
  disabled,
  children,
  className,
  variant,
  size,
  ...props
}: LoadingButtonProps) {
  const isDisabled = disabled || isLoading

  return (
    <Button
      className={cn(className)}
      disabled={isDisabled}
      variant={variant}
      size={size}
      {...props}
    >
      {isLoading && (
        <>
          {loadingIcon || <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
          {!hideTextWhenLoading && <span>{loadingText || children}</span>}
        </>
      )}
      {!isLoading && children}
    </Button>
  )
} 
