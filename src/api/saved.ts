// src/api/saved.ts — API integration for the saved items domain.
//
// All calls go through the single HTTP client in src/api/, never fetch directly.

import { apiClient } from '@/api/client';
import type { SavedItem, SavedItemForm } from '@/types/saved';

export async function fetchSavedItems(): Promise<SavedItem[]> {
  return apiClient.get<SavedItem[]>('/saved');
}

export async function saveItem(form: SavedItemForm): Promise<SavedItem> {
  return apiClient.post<SavedItem>('/saved', { body: form });
}

export async function unsaveItem(savedItemId: string): Promise<void> {
  await apiClient.delete(`/saved/${savedItemId}`);
}

