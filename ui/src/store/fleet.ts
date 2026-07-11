import { create } from 'zustand'
import type { ActivityEvent, AgentToken, ChatMessage, CtxhubEventEnvelope } from '../types'

export type FleetView = 'fleet' | 'captains' | 'knowledge' | 'config' | 'skills'

interface FleetStore {
  activeView: FleetView
  setActiveView: (view: FleetView) => void

  // Set by a citation click in Chat; consumed once by KnowledgeGraphView to switch workspace,
  // select the matching node, and fit the view to it -- then cleared. Not folded into
  // `activeView`/`selectedWorkspace` since those are generic navigation state and this is a
  // one-shot instruction with its own payload.
  pendingKnowledgeFocus: { workspace: string; nodeId: string } | null
  setPendingKnowledgeFocus: (target: { workspace: string; nodeId: string } | null) => void

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

  agents: AgentToken[]
  upsertAgent: (token: AgentToken) => void
  removeAgent: (id: string) => void
}

let activityIdCounter = 0
let chatIdCounter = 0

export const useFleetStore = create<FleetStore>((set) => ({
  activeView: 'fleet',
  setActiveView: (view) => set({ activeView: view }),

  pendingKnowledgeFocus: null,
  setPendingKnowledgeFocus: (target) => set({ pendingKnowledgeFocus: target }),

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

  agents: [],
  upsertAgent: (token) =>
    set((state) => ({
      agents: [...state.agents.filter((a) => a.id !== token.id), token],
    })),
  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
    })),
}))

export function makeMsgId() {
  return `msg-${++chatIdCounter}-${Date.now()}`
}
