/** ``src/types/saved.ts`` — Saved items domain types.

Every field here exists in the mobile client. Nothing is invented, and nothing is
renamed:

* Matches ``backend/app/schemas/saved.py`` exactly.
* Mirrors the model returned by ``GET /saved`` and the request of ``POST /saved``.
*/

export type SavedItemType = 'course' | 'lecture'

export interface SavedItem {
  id: string
  resource_type: SavedItemType
  resource_id: string
  created_at: string
}

export interface SavedItemForm {
  resource_type: SavedItemType
  resource_id: string
}

export interface SavedItemResponse {
  saved_items: SavedItem[]
}