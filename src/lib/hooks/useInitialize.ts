import { useQuery } from "@tanstack/react-query"

export function useInitialize() {
  return useQuery({
    queryKey: ['initialize'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/init')
        const data = await response.json()
        
        if (data.error) {
          console.error('Failed to initialize server:', data.error || 'Unknown error')
          return { initialized: false, error: data.error || 'Unknown error' }
        } else {
          console.log('Server initialized successfully')
          return { initialized: true }
        }
      } catch (error) {
        console.error('Failed to initialize server:', error)
        throw error
      }
    }
  })
} 
