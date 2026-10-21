import { create } from 'zustand'

interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))

let next = 1

export function toast(message: string, action?: Toast['action'], ms = 3200) {
  const id = next++
  useToasts.setState((s) => ({ items: [...s.items, { id, message, action }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
}
