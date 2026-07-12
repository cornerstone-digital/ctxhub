import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useEventStream } from './api/client'
import { useFleetStore } from './store/fleet'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { ChatPanel } from './components/ChatPanel'
import { EventLog } from './components/EventLog'
import { CaptainsView } from './components/CaptainsView'
import { KnowledgeGraphView } from './components/KnowledgeGraphView'
import { ConfigView } from './components/ConfigView'
import { SkillsPersonasView } from './components/SkillsPersonasView'
import { ReviewView } from './components/ReviewView'
import { JobsView } from './components/JobsView'
import { EvalView } from './components/EvalView'
import { TimelineView } from './components/TimelineView'
import { GroupsView } from './components/GroupsView'
import { CloudView } from './components/CloudView'
import { BlueprintsView } from './components/BlueprintsView'
import { OrgKnowledgeView } from './components/OrgKnowledgeView'

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

  const activeView = useFleetStore(s => s.activeView)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--bg-void)' }}>
      <TopBar />
      <PanelGroup direction="horizontal" autoSaveId="mc-horizontal" style={{ flex: 1, minHeight: 0 }}>

        {/* Left: Sidebar */}
        <Panel defaultSize={17} minSize={11} maxSize={32} style={{ display: 'flex', flexDirection: 'column' }}>
          <Sidebar />
        </Panel>

        <ResizeHandleH />

        {/* Centre: main view (Fleet graph / Captains / Knowledge) + Event Log stacked vertically */}
        <Panel minSize={28} style={{ display: 'flex', flexDirection: 'column' }}>
          <PanelGroup direction="vertical" autoSaveId="mc-vertical">
            <Panel minSize={35} style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
              {activeView === 'fleet' && <GraphCanvas />}
              {activeView === 'captains' && <CaptainsView />}
              {activeView === 'jobs' && <JobsView />}
              {activeView === 'timeline' && <TimelineView />}
              {activeView === 'eval' && <EvalView />}
              {activeView === 'knowledge' && <KnowledgeGraphView />}
              {activeView === 'review' && <ReviewView />}
              {activeView === 'config' && <ConfigView />}
              {activeView === 'skills' && <SkillsPersonasView />}
              {activeView === 'groups' && <GroupsView />}
              {activeView === 'cloud' && <CloudView />}
              {activeView === 'blueprints' && <BlueprintsView />}
              {activeView === 'org-knowledge' && <OrgKnowledgeView />}
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
