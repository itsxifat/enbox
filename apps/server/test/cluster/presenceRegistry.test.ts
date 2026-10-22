/**
 * Cluster presence registry (docs "Cluster" → "Presence"): several registries wired through
 * an in-memory bus behave like processes sharing Valkey pub/sub.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { BusTopics } from '../../src/cluster/bus.js';
import { PresenceRegistry, type PresenceEvents } from '../../src/cluster/presenceRegistry.js';

type Msg = {
  [K in keyof BusTopics]: { topic: K; data: BusTopics[K]; from: string };
}[keyof BusTopics];

/** N nodes on a fake bus; `deliver()` flushes queued messages (pub/sub is asynchronous). */
function cluster(ids: string[]) {
  let clock = 1_000_000;
  const queue: Msg[] = [];
  const cut = new Set<string>(); // nodes whose messages are dropped (network partition / crash)
  const events: Record<string, string[]> = {};
  const nodes = new Map<string, PresenceRegistry>();
  for (const id of ids) {
    const ee = new EventEmitter<PresenceEvents>();
    events[id] = [];
    ee.on('online', (u) => events[id]!.push(`online:${u}`));
    ee.on('offline', (u) => events[id]!.push(`offline:${u}`));
    ee.on('activity', (u) => events[id]!.push(`activity:${u}`));
    ee.on('lost', (us) => events[id]!.push(`lost:${us.join(',')}`));
    const reg = new PresenceRegistry(
      id,
      {
        publish: (topic, data) =>
          void (!cut.has(id) && queue.push({ topic, data, from: id } as Msg)),
      },
      ee,
      () => clock,
    );
    nodes.set(id, reg);
  }
  function deliver() {
    while (queue.length) {
      const m = queue.shift()!;
      for (const [id, reg] of nodes) {
        if (id === m.from || cut.has(id)) continue;
        switch (m.topic) {
          case 'presence:delta':
            reg.onDelta(m.from, m.data);
            break;
          case 'presence:snapshot':
            reg.onSnapshot(m.from, m.data);
            break;
          case 'presence:hello':
            reg.onHello(m.from);
            break;
          case 'presence:beat':
            reg.onBeat(m.from);
            break;
          case 'presence:bye':
            reg.onBye(m.from);
            break;
          default:
            break;
        }
      }
    }
  }
  return {
    node: (id: string) => nodes.get(id)!,
    events,
    deliver,
    cut,
    advance: (ms: number) => void (clock += ms),
    clearEvents: () => Object.values(events).forEach((e) => e.splice(0)),
  };
}

describe('PresenceRegistry across nodes', () => {
  it('a socket on one node makes the user online everywhere; the last disconnect anywhere makes them offline', () => {
    const c = cluster(['A', 'B']);
    c.node('A').markConnected('u1', 's1');
    c.deliver();
    expect([c.node('A').isOnline('u1'), c.node('B').isOnline('u1')]).toEqual([true, true]);
    expect(c.events).toEqual({ A: ['online:u1'], B: ['online:u1'] });

    // A second device on B: no new transition anywhere.
    c.clearEvents();
    c.node('B').markConnected('u1', 's2');
    c.deliver();
    expect(c.events).toEqual({ A: [], B: [] });

    // The first device leaves: still online (B has a socket); B's leaves: offline everywhere.
    expect(c.node('A').markDisconnected('u1', 's1')).toBe(true); // A's last local socket
    c.deliver();
    expect(c.node('B').isOnline('u1')).toBe(true);
    expect(c.events).toEqual({ A: [], B: [] });
    c.node('B').markDisconnected('u1', 's2');
    c.deliver();
    expect(c.events).toEqual({ A: ['offline:u1'], B: ['offline:u1'] });
    expect([c.node('A').isOnline('u1'), c.node('B').isOnline('u1')]).toEqual([false, false]);
  });

  it('auto-idle is cluster-wide: idle only when every socket on every node is idle', () => {
    const c = cluster(['A', 'B']);
    c.node('A').markConnected('u1', 's1');
    c.node('B').markConnected('u1', 's2');
    c.deliver();
    c.clearEvents();
    c.node('A').setSocketIdle('u1', 's1', true);
    c.deliver();
    expect([c.node('A').autoIdle('u1'), c.node('B').autoIdle('u1')]).toEqual([false, false]);
    expect(c.node('B').setSocketIdle('u1', 's2', true)).toBe(true);
    c.deliver();
    expect([c.node('A').autoIdle('u1'), c.node('B').autoIdle('u1')]).toEqual([true, true]);
    expect(c.events).toEqual({ A: ['activity:u1'], B: ['activity:u1'] });
    // A fresh (active) socket anywhere makes them active again.
    c.clearEvents();
    c.node('A').markConnected('u1', 's3');
    c.deliver();
    expect(c.node('B').autoIdle('u1')).toBe(false);
    expect(c.events).toEqual({ A: ['activity:u1'], B: ['activity:u1'] });
  });

  it('a node that joins late learns everyone through hello + snapshots', () => {
    const c = cluster(['A', 'B', 'C']);
    c.cut.add('C'); // C is not running yet
    c.node('A').markConnected('u1', 's1');
    c.node('B').markConnected('u2', 's2');
    c.deliver();
    expect(c.node('C').isOnline('u1')).toBe(false);
    c.cut.delete('C');
    c.node('C').announce();
    c.deliver();
    expect([c.node('C').isOnline('u1'), c.node('C').isOnline('u2')]).toEqual([true, true]);
    expect(c.node('C').knownNodes().sort()).toEqual(['A', 'B']);
  });

  it('a silent node is dropped after the TTL: its users go offline and are reported lost', () => {
    const c = cluster(['A', 'B']);
    c.node('B').markConnected('u1', 's1');
    c.node('A').markConnected('u2', 's2');
    c.node('B').markConnected('u2', 's3'); // also on A: stays online
    c.deliver();
    c.clearEvents();
    c.cut.add('B'); // B crashes: no more beats
    c.advance(10_000);
    c.node('A').tick(20_000);
    c.deliver();
    expect(c.node('A').isOnline('u1')).toBe(true);
    c.advance(15_000);
    c.node('A').tick(20_000);
    c.deliver();
    expect(c.node('A').isOnline('u1')).toBe(false);
    expect(c.node('A').isOnline('u2')).toBe(true);
    expect(c.events.A).toEqual(['offline:u1', 'lost:u1']);
  });

  it('a bye drops the node at once', () => {
    const c = cluster(['A', 'B']);
    c.node('B').markConnected('u1', 's1');
    c.deliver();
    c.node('A').onBye('B');
    expect(c.node('A').isOnline('u1')).toBe(false);
  });

  it('a beat from an unknown node triggers a resync (we missed its hello)', () => {
    const c = cluster(['A', 'B']);
    c.cut.add('A');
    c.node('B').markConnected('u1', 's1');
    c.deliver(); // A never heard about u1
    c.cut.delete('A');
    c.node('B').tick(20_000); // beat → A does not know B → hello → B answers with a snapshot
    c.deliver();
    expect(c.node('A').isOnline('u1')).toBe(true);
  });

  it('snapshots replace a node’s replica (users it no longer counts go offline)', () => {
    const c = cluster(['A', 'B']);
    c.node('B').markConnected('u1', 's1');
    c.deliver();
    c.clearEvents();
    c.node('A').onSnapshot('B', { entries: [['u2', 1, 0]], to: null });
    expect([c.node('A').isOnline('u1'), c.node('A').isOnline('u2')]).toEqual([false, true]);
    expect(c.events.A).toEqual(['offline:u1', 'online:u2']);
  });

  it('markDisconnected of an uncounted socket is a no-op', () => {
    const c = cluster(['A']);
    expect(c.node('A').markDisconnected('u1', 'nope')).toBe(false);
    expect(c.events.A).toEqual([]);
  });
});
