import { Fragment, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Send, MessageSquare, ChevronDown } from 'lucide-react'
import { useFleetStore, makeMsgId } from '../store/fleet'
import { useWorkspaces, useChatMutation, useKnowledgeGraph } from '../api/client'
import type { ChatMessage } from '../types'

// Answers are markdown-ish evidence-grounded text (paragraphs, single-level bullet/numbered
// lists, **bold**, `code`, and inline [E1]-style citation markers matching the CitationChip refs
// below) — never full CommonMark, so a small hand-rolled renderer covers it without a new
// dependency for a chat sidebar.
const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[E\d+\])/g

function renderInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let i = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push(text.slice(lastIndex, index))
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('**')) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={key}
          className="px-1 py-0.5 rounded text-[11px] font-mono"
          style={{ background: 'rgba(124,110,245,0.12)' }}
        >
          {token.slice(1, -1)}
        </code>
      )
    } else {
      parts.push(
        <span key={key} style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.85em' }}>
          {token}
        </span>
      )
    }
    lastIndex = index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function renderMarkdown(content: string) {
  const blocks = content.split(/\n{2,}/)
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter(l => l.trim().length > 0)
    if (lines.length === 0) return null

    const isBulletList = lines.every(l => /^[-*]\s+/.test(l.trim()))
    const isNumberedList = !isBulletList && lines.every(l => /^\d+\.\s+/.test(l.trim()))

    if (isBulletList) {
      return (
        <ul key={bi} className="list-disc pl-4 space-y-1" style={{ marginTop: bi > 0 ? 6 : 0 }}>
          {lines.map((line, li) => (
            <li key={li}>{renderInline(line.trim().replace(/^[-*]\s+/, ''), `${bi}-${li}`)}</li>
          ))}
        </ul>
      )
    }
    if (isNumberedList) {
      return (
        <ol key={bi} className="list-decimal pl-4 space-y-1" style={{ marginTop: bi > 0 ? 6 : 0 }}>
          {lines.map((line, li) => (
            <li key={li}>{renderInline(line.trim().replace(/^\d+\.\s+/, ''), `${bi}-${li}`)}</li>
          ))}
        </ol>
      )
    }
    return (
      <p key={bi} style={{ marginTop: bi > 0 ? 6 : 0 }}>
        {lines.map((line, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </Fragment>
        ))}
      </p>
    )
  })
}

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

function CitationChip({
  refLabel,
  title,
  path,
  onJump,
}: {
  refLabel: string
  title?: string
  path: string
  onJump: (() => void) | null
}) {
  // `onJump: null` means we've confirmed this citation has no matching Knowledge graph node
  // (e.g. a file outside the graph's 120-node cap) -- still shown for evidence transparency, but
  // deliberately not styled or wired as clickable so it doesn't look interactive and then do
  // nothing. `undefined`-vs-`null` distinction lives one level up in `resolvable`.
  const clickable = onJump !== null
  const Tag = clickable ? 'button' : 'span'
  return (
    <Tag
      onClick={onJump ?? undefined}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-opacity ${clickable ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{
        background: clickable ? 'rgba(124,110,245,0.12)' : 'var(--bg-elevated)',
        border: `1px solid ${clickable ? 'rgba(124,110,245,0.25)' : 'var(--border)'}`,
        color: clickable ? 'var(--accent)' : 'var(--text-muted)',
      }}
      title={clickable ? `Open ${path} in the Knowledge graph` : `${path} (not in the current Knowledge graph view)`}
    >
      <span className="font-mono">{refLabel}</span>
      {title && <span style={{ color: 'var(--text-secondary)' }}>{title.slice(0, 20)}</span>}
    </Tag>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  const setActiveView = useFleetStore(s => s.setActiveView)
  const setPendingKnowledgeFocus = useFleetStore(s => s.setPendingKnowledgeFocus)

  // Same graph the Knowledge view itself renders -- react-query dedupes/caches this by
  // [workspace] query key, so this doesn't force a second independent fetch if the user has
  // already visited Knowledge for this workspace this session.
  const { data: graph } = useKnowledgeGraph(msg.citations && msg.citations.length > 0 ? msg.workspace : null)
  const graphNodeIds = useMemo(() => (graph ? new Set(graph.nodes.map(n => n.id)) : null), [graph])

  const jumpToCitation = useCallback(
    (repo: string, path: string) => {
      setPendingKnowledgeFocus({ workspace: msg.workspace, nodeId: `${repo}:${path}` })
      setActiveView('knowledge')
    },
    [msg.workspace, setActiveView, setPendingKnowledgeFocus]
  )

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
        {isUser ? msg.content : renderMarkdown(msg.content)}
      </div>
      {msg.citations && msg.citations.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-[90%]">
          {msg.citations.slice(0, 6).map((c, i) => {
            const nodeId = `${c.repo}:${c.path}`
            // Optimistic while the graph is still loading (graphNodeIds === null): most
            // citations do resolve, and defaulting to clickable avoids every chip flashing
            // disabled-then-enabled on first render. Once loaded, only a confirmed match stays
            // clickable.
            const resolvable = graphNodeIds === null || graphNodeIds.has(nodeId)
            return (
              <CitationChip
                key={i}
                refLabel={c.ref}
                title={c.title}
                path={c.path}
                onJump={resolvable ? () => jumpToCitation(c.repo, c.path) : null}
              />
            )
          })}
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
      workspace: chatWorkspace,
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
        workspace: chatWorkspace,
      }
      addChatMessage(assistantMsg)
      addActivity(`Answer received from ${chatWorkspace}`, 'ok')
    } catch (err) {
      const errMsg: ChatMessage = {
        id: makeMsgId(),
        role: 'system',
        content: `Error: ${(err as Error).message}`,
        timestamp: new Date(),
        workspace: chatWorkspace,
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
