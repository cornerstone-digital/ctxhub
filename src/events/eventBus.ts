import { EventEmitter } from 'node:events';
import type { IndexResult } from '../indexing/indexer.js';

// A minimal, in-process pub/sub core. Producers (the indexer, captains, the service) publish
// facts about what just happened; consumers (desktop notify, SSE clients, the dashboard's
// activity feed) subscribe without the producer knowing or caring who's listening. The point is
// decoupling, not scale: this is not a queue, isn't persisted, and doesn't cross process
// boundaries. A durable/cross-process transport for real agent-to-agent delivery (e.g. over MCP)
// can be layered on top of this later if a concrete use case needs it -- this is deliberately
// just the in-process contract first, wired to real producers/consumers that exist today
// (index jobs, Captain runs) rather than speculative ones.
export type CtxhubEvent =
  | { type: 'index.started'; workspace: string }
  | { type: 'index.progress'; workspace: string; repo: string; scanned: number; total: number }
  | { type: 'index.completed'; workspace: string; result: IndexResult }
  | { type: 'index.failed'; workspace: string; error: string }
  | { type: 'captain.run.started'; task: string; workspace: string }
  | { type: 'captain.run.completed'; task: string; workspace: string; runId: string }
  | { type: 'captain.run.failed'; task: string; workspace: string; error: string }
  | { type: 'captain.handoff'; from: string; to: string; fromWorkspace: string; toWorkspace: string }
  | { type: 'skills.installed'; workspace: string; agents: string[] }
  | { type: 'personas.synced'; workspace: string; agents: string[] };

export type CtxhubEventEnvelope = CtxhubEvent & { id: string; at: string };

const CHANNEL = 'event';

export class EventBus {
  private readonly emitter = new EventEmitter();
  private sequence = 0;

  constructor() {
    // Every SSE-connected dashboard tab (and eventually every subscribed agent) adds a listener
    // that lives for the connection's lifetime -- unbounded is the correct ceiling here, not a
    // leak smell. Each is removed via the unsubscribe function returned by subscribe().
    this.emitter.setMaxListeners(0);
  }

  publish(event: CtxhubEvent): CtxhubEventEnvelope {
    const envelope: CtxhubEventEnvelope = { ...event, id: `evt-${++this.sequence}`, at: new Date().toISOString() };
    this.emitter.emit(CHANNEL, envelope);
    return envelope;
  }

  subscribe(listener: (event: CtxhubEventEnvelope) => void): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => this.emitter.off(CHANNEL, listener);
  }
}

// One process-wide bus -- every producer/consumer in the `ctxhub service` process shares it.
// Not exported as a class for callers to instantiate; deliberately a singleton, same as
// getCtxhubHome() being a function over a module constant (see workspaces/registry.ts) rather
// than something that could quietly drift into two disconnected buses.
export const eventBus = new EventBus();
