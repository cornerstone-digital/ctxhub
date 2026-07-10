import { create } from 'zustand'
import type { ActivityEvent, ChatMessage } from '../types'

interface FleetStore {
  selectedWorkspace: string | null
  setSelectedWorkspace: (name: string | null) => void

  chatWorkspace: string | null
  setChatWorkspace: (name: string | null) => void

  chatMessages: ChatMessage[]
  addChatMessage: (msg: ChatMessage) => void
  clearChatMessages: () => void

  activity: ActivityEvent[]
  addActivity: (text: string, type: ActivityEvent['type']) => void

  frozen: boolean
  toggleFrozen: () => void
}

let activityIdCounter = 0
let chatIdCounter = 0

export const useFleetStore = create<FleetStore>((set) => ({
  selectedWorkspace: null,
  setSelectedWorkspace: (name) => set({ selectedWorkspace: name }),

  chatWorkspace: null,
  setChatWorkspace: (name) => set({ chatWorkspace: name }),

  chatMessages: [],
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-100),
    })),
  clearChatMessages: () => set({ chatMessages: [] }),

  activity: [],
  addActivity: (text, type) =>
    set((state) => ({
      activity: [
        {
          id: `act-${++activityIdCounter}`,
          text,
          type,
          timestamp: new Date(),
        },
        ...state.activity,
      ].slice(0, 50),
    })),

  frozen: false,
  toggleFrozen: () => set((state) => ({ frozen: !state.frozen })),
}))

export function makeMsgId() {
  return `msg-${++chatIdCounter}-${Date.now()}`
}
