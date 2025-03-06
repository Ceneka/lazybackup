import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface SettingItem {
  id: string
  key: string
  value: string | null
  createdAt: string
  updatedAt: string
}

export type Settings = Record<string, string | null>

// Hook for managing settings
export function useSettings() {
  const queryClient = useQueryClient()

  // Fetch settings
  const { data: settings = {}, isLoading, error } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings')
      
      if (!response.ok) {
        throw new Error("Failed to fetch settings")
      }
      
      return response.json()
    }
  })

  // Update setting
  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string | null }) => {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update setting')
      }
      
      return response.json()
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Settings>(['settings'], (old = {}) => ({
        ...old,
        [data.key]: data.value,
      }))
      toast.success('Setting updated successfully')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update setting')
    }
  })

  // Delete setting
  const deleteSetting = useMutation({
    mutationFn: async (key: string) => {
      const response = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete setting')
      }
      
      return response.json()
    },
    onSuccess: (_data, key) => {
      queryClient.setQueryData<Settings>(['settings'], (old = {}) => {
        const newSettings = { ...old }
        delete newSettings[key]
        return newSettings
      })
      toast.success('Setting deleted successfully')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete setting')
    }
  })

  return {
    settings,
    isLoading,
    error,
    updateSetting,
    deleteSetting,
    // Helper to get specific setting value with default
    getSetting: (key: string, defaultValue: string | null = null): string | null => {
      return settings[key] !== undefined ? settings[key] : defaultValue
    }
  }
} 
