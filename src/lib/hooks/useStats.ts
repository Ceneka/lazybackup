import { useQuery } from "@tanstack/react-query"

export interface Stats {
  servers: number
  backups: number
  history: number
  running: number
  failed: number
  success: number
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      try {
        // Fetch servers count
        const serversRes = await fetch('/api/servers')
        const servers = await serversRes.json()
        
        // Fetch backups count
        const backupsRes = await fetch('/api/backups')
        const backups = await backupsRes.json()
        
        // Fetch history
        const historyRes = await fetch('/api/history')
        const historyData = await historyRes.json()
        
        // Extract the history array from the response
        const history = historyData.history || []
        
        // Calculate stats
        const running = history.filter((item: any) => item.status === 'running').length
        const failed = history.filter((item: any) => item.status === 'failed').length
        const success = history.filter((item: any) => item.status === 'success').length
        
        return {
          servers: servers.length,
          backups: backups.length,
          history: history.length,
          running,
          failed,
          success,
        } as Stats
      } catch (error) {
        console.error('Failed to fetch stats:', error)
        throw error
      }
    }
  })
} 
