import { create } from 'zustand'
import type { ActivityEvent, ChatMessage, CtxhubEventEnvelope } from '../types'

interface FleetStore {
  selectedWorkspace: string | null
  setSelectedWorkspace: (name: string | null) => void

  selectedEvent: CtxhubEventEnvelope | null
  setSelectedEvent: (event: CtxhubEventEnvelope | null) => void

  chatWorkspace: string | null
  setChatWorkspace: (name: string | null) => void

  chatMessages: ChatMessage[]
  addChatMessage: (msg: ChatMessage) => void
  clearChatMessages: () => void

  activity: ActivityEvent[]
  addActivity: (text: string, type: ActivityEvent['type'], raw?: CtxhubEventEnvelope) => void

  frozen: boolean
  toggleFrozen: () => void
}

let activityIdCounter = 0
let chatIdCounter = 0

export const useFleetStore = create<FleetStore>((set) => ({
  selectedWorkspace: null,
  // Mutually exclusive with selectedEvent -- both render as the same right-hand slide-in over
  // the graph, and showing two stacked would just fight over the same space.
  setSelectedWorkspace: (name) => set({ selectedWorkspace: name, selectedEvent: null }),

  selectedEvent: null,
  setSelectedEvent: (event) => set({ selectedEvent: event, selectedWorkspace: null }),

  chatWorkspace: null,
  setChatWorkspace: (name) => set({ chatWorkspace: name }),

  chatMessages: [],
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-100),
    })),
  clearChatMessages: () => set({ chatMessages: [] }),

  activity: [],
  addActivity: (text, type, raw) =>
    set((state) => ({
      activity: [
        {
          id: `act-${++activityIdCounter}`,
          text,
          type,
          timestamp: new Date(),
          raw,
        },
        ...state.activity,
      ].slice(0, 200),
    })),

  frozen: false,
  toggleFrozen: () => set((state) => ({ frozen: !state.frozen })),
}))

export function makeMsgId() {
  return `msg-${++chatIdCounter}-${Date.now()}`
}
