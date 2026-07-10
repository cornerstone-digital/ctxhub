import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useEventStream } from './api/client'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { ChatPanel } from './components/ChatPanel'
import { EventLog } from './components/EventLog'

function ResizeHandleH() {
  return (
    <PanelResizeHandle className="resize-handle-h">
      <div className="resize-handle-h-bar" />
    </PanelResizeHandle>
  )
}

function ResizeHandleV() {
  return (
    <PanelResizeHandle className="resize-handle-v">
      <div className="resize-handle-v-bar" />
    </PanelResizeHandle>
  )
}

export default function App() {
  useEffect(() => {
    // Ask once, up front, so a completed background job (see useEventStream) can raise a real
    // desktop notification instead of only the in-app Event Log row.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  // Single shared SSE connection for the whole app -- every event bus event (index jobs,
  // Captain runs) fans out from here into the Event Log and the Sidebar's live progress.
  useEventStream()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--bg-void)' }}>
      <TopBar />
      <PanelGroup direction="horizontal" autoSaveId="mc-horizontal" style={{ flex: 1, minHeight: 0 }}>

        {/* Left: Sidebar */}
        <Panel defaultSize={17} minSize={11} maxSize={32} style={{ display: 'flex', flexDirection: 'column' }}>
          <Sidebar />
        </Panel>

        <ResizeHandleH />

        {/* Centre: Graph + Activity stacked vertically */}
        <Panel minSize={28} style={{ display: 'flex', flexDirection: 'column' }}>
          <PanelGroup direction="vertical" autoSaveId="mc-vertical">
            <Panel minSize={35} style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <GraphCanvas />
            </Panel>
            <ResizeHandleV />
            <Panel defaultSize={22} minSize={10} maxSize={45} style={{ display: 'flex', flexDirection: 'column' }}>
              <EventLog />
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandleH />

        {/* Right: Chat */}
        <Panel defaultSize={26} minSize={14} maxSize={48} style={{ display: 'flex', flexDirection: 'column' }}>
          <ChatPanel />
        </Panel>

      </PanelGroup>
    </div>
  )
}
