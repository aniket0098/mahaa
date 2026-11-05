/* ``src/features/learn/savedModel.ts`` — Pure view model for the Saved section.

Completely derived from server — no local computation of completeness percentages.
All data flows through the API layer in `src/api/saved.ts`.

**Never compute profile completeness on the client.** It is server-derived from
``GET /profile/completeness``.
*/

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SavedItem, SavedItemType } from '@/types/saved'
import { fetchSavedItems, saveItem, unsaveItem } from '@/api/saved'
import { queryKeys } from '@/api/queryKeys'

export type { SavedItemType }

export function useSavedItems(): {
  savedItems: SavedItem[]
  isLoading: boolean
  isRefetching: boolean
  error: string | null
  refetch: () => void
  saveMutation: any
  unsaveMutation: any
} {
  const queryClient = useQueryClient()

  const { data, isError, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: queryKeys.saved(),
    queryFn: fetchSavedItems,
    staleTime: 30 * 1000,
  })

  const savedItems = data ?? []
  const errorMsg = isError ? (error instanceof Error ? error.message : String(error)) : null

  const saveMutation = useMutation({
    mutationFn: ({ resourceType, resourceId }: { resourceType: SavedItemType; resourceId: string }) =>
      saveItem({ resource_type: resourceType, resource_id: resourceId } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.saved() })
    },
  })

  const unsaveMutation = useMutation({
    mutationFn: (savedItemId: string) => unsaveItem(savedItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.saved() })
    },
  })

  return {
    savedItems,
    isLoading,
    isRefetching,
    error: errorMsg,
    refetch: () => void refetch(),
    saveMutation,
    unsaveMutation,
  }
}
