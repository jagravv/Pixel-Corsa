(() => {
  "use strict";

  const W = 800, TRACK_H = 400, H = 400;
  const FINISH_X = 400, STRAIGHT_TOP = 300, STRAIGHT_BOTTOM = 360;
  const TRACK_SCALE_TCK01 = 1.45, TRACK_SCALE_TCK02 = 0.72, SCENE_H = 400;
  // TCK-02's complete PNG is upscaled 1.5x with nearest-neighbour filtering.
  // The layout still uses 1.6x world scaling; camera zoom and car screen-size stay unchanged.
  const TCK02_ART_SCALE = 1.5;
  const TCK02_LAYOUT_SCALE = 1.6;
  const TCK02_SOURCE_WIDTH = 2400, TCK02_SOURCE_HEIGHT = 1350;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const motionTrailCanvas = document.createElement("canvas");
  motionTrailCanvas.width = W; motionTrailCanvas.height = TRACK_H;
  const motionTrailCtx = motionTrailCanvas.getContext("2d");
  const sceneSnapshot = document.createElement("canvas");
  sceneSnapshot.width = W; sceneSnapshot.height = TRACK_H;
  const sceneSnapshotCtx = sceneSnapshot.getContext("2d");
  const menu = document.getElementById("menu");
  const pages = {
    main: document.getElementById("mainPage"),
    experimental: document.getElementById("experimentalPage"),
    pause: document.getElementById("pausePage"),
    levels: document.getElementById("levelsPage"),
    settings: document.getElementById("settingsPage"),
    multiplayer: document.getElementById("multiplayerPage"),
    lanLobby: document.getElementById("lanLobbyPage"),
    timeAttack: document.getElementById("timeAttackPage")
  };
  const decodeMask = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  function readTrackSelection() {
    try { return localStorage.getItem("pixelRacerTrack") === "tck02" ? "tck02" : "tck01"; }
    catch (_) { return "tck01"; }
  }
  const trackCatalog = {
    tck01: {
      id: "tck01", name: "TCK - 01", width: 800, height: 400,
      image: new Image(), roadMask: decodeMask(TRACK_MASK_BASE64), kerbMask: decodeMask(KERB_MASK_BASE64),
      maskWidth: 400, maskHeight: 200,
      spawn: { x: 660, y: 330, heading: Math.PI },
      finish: { x: FINISH_X, yMin: STRAIGHT_TOP, yMax: STRAIGHT_BOTTOM, direction: -1 },
      carRenderHeight: 65, wheelScale: 11.5
    },
    tck02: {
      id: "tck02", name: "TCK - 02", width: TCK02_SOURCE_WIDTH * TCK02_LAYOUT_SCALE, height: TCK02_SOURCE_HEIGHT * TCK02_LAYOUT_SCALE,
      image: new Image(),
      roadMask: decodeMask(TCK02_ROAD_MASK_BASE64), kerbMask: decodeMask(TCK02_KERB_MASK_BASE64),
      maskWidth: TCK02_MASK_WIDTH, maskHeight: TCK02_MASK_HEIGHT,
      // Spawn and gate coordinates scale with the 1.5x enlarged artwork.
      spawn: { x: 1330 * TCK02_ART_SCALE * TCK02_LAYOUT_SCALE, y: 770 * TCK02_ART_SCALE * TCK02_LAYOUT_SCALE, heading: Math.PI },
      // Match timing to the supplied artwork's lower-straight white line at x=474..483, y=725..814.
      finish: { x: 480 * TCK02_ART_SCALE * TCK02_LAYOUT_SCALE, yMin: 725 * TCK02_ART_SCALE * TCK02_LAYOUT_SCALE, yMax: 814 * TCK02_ART_SCALE * TCK02_LAYOUT_SCALE, direction: -1 },
      // Two DRS straights, aligned to the visible DRS boards/poles in the complete supplied PNG.
      // Coordinates below are supplied-image pixels converted into world units. Central straight
      // travels left-to-right; lower straight travels right-to-left. Eligibility starts only after
      // crossing the corresponding visible DRS mark in the correct direction.
      drsZones: [
        { id: "central", detectX: 1190 * TCK02_LAYOUT_SCALE, direction: 1,
          minX: 1190 * TCK02_LAYOUT_SCALE, maxX: 1880 * TCK02_LAYOUT_SCALE,
          yMin: 740 * TCK02_LAYOUT_SCALE, yMax: 890 * TCK02_LAYOUT_SCALE },
        { id: "lower", detectX: 1715 * TCK02_LAYOUT_SCALE, direction: -1,
          minX: 350 * TCK02_LAYOUT_SCALE, maxX: 1715 * TCK02_LAYOUT_SCALE,
          yMin: 1070 * TCK02_LAYOUT_SCALE, yMax: 1230 * TCK02_LAYOUT_SCALE }
      ],
      // Match the reference screenshot: same rendered car scale and wheel-contact scale as TCK-01.
      carRenderHeight: 65, wheelScale: 11.5
    }
  };
  trackCatalog.tck01.image.src = "assets/track.png";
  trackCatalog.tck02.image.src = "assets/tracks/TCK-02.png";
  let activeTrackId = readTrackSelection();
  let activeTrack = trackCatalog[activeTrackId];

  // Targets are seconds. Each medal is checked independently against the saved best lap.
  // Corsa is the Author-Medal equivalent and uses the exact per-track targets requested.
  const MEDAL_TARGETS = {
    tck01: { copper: 55, iron: 37, gold: 35.5, corsa: 34 },
    tck02: { copper: 140, iron: 120, gold: 117, corsa: 113.21 }
  };
  const MEDAL_TIERS = [
    { id: "copper", label: "Copper", rank: 1, src: "assets/medals/copper_coin.png" },
    { id: "iron", label: "Iron", rank: 2, src: "assets/medals/iron_coin.png" },
    { id: "gold", label: "Gold", rank: 3, src: "assets/medals/gold_coin.png" },
    { id: "corsa", label: "Corsa", rank: 4, src: "assets/medals/corsa_coin.png" }
  ];
  const MEDAL_STORAGE_KEY = "pixelCorsaTrackMedalsV1";
  const GHOST_STORAGE_KEY = "pixelCorsaGhostsV1";
  const STATS_STORAGE_KEY = "pixelCorsaStatsV1";
  const TIME_ATTACK_CONFIG_KEY = "pixelCorsaTimeAttackConfigV1";
  function readStoredObject(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value && typeof value === "object" ? value : fallback; }
    catch (_) { return fallback; }
  }
  function isUsableGhost(record) {
    if (!record || !Array.isArray(record.samples) || record.samples.length < 2 || record.samples.length > 12000) return false;
    let previous = null;
    for (const sample of record.samples) {
      if (!sample || ![sample.t, sample.x, sample.y, sample.heading, sample.distance].every(Number.isFinite) || sample.t < 0 || sample.distance < 0) return false;
      if (previous && (sample.t <= previous.t || sample.distance < previous.distance)) return false;
      previous = sample;
    }
    return true;
  }
  let ghostRecords = readStoredObject(GHOST_STORAGE_KEY, { tck01: null, tck02: null });
  let driverStats = readStoredObject(STATS_STORAGE_KEY, { tck01: { laps: 0, valid: 0, history: [] }, tck02: { laps: 0, valid: 0, history: [] } });
  let timeAttackConfig = readStoredObject(TIME_ATTACK_CONFIG_KEY, { ghost: true });
  let currentLapSamples = [], ghostSampleClock = 0, lapDistance = 0, sectorSplits = [], nextSector = 1;
  let lastGhostDrawPoint = null;
  const SECTOR_STORAGE_KEY = "pixelCorsaSectorRecordsV1";
  let sectorRecords = readStoredObject(SECTOR_STORAGE_KEY, { tck01: null, tck02: null });
  const ghostSprites = {};
  for (const [key, file] of Object.entries({ center:"ghost_pixelracer.png", left:"ghost_pixelracer_left.png", right:"ghost_pixelracer_right.png", drsCenter:"ghost_pixelracer_drs.png", drsLeft:"ghost_pixelracer_left_drs.png", drsRight:"ghost_pixelracer_right_drs.png" })) {
    const image = new Image(); image.src = `assets/ghosts/${file}`; ghostSprites[key] = image;
  }
  const sectorPanelImage = new Image(); sectorPanelImage.src = "assets/ghosts/sector_bg.png";
  let sessionFastestSectors = [null, null, null];
  function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Storage may be unavailable. */ } }
  function updateTimeAttackStats() {
    const el = document.getElementById("timeAttackStats"); if (!el) return;
    const id = document.getElementById("timeAttackTrack")?.value || activeTrackId;
    const stat = driverStats[id] || { laps: 0, valid: 0, history: [] };
    const best = getTrackRecord(id).best;
    const ghost = ghostRecords[id];
    const bestSectors = sectorRecords[id] && Array.isArray(sectorRecords[id].best) ? sectorRecords[id].best : [];
    const history = Array.isArray(stat.history) ? stat.history : [];
    const avg = history.length ? history.reduce((a,b)=>a+b,0)/history.length : null;
    const values = [
      ["PERSONAL BEST", formatLapTime(best)],
      ["LAPS", String(stat.laps || 0)],
      ["VALID", String(stat.valid || 0)],
      ["AVERAGE", formatLapTime(avg)],
      ["GHOST", isUsableGhost(ghost) ? "READY" : "NOT SET"],
      ["S1 BEST", Number.isFinite(bestSectors[0]) ? bestSectors[0].toFixed(3) : "--.---"],
      ["S2 BEST", Number.isFinite(bestSectors[1]) ? bestSectors[1].toFixed(3) : "--.---"],
      ["S3 BEST", Number.isFinite(bestSectors[2]) ? bestSectors[2].toFixed(3) : "--.---"]
    ];
    el.replaceChildren(...values.map(([label, value]) => {
      const item = document.createElement("span");
      item.className = "time-attack-stat";
      const caption = document.createElement("small"); caption.textContent = label;
      const result = document.createElement("strong"); result.textContent = value;
      item.append(caption, result);
      return item;
    }));
  }
  function recordGhostSample(force = false) {
    if (!state.gateArmed || state.lapInvalid) return;
    ghostSampleClock += state.frameDt || 0;
    if (!force && ghostSampleClock < 0.05) return;
    ghostSampleClock = 0;
    const t = Math.max(0, state.elapsed - state.lapStart);
    const last = currentLapSamples[currentLapSamples.length - 1];
    if (!last || t > last.t) currentLapSamples.push({ t, x: state.x, y: state.y, heading: state.heading, distance: lapDistance, drsOpen: !!state.drsOpen });
  }
  function interpolateGhost(samples, t) {
    if (!samples || samples.length < 2 || t < 0 || t > samples[samples.length - 1].t) return null;
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid; }
    const a = samples[lo], b = samples[hi], f = (t - a.t) / Math.max(0.0001, b.t - a.t);
    let da = b.heading - a.heading; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    return { x: a.x + (b.x-a.x)*f, y: a.y + (b.y-a.y)*f, heading: a.heading + da*f, drsOpen: f < 0.5 ? !!a.drsOpen : !!b.drsOpen, steerDir: da < -0.012 ? "left" : da > 0.012 ? "right" : "center" };
  }
  function interpolateGhostDistance(samples, distance) {
    if (!samples || samples.length < 2 || distance < 0 || distance > samples[samples.length - 1].distance) return null;
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].distance <= distance) lo = mid; else hi = mid; }
    const a = samples[lo], b = samples[hi], f = (distance - a.distance) / Math.max(0.0001, b.distance - a.distance);
    let da = b.heading - a.heading; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    return { x: a.x + (b.x-a.x)*f, y: a.y + (b.y-a.y)*f, heading: a.heading + da*f, t: a.t + (b.t-a.t)*f, drsOpen: f < 0.5 ? !!a.drsOpen : !!b.drsOpen, steerDir: da < -0.012 ? "left" : da > 0.012 ? "right" : "center" };
  }
  function getGhostSectorTimes(record) {
    if (!isUsableGhost(record)) return null;
    const samples = record.samples;
    const distance = samples[samples.length - 1].distance;
    if (!(distance > 0)) return null;
    const cumulative = [1, 2].map(sector => interpolateGhostDistance(samples, distance * sector / 3)?.t);
    if (!cumulative.every(Number.isFinite)) return null;
    const finish = Number.isFinite(record.time) ? record.time : samples[samples.length - 1].t;
    return [cumulative[0], cumulative[1] - cumulative[0], finish - cumulative[1]];
  }

  function loadMedalRecords() {
    const records = { tck01: { best: null }, tck02: { best: null } };
    try {
      const saved = JSON.parse(localStorage.getItem(MEDAL_STORAGE_KEY) || "null");
      for (const id of Object.keys(records)) {
        const best = saved && saved[id] ? saved[id].best : null;
        if (Number.isFinite(best) && best > 0 && best < 36000) records[id].best = best;
      }
    } catch (_) { /* Private browsing and file:// origins may block persistent storage. */ }
    return records;
  }
  let medalRecords = loadMedalRecords();
  const medalImages = Object.fromEntries(MEDAL_TIERS.map(tier => {
    const image = new Image(); image.src = tier.src; return [tier.id, image];
  }));
  function getTrackRecord(trackId) {
    return medalRecords[trackId] || { best: null };
  }
  function formatLapTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--.--";
    const minutes = Math.floor(seconds / 60);
    const remaining = (seconds - minutes * 60).toFixed(2).padStart(5, "0");
    return `${minutes}:${remaining}`;
  }
  function earnedMedalsForTime(trackId, seconds) {
    const targets = MEDAL_TARGETS[trackId];
    if (!targets || !Number.isFinite(seconds)) return [];
    return MEDAL_TIERS
      .filter(tier => Number.isFinite(targets[tier.id]) && seconds <= targets[tier.id])
      .map(tier => tier.id);
  }
  function medalRank(medalId) {
    const tier = MEDAL_TIERS.find(entry => entry.id === medalId);
    return tier ? tier.rank : 0;
  }
  function saveTrackBest(trackId, best) {
    medalRecords[trackId] = { best };
    try { localStorage.setItem(MEDAL_STORAGE_KEY, JSON.stringify(medalRecords)); }
    catch (_) { /* Progress still lasts for the current tab if storage is unavailable. */ }
    refreshTrackMedalCards();
  }
  function refreshTrackMedalCards() {
    for (const trackId of Object.keys(MEDAL_TARGETS)) {
      const best = getTrackRecord(trackId).best;
      const targets = MEDAL_TARGETS[trackId];
      const strip = document.querySelector(`[data-medal-track="${trackId}"]`);
      if (strip) {
        for (const badge of strip.querySelectorAll(".medal-badge")) {
          const medalId = badge.dataset.medal;
          const target = targets[medalId];
          const unlocked = Number.isFinite(best) && best <= target;
          badge.classList.toggle("unlocked", unlocked);
          const targetLabel = badge.querySelector(".medal-target");
          // Keep the Corsa target secret until this track's Corsa medal has been earned.
          // Do not leak its time through the badge tooltip either.
          if (medalId === "corsa" && !unlocked) {
            badge.title = "Corsa medal — locked";
            if (targetLabel) targetLabel.textContent = "LOCKED";
            badge.setAttribute("aria-label", "Corsa medal locked; target time hidden");
          } else {
            badge.title = `${medalId[0].toUpperCase() + medalId.slice(1)} medal target: ${formatLapTime(target)}${unlocked ? " — unlocked" : " — not yet earned"}`;
            if (targetLabel) targetLabel.textContent = formatLapTime(target);
            badge.setAttribute("aria-label", `${medalId[0].toUpperCase() + medalId.slice(1)} medal${unlocked ? " unlocked" : " not yet earned"}, target ${formatLapTime(target)}`);
          }
        }
      }
      const recordLabel = document.querySelector(`[data-track-best="${trackId}"]`);
      if (recordLabel) recordLabel.textContent = Number.isFinite(best) ? `PB ${formatLapTime(best)}` : "PB --:--.--";
    }
  }
  // Seamless repeating grass outside the finite track artwork. The source PNG is used unchanged.
  const grassTexture = new Image();
  grassTexture.src = "assets/grass-texture.png";
  let grassPattern = null;
  grassTexture.addEventListener("load", () => {
    grassPattern = ctx.createPattern(grassTexture, "repeat");
    if (grassPattern && typeof grassPattern.setTransform === "function") {
      // Keeps individual grass pixels close to the scale of the existing track artwork.
      grassPattern.setTransform(new DOMMatrix().scale(0.65));
    }
  });
  let tck02GrassPattern = null;
  grassTexture.addEventListener("load", () => {
    tck02GrassPattern = ctx.createPattern(grassTexture, "repeat");
    if (tck02GrassPattern && typeof tck02GrassPattern.setTransform === "function") {
      // Match the 1.5x enlarged map texture scale outside the finite artwork.
      tck02GrassPattern.setTransform(new DOMMatrix().scale(TCK02_LAYOUT_SCALE * TCK02_ART_SCALE));
    }
  });
  // Built-in car liveries only. The custom pixel livery editor was removed in v0.2.4.
  const SPRITE_WIDTH = 24, SPRITE_HEIGHT = 34;
  const BASE_LIVERIES = [
    { id: "redbull", name: "Red Bull", base: "assets/cars/redbull_pixelracer" },
    { id: "ferrari", name: "Ferrari", base: "assets/cars/ferrari_pixelracer" },
    { id: "mclaren", name: "McLaren", base: "assets/cars/mclaren_pixelracer" }
  ];
  for (const livery of BASE_LIVERIES) {
    livery.center = new Image(); livery.left = new Image(); livery.right = new Image();
    livery.center.src = livery.base + ".png";
    livery.left.src = livery.base + "_left.png";
    livery.right.src = livery.base + "_right.png";
    livery.drsCenter = new Image(); livery.drsLeft = new Image(); livery.drsRight = new Image();
    livery.drsCenter.src = livery.base + "_drs.png";
    livery.drsLeft.src = livery.base + "_left_drs.png";
    livery.drsRight.src = livery.base + "_right_drs.png";
  }
  function spriteIsReady(sprite) {
    if (!sprite) return false;
    return sprite instanceof HTMLCanvasElement ? sprite.width > 0 && sprite.height > 0 : !!(sprite.complete && sprite.naturalWidth > 0);
  }
  function spriteDimensions(sprite) {
    return { width: sprite && (sprite.naturalWidth || sprite.width) || SPRITE_WIDTH,
      height: sprite && (sprite.naturalHeight || sprite.height) || SPRITE_HEIGHT };
  }
  function getLiverySprite(livery, frameKey) {
    return livery ? livery[frameKey] || null : null;
  }
  function getPlayerSpriteForCurrentFrame() {
    const steerLeft = keys.has(bindings.left), steerRight = keys.has(bindings.right);
    const steerDir = steerLeft && !steerRight ? "left" : steerRight && !steerLeft ? "right" : "center";
    const livery = currentLivery();
    const drsKey = { left: "drsLeft", right: "drsRight", center: "drsCenter" }[steerDir];
    const normal = getLiverySprite(livery, steerDir);
    const drsSprite = getLiverySprite(livery, drsKey);
    const requested = state.drsLevel > 0.5 && spriteIsReady(drsSprite) ? drsSprite : normal;
    const sprite = spriteIsReady(requested) ? requested : getLiverySprite(livery, "center");
    return spriteIsReady(sprite) ? sprite : null;
  }
  function getPlayerCarRenderSize() {
    const sprite = getPlayerSpriteForCurrentFrame();
    const dimensions = spriteDimensions(sprite);
    const height = activeTrack.carRenderHeight;
    return { width: height * dimensions.width / dimensions.height, height };
  }
  let liveryId = loadLivery();
  const actions = [
    ["accelerate", "Accelerate"], ["brake", "Brake / Reverse"],
    ["left", "Steer Left"], ["right", "Steer Right"],
    ["clutch", "Clutch (hold)"], ["shiftUp", "Upshift"], ["shiftDown", "Downshift"],
    ["startEngine", "Start / Restart Engine"], ["drs", "DRS (toggle)"], ["reset", "Reset Car"]
  ];
  const defaults = { accelerate: "KeyW", brake: "KeyS", left: "KeyA", right: "KeyD",
    clutch: "KeyC", shiftUp: "KeyE", shiftDown: "KeyQ", startEngine: "KeyI", drs: "KeyF", reset: "KeyR" };
  let bindings = loadBindings();
  let gearboxMode = loadGearboxMode();
  let customize = loadCustomize();
  let guiTheme = loadGuiTheme();
  let mode = "menu", listeningAction = null;
  const keys = new Set();
  const lan = {
    socket: null, connectPromise: null, playerId: null, room: null, isHost: false, ready: false,
    raceActive: false, playerFinished: false, gridIndex: 0, raceLength: "3", lastStateSentAt: 0,
    selectedName: "Driver", selectedLivery: liveryId, remotes: new Map(), countdownTimer: null,
    countdownStartAt: 0, lastError: "", localPaused: false, serverAddresses: [], shareAddress: ""
  };
  let cameraX = activeTrack.spawn.x, cameraY = activeTrack.spawn.y;
  let gameNotice = "", gameNoticeUntil = 0;
  let medalAwardToast = null;
  let runtimeFault = null;
  const state = {
    x: activeTrack.spawn.x, y: activeTrack.spawn.y, heading: activeTrack.spawn.heading, vx: 0, vy: 0,
    forwardSpeed: 0, lateralSpeed: 0, yawRate: 0, longAccel: 0, steering: 0,
    laps: 0, best: getTrackRecord(activeTrackId).best, elapsed: 0, lapStart: 0, started: false,
    gateArmed: false, lapInvalid: false, offTrackTime: 0, frameDt: 0,
    gear: 0, engineRunning: true, engineRpm: 1000,
    freeRpm: 950, clutchEngagement: 1, speed: 0,
    drsOpen: false, drsLevel: 0, drsZone: null, revLimiterActive: false
  };

  function loadBindings() {
    try {
      const saved = JSON.parse(localStorage.getItem("pixelRacerBindings") || "null");
      if (saved) {
        const merged = { ...defaults, ...saved };
        // Older saves have no DRS key: give it the default, or the first free letter if that key is taken.
        if (!isAllowedBinding(saved.drs) || actions.some(([id]) => id !== "drs" && merged[id] === merged.drs)) {
          const taken = new Set(actions.filter(([id]) => id !== "drs").map(([id]) => merged[id]));
          merged.drs = ["KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "KeyX", "KeyZ", "KeyV", "KeyB"].find(code => !taken.has(code)) || "KeyF";
        }
        if (actions.every(([id]) => isAllowedBinding(merged[id])) &&
            new Set(actions.map(([id]) => merged[id])).size === actions.length) {
          return merged;
        }
      }
    } catch (_) { /* Storage may be disabled for local files. */ }
    return { ...defaults };
  }

  function saveBindings() {
    try { localStorage.setItem("pixelRacerBindings", JSON.stringify(bindings)); }
    catch (_) { /* The bindings still work for this session. */ }
  }

  function loadGearboxMode() {
    try { return localStorage.getItem("pixelRacerGearbox") === "sequential" ? "sequential" : "clutch"; }
    catch (_) { return "clutch"; }
  }

  function saveGearboxMode(value) {
    gearboxMode = value === "sequential" ? "sequential" : "clutch";
    try { localStorage.setItem("pixelRacerGearbox", gearboxMode); }
    catch (_) { /* Keep the selection for this session. */ }
    updateGearboxHint();
  }

  function currentLivery() { return BASE_LIVERIES.find(l => l.id === liveryId) || BASE_LIVERIES[0]; }

  function loadLivery() {
    const fallback = BASE_LIVERIES[0].id;
    try {
      const saved = localStorage.getItem("pixelRacerLivery");
      if (BASE_LIVERIES.some(l => l.id === saved)) return saved;
      // Old builds may have saved a custom-editor skin ID. Migrate it to Red Bull.
      if (saved) localStorage.setItem("pixelRacerLivery", fallback);
    } catch (_) { /* Storage may be disabled for local files. */ }
    return fallback;
  }

  function saveLivery(id) {
    liveryId = BASE_LIVERIES.some(l => l.id === id) ? id : BASE_LIVERIES[0].id;
    try { localStorage.setItem("pixelRacerLivery", liveryId); }
    catch (_) { /* The selection still works for this session. */ }
    buildLiveryList();
  }

  function buildLiveryList() {
    const list = document.getElementById("liveryList");
    if (!list) return;
    list.replaceChildren();
    for (const livery of BASE_LIVERIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "livery-card" + (livery.id === liveryId ? " selected" : "");
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(livery.id === liveryId));
      button.setAttribute("aria-label", livery.name);
      const preview = document.createElement("canvas");
      preview.width = SPRITE_WIDTH; preview.height = SPRITE_HEIGHT;
      const draw = () => {
        const pctx = preview.getContext("2d");
        pctx.imageSmoothingEnabled = false;
        pctx.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
        if (spriteIsReady(livery.center)) pctx.drawImage(livery.center, 0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
      };
      if (spriteIsReady(livery.center)) draw();
      else if (livery.center && !livery.center.complete) livery.center.addEventListener("load", draw, { once: true });
      const name = document.createElement("span");
      name.className = "livery-name"; name.textContent = livery.name;
      button.append(preview, name);
      button.addEventListener("click", () => saveLivery(livery.id));
      list.append(button);
    }
  }

  function defaultGuiTheme() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "oled" : "light";
    } catch (_) { return "oled"; }
  }

  function loadGuiTheme() {
    try {
      const saved = localStorage.getItem("pixelRacerGuiTheme");
      return ["dark", "oled", "light"].includes(saved) ? saved : defaultGuiTheme();
    } catch (_) { return defaultGuiTheme(); }
  }

  function applyGuiTheme(save = false) {
    guiTheme = ["dark", "oled", "light"].includes(guiTheme) ? guiTheme : defaultGuiTheme();
    document.documentElement.dataset.guiTheme = guiTheme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const themeChromeColors = { dark: "#101719", oled: "#000000", light: "#e8e8e8" };
    if (themeColor) themeColor.content = themeChromeColors[guiTheme];
    const selector = document.getElementById("guiTheme");
    if (selector) selector.value = guiTheme;
    if (save) {
      try { localStorage.setItem("pixelRacerGuiTheme", guiTheme); }
      catch (_) { /* Theme remains selected until this page closes. */ }
    }
  }

  function loadCustomize() {
    const fallback = { accent: "#d8c99a", background: "#17212b", opacity: 100 };
    try {
      const saved = JSON.parse(localStorage.getItem("pixelRacerCustomize") || "null");
      return {
        accent: saved && /^#[0-9a-f]{6}$/i.test(saved.accent) ? saved.accent : fallback.accent,
        background: saved && /^#[0-9a-f]{6}$/i.test(saved.background) ? saved.background : fallback.background,
        opacity: saved && Number.isFinite(Number(saved.opacity))
          ? Math.max(20, Math.min(100, Number(saved.opacity))) : fallback.opacity
      };
    } catch (_) { return fallback; }
  }

  function hexToRgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }

  function applyCustomize(save = false) {
    // If the background is still the untouched default, harmonize the panel with the selected GUI theme.
    const themePanelDefaults = { dark: "#17212b", oled: "#000000", light: "#f7f7f7" };
    const useThemeDefault = customize.background.toLowerCase() === "#17212b";
    const panelHex = useThemeDefault ? themePanelDefaults[guiTheme] : customize.background;
    const rgb = hexToRgb(panelHex);
    const panel = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${customize.opacity / 100})`;
    const channel = value => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    const panelIsLight = luminance > 0.42;
    document.documentElement.style.setProperty("--accent", customize.accent);
    document.documentElement.style.setProperty("--ui-panel", panel);
    document.documentElement.style.setProperty("--panel-text", panelIsLight ? "#202020" : "#f7e8b2");
    document.documentElement.style.setProperty("--panel-muted", panelIsLight ? "#505050" : "#c2c9ba");
    const accentInput = document.getElementById("accentColor");
    const backgroundInput = document.getElementById("backgroundColor");
    const opacityInput = document.getElementById("backgroundOpacity");
    if (accentInput) accentInput.value = customize.accent;
    if (backgroundInput) backgroundInput.value = panelHex;
    if (opacityInput) opacityInput.value = customize.opacity;
    const opacityValue = document.getElementById("opacityValue");
    if (opacityValue) opacityValue.value = `${customize.opacity}%`;
    if (save) {
      try { localStorage.setItem("pixelRacerCustomize", JSON.stringify(customize)); }
      catch (_) { /* Custom colors remain active until the page closes. */ }
    }
  }

  function activateSettingsTab(tab) {
    document.querySelectorAll("[data-settings-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.settingsTab === tab);
    });
    document.getElementById("controlsPanel").classList.toggle("active", tab === "controls");
    document.getElementById("carPanel").classList.toggle("active", tab === "car");
    document.getElementById("customizePanel").classList.toggle("active", tab === "customize");
  }

  function updateGearboxHint() {
    const select = document.getElementById("gearboxType");
    const hint = document.getElementById("gearboxHint");
    if (select) select.value = gearboxMode;
    if (hint) hint.textContent = gearboxMode === "clutch"
      ? "Hold the clutch for every shift. Release it gradually when pulling away."
      : "Shift without the clutch; it briefly cuts drive. Use the clutch to pull away smoothly from a stop.";
  }

  function labelFor(code) {
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return ({ ArrowUp: "UP ARROW", ArrowDown: "DOWN ARROW", ArrowLeft: "LEFT ARROW", ArrowRight: "RIGHT ARROW" })[code] || code;
  }

  function buildControls() {
    const controls = document.getElementById("controls");
    controls.replaceChildren();
    for (const [id, label] of actions) {
      const row = document.createElement("div");
      row.className = "control-row";
      const name = document.createElement("span");
      name.textContent = label;
      const button = document.createElement("button");
      button.className = "bind-button";
      button.textContent = listeningAction === id ? "Press a key…" : labelFor(bindings[id]);
      button.addEventListener("click", () => {
        listeningAction = id;
        document.getElementById("bindingNotice").textContent = `Press a letter, number, or arrow key for "${label}".`;
        buildControls();
      });
      row.append(name, button);
      controls.append(row);
    }
  }

  // LAN multiplayer is available when the game is served by the included HTTP server.
  // Every player opens the host's http://LAN-IP:3000 URL, so the game and WebSocket share an origin.
  const LAN_MAX_PLAYERS = 4;
  const LAN_LIVERIES = new Set(BASE_LIVERIES.map(item => item.id));
  function isLanServerPage() {
    return location.protocol === "http:" && !!location.port && !/\.netlify\.app$/i.test(location.hostname);
  }
  function setLanStatus(message, isError = false) {
    const status = document.getElementById("lanStatus");
    const lobbyStatus = document.getElementById("lanLobbyStatus");
    if (status) { status.textContent = message; status.classList.toggle("error", !!isError); }
    if (lobbyStatus && (!lan.room || isError)) { lobbyStatus.textContent = message; lobbyStatus.classList.toggle("error", !!isError); }
  }
  async function refreshLanServerInfo() {
    try {
      const response = await fetch(`${location.origin}/health`, { cache: "no-store" });
      if (!response.ok) return;
      const info = await response.json();
      lan.serverAddresses = Array.isArray(info.addresses) ? info.addresses.filter(value => typeof value === "string" && /^http:\/\//.test(value)) : [];
      const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
      lan.shareAddress = !localHost ? location.origin : (lan.serverAddresses[0] || location.origin);
      const addressText = document.getElementById("lanAddressNotice");
      const lobbyAddress = document.getElementById("lanLobbyAddress");
      if (addressText) addressText.textContent = lan.serverAddresses.length
        ? `Host URL (share this with same-network players): ${lan.shareAddress}${lan.serverAddresses.length > 1 ? ` · Other adapters: ${lan.serverAddresses.join(" · ")}` : ""}`
        : `LAN URL: ${lan.shareAddress || location.origin}`;
      if (lobbyAddress) lobbyAddress.textContent = `Share ${lan.shareAddress || location.origin} with everyone on the same Wi-Fi or Ethernet network.`;
    } catch (_) { /* Netlify is intentionally unsupported for local WebSocket hosting. */ }
  }
  function updateLanEntryPage() {
    const ok = isLanServerPage();
    refreshLanServerInfo();
    const hostButton = document.getElementById("lanHostButton");
    const joinButton = document.getElementById("lanJoinButton");
    const hint = document.getElementById("lanMultiplayerHint");
    if (hint) hint.textContent = ok
      ? "LAN server page detected. Host a room or join a code from another device on the same Wi-Fi or Ethernet network."
      : "LAN-only mode: first run Start-Pixel-Corsa-LAN.bat on the host PC, then EVERYONE must open the same http://LAN-IP:3000 address. The public HTTPS website cannot host this LAN session.";
    if (hostButton) hostButton.disabled = !ok;
    if (joinButton) joinButton.disabled = !ok;
    if (!ok) setLanStatus("Open Pixel Corsa from the host PC's LAN URL (for example http://192.168.1.20:3000). Do not use the Netlify URL for LAN sessions.", true);
    else if (lan.socket && lan.socket.readyState === WebSocket.OPEN) setLanStatus("Connected to the local multiplayer server.");
    else setLanStatus("Ready. Host a room or enter your friend's 4-character room code.");
    const livery = document.getElementById("lanLiverySelect");
    if (livery) livery.value = liveryId;
  }
  function sendLanMessage(type, data = {}) {
    if (!lan.socket || lan.socket.readyState !== WebSocket.OPEN) return false;
    try { lan.socket.send(JSON.stringify({ type, ...data })); return true; }
    catch (_) { return false; }
  }
  function ensureLanConnection() {
    if (!isLanServerPage()) {
      const message = "LAN multiplayer needs the host's local URL. Run Start-Pixel-Corsa-LAN.bat, then open http://HOST-LAN-IP:3000 on every device.";
      setLanStatus(message, true);
      return Promise.reject(new Error(message));
    }
    if (lan.socket && lan.socket.readyState === WebSocket.OPEN) return Promise.resolve(lan.socket);
    if (lan.connectPromise) return lan.connectPromise;
    setLanStatus("Connecting to the LAN server...");
    lan.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(`ws://${location.host}/multiplayer`);
      lan.socket = socket;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch (_) {}
        reject(new Error("Timed out connecting to the LAN server."));
      }, 5000);
      socket.onopen = () => {
        if (settled) return;
        settled = true; window.clearTimeout(timeout);
        setLanStatus("Connected to the local server. Creating your room...");
        resolve(socket);
      };
      socket.onmessage = event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch (_) { return; }
        handleLanMessage(packet);
      };
      socket.onerror = () => {
        if (!settled) { settled = true; window.clearTimeout(timeout); reject(new Error("Could not reach the LAN server. Check the host app and Windows Firewall.")); }
      };
      socket.onclose = () => {
        if (!settled) { settled = true; window.clearTimeout(timeout); reject(new Error("Connection to the LAN server closed.")); }
        if (lan.socket === socket) {
          lan.socket = null; lan.connectPromise = null;
          if (lan.room) setLanStatus("Connection to the host was lost. Ask the host to restart the LAN server.", true);
          if (lan.raceActive) showNotice("LAN CONNECTION LOST");
        }
      };
    }).catch(err => {
      lan.connectPromise = null;
      setLanStatus(err.message || "Could not connect to the LAN server.", true);
      throw err;
    });
    return lan.connectPromise;
  }
  function clearLanCountdown() {
    if (lan.countdownTimer) window.clearInterval(lan.countdownTimer);
    lan.countdownTimer = null; lan.countdownStartAt = 0;
  }
  function clearLanRaceLocally() {
    clearLanCountdown();
    lan.room = null; lan.playerId = null; lan.isHost = false; lan.ready = false;
    lan.raceActive = false; lan.playerFinished = false; lan.gridIndex = 0; lan.raceLength = "3";
    lan.localPaused = false; lan.remotes.clear();
    const returnLobbyButton = document.getElementById("lanReturnLobbyButton");
    if (returnLobbyButton) returnLobbyButton.hidden = true;
  }
  function hostLanRoom() {
    const name = document.getElementById("lanPlayerName").value;
    const livery = document.getElementById("lanLiverySelect").value;
    const trackId = document.getElementById("lanHostTrack").value;
    const raceLength = document.getElementById("lanRaceLength").value;
    ensureLanConnection().then(() => {
      lan.selectedName = name; lan.selectedLivery = LAN_LIVERIES.has(livery) ? livery : "redbull";
      saveLivery(lan.selectedLivery);
      sendLanMessage("createRoom", { name: lan.selectedName, livery: lan.selectedLivery, trackId, raceLength });
    }).catch(() => {});
  }
  function joinLanRoom() {
    const name = document.getElementById("lanPlayerName").value;
    const livery = document.getElementById("lanLiverySelect").value;
    const code = document.getElementById("lanRoomCodeInput").value.trim().toUpperCase();
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
      setLanStatus("Enter the 4-character room code shown by the host.", true); return;
    }
    ensureLanConnection().then(() => {
      lan.selectedName = name; lan.selectedLivery = LAN_LIVERIES.has(livery) ? livery : "redbull";
      saveLivery(lan.selectedLivery);
      sendLanMessage("joinRoom", { code, name: lan.selectedName, livery: lan.selectedLivery });
    }).catch(() => {});
  }
  function renderLanLobby() {
    const room = lan.room;
    if (!room) return;
    const codeLabel = document.getElementById("lanRoomCodeLabel");
    if (codeLabel) codeLabel.textContent = room.code;
    const lobbyAddress = document.getElementById("lanLobbyAddress");
    if (lobbyAddress) lobbyAddress.textContent = `Share ${lan.shareAddress || location.origin} with everyone on the same Wi-Fi or Ethernet network.`;
    const hostTrack = document.getElementById("lanLobbyTrack");
    const raceLength = document.getElementById("lanLobbyRaceLength");
    const lobbyLivery = document.getElementById("lanLobbyLivery");
    if (hostTrack) { hostTrack.value = room.trackId; hostTrack.disabled = !lan.isHost || room.status !== "lobby"; }
    if (raceLength) { raceLength.value = room.raceLength; raceLength.disabled = !lan.isHost || room.status !== "lobby"; }
    const me = (room.players || []).find(player => player.id === lan.playerId);
    if (me) { lan.ready = !!me.ready; if (lobbyLivery) lobbyLivery.value = me.livery; }
    if (lobbyLivery) lobbyLivery.disabled = room.status !== "lobby";
    const count = document.getElementById("lanPlayerCount");
    if (count) count.textContent = `${room.players.length} / ${room.maxPlayers || LAN_MAX_PLAYERS}`;
    const list = document.getElementById("lanPlayerList");
    if (list) {
      list.replaceChildren();
      for (const player of room.players) {
        const row = document.createElement("div"); row.className = "lan-player-row";
        const identity = document.createElement("div"); identity.className = "lan-player-identity";
        const dot = document.createElement("span"); dot.className = `lan-car-dot ${player.livery || "redbull"}`; dot.setAttribute("aria-hidden", "true");
        const info = document.createElement("div"); info.className = "lan-player-info";
        const playerName = document.createElement("strong"); playerName.textContent = player.name + (player.id === lan.playerId ? " (YOU)" : "");
        const playerMeta = document.createElement("small");
        const labels = [player.host ? "HOST" : liveryLabel(player.livery), player.ready ? "READY" : "NOT READY"];
        if (player.finished) labels.push("FINISHED");
        playerMeta.textContent = labels.join(" · "); info.append(playerName, playerMeta); identity.append(dot, info);
        const ready = document.createElement("span"); ready.className = `lan-ready-state ${player.ready ? "is-ready" : ""}`; ready.textContent = player.ready ? "✓" : "…";
        row.append(identity, ready); list.append(row);
      }
    }
    const readyButton = document.getElementById("lanReadyButton");
    if (readyButton) {
      readyButton.hidden = lan.isHost;
      readyButton.disabled = room.status !== "lobby";
      readyButton.textContent = lan.ready ? "Not Ready" : "I'm Ready";
    }
    const startButton = document.getElementById("lanStartButton");
    const allReady = room.players.length >= 2 && room.players.every(player => player.ready);
    if (startButton) {
      startButton.hidden = !lan.isHost;
      startButton.disabled = !lan.isHost || room.status !== "lobby" || !allReady;
      startButton.textContent = room.status === "starting" ? "Starting…" : room.status === "racing" ? "Race in Progress" : room.status === "results" ? "Race Complete" : "Start Race";
    }
    const status = document.getElementById("lanLobbyStatus");
    if (status) {
      let text = "Waiting for drivers to join…";
      if (room.status === "lobby") {
        if (room.players.length < 2) text = "Share the room code with a friend on the same network. At least 2 drivers are required.";
        else if (!allReady) text = "Waiting for every driver to be ready.";
        else text = "All drivers ready. Host can start the race.";
      } else if (room.status === "starting") text = "Synchronising grid. Race starting shortly…";
      else if (room.status === "racing") text = room.raceLength === "practice" ? "Free Run in progress. Host can return everyone to the lobby from the pause menu." : `${room.raceLength}-lap session in progress. Host can return everyone to the lobby from the pause menu.`;
      else if (room.status === "results") text = "Race complete. Host can return everyone to the lobby from the pause menu.";
      status.textContent = text; status.classList.remove("error");
    }
  }
  function liveryLabel(id) { return ({ redbull: "Red Bull", ferrari: "Ferrari", mclaren: "McLaren" })[id] || "Red Bull"; }
  function handleLanMessage(packet) {
    switch (packet.type) {
      case "connected":
        lan.playerId = packet.playerId;
        break;
      case "roomJoined":
        lan.playerId = packet.playerId; lan.room = packet.room; lan.isHost = !!packet.isHost;
        lan.ready = lan.isHost; lan.raceLength = packet.room.raceLength;
        lan.raceActive = false; lan.playerFinished = false; lan.remotes.clear();
        const own = (packet.room.players || []).find(p => p.id === lan.playerId);
        if (own) { lan.selectedName = own.name; lan.selectedLivery = own.livery; saveLivery(own.livery); }
        showPage("lanLobby"); renderLanLobby();
        setLanStatus(`Connected to LAN room ${packet.room.code}.`);
        break;
      case "roomUpdate": {
        const wasRaceActive = lan.raceActive;
        const previousStatus = lan.room && lan.room.status;
        lan.room = packet.room;
        lan.isHost = packet.room.hostId === lan.playerId;
        lan.raceLength = packet.room.raceLength;
        const me = (packet.room.players || []).find(p => p.id === lan.playerId);
        if (me) lan.ready = !!me.ready;
        reconcileLanPlayers(packet.room.players || []);
        if (wasRaceActive && packet.room.status === "lobby" && previousStatus !== "lobby") exitRaceToLanLobby();
        else if (pages.lanLobby.classList.contains("active")) renderLanLobby();
        break;
      }
      case "raceStarting":
        lan.room = packet.room; lan.countdownStartAt = packet.startAt || Date.now() + 4000;
        clearLanCountdown(); lan.countdownStartAt = packet.startAt || Date.now() + 4000;
        const countdownTick = () => {
          const seconds = Math.max(0, Math.ceil((lan.countdownStartAt - Date.now()) / 1000));
          const status = document.getElementById("lanLobbyStatus");
          if (status && !lan.raceActive) status.textContent = seconds > 0 ? `RACE STARTING IN ${seconds}…` : "Waiting for race start signal…";
        };
        countdownTick(); lan.countdownTimer = window.setInterval(countdownTick, 150);
        renderLanLobby();
        break;
      case "raceStarted":
        clearLanCountdown(); lan.room = packet.room;
        beginLanRace(packet.room);
        break;
      case "playerState":
        if (packet.player && packet.player.id !== lan.playerId) acceptLanPlayerState(packet.player);
        break;
      case "playerFinished":
        if (packet.room) lan.room = packet.room;
        if (packet.result && packet.result.playerId !== lan.playerId) showNotice(`${packet.result.name} FINISHED — P${packet.result.place}`);
        renderLanLobby();
        break;
      case "playerRestarted":
        lan.playerFinished = false;
        break;
      case "playerLeft":
        lan.remotes.delete(packet.playerId);
        break;
      case "leftRoom":
        clearLanRaceLocally();
        break;
      case "error":
        setLanStatus(packet.message || "LAN server error.", true);
        const lobbyStatus = document.getElementById("lanLobbyStatus");
        if (lobbyStatus && lan.room) { lobbyStatus.textContent = packet.message; lobbyStatus.classList.add("error"); }
        break;
      case "pong": break;
    }
  }
  function reconcileLanPlayers(players) {
    const ids = new Set(players.filter(p => p.id !== lan.playerId).map(p => p.id));
    for (const id of lan.remotes.keys()) if (!ids.has(id)) lan.remotes.delete(id);
    for (const player of players) {
      if (player.id !== lan.playerId && player.state) acceptLanPlayerState(player);
    }
  }
  function acceptLanPlayerState(player) {
    if (!player || !player.state || !Number.isFinite(player.state.x) || !Number.isFinite(player.state.y)) return;
    const snapshot = player.state;
    let remote = lan.remotes.get(player.id);
    if (!remote) {
      remote = {
        id: player.id, name: player.name || "Driver", livery: LAN_LIVERIES.has(player.livery) ? player.livery : "redbull",
        target: { ...snapshot }, visual: { x: snapshot.x, y: snapshot.y, heading: snapshot.heading },
        state: { ...snapshot }, receivedAt: performance.now()
      };
      lan.remotes.set(player.id, remote);
    } else {
      remote.name = player.name || remote.name;
      remote.livery = LAN_LIVERIES.has(player.livery) ? player.livery : remote.livery;
      remote.target = { ...snapshot }; remote.state = { ...snapshot }; remote.receivedAt = performance.now();
    }
  }
  function updateLanRemoteVisuals(dt) {
    const factor = 1 - Math.exp(-Math.min(dt, 0.06) * 15);
    for (const remote of lan.remotes.values()) {
      if (!remote.target || !remote.visual) continue;
      remote.visual.x += (remote.target.x - remote.visual.x) * factor;
      remote.visual.y += (remote.target.y - remote.visual.y) * factor;
      const angleDelta = Math.atan2(Math.sin(remote.target.heading - remote.visual.heading), Math.cos(remote.target.heading - remote.visual.heading));
      remote.visual.heading += angleDelta * factor;
    }
  }
  function beginLanRace(room) {
    if (!room || lan.raceActive) return;
    lan.room = room; lan.raceActive = true; lan.playerFinished = false; lan.raceLength = room.raceLength;
    lan.gridIndex = Math.max(0, room.players.findIndex(player => player.id === lan.playerId));
    setActiveTrack(room.trackId);
    const own = room.players.find(player => player.id === lan.playerId);
    if (own && LAN_LIVERIES.has(own.livery)) saveLivery(own.livery);
    for (const remote of lan.remotes.values()) remote.state = remote.state || null;
    startGame({ multiplayer: true, gridIndex: lan.gridIndex });
    showNotice(`LAN RACE STARTED — ${room.trackId.toUpperCase()}`);
  }
  function exitRaceToLanLobby() {
    clearLanCountdown();
    lan.raceActive = false; lan.playerFinished = false; lan.localPaused = false; lan.remotes.clear();
    mode = "menu"; keys.clear(); menu.hidden = false; canvas.hidden = true;
    if (audio) audio.pause();
    menu.classList.remove("pause-overlay");
    showPage("lanLobby");
  }
  function returnLanRaceToLobby() {
    if (!lan.raceActive || !lan.isHost) return;
    showNotice("RETURNING ALL DRIVERS TO LOBBY…");
    sendLanMessage("returnToLobby");
  }
  async function copyLanAddress() {
    const address = lan.shareAddress || location.origin;
    try { await navigator.clipboard.writeText(address); setLanStatus(`Copied LAN address: ${address}`); }
    catch (_) { window.prompt("Copy this LAN address and share it with friends on the same network:", address); }
  }
  function publishLanPlayerState(now, force = false, pausedOverride = null) {
    if (!lan.raceActive || !lan.socket || lan.socket.readyState !== WebSocket.OPEN || !lan.room) return;
    if (!force && now - lan.lastStateSentAt < 50) return;
    lan.lastStateSentAt = now;
    const steerDir = keys.has(bindings.left) && !keys.has(bindings.right) ? "left" : keys.has(bindings.right) && !keys.has(bindings.left) ? "right" : "center";
    const paused = pausedOverride == null ? lan.localPaused : !!pausedOverride;
    sendLanMessage("playerState", { state: {
      x: state.x, y: state.y, heading: state.heading, speedKmh: Math.round(state.speed * 3.6),
      laps: state.laps, lapTimeSeconds: state.gateArmed ? Math.max(0, state.elapsed - state.lapStart) : 0,
      bestSeconds: Number.isFinite(state.best) ? state.best : null, elapsedSeconds: state.elapsed,
      gear: state.gear, drsOpen: state.drsOpen, steerDir, paused, finished: lan.playerFinished
    } });
  }
  function drawRemoteCars(trackScale, shakeX, shakeY) {
    if (!lan.raceActive || !lan.remotes.size) return;
    for (const remote of lan.remotes.values()) {
      if (!remote.visual) continue;
      const livery = BASE_LIVERIES.find(item => item.id === remote.livery) || BASE_LIVERIES[0];
      const steerDir = remote.state && ["left", "right", "center"].includes(remote.state.steerDir) ? remote.state.steerDir : "center";
      const key = remote.state && remote.state.drsOpen
        ? ({ left: "drsLeft", right: "drsRight", center: "drsCenter" })[steerDir]
        : ({ left: "left", right: "right", center: "center" })[steerDir];
      let sprite = livery[key];
      if (!spriteIsReady(sprite)) sprite = livery.center;
      if (!spriteIsReady(sprite)) continue;
      const dimensions = spriteDimensions(sprite);
      const x = W / 2 + (remote.visual.x - cameraX) * trackScale + shakeX;
      const y = SCENE_H / 2 + (remote.visual.y - cameraY) * trackScale + shakeY;
      const carH = activeTrack.carRenderHeight, carW = carH * dimensions.width / dimensions.height;
      ctx.save(); ctx.translate(x, y); ctx.rotate(remote.visual.heading + Math.PI / 2);
      ctx.drawImage(sprite, -carW / 2, -carH / 2, carW, carH); ctx.restore();
      ctx.save(); ctx.font = '10px "Upheaval TT (BRK)", "Courier New", monospace'; ctx.textAlign = "center";
      const label = String(remote.name || "Driver").slice(0, 16);
      const labelWidth = Math.min(100, ctx.measureText(label).width + 10);
      ctx.fillStyle = "rgba(0,0,0,.76)"; ctx.fillRect(x - labelWidth / 2, y - carH / 2 - 15, labelWidth, 13);
      ctx.fillStyle = remote.state && remote.state.finished ? "#b5ed83" : "#ffffff";
      ctx.fillText(label, x, y - carH / 2 - 5); ctx.restore();
    }
  }
  function drawLanHud() {
    if (!lan.raceActive) return;
    const players = lan.room && lan.room.players ? lan.room.players.length : lan.remotes.size + 1;
    const label = `LAN ${players}/${LAN_MAX_PLAYERS} · ${lan.room ? lan.room.code : "----"}`;
    ctx.save(); ctx.font = '11px "Upheaval TT (BRK)", "Courier New", monospace';
    const width = ctx.measureText(label).width + 16;
    ctx.fillStyle = "rgba(0,0,0,.76)"; ctx.fillRect(W - width - 10, 10, width, 22);
    ctx.strokeStyle = "#d8c99a"; ctx.lineWidth = 1; ctx.strokeRect(W - width - 10, 10, width, 22);
    ctx.fillStyle = "#fff3c9"; ctx.textAlign = "center"; ctx.fillText(label, W - width / 2 - 10, 24);
    if (lan.playerFinished) {
      const result = lan.room && lan.room.results ? lan.room.results.find(row => row.playerId === lan.playerId) : null;
      const title = result ? `FINISHED — P${result.place}` : "FINISHED";
      ctx.font = '18px "Upheaval TT (BRK)", Calibri, sans-serif';
      ctx.textAlign = "center"; ctx.fillStyle = "rgba(0,0,0,.8)"; ctx.fillRect(W / 2 - 122, 90, 244, 34);
      ctx.fillStyle = "#b5ed83"; ctx.fillText(title, W / 2, 112);
    }
    if (lan.room && lan.room.status === "results") {
      ctx.font = '10px "Upheaval TT (BRK)", "Courier New", monospace'; ctx.textAlign = "center";
      const results = [...(lan.room.results || [])].sort((a, b) => a.place - b.place).slice(0, 4);
      ctx.fillStyle = "rgba(0,0,0,.83)"; ctx.fillRect(W / 2 - 95, 133, 190, Math.max(25, results.length * 18 + 8));
      ctx.fillStyle = "#ffffff";
      results.forEach((result, index) => ctx.fillText(`${result.place}. ${result.name}  ${formatLapTime(result.elapsedSeconds || 0)}`, W / 2, 151 + index * 18));
    }
    ctx.restore();
  }

  function showPage(name) {
    for (const page of Object.values(pages)) page.classList.remove("active");
    pages[name].classList.add("active");
    menu.classList.toggle("pause-overlay", name === "pause");
    listeningAction = null;
    if (name === "settings") { buildControls(); buildLiveryList(); activateSettingsTab("controls"); }
    if (name === "levels") refreshTrackMedalCards();
    if (name === "multiplayer") updateLanEntryPage();
    if (name === "lanLobby") renderLanLobby();
    if (name === "timeAttack") updateTimeAttackStats();
  }

  document.getElementById("playButton").addEventListener("click", () => showPage("levels"));
  document.getElementById("experimentalMenuButton").addEventListener("click", () => showPage("experimental"));
  document.getElementById("multiplayerButton").addEventListener("click", () => showPage("multiplayer"));
  document.getElementById("timeAttackButton").addEventListener("click", () => { document.getElementById("timeAttackTrack").value = activeTrackId; document.getElementById("timeAttackGhost").value = timeAttackConfig.ghost === false ? "off" : "on"; updateTimeAttackStats(); showPage("timeAttack"); });
  document.getElementById("timeAttackTrack").addEventListener("change", updateTimeAttackStats);
  document.getElementById("timeAttackGhost").addEventListener("change", e => { timeAttackConfig.ghost = e.target.value === "on"; saveJson(TIME_ATTACK_CONFIG_KEY, timeAttackConfig); });
  document.getElementById("startTimeAttackButton").addEventListener("click", () => { setActiveTrack(document.getElementById("timeAttackTrack").value); lan.raceActive = false; startGame({ timeAttack: true }); });
  document.getElementById("timeAttackResetStatsButton").addEventListener("click", () => { const id = document.getElementById("timeAttackTrack").value; driverStats[id] = { laps: 0, valid: 0, history: [] }; saveJson(STATS_STORAGE_KEY, driverStats); updateTimeAttackStats(); showNotice("SESSION STATISTICS RESET"); });
  document.getElementById("settingsButton").addEventListener("click", () => showPage("settings"));
  document.getElementById("lanHostButton").addEventListener("click", hostLanRoom);
  document.getElementById("lanJoinButton").addEventListener("click", joinLanRoom);
  document.getElementById("lanRoomCodeInput").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, "").slice(0, 4); });
  document.getElementById("lanPlayerName").addEventListener("change", event => {
    lan.selectedName = event.target.value;
    if (lan.room) sendLanMessage("setPreferences", { name: lan.selectedName, livery: lan.selectedLivery || liveryId });
  });
  document.getElementById("lanLiverySelect").addEventListener("change", event => {
    lan.selectedLivery = LAN_LIVERIES.has(event.target.value) ? event.target.value : "redbull";
    saveLivery(lan.selectedLivery);
    if (lan.room) sendLanMessage("setPreferences", { name: document.getElementById("lanPlayerName").value, livery: lan.selectedLivery });
  });
  document.getElementById("lanHostTrack").addEventListener("change", () => {
    if (!lan.room) setLanStatus(`Hosting will use ${document.getElementById("lanHostTrack").selectedOptions[0].text}.`);
  });
  document.getElementById("lanLobbyTrack").addEventListener("change", event => sendLanMessage("setTrack", { trackId: event.target.value }));
  document.getElementById("lanLobbyRaceLength").addEventListener("change", event => sendLanMessage("setRaceLength", { raceLength: event.target.value }));
  document.getElementById("lanLobbyLivery").addEventListener("change", event => {
    lan.selectedLivery = LAN_LIVERIES.has(event.target.value) ? event.target.value : "redbull";
    saveLivery(lan.selectedLivery);
    sendLanMessage("setPreferences", { name: document.getElementById("lanPlayerName").value || lan.selectedName, livery: lan.selectedLivery });
  });
  document.getElementById("lanReadyButton").addEventListener("click", () => sendLanMessage("setReady", { ready: !lan.ready }));
  document.getElementById("lanStartButton").addEventListener("click", () => sendLanMessage("startRace"));
  document.getElementById("lanLobbyLeaveButton").addEventListener("click", () => leaveLanRoomToMenu());
  document.getElementById("lanCopyAddressButton").addEventListener("click", copyLanAddress);
  document.getElementById("lanReturnLobbyButton").addEventListener("click", returnLanRaceToLobby);
  document.getElementById("resumeButton").addEventListener("click", resumeGame);
  document.getElementById("restartSessionButton").addEventListener("click", restartSession);
  document.getElementById("pauseMainMenuButton").addEventListener("click", returnToMainMenu);
  document.getElementById("gearboxType").addEventListener("change", event => saveGearboxMode(event.target.value));
  updateGearboxHint();
  document.querySelectorAll("[data-settings-tab]").forEach(button => {
    button.addEventListener("click", () => activateSettingsTab(button.dataset.settingsTab));
  });
  document.getElementById("accentColor").addEventListener("input", event => {
    customize.accent = event.target.value; applyCustomize(true);
  });
  document.getElementById("backgroundColor").addEventListener("input", event => {
    customize.background = event.target.value; applyCustomize(true);
  });
  document.getElementById("guiTheme").addEventListener("change", event => {
    guiTheme = event.target.value; applyGuiTheme(true); applyCustomize();
  });
  document.getElementById("backgroundOpacity").addEventListener("input", event => {
    customize.opacity = Number(event.target.value); applyCustomize(true);
  });
  applyGuiTheme();
  applyCustomize();
  for (const button of document.querySelectorAll(".back-button")) {
    button.addEventListener("click", () => showPage(button.dataset.page));
  }
  document.querySelectorAll("[data-track-id]").forEach(button => {
    button.classList.toggle("selected", button.dataset.trackId === activeTrackId);
    button.addEventListener("click", () => {
      setActiveTrack(button.dataset.trackId);
      startGame();
    });
  });
  document.getElementById("quitButton").addEventListener("click", () => {
    window.close();
    window.setTimeout(() => {
      document.getElementById("quitFallback").hidden = false;
    }, 180);
  });

  function startGame(options = {}) {
    lan.raceActive = !!options.multiplayer;
    window.pixelCorsaTimeAttack = !!options.timeAttack;
    lan.gridIndex = Math.max(0, Math.min(3, Number(options.gridIndex) || 0));
    lan.playerFinished = false;
    lan.localPaused = false;
    menu.classList.remove("pause-overlay");
    menu.hidden = true;
    canvas.hidden = false;
    mode = "game";
    keys.clear();
    resetCar(lan.gridIndex);
    startAudio();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function setActiveTrack(id) {
    activeTrackId = trackCatalog[id] ? id : "tck01";
    activeTrack = trackCatalog[activeTrackId];
    try { localStorage.setItem("pixelRacerTrack", activeTrackId); }
    catch (_) { /* Selection remains active for this session. */ }
    document.querySelectorAll("[data-track-id]").forEach(button => {
      button.classList.toggle("selected", button.dataset.trackId === activeTrackId);
    });
  }

  function pauseGameMenu() {
    mode = "paused";
    lan.localPaused = lan.raceActive;
    if (lan.raceActive) publishLanPlayerState(performance.now(), true, true);
    const returnLobbyButton = document.getElementById("lanReturnLobbyButton");
    if (returnLobbyButton) returnLobbyButton.hidden = !(lan.raceActive && lan.isHost);
    keys.clear();
    listeningAction = null;
    menu.hidden = false;
    canvas.hidden = false;
    showPage("pause");
    document.getElementById("resumeButton").focus({ preventScroll: true });
    if (audio) audio.pause();
  }

  function resumeGame() {
    mode = "game";
    lan.localPaused = false;
    keys.clear();
    menu.classList.remove("pause-overlay");
    menu.hidden = true;
    canvas.hidden = false;
    if (audio) audio.play();
    if (lan.raceActive) publishLanPlayerState(performance.now(), true, false);
  }

  function restartSession() {
    // Restart only the local driver's session; in LAN mode, the room and other drivers remain active.
    if (lan.raceActive) {
      lan.playerFinished = false;
      sendLanMessage("restartPlayer");
    }
    keys.clear();
    resetCar(lan.gridIndex);
    mode = "game";
    menu.classList.remove("pause-overlay");
    menu.hidden = true;
    canvas.hidden = false;
    startAudio();
  }

  function returnToMainMenu() {
    // Main Menu leaves any LAN room; the home screen intentionally has no Resume button.
    if (lan.room) sendLanMessage("leaveRoom");
    clearLanRaceLocally();
    keys.clear();
    mode = "menu";
    menu.hidden = false;
    canvas.hidden = true;
    if (audio) audio.pause();
    showPage("main");
    document.getElementById("playButton").focus({ preventScroll: true });
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  function leaveLanRoomToMenu() {
    if (lan.room) sendLanMessage("leaveRoom");
    clearLanRaceLocally();
    mode = "menu"; keys.clear(); menu.hidden = false; canvas.hidden = true;
    if (audio) audio.pause();
    menu.classList.remove("pause-overlay");
    showPage("multiplayer");
    updateLanEntryPage();
  }

  function isAllowedBinding(code) {
    return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^Arrow(Up|Down|Left|Right)$/.test(code);
  }

  window.addEventListener("keydown", event => {
    if (listeningAction) {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        listeningAction = null;
        document.getElementById("bindingNotice").textContent = "Key binding cancelled.";
        buildControls();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || !isAllowedBinding(event.code)) {
        document.getElementById("bindingNotice").textContent = "Choose a letter, number, or arrow key. Browser shortcuts are unavailable.";
        return;
      }
      const old = bindings[listeningAction];
      const other = actions.find(([id]) => id !== listeningAction && bindings[id] === event.code);
      if (other) bindings[other[0]] = old;
      bindings[listeningAction] = event.code;
      listeningAction = null;
      saveBindings();
      document.getElementById("bindingNotice").textContent = "Controls saved.";
      buildControls();
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      if (mode === "game") pauseGameMenu();
      else if (mode === "paused") resumeGame();
      else if (mode === "menu" && (pages.settings.classList.contains("active") || pages.levels.classList.contains("active") || pages.experimental.classList.contains("active"))) showPage("main");
      return;
    }
    if (mode !== "game") return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.code === bindings.reset) {
      event.preventDefault();
      if (!event.repeat) {
        if (lan.raceActive) { lan.playerFinished = false; sendLanMessage("restartPlayer"); }
        resetCar(lan.gridIndex);
      }
      return;
    }
    if (event.code === bindings.shiftUp || event.code === bindings.shiftDown) {
      event.preventDefault();
      if (!event.repeat) shiftGear(event.code === bindings.shiftUp ? 1 : -1);
      return;
    }
    if (event.code === bindings.startEngine) {
      event.preventDefault();
      if (!event.repeat) startEngine();
      return;
    }
    if (event.code === bindings.drs) {
      event.preventDefault();
      if (!event.repeat) toggleDrs();
      return;
    }
    if (Object.values(bindings).includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  }, true);
  window.addEventListener("keyup", event => keys.delete(event.code), true);
  window.addEventListener("blur", () => keys.clear());

  function surfaceAt(x, y) {
    const px = Math.floor(x / 2), py = Math.floor(y / 2);
    if (x < 0 || y < 0 || x >= activeTrack.width || y >= activeTrack.height ||
        px < 0 || py < 0 || px >= activeTrack.maskWidth || py >= activeTrack.maskHeight) return "grass";
    const bit = py * activeTrack.maskWidth + px, value = 1 << (bit & 7), byte = bit >> 3;
    if ((activeTrack.roadMask[byte] & value) !== 0) return "road";
    if ((activeTrack.kerbMask[byte] & value) !== 0) return "kerb";
    return "grass";
  }

  function multiplayerGridPosition(gridIndex) {
    const slot = Math.max(0, Math.min(3, Number(gridIndex) || 0));
    // Use a compact 2x2 grid and verify all four centres against the actual track masks.
    // TCK-01's previous single-file spacing put slot four on grass; these positions are all on asphalt.
    if (activeTrack.id === "tck02") {
      const positions = [
        { x: activeTrack.spawn.x, y: activeTrack.spawn.y - 45 },
        { x: activeTrack.spawn.x, y: activeTrack.spawn.y + 45 },
        { x: activeTrack.spawn.x + 100, y: activeTrack.spawn.y - 45 },
        { x: activeTrack.spawn.x + 100, y: activeTrack.spawn.y + 45 }
      ];
      return positions[slot];
    }
    const positions = [
      { x: activeTrack.spawn.x - 50, y: activeTrack.spawn.y - 15 },
      { x: activeTrack.spawn.x - 50, y: activeTrack.spawn.y + 15 },
      { x: activeTrack.spawn.x, y: activeTrack.spawn.y - 15 },
      { x: activeTrack.spawn.x, y: activeTrack.spawn.y + 15 }
    ];
    return positions[slot];
  }

  function resetCar(gridIndex = (lan.raceActive ? lan.gridIndex : 0)) {
    runtimeFault = null;
    gameNotice = ""; gameNoticeUntil = 0;
    const gridSlot = Math.max(0, Math.min(3, Number(gridIndex) || 0));
    const spawn = lan.raceActive ? multiplayerGridPosition(gridSlot) : activeTrack.spawn;
    const spawnX = spawn.x;
    const spawnY = spawn.y;
    Object.assign(state, { x: spawnX, y: spawnY, heading: activeTrack.spawn.heading, vx: 0, vy: 0,
      forwardSpeed: 0, lateralSpeed: 0, yawRate: 0, longAccel: 0, steering: 0,
      laps: 0, best: getTrackRecord(activeTrackId).best, elapsed: 0, lapStart: 0, started: false,
      gateArmed: false, lapInvalid: false, offTrackTime: 0,
      gear: 0, shiftTimer: 0, engineRunning: true,
      engineRpm: 950, freeRpm: 950, clutchEngagement: 1, speed: 0,
      drsOpen: false, drsLevel: 0, drsZone: null, revLimiterActive: false });
    currentLapSamples = []; ghostSampleClock = 0; lapDistance = 0; sectorSplits = []; nextSector = 1;
    cameraX = state.x; cameraY = state.y;
    keys.clear();
    motionTrailCtx.clearRect(0, 0, W, TRACK_H);
  }

  function shiftGear(direction) {
    if (gearboxMode === "clutch" && !keys.has(bindings.clutch)) { showNotice("HOLD CLUTCH TO SHIFT"); return; }
    const next = Math.max(-1, Math.min(6, state.gear + direction));
    if (next === state.gear) return;
    if (state.forwardSpeed > 2 && next === -1) { showNotice("STOP BEFORE SELECTING REVERSE"); return; }
    const nextRatio = gearRatio(next);
    if (next !== 0 && Math.abs(state.forwardSpeed) / WHEEL_RADIUS * 60 / (2 * Math.PI) * Math.abs(nextRatio) * FINAL_DRIVE > REDLINE_RPM) {
      showNotice("DOWNSHIFT WOULD OVER-REV"); return;
    }
    state.gear = next;
    state.shiftTimer = gearboxMode === "sequential" ? 0.16 : 0;
    playShiftSfx();
    showNotice(next === 0 ? "NEUTRAL" : next === -1 ? "REVERSE" : `${next} GEAR`);
  }

  const GEAR_RATIOS = [0, 3.10, 2.25, 1.75, 1.42, 1.18, 0.86];
  const FINAL_DRIVE = 4.20, WHEEL_RADIUS = 0.33, REDLINE_RPM = 18000;
  const MASS = 800, WHEELBASE = 3.6, FRONT_AXLE = 1.6, REAR_AXLE = 2.0, INERTIA = 1300;
  // Higher-revving power curve and a taller sixth gear keep acceleration alive near 500 km/h.
  // DRS cuts drag and adds drive force, while reducing lateral cornering response only.
  const DRS_MIN_SPEED = 25, DRS_FORCE_BOOST = 0.72, DRS_DRAG_CUT = 0.68, DRS_TOP_SPEED_BONUS = 32;
  const DRS_CORNERING_GRIP_LOSS = 0.25;
  const BASE_TOP_SPEED = 138;
  function drsBlocker() {
    if (!state.engineRunning || state.gear < 1) return "ENGINE / GEAR";
    if (state.forwardSpeed < DRS_MIN_SPEED) return "NEED MORE SPEED";
    if (!keys.has(bindings.accelerate)) return "NEED THROTTLE";
    if (keys.has(bindings.brake)) return "RELEASE BRAKE";
    // TCK-02 requires a correctly crossed DRS mark and the car to remain in that straight's zone.
    // TCK-01 keeps its previous unrestricted manual DRS behavior because it has no DRS markings.
    if (activeTrack.id === "tck02" && !state.drsZone) return "OUTSIDE DRS ZONE";
    return null;
  }
  function toggleDrs() {
    if (state.drsOpen) { state.drsOpen = false; showNotice("DRS CLOSED"); return; }
    const blocker = drsBlocker();
    if (blocker) { showNotice(`DRS UNAVAILABLE — ${blocker}`); return; }
    state.drsOpen = true; showNotice("DRS OPEN - TURNING GRIP -25%");
  }

  function gearRatio(gear) { return gear === -1 ? -3.0 : gear === 0 ? 0 : GEAR_RATIOS[gear]; }
  // Convert engine redline through the selected ratio into a physically plausible road speed.
  // The gear-specific limiter is essential: the global 612 km/h DRS cap is only reachable in 6th.
  function gearRedlineSpeed(gear) {
    const ratio = Math.abs(gearRatio(gear));
    return ratio > 0 ? REDLINE_RPM * WHEEL_RADIUS * (2 * Math.PI) / (60 * ratio * FINAL_DRIVE) : Infinity;
  }
  function showNotice(text) { gameNotice = text; gameNoticeUntil = performance.now() + 2200; }
  function showMedalAward(medalId, lapTime) {
    const tier = MEDAL_TIERS.find(entry => entry.id === medalId);
    if (!tier) return;
    medalAwardToast = { id: medalId, label: tier.label, lapTime, until: performance.now() + 4200 };
    showNotice(`${tier.label.toUpperCase()} MEDAL UNLOCKED — ${formatLapTime(lapTime)}`);
  }
  function startEngine() {
    if (state.engineRunning) return;
    if (state.gear !== 0 && !keys.has(bindings.clutch)) { showNotice("SELECT NEUTRAL OR HOLD CLUTCH TO START"); return; }
    state.engineRunning = true; state.freeRpm = 950; state.engineRpm = 950;
    showNotice("ENGINE STARTED");
  }

  let audio = null;
  function startAudio() {
    if (audio) { audio.play(); return; }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = AudioContextClass ? new AudioContextClass() : null;
    let firingSource = null, crank = null, exhaustFilter = null, exhaustGain = null, crankGain = null;
    let windSource = null, windFilter = null, windGain = null;
    if (context) {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      compressor.connect(context.destination);

      // Procedural V8: evenly spaced four-stroke combustion pulses, with
      // harmonic exhaust tone and subtle crank rumble, all driven by live RPM.
      const sampleRate = context.sampleRate;
      const firingBuffer = context.createBuffer(1, sampleRate, sampleRate);
      const samples = firingBuffer.getChannelData(0);
      const fireHz = 80; // Four firing events/rev at 1,200 RPM.
      for (let i = 0; i < samples.length; i++) {
        const phase = (i / sampleRate * fireHz) % 1;
        const exhaust = Math.exp(-phase * 14);
        const transient = Math.exp(-phase * 115);
        const harmonics = Math.sin(phase * Math.PI * 2) * 0.72 +
          Math.sin(phase * Math.PI * 4) * 0.34 + Math.sin(phase * Math.PI * 6) * 0.16 +
          Math.sin(phase * Math.PI * 8) * 0.08;
        samples[i] = harmonics * exhaust * 0.7 + (Math.random() * 2 - 1) * transient * 0.42;
      }
      firingSource = context.createBufferSource();
      firingSource.buffer = firingBuffer;
      firingSource.loop = true;
      exhaustFilter = context.createBiquadFilter();
      exhaustFilter.type = "lowpass";
      exhaustFilter.frequency.value = 1300;
      exhaustGain = context.createGain();
      exhaustGain.gain.value = 0;
      firingSource.connect(exhaustFilter).connect(exhaustGain).connect(compressor);
      firingSource.start();

      crank = context.createOscillator();
      crank.type = "sawtooth";
      crank.frequency.value = 16;
      const crankFilter = context.createBiquadFilter();
      crankFilter.type = "lowpass";
      crankFilter.frequency.value = 420;
      crankGain = context.createGain();
      crankGain.gain.value = 0;
      crank.connect(crankFilter).connect(crankGain).connect(compressor);
      crank.start();

      // Procedural wind rush gives high speeds a stronger sense of velocity without requiring assets.
      const windBuffer = context.createBuffer(1, sampleRate * 2, sampleRate);
      const windSamples = windBuffer.getChannelData(0);
      for (let i = 0; i < windSamples.length; i++) windSamples[i] = (Math.random() * 2 - 1) * 0.6;
      windSource = context.createBufferSource(); windSource.buffer = windBuffer; windSource.loop = true;
      windFilter = context.createBiquadFilter(); windFilter.type = "lowpass"; windFilter.frequency.value = 450;
      windGain = context.createGain(); windGain.gain.value = 0;
      windSource.connect(windFilter).connect(windGain).connect(compressor);
      windSource.start();
    }
    const makeLoop = (file) => {
      const sound = new Audio(`assets/audio/${file}`);
      sound.loop = true;
      sound.preload = "auto";
      sound.volume = 0;
      return sound;
    };
    const tire = new Audio("assets/audio/tire_squeal.wav");
    tire.loop = false;
    tire.preload = "auto";
    tire.volume = 0;
    audio = {
      context, firingSource, exhaustFilter, exhaustGain, crank, crankGain,
      windSource, windFilter, windGain, tire,
      grass: makeLoop("grass.wav"),
      squealCooldown: 0,
      squealCheck: 0,
      play() {
        if (this.context) this.context.resume();
        this.grass.play().catch(() => {});
      },
      pause() {
        if (this.context) this.context.suspend();
        [this.tire, this.grass].forEach(sound => sound.pause());
      }
    };
    audio.play();
  }

  function playShiftSfx() { /* The recorded engine audio carries pitch changes through shifts. */ }

  function playLapChime() {
    if (!audio) return;
    const chime = new Audio("assets/audio/lap.wav");
    chime.volume = 0.8;
    chime.play().catch(() => {});
  }

  function crossedVerticalLine(oldX, newX, x, direction) {
    return direction > 0 ? oldX < x && newX >= x : oldX > x && newX <= x;
  }

  function insideYRange(y, min, max) { return y >= min && y <= max; }

  // A lap is invalidated only when all four tyre contact points remain fully beyond the road/kerbs
  // for a continuous grace period. A quick brush, one wheel over the kerb, or a single sampled
  // frame on grass does not invalidate anything.
  const TRACK_LIMIT_GRACE_SECONDS = 0.32;
  function updateTrackLimits(wheelSurfaces, dt) {
    const allFourTyresOffTrack = wheelSurfaces.length === 4 && wheelSurfaces.every(surface => surface === "grass");
    if (!state.gateArmed || !state.started || state.lapInvalid || !allFourTyresOffTrack) {
      state.offTrackTime = 0;
      return;
    }
    state.offTrackTime += dt;
    if (state.offTrackTime >= TRACK_LIMIT_GRACE_SECONDS) {
      state.lapInvalid = true;
      showNotice("LAP INVALIDATED — TRACK LIMITS");
    }
  }

  function pointInsideDrsZone(zone, x, y) {
    return x >= zone.minX && x <= zone.maxX && insideYRange(y, zone.yMin, zone.yMax);
  }

  function clearDrsZone() {
    if (!state.drsZone) return;
    state.drsZone = null;
    if (state.drsOpen) {
      state.drsOpen = false;
      showNotice("DRS ZONE ENDED — DRS CLOSED");
    }
  }

  function processDrsZones(oldX, newX, oldY, newY) {
    if (activeTrack.id !== "tck02" || !activeTrack.drsZones) {
      state.drsZone = null;
      return;
    }

    // Crossing a DRS mark is directional: the central straight runs east, the lower straight west.
    // The marked point is the detection gate; only the road segment beyond it is activation-eligible.
    for (const zone of activeTrack.drsZones) {
      const dx = newX - oldX;
      if (Math.abs(dx) < 1e-9) continue;
      const crossingT = Math.max(0, Math.min(1, (zone.detectX - oldX) / dx));
      const crossingY = oldY + (newY - oldY) * crossingT;
      if (crossedVerticalLine(oldX, newX, zone.detectX, zone.direction) &&
          insideYRange(crossingY, zone.yMin, zone.yMax)) {
        state.drsZone = zone.id;
        showNotice("DRS DETECTED — PRESS F TO OPEN");
        break;
      }
      if (state.drsZone === zone.id && crossedVerticalLine(oldX, newX, zone.detectX, -zone.direction) &&
          insideYRange(crossingY, zone.yMin, zone.yMax)) {
        clearDrsZone();
      }
    }

    if (state.drsZone) {
      const zone = activeTrack.drsZones.find(candidate => candidate.id === state.drsZone);
      if (!zone || !pointInsideDrsZone(zone, newX, newY)) clearDrsZone();
    }
  }

  function processTrackGates(oldX, newX, oldY, newY) {
    const finish = activeTrack.finish;
    if (!state.started || !crossedVerticalLine(oldX, newX, finish.x, finish.direction)) return;

    // Test where the car crossed the line during this physics step, not just its
    // final position. This prevents diagonal/high-speed crossings being missed.
    const dx = newX - oldX;
    if (Math.abs(dx) < 1e-9) return;
    const crossingT = Math.max(0, Math.min(1, (finish.x - oldX) / dx));
    const crossingY = oldY + (newY - oldY) * crossingT;
    if (!insideYRange(crossingY, finish.yMin, finish.yMax)) return;

    if (!state.gateArmed) {
      state.gateArmed = true;
      state.lapStart = state.elapsed;
      state.lapInvalid = false;
      state.offTrackTime = 0;
      currentLapSamples = [{ t: 0, x: state.x, y: state.y, heading: state.heading, distance: 0, drsOpen: !!state.drsOpen }];
      ghostSampleClock = 0; lapDistance = 0; sectorSplits = []; nextSector = 1;
      showNotice("TIMING STARTED — GO GO GO");
      return;
    }

    const lapTime = state.elapsed - state.lapStart;
    state.laps++;
    const stats = driverStats[activeTrackId] || (driverStats[activeTrackId] = { laps: 0, valid: 0, history: [] });
    stats.laps = (stats.laps || 0) + 1;
    if (state.lapInvalid) {
      // The lap number advances, but an invalid lap is never recorded as a personal best or medal.
      showNotice(`LAP ${state.laps} INVALID — TIME DISCARDED`);
      currentLapSamples = [];
    } else {
      recordGhostSample(true);
      const previousBest = getTrackRecord(activeTrackId).best;
      const improved = !Number.isFinite(previousBest) || lapTime < previousBest;
      const nextBest = improved ? lapTime : previousBest;
      if (improved) {
        saveTrackBest(activeTrackId, nextBest);
      }
      // Older builds may already have a saved PB but no matching ghost. Save the
      // first valid lap as a usable reference, then replace it only with a faster lap.
      const previousGhost = ghostRecords[activeTrackId];
      if (currentLapSamples.length > 1 && (!isUsableGhost(previousGhost) || !Number.isFinite(previousGhost.time) || lapTime < previousGhost.time)) {
        ghostRecords[activeTrackId] = { time: lapTime, samples: currentLapSamples.slice(0, 12000), savedAt: Date.now() };
        saveJson(GHOST_STORAGE_KEY, ghostRecords);
      }
      // If this is the first valid lap, or a frame skipped a boundary, backfill
      // missing splits from the lap's time-distance samples so all three sectors exist.
      const referenceForSplits = isUsableGhost(previousGhost) ? previousGhost : { time: lapTime, samples: currentLapSamples };
      const referenceSectorTimes = getGhostSectorTimes(previousGhost);
      const referenceDistance = referenceForSplits.samples[referenceForSplits.samples.length - 1].distance;
      for (let index = 0; index < 2; index++) {
        if (sectorSplits.some(split => split.sector === index + 1)) continue;
        const point = interpolateGhostDistance(currentLapSamples, referenceDistance * (index + 1) / 3);
        if (!point) continue;
        const earlierSplits = sectorSplits.filter(split => split.sector < index + 1);
        const prior = earlierSplits.length ? earlierSplits[earlierSplits.length - 1] : null;
        const previousCumulative = prior ? prior.cumulative : 0;
        const splitTime = Math.max(0, point.t - previousCumulative);
        const referenceSplitTime = referenceSectorTimes ? referenceSectorTimes[index] : null;
        const split = { sector: index + 1, cumulative: point.t, splitTime, referenceSplitTime,
          delta: Number.isFinite(referenceSplitTime) ? splitTime - referenceSplitTime : null };
        sectorSplits.push(split);
        sectorSplits.sort((a, b) => a.sector - b.sector);
        if (sessionFastestSectors[index] == null || splitTime < sessionFastestSectors[index]) sessionFastestSectors[index] = splitTime;
      }
      const completedSectorTimes = [0, 1, 2].map(index => {
        const split = sectorSplits.find(item => item.sector === index + 1);
        if (split) return split.splitTime;
        const earlierSplits = sectorSplits.filter(item => item.sector <= index);
        const previous = earlierSplits.length ? earlierSplits[earlierSplits.length - 1] : null;
        return Math.max(0, lapTime - (previous ? previous.cumulative : 0));
      });
      const existingSectorBest = sectorRecords[activeTrackId] && Array.isArray(sectorRecords[activeTrackId].best) ? sectorRecords[activeTrackId].best.slice(0, 3) : [null, null, null];
      while (existingSectorBest.length < 3) existingSectorBest.push(null);
      for (let i = 0; i < 3; i++) if (Number.isFinite(completedSectorTimes[i]) && (existingSectorBest[i] == null || completedSectorTimes[i] < existingSectorBest[i])) existingSectorBest[i] = completedSectorTimes[i];
      sectorRecords[activeTrackId] = { best: existingSectorBest }; saveJson(SECTOR_STORAGE_KEY, sectorRecords);
      stats.valid = (stats.valid || 0) + 1;
      stats.history = Array.isArray(stats.history) ? stats.history : [];
      stats.history.push(lapTime); if (stats.history.length > 20) stats.history.shift();
      saveJson(STATS_STORAGE_KEY, driverStats);
      updateTimeAttackStats();
      state.best = nextBest;
      playLapChime();

      const oldMedals = new Set(earnedMedalsForTime(activeTrackId, previousBest));
      const newMedals = earnedMedalsForTime(activeTrackId, nextBest);
      const newlyEarned = newMedals.filter(medalId => !oldMedals.has(medalId));
      if (improved && newlyEarned.length) {
        // If a lap crosses multiple targets, celebrate the highest-ranked new medal.
        const award = newlyEarned.sort((a, b) => medalRank(b) - medalRank(a))[0];
        showMedalAward(award, lapTime);
      } else if (improved) {
        showNotice(`NEW PERSONAL BEST — ${formatLapTime(lapTime)}`);
      } else {
        showNotice(`LAP ${state.laps} COMPLETE — ${formatLapTime(lapTime)}`);
      }
    }
    state.lapStart = state.elapsed;
    state.lapInvalid = false;
    state.offTrackTime = 0;
    currentLapSamples = [{ t: 0, x: state.x, y: state.y, heading: state.heading, distance: 0, drsOpen: !!state.drsOpen }];
    ghostSampleClock = 0; lapDistance = 0; sectorSplits = []; nextSector = 1;
    if (lan.raceActive && lan.raceLength !== "practice" && state.laps >= Number(lan.raceLength) && !lan.playerFinished) {
      lan.playerFinished = true;
      showNotice(`FINISH — ${state.laps} LAPS COMPLETE`);
      if (audio) audio.pause();
      publishLanPlayerState(performance.now(), true, false);
    }
  }

  function update(dt) {
    const dtClamped = Math.min(dt, 1 / 30);
    state.frameDt = dtClamped;
    const clutchHeld = keys.has(bindings.clutch);
    const throttleInput = keys.has(bindings.accelerate) ? 1 : 0;
    const brakeInput = keys.has(bindings.brake) ? 1 : 0;
    const steerInput = Number(keys.has(bindings.right)) - Number(keys.has(bindings.left));
    state.steering += (steerInput - state.steering) * Math.min(1, dtClamped * 5.5);
    state.shiftTimer = Math.max(0, state.shiftTimer - dtClamped);
    if (state.drsOpen) {
      const blocker = drsBlocker();
      const slowButOk = blocker === "NEED MORE SPEED" && state.forwardSpeed >= DRS_MIN_SPEED * 0.8;
      if (blocker && !slowButOk) { state.drsOpen = false; showNotice("DRS CLOSED"); }
    }
    state.drsLevel = Math.max(0, Math.min(1, state.drsLevel + (state.drsOpen ? 4.5 : -6) * dtClamped));
    const drs = state.drsLevel;
    state.clutchEngagement = Math.max(0, Math.min(1, state.clutchEngagement + (clutchHeld ? -9 : 1.35) * dtClamped));
    const centerSurface = surfaceAt(state.x, state.y);
    const forwardX = Math.cos(state.heading), forwardY = Math.sin(state.heading);
    const sideX = -forwardY, sideY = forwardX;
    const wheelScale = activeTrack.wheelScale;
    const wheelSurfaces = [
      surfaceAt(state.x + forwardX * FRONT_AXLE * wheelScale + sideX * 0.78 * wheelScale,
        state.y + forwardY * FRONT_AXLE * wheelScale + sideY * 0.78 * wheelScale),
      surfaceAt(state.x + forwardX * FRONT_AXLE * wheelScale - sideX * 0.78 * wheelScale,
        state.y + forwardY * FRONT_AXLE * wheelScale - sideY * 0.78 * wheelScale),
      surfaceAt(state.x - forwardX * REAR_AXLE * wheelScale + sideX * 0.78 * wheelScale,
        state.y - forwardY * REAR_AXLE * wheelScale + sideY * 0.78 * wheelScale),
      surfaceAt(state.x - forwardX * REAR_AXLE * wheelScale - sideX * 0.78 * wheelScale,
        state.y - forwardY * REAR_AXLE * wheelScale - sideY * 0.78 * wheelScale)
    ];
    updateTrackLimits(wheelSurfaces, dtClamped);
    const kerbContact = centerSurface === "kerb" || wheelSurfaces.includes("kerb");
    const grassContact = centerSurface === "grass" || wheelSurfaces.includes("grass");
    const surface = grassContact ? "grass" : kerbContact ? "kerb" : "road";
    state.surface = surface;
    // More believable tyre grip: kerbs and grass are substantially less forgiving than asphalt.
    const mu = surface === "road" ? 1.10 : surface === "kerb" ? 0.84 : 0.44;
    // The powered rear axle gets a stronger longitudinal traction budget than its lateral budget.
    // This keeps launch/straight-line acceleration punchy without restoring the old cornering grip.
    const driveMu = surface === "road" ? 1.55 : surface === "kerb" ? 0.92 : 0.32;
    const u = state.forwardSpeed, v = state.lateralSpeed, r = state.yawRate;
    const absSpeed = Math.hypot(u, v), absU = Math.max(1, Math.abs(u));
    const corneringGrip = 1 - DRS_CORNERING_GRIP_LOSS * drs;
    const gear = gearRatio(state.gear);
    const wheelRpm = Math.abs(u) / WHEEL_RADIUS * 60 / (2 * Math.PI) * Math.abs(gear) * FINAL_DRIVE;
    const freeTarget = state.engineRunning ? 950 + throttleInput * (REDLINE_RPM - 950) : 0;
    state.freeRpm += (freeTarget - state.freeRpm) * Math.min(1, dtClamped * (throttleInput ? 2.5 : 5));
    if (state.engineRunning && state.gear !== 0 && state.clutchEngagement > 0.9 && absSpeed < 2.2 && throttleInput < 0.18) {
      state.engineRunning = false; showNotice("ENGINE STALLED — CLUTCH + I TO RESTART");
    }
    const coupledRpm = state.gear === 0 ? state.freeRpm : Math.max(0, wheelRpm);
    const rpmTarget = state.engineRunning ? state.freeRpm * (1 - state.clutchEngagement) + coupledRpm * state.clutchEngagement : 0;
    state.engineRpm += (rpmTarget - state.engineRpm) * Math.min(1, dtClamped * 8);

    // Progressive rev limiter: torque tapers over the final 5% of the RPM range and is cut at
    // redline when the clutch is coupled. Use wheel RPM for the limit, not the smoothed audio RPM,
    // so integration timing cannot let a low gear drag the car up to the 612 km/h global cap.
    const drivetrainCoupled = state.gear !== 0 && state.clutchEngagement > 0.85;
    const limiterStartRpm = REDLINE_RPM * 0.95;
    const rpmLimiter = drivetrainCoupled
      ? Math.max(0, Math.min(1, (REDLINE_RPM - wheelRpm) / (REDLINE_RPM - limiterStartRpm)))
      : 1;
    if (state.engineRunning && drivetrainCoupled && wheelRpm >= REDLINE_RPM * 0.985) {
      if (!state.revLimiterActive) showNotice("REV LIMIT — UPSHIFT");
      state.revLimiterActive = true;
      if (wheelRpm >= REDLINE_RPM) state.engineRpm = REDLINE_RPM;
    } else if (!drivetrainCoupled || wheelRpm < REDLINE_RPM * 0.94) {
      state.revLimiterActive = false;
    }

    const torqueCurve = state.engineRpm < 3500 ? 0.72 + state.engineRpm / 10000
      : state.engineRpm < 14000 ? 1.07
      : Math.max(0.70, 1.07 - (state.engineRpm - 14000) / 12000);
    let engineForce = state.engineRunning && state.gear !== 0 && throttleInput > 0
      ? (throttleInput * 500 * torqueCurve * rpmLimiter) * gear * FINAL_DRIVE / WHEEL_RADIUS * state.clutchEngagement
      : 0;
    if (drs > 0 && engineForce > 0) engineForce *= 1 + DRS_FORCE_BOOST * drs;
    if (gearboxMode === "sequential" && state.shiftTimer > 0) engineForce *= 0.08;
    if (state.gear !== 0 && throttleInput === 0 && state.engineRunning) engineForce -= Math.sign(u || gear) * 360 * state.clutchEngagement;
    // Aero still builds with speed, but the lower coefficient/cap prevents absurd cornering loads.
    // This is what makes hairpins require real braking instead of letting the car stick at any speed.
    const downforce = Math.min(0.5 * 1.2 * 4.5 * absSpeed * absSpeed, MASS * 9.81 * 1.45);
    const transfer = MASS * state.longAccel * 0.48 / WHEELBASE;
    const frontLoad = Math.max(800, MASS * 9.81 * 0.46 - transfer + downforce * 0.48);
    const rearLoad = Math.max(800, MASS * 9.81 * 0.54 + transfer + downforce * 0.52);
    const frontGrip = mu * frontLoad;
    // No-oversteer model: rear grip ignores load transfer and wheelspin, so it never drops below its static + aero load.
    const rearGrip = mu * Math.max(rearLoad, MASS * 9.81 * 0.54 + downforce * 0.52);
    const rearDriveGrip = driveMu * Math.max(rearLoad, MASS * 9.81 * 0.54 + downforce * 0.52);
    // Steering gets progressively more precise at speed: a full lock input cannot pivot the car
    // through a hairpin at 250-500 km/h. Slow down to regain steering angle and lateral grip.
    const speedSteerFactor = Math.max(0.12, 1 / (1 + absSpeed / 38));
    const steerAngle = state.steering * 0.72 * speedSteerFactor;
    const alphaFront = Math.atan2(v + FRONT_AXLE * r, absU) - steerAngle * Math.sign(u || 1);
    const alphaRear = Math.atan2(v - REAR_AXLE * r, absU);
    const brakeSign = Math.sign(u || (state.gear === -1 ? -1 : 1));
    // Brake force scales modestly with aero load. A combined-slip friction circle prevents the
    // front/rear tyres from producing full braking and full cornering force simultaneously.
    const brakeDemand = brakeInput * Math.min(MASS * 9.81 * 2.05, MASS * 9.81 * 0.90 + downforce * 0.55);
    const frontBrakeDemand = brakeDemand * 0.58;
    const rearBrakeDemand = brakeDemand * 0.42;
    const frontBrakeRequest = Math.min(frontBrakeDemand, frontGrip);
    const rearBrakeRequest = Math.min(rearBrakeDemand, rearGrip);
    // DRS trims lateral tyre response/capacity only; it does not lower the underlying longitudinal
    // tyre grip or the drive-force ceiling.
    const frontLatLimit = Math.sqrt(Math.max(0, frontGrip * frontGrip - frontBrakeRequest * frontBrakeRequest)) * corneringGrip;
    const rearLatLimit = Math.sqrt(Math.max(0, rearGrip * rearGrip - rearBrakeRequest * rearBrakeRequest)) * corneringGrip;
    let fyFront = Math.max(-frontLatLimit, Math.min(frontLatLimit, -85000 * alphaFront * corneringGrip));
    let fyRear = Math.max(-rearLatLimit, Math.min(rearLatLimit, -92000 * alphaRear * corneringGrip));
    const frontBrake = Math.min(frontBrakeRequest, Math.sqrt(Math.max(0, frontGrip * frontGrip - fyFront * fyFront)));
    const rearBrake = Math.min(rearBrakeRequest, Math.sqrt(Math.max(0, rearGrip * rearGrip - fyRear * fyRear)));
    const rearLateralAndBrakeUse = Math.min(1, (fyRear / Math.max(1, rearGrip)) ** 2 + (rearBrake / Math.max(1, rearGrip)) ** 2);
    const driveLimit = rearDriveGrip * Math.sqrt(Math.max(0, 1 - rearLateralAndBrakeUse));
    // Keep modest extra yaw damping when the player countersteers; power oversteer is disabled.
    const countersteering = Math.abs(state.yawRate) > 0.18 && state.steering * state.yawRate < -0.04;
    const fxRear = Math.max(-driveLimit, Math.min(driveLimit, engineForce));
    const rollingResistance = absSpeed > 0.15 ? Math.sign(u) * 180 : 0;
    const longitudinalAccel = (fxRear - brakeSign * (frontBrake + rearBrake) - rollingResistance) / MASS - 0.5 * 1.2 * 0.9 * (1 - DRS_DRAG_CUT * drs) * absSpeed * u / MASS;
    const lateralAccel = (fyFront + fyRear) / MASS - r * u;
    const yawAccel = (FRONT_AXLE * fyFront - REAR_AXLE * fyRear) / INERTIA;
    state.longAccel = longitudinalAccel;
    const selectedGearRedline = state.gear > 0 ? gearRedlineSpeed(state.gear) : Infinity;
    const topSpeed = Math.min(BASE_TOP_SPEED + DRS_TOP_SPEED_BONUS, selectedGearRedline);
    state.forwardSpeed = Math.max(-30, Math.min(topSpeed, u + longitudinalAccel * dtClamped));
    // Bleed off the DRS speed bonus smoothly once the flap closes instead of snapping to the normal limit.
    // The active gear's redline cap always takes priority over the DRS top-speed bonus.
    const softCap = Math.min(BASE_TOP_SPEED + DRS_TOP_SPEED_BONUS * drs, selectedGearRedline);
    if (state.forwardSpeed > softCap) state.forwardSpeed += (softCap - state.forwardSpeed) * Math.min(1, dtClamped * 2.5);
    if (state.gear > 0) state.forwardSpeed = Math.min(state.forwardSpeed, selectedGearRedline);
    state.lateralSpeed += lateralAccel * dtClamped;
    state.yawRate += yawAccel * dtClamped;
    if (Math.abs(state.steering) > 0.01 && Math.abs(u) > 0.25 && absSpeed < 35) {
      const kinematicYaw = u / WHEELBASE * Math.tan(steerAngle);
      const gripYawLimit = (mu * corneringGrip * (9.81 + downforce / MASS)) / Math.max(absSpeed, 1.5);
      const targetYaw = Math.max(-gripYawLimit, Math.min(gripYawLimit, kinematicYaw));
      const lowSpeedAssist = 0.42 * Math.max(0, 1 - absSpeed / 35);
      state.yawRate += (targetYaw - state.yawRate) * lowSpeedAssist * Math.min(1, dtClamped * 6);
    }
    state.yawRate *= Math.exp(-dtClamped * (absSpeed < 2 ? 3.5 : brakeInput ? 1.8 : 0.12 + (countersteering ? 0.3 : 0)));
    state.heading += state.yawRate * dtClamped;
    if (brakeInput && absSpeed < 0.8) state.forwardSpeed = 0;
    if (state.gear > 0 && state.forwardSpeed < 0) state.forwardSpeed = 0;
    if (state.gear === -1 && state.forwardSpeed > 0) state.forwardSpeed = 0;
    if (absSpeed < 0.5) { state.lateralSpeed *= Math.exp(-dtClamped * 5); state.yawRate *= Math.exp(-dtClamped * 4); }
    state.speed = Math.hypot(state.forwardSpeed, state.lateralSpeed);
    state.vx = state.forwardSpeed * Math.cos(state.heading) - state.lateralSpeed * Math.sin(state.heading);
    state.vy = state.forwardSpeed * Math.sin(state.heading) + state.lateralSpeed * Math.cos(state.heading);
    const oldX = state.x, oldY = state.y;
    const elapsedBeforeStep = state.elapsed;
    state.x += state.vx * dtClamped; state.y += state.vy * dtClamped;
    // Once a lap is armed, time belongs to the lap and advances independently
    // of the player's speed so stopping cannot pause the reference ghost.
    const elapsedStep = state.gateArmed || state.speed > 1.5 ? dtClamped : 0;
    if (state.speed > 1.5) state.started = true;
    if (elapsedStep > 0) state.elapsed += elapsedStep;
    if (state.gateArmed) {
      const previousLapDistance = lapDistance;
      lapDistance += Math.hypot(state.x-oldX, state.y-oldY);
      const referenceGhost = ghostRecords[activeTrackId];
      const referenceDistance = isUsableGhost(referenceGhost) ? referenceGhost.samples[referenceGhost.samples.length - 1].distance : 0;
      const referenceSectorTimes = getGhostSectorTimes(referenceGhost);
      while (referenceDistance > 0 && nextSector <= 2 && lapDistance >= referenceDistance * nextSector / 3) {
        const boundaryDistance = referenceDistance * nextSector / 3;
        const distanceStep = lapDistance - previousLapDistance;
        const crossingFraction = distanceStep > 0 ? Math.max(0, Math.min(1, (boundaryDistance - previousLapDistance) / distanceStep)) : 1;
        const cumulative = Math.max(0, elapsedBeforeStep - state.lapStart + elapsedStep * crossingFraction);
        const previousCumulative = sectorSplits.length ? sectorSplits[sectorSplits.length - 1].cumulative : 0;
        const splitTime = Math.max(0, cumulative - previousCumulative);
        const referenceSplitTime = referenceSectorTimes ? referenceSectorTimes[nextSector - 1] : null;
        sectorSplits.push({ sector: nextSector, time: cumulative, cumulative, splitTime, referenceSplitTime,
          delta: Number.isFinite(referenceSplitTime) ? splitTime - referenceSplitTime : null });
        const idx = nextSector - 1;
        if (sessionFastestSectors[idx] == null || splitTime < sessionFastestSectors[idx]) sessionFastestSectors[idx] = splitTime;
        nextSector++;
      }
      recordGhostSample();
    }
    if (surface === "grass") { state.forwardSpeed *= 0.985; state.lateralSpeed *= 0.98; }
    processTrackGates(oldX, state.x, oldY, state.y);
    processDrsZones(oldX, state.x, oldY, state.y);
    if (audio) {
      const rpm = state.engineRunning ? Math.max(0, state.engineRpm) : 0;
      const rpmFraction = Math.max(0, Math.min(1, rpm / REDLINE_RPM));
      if (audio.context) {
        const now = audio.context.currentTime;
        audio.firingSource.playbackRate.setTargetAtTime(Math.max(0.05, rpm / 1200), now, 0.035);
        audio.crank.frequency.setTargetAtTime(Math.max(0, rpm / 60), now, 0.045);
        audio.exhaustFilter.frequency.setTargetAtTime(1000 + rpmFraction * 2600, now, 0.08);
        audio.exhaustGain.gain.setTargetAtTime(state.engineRunning ? 0.10 + throttleInput * 0.25 + rpmFraction * 0.08 : 0, now, 0.055);
        audio.crankGain.gain.setTargetAtTime(state.engineRunning ? 0.07 + throttleInput * 0.035 : 0, now, 0.06);
        const speedKmh = state.speed * 3.6;
        const windBlend = Math.max(0, Math.min(1, (speedKmh - 90) / 420));
        if (audio.windFilter && audio.windGain) {
          audio.windFilter.frequency.setTargetAtTime(450 + windBlend * 1900, now, 0.09);
          audio.windGain.gain.setTargetAtTime(windBlend * (state.drsOpen ? 0.15 : 0.11), now, 0.10);
        }
      }
      const frontSaturation = Math.abs(fyFront) / Math.max(1, frontGrip);
      const rearSaturation = Math.abs(fyRear) / Math.max(1, rearGrip);
      audio.squealCooldown = Math.max(0, audio.squealCooldown - dtClamped);
      audio.squealCheck += dtClamped;
      const nearTyreLimit = absSpeed > 14 && (
        (frontSaturation > 0.92 && Math.abs(alphaFront) > 0.08) ||
        (rearSaturation > 0.92 && Math.abs(alphaRear) > 0.10)
      );
      if (audio.squealCheck >= 0.45) {
        audio.squealCheck = 0;
        if (nearTyreLimit && audio.squealCooldown <= 0 && audio.tire.paused && Math.random() < 0.28) {
          audio.tire.currentTime = 0;
          audio.tire.volume = 0.22;
          audio.tire.play().then(() => window.setTimeout(() => {
            audio.tire.pause(); audio.tire.currentTime = 0;
          }, 500)).catch(() => {});
          audio.squealCooldown = 2.6;
        }
      }
      audio.grass.volume = surface === "grass" ? 0.55 : 0;
    }
  }

  function drawCar(x, y) {
    const sprite = getPlayerSpriteForCurrentFrame();
    if (!sprite) return;
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(state.heading + Math.PI / 2);
    const { width, height } = getPlayerCarRenderSize();
    ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function drawGauge(cx, cy, radius, value, max, label, unit, redStart = max) {
    ctx.save();
    const start = Math.PI * 0.78, sweep = Math.PI * 1.44;
    ctx.shadowColor = "#101719"; ctx.shadowBlur = 5;
    ctx.lineWidth = 4; ctx.strokeStyle = "#52625a";
    ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + sweep); ctx.stroke();
    const redFraction = Math.max(0, Math.min(1, redStart / max));
    ctx.strokeStyle = "#f4514b"; ctx.beginPath();
    ctx.arc(cx, cy, radius, start + sweep * redFraction, start + sweep); ctx.stroke();
    for (let tick = 0; tick <= 8; tick++) {
      const a = start + sweep * tick / 8;
      ctx.strokeStyle = "#f7e8b2"; ctx.lineWidth = tick % 2 === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (radius - 5), cy + Math.sin(a) * (radius - 5));
      ctx.lineTo(cx + Math.cos(a) * (radius + 1), cy + Math.sin(a) * (radius + 1)); ctx.stroke();
    }
    const fraction = Math.max(0, Math.min(1, value / max));
    const needle = start + sweep * fraction;
    ctx.strokeStyle = customize.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needle) * (radius - 8), cy + Math.sin(needle) * (radius - 8)); ctx.stroke();
    ctx.fillStyle = "#f7e8b2"; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff3c9"; ctx.textAlign = "center"; ctx.font = '10px \"Upheaval TT (BRK)\", \"Courier New\", monospace';
    ctx.fillText(label, cx, cy + 8);
    ctx.font = '10px \"Upheaval TT (BRK)\", \"Courier New\", monospace'; ctx.fillText(`${Math.round(value)} ${unit}`, cx, cy + 20);
    ctx.restore();
  }

  function drawFloatingGauges() {
    drawGauge(315, 342, 34, state.engineRpm, REDLINE_RPM, "TACH", "RPM", 15500);
    drawGauge(405, 342, 34, state.speed * 3.6, 620, "SPEED", "KM/H", 520);
    const gear = state.gear === 0 ? "N" : state.gear === -1 ? "R" : state.gear;
    ctx.save(); ctx.textAlign = "center"; ctx.fillStyle = "#fff3c9";
    ctx.shadowBlur = 0;
    ctx.font = '11px \"Upheaval TT (BRK)\", \"Courier New\", monospace'; ctx.fillText("GEAR", 495, 325);
    ctx.font = '34px \"Upheaval TT (BRK)\", \"Courier New\", monospace'; ctx.fillText(String(gear), 495, 363);
    ctx.restore();
  }

  const speedLines = Array.from({ length: 72 }, () => ({ x: Math.random() * W, y: Math.random() * H,
    length: 7 + Math.random() * 13, width: Math.random() < 0.78 ? 1 : 2, drift: 0.65 + Math.random() * 0.8 }));
  function resetSpeedLine(line) {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { line.x = -20; line.y = Math.random() * H; }
    else if (edge === 1) { line.x = W + 20; line.y = Math.random() * H; }
    else if (edge === 2) { line.x = Math.random() * W; line.y = -20; }
    else { line.x = Math.random() * W; line.y = H + 20; }
    line.length = 7 + Math.random() * 13;
    line.width = Math.random() < 0.78 ? 1 : 2;
    line.drift = 0.65 + Math.random() * 0.8;
  }
  function updateSpeedLines(dt) {
    const kmh = state.speed * 3.6;
    if (kmh < 125) return;
    const drift = (80 + Math.min(kmh, 620) * 1.15) * dt;
    const dx = Math.cos(state.heading) * drift;
    const dy = Math.sin(state.heading) * drift;
    for (const line of speedLines) {
      line.x -= dx * line.drift;
      line.y -= dy * line.drift;
      if (line.x < -30 || line.x > W + 30 || line.y < -30 || line.y > H + 30) resetSpeedLine(line);
    }
  }
  function drawSpeedLines(kmh) {
    const blend = Math.max(0, Math.min(1, (kmh - 140) / 420));
    if (blend <= 0) return;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = `rgba(225, 245, 255, ${0.035 + blend * 0.13})`;
    const ux = Math.cos(state.heading), uy = Math.sin(state.heading);
    for (const line of speedLines) {
      const edgeDistance = Math.min(line.x, W - line.x, line.y, H - line.y);
      if (edgeDistance > 112) continue; // Keep the car and HUD areas calm and readable.
      if ((line.x < 218 && line.y < 92) || (line.y > 294 && line.x > 260 && line.x < 535)) continue;
      const length = line.length * (0.55 + blend * 1.25);
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.x - ux * length, line.y - uy * length);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSectorHud() {
    // Show completed sector times and a live clock for the sector currently in progress.
    const w = 184, h = 116;
    const x = W - w - 10, y = 92;
    ctx.save();
    if (sectorPanelImage.complete && sectorPanelImage.naturalWidth) {
      ctx.globalAlpha = 0.96;
      ctx.drawImage(sectorPanelImage, x, y, w, h);
    } else {
      ctx.fillStyle = "rgba(8,7,20,.90)";
      ctx.fillRect(x, y, w, h);
    }
    // Subtle inner shade keeps text readable without hiding the supplied art.
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(5,5,15,.34)";
    ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
    ctx.textAlign = "left";
    ctx.font = '10px "Upheaval TT (BRK)", "Courier New", monospace';
    ctx.fillStyle = "#ffffff";
    ctx.fillText(isUsableGhost(ghostRecords[activeTrackId]) ? "SECTOR TIMES / DELTA" : "REFERENCE LAP", x + 11, y + 17);

    const bestSectors = sectorRecords[activeTrackId] && sectorRecords[activeTrackId].best || [];
    const ghostSectorTimes = getGhostSectorTimes(ghostRecords[activeTrackId]);
    const elapsed = state.gateArmed ? Math.max(0, state.elapsed - state.lapStart) : 0;
    const previousCumulative = sectorSplits.length ? sectorSplits[sectorSplits.length - 1].cumulative : 0;
    for (let i = 0; i < 3; i++) {
      const rowY = y + 36 + i * 20;
      const split = sectorSplits.find(v => v.sector === i + 1);
      const isCurrent = state.gateArmed && i === sectorSplits.length;
      const value = split ? split.splitTime : isCurrent ? Math.max(0, elapsed - previousCumulative) : null;
      const reference = ghostSectorTimes && ghostSectorTimes[i];
      const delta = split && Number.isFinite(split.delta) ? split.delta
        : isCurrent && Number.isFinite(reference) ? value - reference : null;
      let color = "#f0d84f";
      if (Number.isFinite(delta)) color = delta < -0.005 ? "#bd78ff" : delta <= 0.005 ? "#65ef91" : "#ffbd62";
      else if (value != null && bestSectors[i] != null && value <= bestSectors[i]) {
        color = sessionFastestSectors[i] != null && value <= sessionFastestSectors[i] ? "#bd78ff" : "#65ef91";
      }
      ctx.fillStyle = "rgba(0,0,0,.40)";
      ctx.fillRect(x + 8, rowY - 10, w - 16, 16);
      ctx.fillStyle = color;
      ctx.fillRect(x + 8, rowY - 10, 3, 16);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.font = '10px "Upheaval TT (BRK)", "Courier New", monospace';
      ctx.fillText(`S${i + 1}`, x + 16, rowY + 1);
      ctx.font = '10px "Upheaval TT (BRK)", "Courier New", monospace';
      ctx.fillText(value == null ? "--.---" : value.toFixed(3), x + 37, rowY + 1);
      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.fillText(delta == null ? (isCurrent ? "LIVE" : "") : `${delta <= 0 ? "-" : "+"}${Math.abs(delta).toFixed(3)}`, x + w - 11, rowY + 1);
    }
    ctx.textAlign = "left";
    ctx.font = '8px "Upheaval TT (BRK)", "Courier New", monospace';
    ctx.fillStyle = "#bfc8d0"; ctx.fillText("SECTOR TIME  DELTA VS REF", x + 9, y + h - 7);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const sceneBackgroundPattern = activeTrack.id === "tck02" ? tck02GrassPattern : grassPattern;
    // TCK-02's supplied image is the complete opaque circuit composition (grass, road, kerbs and markings).
    // TCK-01 retains its original scene artwork; repeating grass is only visible outside the TCK-02 map.
    ctx.fillStyle = sceneBackgroundPattern || (activeTrack.id === "tck02" ? "#53545a" : "#4a8343");
    ctx.fillRect(0, 0, W, TRACK_H);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, TRACK_H); ctx.clip();
    const cameraSpeedKmh = state.speed * 3.6;
    const fastBlendRaw = Math.max(0, Math.min(1, (cameraSpeedKmh - 120) / 480));
    const fastBlend = fastBlendRaw * fastBlendRaw * (3 - 2 * fastBlendRaw);
    // A subtle high-speed push-in increases scenery flow while the car sprite remains fixed at 65px.
    const baseTrackScale = activeTrack.id === "tck02" ? TRACK_SCALE_TCK02 : TRACK_SCALE_TCK01;
    const trackScale = baseTrackScale * (1 + (activeTrack.id === "tck02" ? 0.14 : 0.06) * fastBlend);
    const shakeX = Math.sin(performance.now() * 0.071) * 0.72 * fastBlend;
    const shakeY = Math.cos(performance.now() * 0.083) * 0.52 * fastBlend;
    ctx.translate(W / 2 - cameraX * trackScale + shakeX, SCENE_H / 2 - cameraY * trackScale + shakeY);
    ctx.scale(trackScale, trackScale);
    if (sceneBackgroundPattern) {
      ctx.fillStyle = sceneBackgroundPattern;
      ctx.fillRect(-12000, -12000, 24000, 24000);
    }
    if (activeTrack.image.complete && activeTrack.image.naturalWidth) {
      ctx.drawImage(activeTrack.image, 0, 0, activeTrack.width, activeTrack.height);
    }
    const finish = activeTrack.finish;
    if (activeTrack.id !== "tck02") {
      // TCK-01 keeps its code-drawn checkerboard. TCK-02 uses the supplied finish-line pixels as-is.
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 2; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? "#fff" : "#252626";
          ctx.fillRect(FINISH_X - 4 + col * 4, STRAIGHT_TOP + row * 8, 4, 8);
        }
      }
    }
    if (!lan.raceActive && timeAttackConfig.ghost !== false && state.gateArmed) {
      const ghost = ghostRecords[activeTrackId];
      if (isUsableGhost(ghost)) {
        const point = interpolateGhost(ghost.samples, state.elapsed - state.lapStart);
        if (point) {
          const steer = point.steerDir || "center";
          const key = point.drsOpen ? ({left:"drsLeft",right:"drsRight",center:"drsCenter"})[steer] : ({left:"left",right:"right",center:"center"})[steer];
          const sprite = ghostSprites[key] && ghostSprites[key].complete && ghostSprites[key].naturalWidth ? ghostSprites[key] : ghostSprites.center;
          if (sprite && sprite.complete && sprite.naturalWidth) {
            ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(point.heading + Math.PI / 2);
            ctx.globalAlpha = 0.68; ctx.imageSmoothingEnabled = false;
            // This sprite is drawn inside the scaled world transform; divide the
            // player's screen-space size by the camera scale to match it exactly.
            const playerSize = getPlayerCarRenderSize();
            const gh = playerSize.height / trackScale, gw = playerSize.width / trackScale;
            ctx.drawImage(sprite, -gw / 2, -gh / 2, gw, gh); ctx.restore();
          }
        }
      }
    }
    ctx.restore();
    drawRemoteCars(trackScale, shakeX, shakeY);
    const carScreenX = W / 2 + (state.x - cameraX) * trackScale + shakeX;
    const carScreenY = SCENE_H / 2 + (state.y - cameraY) * trackScale + shakeY;
    drawCar(carScreenX, carScreenY);
    sceneSnapshotCtx.clearRect(0, 0, W, TRACK_H);
    sceneSnapshotCtx.drawImage(canvas, 0, 0, W, TRACK_H, 0, 0, W, TRACK_H);
    const speedKmh = state.speed * 3.6;
    const blurStrength = Math.max(0, Math.min(0.34, (speedKmh - 80) / 1500));
    if (blurStrength > 0 && motionTrailCanvas.width) {
      ctx.save(); ctx.globalAlpha = blurStrength; ctx.drawImage(motionTrailCanvas, 0, 0); ctx.restore();
    }
    motionTrailCtx.clearRect(0, 0, W, TRACK_H);
    motionTrailCtx.drawImage(sceneSnapshot, 0, 0);
    drawSpeedLines(speedKmh);
    const now = state.gateArmed ? state.elapsed - state.lapStart : state.elapsed;
    const best = Number.isFinite(state.best) ? formatLapTime(state.best) : "--:--.--";
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.82)"; ctx.fillRect(12, 10, 272, 47);
    ctx.fillStyle = "#fff3c9";
    ctx.font = '18px "Upheaval TT (BRK)", "Courier New", monospace';
    ctx.fillText(`LAP ${state.laps + 1}`, 20, 31);
    ctx.font = '12px "Upheaval TT (BRK)", "Courier New", monospace';
    const timing = state.lapInvalid
      ? `TIME ${formatLapTime(now)}  INVALID  BEST ${best}`
      : `TIME ${formatLapTime(now)}  BEST ${best}`;
    if (state.lapInvalid) ctx.fillStyle = "#ff9c91";
    ctx.fillText(timing, 20, 51);
    ctx.restore();
    if (runtimeFault || performance.now() < gameNoticeUntil) {
      const visibleNotice = runtimeFault ? "GAME ERROR — PRESS R TO RESET" : gameNotice;
      ctx.save(); ctx.textAlign = "center"; ctx.font = '15px \"Upheaval TT (BRK)\", \"Courier New\", monospace';
      const noticeWidth = ctx.measureText(visibleNotice).width + 14;
      ctx.fillStyle = "rgba(0,0,0,.82)"; ctx.fillRect((W - noticeWidth) / 2, 60, noticeWidth, 22);
      ctx.fillStyle = "#fff1b8"; ctx.fillText(visibleNotice, W / 2, 76); ctx.restore();
    }
    if (!lan.raceActive) drawSectorHud();
    drawMedalAwardToast();
    drawDrsIndicator();
    drawLanHud();
    drawFloatingGauges();
  }

  function drawMedalAwardToast() {
    if (!medalAwardToast) return;
    if (performance.now() > medalAwardToast.until) { medalAwardToast = null; return; }
    const icon = medalImages[medalAwardToast.id];
    ctx.save();
    ctx.fillStyle = "rgba(16, 23, 25, 0.90)";
    ctx.strokeStyle = "#d8c99a";
    ctx.lineWidth = 2;
    ctx.fillRect(W / 2 - 112, 88, 224, 52);
    ctx.strokeRect(W / 2 - 112, 88, 224, 52);
    if (icon && icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, W / 2 - 96, 98, 32, 32);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff3c9";
    ctx.font = '13px \"Upheaval TT (BRK)\", \"Courier New\", monospace';
    ctx.fillText(`${medalAwardToast.label.toUpperCase()} MEDAL`, W / 2 + 12, 108);
    ctx.font = '12px \"Upheaval TT (BRK)\", \"Courier New\", monospace';
    ctx.fillText(formatLapTime(medalAwardToast.lapTime), W / 2 + 12, 126);
    ctx.restore();
  }

  function drawDrsIndicator() {
    const open = state.drsOpen;
    const ready = !open && drsBlocker() === null;
    const label = open ? "DRS OPEN" : ready ? "DRS READY" : "DRS";
    ctx.save();
    ctx.font = '12px \"Upheaval TT (BRK)\", \"Courier New\", monospace'; ctx.textAlign = "left";
    const width = ctx.measureText(label).width + 16;
    ctx.fillStyle = open ? "#1f9d4b" : "rgba(23, 33, 43, 0.75)";
    ctx.fillRect(18, 60, width, 20);
    ctx.strokeStyle = open ? "#7dffa8" : ready ? "#f7e8b2" : "#58665c"; ctx.lineWidth = 2;
    ctx.strokeRect(18, 60, width, 20);
    ctx.fillStyle = open ? "#ffffff" : ready ? "#f7e8b2" : "#8b968c";
    ctx.fillText(label, 26, 74);
    ctx.restore();
  }

  let previous = performance.now();
  let lastRpcPublish = 0;
  function publishDiscordPresence(now) {
    if (!window.PixelCorsaRPC || now - lastRpcPublish < 1300) return;
    lastRpcPublish = now;
    const activePage = Object.keys(pages).find(key => pages[key].classList.contains("active")) || "main";
    let screen = "main";
    if (mode === "game") screen = "racing";
    else if (mode === "paused") screen = "paused";
    else if (activePage === "settings") screen = "settings";
    else if (activePage === "levels") screen = "track-select";
    window.PixelCorsaRPC.update({
      screen,
      track: activeTrackId,
      lap: state.laps + 1,
      speedKmh: Math.round(state.speed * 3.6),
      elapsedSeconds: state.elapsed,
      lapTimeSeconds: state.gateArmed ? state.elapsed - state.lapStart : 0,
      drs: state.drsOpen
    });
  }
  function frame(now) {
    // Schedule the next frame first: one unexpected exception must never kill the game loop.
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((now - previous) / 1000, 0.04)); previous = now;
    publishDiscordPresence(now);
    if (mode !== "game") return;

    try {
      if (!lan.playerFinished && !runtimeFault) {
        update(dt);
        updateSpeedLines(dt);
        if (activeTrack.id === "tck02") {
          // TCK-02 uses a direct, car-locked camera with a pulled-back view and no edge clamp.
          cameraX = state.x;
          cameraY = state.y;
        } else {
          const follow = 1 - Math.exp(-dt * 5);
          cameraX += (state.x - cameraX) * follow;
          cameraY += (state.y - cameraY) * follow;
        }
      }
      updateLanRemoteVisuals(dt);
      publishLanPlayerState(now);
      draw();
    } catch (error) {
      if (!runtimeFault) {
        runtimeFault = error;
        keys.clear();
        state.drsOpen = false;
        state.drsLevel = 0;
        console.error("Pixel Corsa recovered from a runtime error. Press R to reset the car.", error);
      }
      // Try drawing a clear fallback diagnostic instead of leaving a frozen black canvas.
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#101719"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff1b8"; ctx.textAlign = "center";
        ctx.font = '18px \"Upheaval TT (BRK)\", \"Courier New\", monospace';
        ctx.fillText("GAME ERROR — PRESS R TO RESET", W / 2, H / 2);
      } catch (_) { /* Canvas unavailable: keep the RAF alive for recovery. */ }
    }
  }
  refreshTrackMedalCards();
  requestAnimationFrame(frame);
})();
