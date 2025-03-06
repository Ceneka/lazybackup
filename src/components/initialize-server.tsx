"use client"

import { useInitialize } from "@/lib/hooks/useInitialize"

export function InitializeServer() {
  // This query will run automatically when the component mounts
  const { data } = useInitialize()
  
  // This component doesn't render anything
  return null
} 
