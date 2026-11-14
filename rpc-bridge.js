/*
 * Pixel Corsa -> local Discord RPC Companion bridge.
 * Sends only game status (screen, track, lap, speed, DRS, elapsed time) to 127.0.0.1.
 * If the companion is not running, it quietly retries and never interrupts gameplay.
 */
(() => {
  'use strict';
  const ENDPOINT = 'ws://127.0.0.1:47832/game';
  let socket = null;
  let retryTimer = null;
  let latestState = null;
  let stopped = false;
  let lastSentSignature = '';

  function sendLatest(force = false) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !latestState) return;
    const signature = JSON.stringify(latestState);
    if (!force && signature === lastSentSignature) return;
    try {
      socket.send(JSON.stringify({ type: 'presence', ...latestState }));
      lastSentSignature = signature;
    } catch { /* Companion may be closing; reconnect will retry the latest snapshot. */ }
  }
  function connect() {
    if (stopped || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
    try { socket = new WebSocket(ENDPOINT); }
    catch { scheduleReconnect(); return; }
    const activeSocket = socket;
    activeSocket.addEventListener('open', () => {
      if (socket !== activeSocket) return;
      lastSentSignature = '';
      sendLatest(true);
    });
    activeSocket.addEventListener('message', () => { /* Reserved for future companion messages. */ });
    activeSocket.addEventListener('error', () => {
      try { activeSocket.close(); } catch { /* reconnect below */ }
    });
    activeSocket.addEventListener('close', () => {
      if (socket === activeSocket) socket = null;
      scheduleReconnect();
    });
  }
  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 2200);
  }
  function update(state) {
    if (!state || typeof state !== 'object') return;
    latestState = {
      screen: ['main', 'settings', 'track-select', 'racing', 'paused'].includes(state.screen) ? state.screen : 'main',
      track: state.track === 'tck02' ? 'tck02' : 'tck01',
      lap: Number.isFinite(Number(state.lap)) ? Number(state.lap) : 1,
      speedKmh: Number.isFinite(Number(state.speedKmh)) ? Number(state.speedKmh) : 0,
      elapsedSeconds: Number.isFinite(Number(state.elapsedSeconds)) ? Number(state.elapsedSeconds) : 0,
      lapTimeSeconds: Number.isFinite(Number(state.lapTimeSeconds)) ? Number(state.lapTimeSeconds) : 0,
      drs: Boolean(state.drs)
    };
    sendLatest();
    if (!socket || socket.readyState > WebSocket.OPEN) connect();
  }
  window.PixelCorsaRPC = Object.freeze({ update });
  connect();
  // Browser unload cleanup is best effort; the companion also expires stale game status.
  window.addEventListener('pagehide', () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'closed' }));
        socket.close(1000, 'Game page closed');
      }
    } catch { /* The companion has a stale-connection timeout as a fallback. */ }
  });
})();
