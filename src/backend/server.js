const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

function createBackendServer({
  engine,
  port = 0,
  host = '127.0.0.1',
  onOpenRoom = null,
  onSendToDesktop = null,
  onQuitApp = null,
} = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'cozy-cat-backend', time: Date.now() });
  });

  app.get('/api/state', (_req, res) => {
    res.json({ ok: true, state: engine.getSnapshot() });
  });

  app.post('/api/actions/:actionId', (req, res) => {
    const source = req.body && req.body.source ? req.body.source : 'room';
    const result = engine.performAction(req.params.actionId, { source });
    if (!result.ok) {
      const status = result.reason === 'unknown_action' ? 404 : 409;
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  app.post('/api/room', (req, res) => {
    const body = req.body || {};
    if (body.currentRoom !== undefined) {
      const resRoom = engine.switchRoom(body.currentRoom);
      if (!resRoom.ok) return res.status(400).json(resRoom);
    }
    const decorPatch = {};
    for (const key of ['wall', 'floor', 'couch', 'fireplace', 'bookshelf']) {
      if (body[key] !== undefined) decorPatch[key] = body[key];
    }
    const result = engine.updateDecor(decorPatch);
    return res.json(result);
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ ok: true, settings: engine.getSnapshot().settings });
  });

  app.put('/api/settings', (req, res) => {
    const result = engine.updateSettings(req.body || {});
    res.json(result);
  });

  app.post('/api/settings/reset', (_req, res) => {
    const result = engine.resetSettingsToDefault();
    res.json(result);
  });

  app.post('/api/overlay/roaming', (req, res) => {
    const body = req.body || {};
    const result =
      body.roaming === undefined
        ? engine.toggleOverlayRoaming()
        : engine.setOverlayRoaming(body.roaming);
    res.json(result);
  });

  app.post('/api/overlay/position', (req, res) => {
    const { x, y } = req.body || {};
    const result = engine.setOverlayPosition(x, y);
    res.json(result);
  });

  app.post('/api/overlay/hint-dismiss', (_req, res) => {
    res.json(engine.dismissOverlayHintBubble());
  });

  app.post('/api/overlay/open-room', (_req, res) => {
    if (typeof onOpenRoom === 'function') onOpenRoom();
    res.json({ ok: true });
  });

  app.post('/api/overlay/send-to-desktop', (_req, res) => {
    if (typeof onSendToDesktop === 'function') onSendToDesktop();
    res.json({ ok: true });
  });

  app.post('/api/overlay/quit', (_req, res) => {
    res.json({ ok: true });
    if (typeof onQuitApp === 'function') {
      setImmediate(() => onQuitApp());
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state:update', data: engine.getSnapshot() }));
  });

  const onStateUpdate = (snapshot) => broadcast('state:update', snapshot);
  const onActionStarted = (payload) => broadcast('action:started', payload);
  const onActionBlocked = (payload) => broadcast('action:blocked', payload);

  engine.on('state:update', onStateUpdate);
  engine.on('action:started', onActionStarted);
  engine.on('action:blocked', onActionBlocked);

  return {
    app,
    server,
    wss,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve({
            host: addr.address,
            port: addr.port,
            baseUrl: `http://${addr.address}:${addr.port}`,
            wsUrl: `ws://${addr.address}:${addr.port}/ws`,
          });
        });
      });
    },
    stop() {
      engine.off('state:update', onStateUpdate);
      engine.off('action:started', onActionStarted);
      engine.off('action:blocked', onActionBlocked);
      return new Promise((resolve) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close(() => {
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          server.close(() => resolve());
        });
      });
    },
  };
}

module.exports = { createBackendServer };
