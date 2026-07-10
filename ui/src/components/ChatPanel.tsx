import { useRef, useEffect, useState, useCallback } from 'react'
import { Send, MessageSquare, ChevronDown } from 'lucide-react'
import { useFleetStore, makeMsgId } from '../store/fleet'
import { useWorkspaces, useChatMutation } from '../api/client'
import type { ChatMessage } from '../types'

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3">
      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
        <MessageSquare size={10} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="flex items-center gap-1 px-3 py-2 rounded-2xl rounded-tl-sm" style={{ background: 'var(--bg-surface)' }}>
        <span className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', display: 'inline-block' }} />
        <span className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', display: 'inline-block' }} />
        <span className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', display: 'inline-block' }} />
      </div>
    </div>
  )
}

function CitationChip({ ref: citRef, title, path }: { ref: string; title?: string; path: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] cursor-pointer"
      style={{
        background: 'rgba(124,110,245,0.12)',
        border: '1px solid rgba(124,110,245,0.25)',
        color: 'var(--accent)',
      }}
      title={path}
    >
      <span className="font-mono">{citRef}</span>
      {title && <span style={{ color: 'var(--text-secondary)' }}>{title.slice(0, 20)}</span>}
    </span>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex flex-col gap-1 px-3 py-2 animate-slide-in-up ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className="max-w-[90%] px-3 py-2 rounded-2xl text-xs leading-relaxed"
        style={{
          background: isUser ? 'var(--accent)' : 'var(--bg-elevated)',
          color: isUser ? 'white' : 'var(--text-primary)',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        }}
      >
        {msg.content}
      </div>
      {msg.citations && msg.citations.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-[90%]">
          {msg.citations.slice(0, 6).map((c, i) => (
            <CitationChip key={i} ref={c.ref} title={c.title} path={c.path} />
          ))}
        </div>
      )}
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {msg.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

export function ChatPanel() {
  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const { chatWorkspace, setChatWorkspace, chatMessages, addChatMessage, addActivity } = useFleetStore()
  const mutation = useChatMutation()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, mutation.isPending])

  // Focus input when chatWorkspace changes
  useEffect(() => {
    if (chatWorkspace) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [chatWorkspace])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || !chatWorkspace || mutation.isPending) return
    setInput('')

    const userMsg: ChatMessage = {
      id: makeMsgId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    }
    addChatMessage(userMsg)
    addActivity(`Chat query to ${chatWorkspace}: "${query.slice(0, 40)}${query.length > 40 ? '…' : ''}"`, 'info')

    try {
      const result = await mutation.mutateAsync({ name: chatWorkspace, query })
      const answer = result.answer.join('\n\n')
      const assistantMsg: ChatMessage = {
        id: makeMsgId(),
        role: 'assistant',
        content: answer || 'No answer returned.',
        citations: result.citations,
        timestamp: new Date(),
      }
      addChatMessage(assistantMsg)
      addActivity(`Answer received from ${chatWorkspace}`, 'ok')
    } catch (err) {
      const errMsg: ChatMessage = {
        id: makeMsgId(),
        role: 'system',
        content: `Error: ${(err as Error).message}`,
        timestamp: new Date(),
      }
      addChatMessage(errMsg)
      addActivity(`Chat error on ${chatWorkspace}: ${(err as Error).message}`, 'error')
    }
  }, [input, chatWorkspace, mutation, addChatMessage, addActivity])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  // Filter workspace messages for current chatWorkspace
  const currentMessages = chatWorkspace
    ? chatMessages.filter(
        m =>
          m.role === 'user' ||
          m.role === 'assistant' ||
          m.role === 'system'
      )
    : []

  return (
    <div
      className="flex flex-col h-full border-l overflow-hidden"
      style={{
        width: 340,
        background: 'var(--bg-base)',
        borderColor: 'var(--border)',
        gridArea: 'chat',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Chat
          </span>
        </div>
        {chatWorkspace && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium truncate max-w-[140px]"
            style={{
              background: 'var(--accent-dim)',
              border: '1px solid rgba(124,110,245,0.3)',
              color: 'var(--accent)',
            }}
          >
            {chatWorkspace}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2">
        {!chatWorkspace && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <MessageSquare size={32} style={{ color: 'var(--text-muted)' }} strokeWidth={1} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a workspace to start chatting
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Click a node on the graph, then press "Ask this workspace"
            </p>
          </div>
        )}
        {chatWorkspace && currentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Ask anything about <strong style={{ color: 'var(--text-secondary)' }}>{chatWorkspace}</strong>
            </p>
          </div>
        )}
        {currentMessages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {mutation.isPending && <ThinkingDots />}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      <div
        className="flex-shrink-0 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Workspace selector */}
        <div className="flex items-center gap-2 px-3 pt-2">
          <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
          <select
            value={chatWorkspace ?? ''}
            onChange={e => setChatWorkspace(e.target.value || null)}
            className="flex-1 text-xs"
            style={{
              background: 'transparent',
              border: 'none',
              color: chatWorkspace ? 'var(--text-secondary)' : 'var(--text-muted)',
              padding: 0,
            }}
          >
            <option value="">Select workspace…</option>
            {workspaces.map(ws => (
              <option key={ws.name} value={ws.name}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        {/* Input area */}
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={chatWorkspace ? `Ask ${chatWorkspace}… (Enter to send)` : 'Select a workspace first'}
            disabled={!chatWorkspace || mutation.isPending}
            rows={2}
            className="flex-1 resize-none text-xs rounded-lg px-3 py-2 transition-all"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
              minHeight: 56,
              maxHeight: 120,
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!chatWorkspace || !input.trim() || mutation.isPending}
            className="w-9 h-9 flex items-center justify-center rounded-lg flex-shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <Send size={14} style={{ color: 'white' }} />
          </button>
        </div>

        <p className="px-3 pb-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
