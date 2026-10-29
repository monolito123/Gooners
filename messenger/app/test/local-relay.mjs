// Minimal in-memory Nostr relay (NIP-01 + replaceable events) for end-to-end tests and local
// development. Not for production.   node test/local-relay.mjs [port]
import { WebSocketServer } from 'ws';

export function startRelay(port = 7777) {
  const events = [];
  const wss = new WebSocketServer({ port, maxPayload: 1 << 20 });
  const subs = new Map(); // ws -> Map<subId, filters>

  const matches = (f, e) =>
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    (!f.ids || f.ids.includes(e.id)) &&
    (f.since === undefined || e.created_at >= f.since) &&
    (f.until === undefined || e.created_at <= f.until) &&
    Object.entries(f)
      .filter(([k]) => k.startsWith('#'))
      .every(([k, vals]) => e.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1])));

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const [type, ...rest] = msg;
      if (type === 'EVENT') {
        const e = rest[0];
        if (events.some((x) => x.id === e.id)) return ws.send(JSON.stringify(['OK', e.id, true, 'duplicate:']));
        if (e.kind >= 30000 && e.kind < 40000) {
          const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
          for (let i = events.length - 1; i >= 0; i--) {
            const x = events[i];
            if (x.kind === e.kind && x.pubkey === e.pubkey && (x.tags.find((t) => t[0] === 'd')?.[1] ?? '') === d) events.splice(i, 1);
          }
        }
        events.push(e);
        ws.send(JSON.stringify(['OK', e.id, true, '']));
        for (const [client, m] of subs) for (const [id, filters] of m) if (filters.some((f) => matches(f, e))) client.send(JSON.stringify(['EVENT', id, e]));
      } else if (type === 'REQ') {
        const [id, ...filters] = rest;
        subs.get(ws).set(id, filters);
        for (const e of events) if (filters.some((f) => matches(f, e))) ws.send(JSON.stringify(['EVENT', id, e]));
        ws.send(JSON.stringify(['EOSE', id]));
      } else if (type === 'CLOSE') {
        subs.get(ws).delete(rest[0]);
      }
    });
    ws.on('close', () => subs.delete(ws));
  });
  return { wss, events, close: () => new Promise((r) => wss.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 7777);
  startRelay(port);
  console.log(`local relay on ws://localhost:${port}`);
}
