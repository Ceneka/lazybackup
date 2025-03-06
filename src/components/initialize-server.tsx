"use client"

import { useQuery } from "@tanstack/react-query"

// This component checks server initialization status but doesn't trigger initialization
// as that now happens automatically on server start
export function InitializeServer() {
  // This query will just check the status
  const { data } = useQuery({
    queryKey: ['server-status'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/init/status')
        const data = await response.json()
        return data
      } catch (error) {
        console.error('Failed to check server status:', error)
        return { initialized: false, error }
      }
    }
  })
  
  // This component doesn't render anything
  return null
} 
