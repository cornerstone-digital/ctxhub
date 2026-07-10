import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { ChatPanel } from './components/ChatPanel'
import { ActivityFeed } from './components/ActivityFeed'

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
              <ActivityFeed />
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
