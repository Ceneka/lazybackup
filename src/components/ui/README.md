# UI Components for State Management

This directory contains reusable UI components for handling common UI states like loading, error, and empty states. These components help maintain consistent UI patterns across the application.

## DataState Component

`DataState` is the base component for handling loading, error, and empty states.

```tsx
import { DataState } from "@/components/ui/data-state"

// Loading state
<DataState isLoading={true}>
  <p>This content won't be shown while loading</p>
</DataState>

// Error state
<DataState 
  error="Failed to load data" 
  errorIcon={<AlertCircleIcon className="h-12 w-12 text-red-500" />}
  showRetry={true}
  onRetry={() => refetchData()}
>
  <p>This content won't be shown while in error state</p>
</DataState>

// Empty state
<DataState 
  isEmpty={true}
  emptyMessage="No items found"
  emptyIcon={<InboxIcon className="h-12 w-12 text-muted-foreground" />}
>
  <p>This content won't be shown while empty</p>
</DataState>

// Content state (default)
<DataState>
  <p>This is the normal content state</p>
</DataState>
```

### Props

| Prop | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `isLoading` | `boolean` | `false` | Whether the data is loading |
| `error` | `string \| null` | `null` | Error message if there is an error |
| `isEmpty` | `boolean` | `false` | Whether to show the empty state |
| `emptyMessage` | `string` | `'No data found'` | Message to show when there is no data |
| `emptyIcon` | `ReactNode` | - | Icon to show in the empty state |
| `errorIcon` | `ReactNode` | - | Icon to show in the error state |
| `showRetry` | `boolean` | `true` | Whether to show a retry button in the error state |
| `onRetry` | `() => void` | - | Function to call when the retry button is clicked |
| `loadingComponent` | `ReactNode` | - | Custom loading component or element |
| `className` | `string` | - | Additional class names for the container |
| `spinnerSize` | `number` | `8` | Custom loading spinner size |
| `children` | `ReactNode` | - | Children to render when not in loading, error, or empty state |

## QueryState Component

`QueryState` is built on top of `DataState` specifically for working with TanStack Query (useQuery).

```tsx
import { QueryState } from "@/components/ui/query-state"

const { data, isLoading, error, refetch } = useQuery(...)

<QueryState 
  query={{ data, isLoading, error, isError: !!error, refetch }}
  dataLabel="users"
  errorIcon={<UserIcon className="h-12 w-12 text-red-500" />}
  emptyIcon={<UserIcon className="h-12 w-12 text-muted-foreground" />}
  emptyMessage="No users found"
>
  {data && (
    <div>
      {/* Render your content here */}
    </div>
  )}
</QueryState>
```

### Props

| Prop | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `query` | `{ isLoading?: boolean, isError?: boolean, error?: any, data?: any, refetch?: () => void }` | - | Query result from TanStack/React Query |
| `isDataEmpty` | `(data: any) => boolean` | - | Function to check if data is empty |
| `errorMessage` | `string` | - | Custom error message |
| `transformError` | `(error: any) => string` | - | Error message transformer |
| `dataLabel` | `string` | `'data'` | Label for the data type (e.g., "servers", "backups") |
| ...other props from `DataState` | | | All other props from DataState are also supported |

## LoadingButton Component

`LoadingButton` is a button component with integrated loading state.

```tsx
import { LoadingButton } from "@/components/ui/loading-button"

// Normal button
<LoadingButton onClick={handleClick}>
  Save Changes
</LoadingButton>

// Loading button
<LoadingButton 
  isLoading={isSaving} 
  onClick={handleSave}
  loadingText="Saving..."
>
  Save Changes
</LoadingButton>

// Loading button with custom styling
<LoadingButton 
  isLoading={isDeleting} 
  variant="destructive"
  loadingText="Deleting..."
  onClick={handleDelete}
>
  Delete
</LoadingButton>
```

### Props

| Prop | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `isLoading` | `boolean` | `false` | Whether the button is in a loading state |
| `loadingText` | `string` | - | The text to display when the button is loading |
| `loadingIcon` | `ReactNode` | `<Loader2Icon className="mr-2 h-4 w-4 animate-spin" />` | The icon to display when the button is loading |
| `hideTextWhenLoading` | `boolean` | `false` | Whether to hide the button text when loading |
| `variant` | `'default' \| 'destructive' \| 'outline' \| 'secondary' \| 'ghost' \| 'link'` | - | Button variant |
| `size` | `'default' \| 'sm' \| 'lg' \| 'icon'` | - | Button size |
| ...other props from `button` | | | All other props from HTML button element |

## Examples

For an interactive demonstration of these components, check out the examples page at `/examples`.

## Best Practices

1. Use `QueryState` for data fetching operations with TanStack Query
2. Use `DataState` for custom loading/error states not tied to queries
3. Use `LoadingButton` for buttons that trigger async operations
4. Provide meaningful error messages and appropriate icons
5. Consider using skeleton loaders for better UX
6. Keep retry functionality when appropriate 
