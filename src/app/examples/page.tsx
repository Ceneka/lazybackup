"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataState } from "@/components/ui/data-state"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { ClipboardIcon, InfoIcon } from "lucide-react"
import { useState } from "react"

export default function ComponentExamplesPage() {
  const [loading, setLoading] = useState(false)
  const [loadExample, setLoadExample] = useState(false)
  const [showError, setShowError] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)

  // Mock query object for QueryState example
  const mockQuery = {
    isLoading: loadExample ? loading : false,
    isError: loadExample && showError,
    error: loadExample && showError ? new Error("Something went wrong") : null,
    data: loadExample && !loading && !showError ? (showEmpty ? [] : [1, 2, 3]) : null,
    refetch: () => {
      setLoading(true)
      setTimeout(() => setLoading(false), 1500)
    }
  }

  const handleLoadExample = () => {
    setLoadExample(true)
    setLoading(true)
    setTimeout(() => setLoading(false), 1500)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">UI Component Examples</h1>
        <p className="text-muted-foreground mt-2">Examples of reusable UI state handling components</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DataState Examples */}
        <Card>
          <CardHeader>
            <CardTitle>DataState Component</CardTitle>
            <CardDescription>A flexible component for loading, error and empty states</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium">Loading State</h3>
              <DataState isLoading={true}>
                <p>This content won't be shown while loading</p>
              </DataState>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Error State</h3>
              <DataState 
                error="Failed to load data" 
                errorIcon={<InfoIcon className="h-12 w-12 text-red-500" />}
                showRetry={true}
                onRetry={() => alert("Retry clicked")}
              >
                <p>This content won't be shown while in error state</p>
              </DataState>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Empty State</h3>
              <DataState 
                isEmpty={true}
                emptyMessage="No items found"
                emptyIcon={<ClipboardIcon className="h-12 w-12 text-muted-foreground" />}
              >
                <p>This content won't be shown while empty</p>
              </DataState>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Content State</h3>
              <DataState>
                <p>This is the normal content state</p>
              </DataState>
            </div>
          </CardContent>
        </Card>

        {/* QueryState Examples */}
        <Card>
          <CardHeader>
            <CardTitle>QueryState Component</CardTitle>
            <CardDescription>A component specifically designed for TanStack Query</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <Button 
                onClick={handleLoadExample} 
                disabled={loadExample}
                variant="outline"
              >
                Load Example
              </Button>
              <Button 
                onClick={() => setShowError(!showError)} 
                variant={showError ? "destructive" : "outline"}
                disabled={!loadExample}
              >
                {showError ? "Hide Error" : "Show Error"}
              </Button>
              <Button 
                onClick={() => setShowEmpty(!showEmpty)} 
                variant={showEmpty ? "secondary" : "outline"}
                disabled={!loadExample || showError}
              >
                {showEmpty ? "Show Data" : "Show Empty"}
              </Button>
              <LoadingButton 
                isLoading={loading}
                loadingText="Refreshing..."
                onClick={() => mockQuery.refetch()}
                disabled={!loadExample}
              >
                Refresh
              </LoadingButton>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-md">
              <QueryState
                query={mockQuery}
                dataLabel="items"
                errorIcon={<InfoIcon className="h-12 w-12 text-red-500" />}
                emptyIcon={<ClipboardIcon className="h-12 w-12 text-muted-foreground" />}
              >
                {mockQuery.data && mockQuery.data.length > 0 && (
                  <div className="p-4 border rounded-md bg-white dark:bg-gray-800">
                    <h3 className="font-medium mb-2">Your data is ready!</h3>
                    <p className="text-muted-foreground">This content only shows when data is loaded</p>
                  </div>
                )}
              </QueryState>
            </div>
          </CardContent>
        </Card>

        {/* LoadingButton Examples */}
        <Card>
          <CardHeader>
            <CardTitle>LoadingButton Component</CardTitle>
            <CardDescription>Button with integrated loading state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Normal State</h3>
                <LoadingButton isLoading={false}>
                  Save Changes
                </LoadingButton>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Loading State</h3>
                <LoadingButton isLoading={true}>
                  Save Changes
                </LoadingButton>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Custom Loading Text</h3>
                <LoadingButton isLoading={true} loadingText="Saving...">
                  Save Changes
                </LoadingButton>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Hide Text When Loading</h3>
                <LoadingButton isLoading={true} hideTextWhenLoading={true}>
                  Save Changes
                </LoadingButton>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Primary Variant</h3>
                <LoadingButton isLoading={loading} variant="default" onClick={() => {
                  setLoading(true)
                  setTimeout(() => setLoading(false), 1500)
                }}>
                  Click Me
                </LoadingButton>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Destructive Variant</h3>
                <LoadingButton isLoading={loading} variant="destructive" onClick={() => {
                  setLoading(true)
                  setTimeout(() => setLoading(false), 1500)
                }}>
                  Delete
                </LoadingButton>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
} 
