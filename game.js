const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const miniMap = document.getElementById('miniMap');
const miniCtx = miniMap.getContext('2d');

const world = {
  width: 2000,
  height: 1800,
  tile: 32,
  route: [
    { x: 260, y: 1320 },
    { x: 420, y: 1240 },
    { x: 550, y: 1090 },
    { x: 760, y: 930 },
    { x: 1040, y: 775 },
    { x: 1260, y: 680 },
    { x: 1510, y: 590 }
  ],
  river: [
    { x: 870, y: 980 },
    { x: 990, y: 900 },
    { x: 1110, y: 820 },
    { x: 1230, y: 760 },
    { x: 1360, y: 720 }
  ]
};

const state = {
  money: 12400,
  missionIndex: 0,
  objectiveCompleted: [false, false, false],
  rutDepth: {},
  activeBtn: 'drive',
  lowRange: true,
  awd: true,
  diffLock: false,
  winchActive: false,
  winchAnchor: null,
  tirePressure: 30,
  radioIndex: 0,
  time: 0,
  build: {
    portalAxles: false,
    lockerRear: false,
    lockerFront: false,
    transferCase: false,
    shafts: false,
    ctis: false,
    beadlocks: false,
    boggers: false,
    chains: false,
    snorkel: false,
    sealedIgnition: false,
    radiatorRelocation: false,
    springOver: false,
    winch: false
  }
};

const player = {
  x: 260,
  y: 1320,
  dir: 0.2,
  speed: 0,
  slip: 0,
  damage: 0,
  fuel: 78,
  engine: 96,
  chassis: 100,
  tyres: 91,
  rpm: 850,
  waterDepth: 0,
  selectedGear: 'N',
  gearMode: 'LOW'
};

const keyState = {};

function saveGame() {
  try {
    localStorage.setItem('taiga-save-v1', JSON.stringify({
      money: state.money,
      objectiveCompleted: state.objectiveCompleted,
      build: state.build,
      tirePressure: state.tirePressure,
      player: { x: player.x, y: player.y, fuel: player.fuel, engine: player.engine, chassis: player.chassis, tyres: player.tyres },
      rutDepth: state.rutDepth
    }));
  } catch (error) {
    // The prototype remains playable when storage is disabled.
  }
}

try {
  const saved = JSON.parse(localStorage.getItem('taiga-save-v1') || 'null');
  if (saved) {
    if (Number.isFinite(saved.money)) state.money = saved.money;
    if (Array.isArray(saved.objectiveCompleted) && saved.objectiveCompleted.length === 3) state.objectiveCompleted = saved.objectiveCompleted;
    if (saved.build) Object.assign(state.build, saved.build);
    if (Number.isFinite(saved.tirePressure)) state.tirePressure = saved.tirePressure;
    if (saved.player) Object.assign(player, saved.player);
    if (saved.rutDepth && typeof saved.rutDepth === 'object') state.rutDepth = saved.rutDepth;
    state.missionIndex = Math.min(state.objectiveCompleted.filter(Boolean).length, 2);
  }
} catch (error) {
  // Ignore corrupt or unavailable local saves and start a fresh sortie.
}

const terrainTypes = {
  road: { label: 'FIRM TRACK', color: '#708061', traction: 1, drag: 0.98, surface: 0.25 },
  mud: { label: 'THAW MUD', color: '#6b5645', traction: 0.48, drag: 0.9, surface: 0.8 },
  peat: { label: 'PEAT BOG', color: '#363d2d', traction: 0.35, drag: 0.78, surface: 1.2 },
  snow: { label: 'SNOW SHELF', color: '#dfe9ee', traction: 0.72, drag: 0.96, surface: 0.48 },
  water: { label: 'WATER CURRENT', color: '#4f8ca8', traction: 0.4, drag: 0.88, surface: 1.05 },
  rock: { label: 'ROCK LEDGE', color: '#7a7f7b', traction: 0.6, drag: 0.94, surface: 0.68 }
};

const upgrades = [
  { id: 'portalAxles', name: 'Military portal axles', type: 'drivetrain', cost: 2100, description: 'Raises ground clearance and improves slow-speed traction.', effect: 'clearance +90 mm, traction +12%' },
  { id: 'lockerRear', name: 'Rear diff locker', type: 'drivetrain', cost: 1300, description: 'Adds rear-axle pull when the differential lock is engaged.', effect: 'locked traction +15%' },
  { id: 'lockerFront', name: 'Front diff locker', type: 'drivetrain', cost: 1400, description: 'Adds front-axle pull when the differential lock is engaged.', effect: 'locked traction +10%' },
  { id: 'transferCase', name: 'Crawler transfer case', type: 'drivetrain', cost: 1800, description: 'Improves low-range acceleration for precise crawling.', effect: 'low-range acceleration +32%' },
  { id: 'shafts', name: 'Reinforced half-shafts', type: 'drivetrain', cost: 900, description: 'Stronger shafts reduce chassis wear from rough impacts and high-load driving.', effect: 'impact / load wear -18%' },
  { id: 'ctis', name: 'CTIS pressure control', type: 'wheels', cost: 1200, description: 'Adjust tyre pressure between road and soft-ground settings.', effect: '30 / 18 PSI on the move' },
  { id: 'beadlocks', name: 'Beadlock rims', type: 'wheels', cost: 1100, description: 'Retains the tyre bead at very low pressure for extra soft-ground grip.', effect: 'enables 8 PSI setting' },
  { id: 'boggers', name: 'Extreme bogger tires', type: 'wheels', cost: 1700, description: 'Deep lugs add bite in mud and peat.', effect: 'mud / peat traction +18%' },
  { id: 'chains', name: 'Snow chains', type: 'wheels', cost: 700, description: 'Adds bite on snow-covered ground.', effect: 'snow traction +15%' },
  { id: 'snorkel', name: 'Snorkel kit', type: 'prep', cost: 940, description: 'Keeps the engine breathing during stream and flood crossings.', effect: 'ford depth +0.2 m' },
  { id: 'sealedIgnition', name: 'Sealed ignition', type: 'prep', cost: 880, description: 'Protects the ignition system during deep-water crossings.', effect: 'water damage risk -60%' },
  { id: 'radiatorRelocation', name: 'Relocated radiator', type: 'prep', cost: 990, description: 'Improves cooling and reduces engine wear during hard running.', effect: 'engine wear -12%' },
  { id: 'springOver', name: 'Spring-over-axle lift', type: 'prep', cost: 1500, description: 'Raises the stance for better clearance and articulation.', effect: 'ground clearance +75 mm' },
  { id: 'winch', name: 'High-amp winch', type: 'prep', cost: 1900, description: 'Recovery tool with stronger pull and better anchor holding.', effect: 'recovery force +28%' }
];

const missionStops = [
  { label: 'Old logging road', x: 520, y: 1100, radius: 80 },
  { label: 'Bog line marker', x: 930, y: 890, radius: 90 },
  { label: 'Ridge beacon', x: 1510, y: 590, radius: 90 }
];

const radioMessages = [
  'Dispatch standing by.',
  'Trail is open, but the bog has gone slick after the thaw.',
  'Keep the line tight through the river bend—current is pushing hard.',
  'Road map updated: ridge beacon is still visible, but low ground is soft.'
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCash(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distanceToPoint(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sampleTerrainBase(x, y) {
  const roadDistance = getRoadDistance(x, y);
  if (roadDistance < 60) return { ...terrainTypes.road, type: 'road', traction: 1.0, drag: 0.99, surface: 0.22 };

  const riverDistance = getRiverDistance(x, y);
  if (riverDistance < 50) return { ...terrainTypes.water, type: 'water', traction: 0.36, drag: 0.8, surface: 1.05 };

  if (y > 1170 && x < 740) {
    return { ...terrainTypes.peat, type: 'peat', traction: 0.28, drag: 0.6, surface: 1.4 };
  }

  if (x > 820 && x < 1200 && y < 1000) {
    return { ...terrainTypes.mud, type: 'mud', traction: 0.42, drag: 0.7, surface: 0.9 };
  }

  const n = Math.sin(x * 0.014) * Math.cos(y * 0.017 + 1.7) + Math.sin((x + y) * 0.02) * 0.7;
  if (n > 0.62) return { ...terrainTypes.snow, type: 'snow', traction: 0.7, drag: 0.97, surface: 0.52 };
  if (n < -0.25) return { ...terrainTypes.rock, type: 'rock', traction: 0.58, drag: 0.9, surface: 0.68 };
  return { ...terrainTypes.mud, type: 'mud', traction: 0.44, drag: 0.76, surface: 0.82 };
}

function rutKey(x, y) {
  const cell = 44;
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
}

function sampleTerrain(x, y) {
  const terrain = sampleTerrainBase(x, y);
  const rut = state.rutDepth[rutKey(x, y)] || 0;
  if (rut > 0) {
    terrain.traction *= 1 - rut * 0.34;
    terrain.drag *= 1 - rut * 0.22;
    terrain.surface = Math.min(1.8, terrain.surface + rut * 0.35);
  }
  return terrain;
}

function getRoadDistance(x, y) {
  let best = Infinity;
  for (let i = 0; i < world.route.length - 1; i += 1) {
    const a = world.route[i];
    const b = world.route[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best) best = dist;
  }
  return best;
}

function getRiverDistance(x, y) {
  let best = Infinity;
  for (let i = 0; i < world.river.length - 1; i += 1) {
    const a = world.river[i];
    const b = world.river[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best) best = dist;
  }
  return best;
}

function findNearestRoadPoint(x, y) {
  let nearest = null;
  let bestDistance = Infinity;
  for (let i = 0; i < world.route.length - 1; i += 1) {
    const a = world.route[i];
    const b = world.route[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = distanceToPoint({ x, y }, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = point;
    }
  }
  return { point: nearest, distance: bestDistance };
}

function getWinchHookPosition() {
  return {
    x: player.x + Math.cos(player.dir) * 28,
    y: player.y + Math.sin(player.dir) * 28
  };
}

function engageWinch() {
  if (state.winchActive) {
    state.winchActive = false;
    state.winchAnchor = null;
    showToast('WINCH RELEASED');
    return;
  }

  const anchor = findNearestRoadPoint(player.x, player.y);
  const maxRange = state.build.winch ? 440 : 320;
  if (!anchor.point || anchor.distance < 30) {
    showToast('ANCHOR TOO CLOSE — DRIVE CLEAR');
    return;
  }
  if (anchor.distance > maxRange) {
    showToast(`NO SOLID ANCHOR IN ${maxRange} M`);
    return;
  }

  state.winchAnchor = { ...anchor.point };
  state.winchActive = true;
  showToast(`${state.build.winch ? 'HEAVY' : 'STANDARD'} WINCH SET · ${Math.round(anchor.distance)} M`);
}

function openTopoMap() {
  const overlay = document.getElementById('mapOverlay');
  overlay.hidden = false;
  document.getElementById('mapClose').focus();
  drawTopoMap();
}

function closeTopoMap() {
  document.getElementById('mapOverlay').hidden = true;
  document.getElementById('mapToggle').focus();
}

function recoverVehicle() {
  const nearest = findNearestRoadPoint(player.x, player.y);
  if (!nearest.point) return;
  const fee = 500;
  if (state.money < fee) {
    showToast(`RECOVERY REQUIRES ₽${fee}`);
    return;
  }
  state.money -= fee;
  player.x = nearest.point.x;
  player.y = nearest.point.y;
  player.speed = 0;
  player.waterDepth = 0;
  state.winchActive = false;
  state.winchAnchor = null;
  updateVehicleUI();
  showToast('SCOUT RECOVERED TO THE LOGGING ROAD · ₽500');
}

function drawTopoMap() {
  const map = document.getElementById('topoMap');
  if (!map || document.getElementById('mapOverlay').hidden) return;

  const rect = map.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(rect.width * ratio);
  const pixelHeight = Math.round(rect.height * ratio);
  if (map.width !== pixelWidth || map.height !== pixelHeight) {
    map.width = pixelWidth;
    map.height = pixelHeight;
  }
  const mapCtx = map.getContext('2d');
  mapCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  mapCtx.clearRect(0, 0, rect.width, rect.height);
  mapCtx.fillStyle = '#28382d';
  mapCtx.fillRect(0, 0, rect.width, rect.height);

  const padding = 28;
  const scale = Math.min((rect.width - padding * 2) / world.width, (rect.height - padding * 2) / world.height);
  const offsetX = (rect.width - world.width * scale) / 2;
  const offsetY = (rect.height - world.height * scale) / 2;
  mapCtx.save();
  mapCtx.translate(offsetX, offsetY);
  mapCtx.scale(scale, scale);

  // Soft contour bands make the full-world overview read as a field map.
  mapCtx.strokeStyle = 'rgba(190, 202, 158, 0.19)';
  mapCtx.lineWidth = 1.2 / scale;
  [[370, 420, 230], [770, 1080, 280], [1450, 380, 330], [1580, 1280, 260]].forEach(([cx, cy, radius]) => {
    for (let ring = 1; ring <= 5; ring += 1) {
      mapCtx.beginPath();
      mapCtx.ellipse(cx, cy, radius * ring * 0.34, radius * ring * 0.25, -0.3, 0, Math.PI * 2);
      mapCtx.stroke();
    }
  });

  mapCtx.strokeStyle = '#4d8ba1';
  mapCtx.lineWidth = 22;
  mapCtx.lineCap = 'round';
  mapCtx.lineJoin = 'round';
  mapCtx.beginPath();
  world.river.forEach((point, index) => index ? mapCtx.lineTo(point.x, point.y) : mapCtx.moveTo(point.x, point.y));
  mapCtx.stroke();
  mapCtx.setLineDash([12, 12]);
  mapCtx.strokeStyle = 'rgba(190, 229, 232, .8)';
  mapCtx.lineWidth = 2;
  mapCtx.stroke();
  mapCtx.setLineDash([]);

  mapCtx.strokeStyle = '#18221b';
  mapCtx.lineWidth = 30;
  mapCtx.beginPath();
  world.route.forEach((point, index) => index ? mapCtx.lineTo(point.x, point.y) : mapCtx.moveTo(point.x, point.y));
  mapCtx.stroke();
  mapCtx.strokeStyle = '#d7d4be';
  mapCtx.lineWidth = 18;
  mapCtx.stroke();
  mapCtx.setLineDash([18, 12]);
  mapCtx.strokeStyle = '#8f9a77';
  mapCtx.lineWidth = 2;
  mapCtx.stroke();
  mapCtx.setLineDash([]);

  missionStops.forEach((stop, index) => {
    mapCtx.beginPath();
    mapCtx.fillStyle = state.objectiveCompleted[index] ? '#899582' : index === state.missionIndex ? '#d6e35a' : '#d7d4be';
    mapCtx.arc(stop.x, stop.y, index === state.missionIndex && !state.objectiveCompleted[index] ? 15 : 10, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.strokeStyle = '#1b251e';
    mapCtx.lineWidth = 3;
    mapCtx.stroke();
    mapCtx.font = `${18 / scale}px 'DM Mono', monospace`;
    mapCtx.fillStyle = '#e7e9de';
    mapCtx.fillText(stop.label.toUpperCase(), stop.x + 22, stop.y - 16);
  });

  mapCtx.save();
  mapCtx.translate(player.x, player.y);
  mapCtx.rotate(player.dir);
  mapCtx.fillStyle = '#c0dc68';
  mapCtx.strokeStyle = '#152019';
  mapCtx.lineWidth = 4;
  mapCtx.beginPath();
  mapCtx.moveTo(20, 0);
  mapCtx.lineTo(-13, -12);
  mapCtx.lineTo(-9, 0);
  mapCtx.lineTo(-13, 12);
  mapCtx.closePath();
  mapCtx.fill();
  mapCtx.stroke();
  mapCtx.restore();
  mapCtx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  miniMap.width = 150;
  miniMap.height = 104;
}

function getVehicleStats() {
  const lowRangeMul = state.lowRange ? 1.5 : 1;
  const diffMul = state.diffLock
    ? 1 + (state.build.lockerRear ? 0.15 : 0) + (state.build.lockerFront ? 0.1 : 0)
    : 1;
  const tractionBonus = state.build.portalAxles ? 0.12 : 0;
  const clearance = 220 + (state.build.portalAxles ? 90 : 0) + (state.build.springOver ? 75 : 0);
  const fordDepth = 0.55 + (state.build.snorkel ? 0.2 : 0) + (state.build.portalAxles ? 0.12 : 0);
  const recoveryPower = 3.5 + (state.build.winch ? 1.2 : 0);
  return {
    lowRangeMul,
    diffMul,
    tractionBonus,
    clearance,
    fordDepth,
    recoveryPower,
    shockProtection: state.build.shafts ? 0.18 : 0,
    tireWearMultiplier: state.build.beadlocks && state.tirePressure <= 8 ? 0.85 : 1,
    maxSpeed: state.lowRange ? 52 : 100,
    steer: 1.4,
    acceleration: (state.lowRange ? 58 : 92) * (state.lowRange && state.build.transferCase ? 1.32 : 1),
    braking: 96,
    traction: 1 + tractionBonus,
    tirePressure: state.tirePressure,
    canBite: state.build.beadlocks || state.build.ctis
  };
}

function showToast(msg, ttl = 1500) {
  const toast = document.getElementById('globalToast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), ttl);
}

function updateMission() {
  const mission = document.getElementById('missionName');
  const desc = document.getElementById('missionDesc');
  const objectiveList = document.getElementById('objectiveList');
  const objectiveLabel = document.getElementById('objectiveLabel');
  const progressText = document.getElementById('progressText');
  const missionProgress = document.getElementById('missionProgress');
  const progress = state.objectiveCompleted.filter(Boolean).length;

  const labels = [
    'REACH THE OLD LOGGING ROAD',
    'TEST THE BOG LINE',
    'TOP OUT AT THE RIDGE BEACON'
  ];

  mission.textContent = missionStops[state.missionIndex].label === 'Ridge beacon' ? 'The Ridge Beacon' : 'The Old Logging Road';
  desc.textContent =
    state.missionIndex === 0
      ? 'Reach the ridge marker. Keep to the old logging road; the thaw has turned the low ground to soup.'
      : state.missionIndex === 1
        ? 'Cross the bog line without frying the clutch. Keep wheel spin under control and avoid dead stopping.'
        : 'Climb to the ridge, anchor, and get the scout team on the radio.';

  objectiveList.innerHTML = missionStops.map((stop, idx) => {
    const complete = state.objectiveCompleted[idx];
    const current = idx === state.missionIndex && !complete;
    return `
      <div class="objective ${complete ? 'done' : current ? 'current' : ''}">
        <span class="check">${complete ? '✓' : idx + 1}</span>
        <span>${stop.label}</span>
      </div>
    `;
  }).join('');

  objectiveLabel.textContent = labels[state.missionIndex] || 'CLEAR MISSION';
  progressText.textContent = `${progress} / ${missionStops.length}`;
  missionProgress.style.width = `${(progress / missionStops.length) * 100}%`;

  const missionState = document.getElementById('toast');
  if (progress >= 3) {
    missionState.textContent = 'MISSION COMPLETE';
    missionState.classList.add('show');
  }
}

function checkMission() {
  const i = state.missionIndex;
  const stop = missionStops[i];
  if (stop && !state.objectiveCompleted[i] && distanceToPoint(player, stop) < stop.radius) {
    state.objectiveCompleted[i] = true;
    const rewards = [1500, 2200, 3500];
    state.money += rewards[i];
    if (i === 0) showToast(`OLD LOGGING ROAD SECURED · ₽${formatCash(rewards[i])}`);
    if (i === 1) showToast(`BOG LINE CROSSED · ₽${formatCash(rewards[i])}`);
    if (i === 2) showToast(`RIDGE BEACON REACHED · ₽${formatCash(rewards[i])}`);
    state.missionIndex = Math.min(i + 1, missionStops.length - 1);
    saveGame();
  }
  updateMission();
}

function drawWorld() {
  const viewX = player.x - canvas.clientWidth / 2;
  const viewY = player.y - canvas.clientHeight / 2;
  const visibleW = canvas.clientWidth;
  const visibleH = canvas.clientHeight;

  ctx.clearRect(0, 0, visibleW, visibleH);
  ctx.fillStyle = '#1c2a23';
  ctx.fillRect(0, 0, visibleW, visibleH);

  const startX = Math.floor((viewX - 40) / world.tile) * world.tile;
  const startY = Math.floor((viewY - 40) / world.tile) * world.tile;
  const endX = Math.ceil((viewX + visibleW + 40) / world.tile) * world.tile;
  const endY = Math.ceil((viewY + visibleH + 40) / world.tile) * world.tile;

  for (let y = startY; y < endY; y += world.tile) {
    for (let x = startX; x < endX; x += world.tile) {
      const terrain = sampleTerrain(x + world.tile * 0.5, y + world.tile * 0.5);
      const px = x - viewX;
      const py = y - viewY;
      ctx.fillStyle = terrain.color;
      ctx.fillRect(px, py, world.tile + 1, world.tile + 1);
    }
  }

  for (const [key, depth] of Object.entries(state.rutDepth)) {
    if (depth < 0.06) continue;
    const [cellX, cellY] = key.split(',').map(Number);
    const rx = cellX * 44 + 22 - viewX;
    const ry = cellY * 44 + 22 - viewY;
    if (rx < -30 || ry < -30 || rx > visibleW + 30 || ry > visibleH + 30) continue;
    ctx.globalAlpha = Math.min(0.42, depth * 0.42);
    ctx.fillStyle = '#211d17';
    ctx.beginPath();
    ctx.ellipse(rx, ry, 13 + depth * 12, 8 + depth * 8, 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#7f8d66';
  ctx.lineWidth = 22;
  ctx.beginPath();
  world.route.forEach((point, idx) => {
    const px = point.x - viewX;
    const py = point.y - viewY;
    if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.strokeStyle = '#d9d6c2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  world.route.forEach((point, idx) => {
    const px = point.x - viewX;
    const py = point.y - viewY;
    if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.strokeStyle = '#4a7d90';
  ctx.lineWidth = 12;
  ctx.beginPath();
  world.river.forEach((point, idx) => {
    const px = point.x - viewX;
    const py = point.y - viewY;
    if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  missionStops.forEach((stop, idx) => {
    const px = stop.x - viewX;
    const py = stop.y - viewY;
    const active = idx === state.missionIndex && !state.objectiveCompleted[idx];
    ctx.beginPath();
    ctx.fillStyle = active ? '#d8db85' : '#d7d4be';
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = active ? '#c7cf5c' : '#7f8d79';
    ctx.lineWidth = 2;
    ctx.arc(px, py, stop.radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  if (state.winchActive && state.winchAnchor) {
    const hook = getWinchHookPosition();
    ctx.beginPath();
    ctx.moveTo(hook.x - viewX, hook.y - viewY);
    ctx.lineTo(state.winchAnchor.x - viewX, state.winchAnchor.y - viewY);
    ctx.strokeStyle = '#d7d4be';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(state.winchAnchor.x - viewX, state.winchAnchor.y - viewY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#c0dc68';
    ctx.fill();
  }

  const px = player.x - viewX;
  const py = player.y - viewY;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(player.dir);
  ctx.fillStyle = '#7f8d63';
  ctx.fillRect(-24, -12, 48, 24);
  ctx.fillStyle = '#d9dcbf';
  ctx.fillRect(-15, -10, 30, 20);
  ctx.fillStyle = '#233127';
  ctx.fillRect(-32, -20, 20, 16);
  ctx.fillRect(12, -20, 20, 16);
  ctx.fillStyle = '#161a17';
  ctx.fillRect(-24, -16, 8, 8);
  ctx.fillRect(16, -16, 8, 8);
  ctx.fillRect(-24, 8, 8, 8);
  ctx.fillRect(16, 8, 8, 8);
  ctx.restore();
}

function drawMiniMap() {
  miniCtx.clearRect(0, 0, miniMap.width, miniMap.height);
  miniCtx.fillStyle = '#101a14';
  miniCtx.fillRect(0, 0, miniMap.width, miniMap.height);

  miniCtx.strokeStyle = '#3a4a39';
  miniCtx.lineWidth = 3;
  miniCtx.beginPath();
  world.route.forEach((point, idx) => {
    const px = (point.x / world.width) * miniMap.width;
    const py = (point.y / world.height) * miniMap.height;
    if (idx === 0) miniCtx.moveTo(px, py); else miniCtx.lineTo(px, py);
  });
  miniCtx.stroke();

  missionStops.forEach((stop, idx) => {
    const px = (stop.x / world.width) * miniMap.width;
    const py = (stop.y / world.height) * miniMap.height;
    miniCtx.fillStyle = idx === state.missionIndex ? '#d6e35a' : '#dfe6d7';
    miniCtx.beginPath();
    miniCtx.arc(px, py, 3, 0, Math.PI * 2);
    miniCtx.fill();
  });

  const px = (player.x / world.width) * miniMap.width;
  const py = (player.y / world.height) * miniMap.height;
  miniCtx.fillStyle = '#d0e1bc';
  miniCtx.fillRect(px - 3, py - 3, 6, 6);
}

function updateVehicleUI() {
  const stats = getVehicleStats();
  const terrain = sampleTerrain(player.x, player.y);
  const terrainDot = document.getElementById('terrainDot');
  const terrainName = document.getElementById('terrainName');
  const surfaceValue = document.getElementById('surfaceValue');
  const speed = document.getElementById('speed');
  const rpm = document.getElementById('rpm');
  const gear = document.getElementById('gear');
  const slip = document.getElementById('slip');
  const depth = document.getElementById('depth');
  const traction = document.getElementById('traction');
  const tractionBar = document.getElementById('tractionBar');
  const tirePressureLabel = document.getElementById('tirePressure');
  const fuelValue = document.getElementById('fuelValue');
  const engineValue = document.getElementById('engineValue');
  const chassisValue = document.getElementById('chassisValue');
  const tireValue = document.getElementById('tireValue');
  const efficiency = document.getElementById('efficiency');
  const engineBar = document.getElementById('engineBar');
  const chassisBar = document.getElementById('chassisBar');
  const fuelBar = document.getElementById('fuelBar');
  const tireBar = document.getElementById('tireBar');
  const lowRangeEffect = document.getElementById('lowRangeEffect');
  const fordEffect = document.getElementById('fordEffect');
  const recoveryEffect = document.getElementById('recoveryEffect');
  const garageCash = document.getElementById('garageCash');
  const moneyText = document.getElementById('cash');

  terrainDot.style.background = terrain.color;
  terrainName.textContent = terrain.label;
  surfaceValue.textContent = terrain.surface.toFixed(2);
  speed.textContent = Math.abs(Math.round(player.speed * 1.7)).toString().padStart(2, '0');
  rpm.textContent = Math.round(player.rpm).toString();
  gear.textContent = `${player.selectedGear} ${player.gearMode === 'LOW' ? '· LOW' : '· HIGH'}`;
  slip.textContent = `${Math.round(player.slip)}${player.slip > 99 ? '' : ''}`;
  depth.textContent = `${player.waterDepth.toFixed(1)}${' '}`;
  const tractionPercent = clamp(100 - player.slip * 1.35 + stats.tractionBonus * 25, 25, 100);
  traction.textContent = `${Math.round(tractionPercent)}%`;
  tractionBar.style.width = `${tractionPercent}%`;
  tirePressureLabel.textContent = `${state.tirePressure} PSI`;
  fuelValue.textContent = `${Math.round(player.fuel)}%`;
  engineValue.textContent = `${Math.round(player.engine)}%`;
  chassisValue.textContent = `${Math.round(player.chassis)}%`;
  tireValue.textContent = `${Math.round(player.tyres)}%`;
  efficiency.textContent = (5.2 + (state.build.portalAxles ? 0.3 : 0)).toFixed(1);
  engineBar.style.width = `${player.engine}%`;
  chassisBar.style.width = `${player.chassis}%`;
  fuelBar.style.width = `${player.fuel}%`;
  tireBar.style.width = `${player.tyres}%`;
  lowRangeEffect.textContent = state.lowRange ? 'LOW RANGE' : 'HIGH RANGE';
  fordEffect.textContent = `${stats.fordDepth.toFixed(2)} M`;
  recoveryEffect.textContent = state.build.winch ? 'STRONG' : 'STANDARD';
  garageCash.textContent = formatCash(state.money);
  moneyText.textContent = formatCash(state.money);

  const num = Math.round(terrain.surface * 100);
  depth.innerHTML = `${player.waterDepth.toFixed(1)}<span> M</span>`;
  slide = num;
}

function updateState(dt) {
  state.time += dt;
  const stats = getVehicleStats();
  let terrain = sampleTerrain(player.x, player.y);
  const maxSpeed = stats.maxSpeed;
  const angularForce = state.lowRange ? 1.1 : 0.9;
  const softGround = terrain.type === 'mud' || terrain.type === 'peat' || terrain.type === 'snow';
  const pressureBonus = softGround && state.tirePressure <= 18 ? 0.12 + (state.build.beadlocks ? 0.08 : 0) : 0;
  const terrainUpgradeBonus = (state.build.boggers && (terrain.type === 'mud' || terrain.type === 'peat') ? 0.18 : 0)
    + (state.build.chains && terrain.type === 'snow' ? 0.15 : 0);
  const effectiveTraction = clamp(terrain.traction * stats.traction * stats.diffMul * (state.awd ? 1 : 0.72) * (1 + pressureBonus + terrainUpgradeBonus), 0.12, 1.4);

  if (keyState.KeyW) {
    player.speed += stats.acceleration * dt * effectiveTraction;
  }
  if (keyState.KeyS) {
    player.speed -= stats.braking * dt * 0.78;
  }
  if (!keyState.KeyW && !keyState.KeyS) {
    player.speed *= 0.98 * terrain.drag;
  }

  if (keyState.KeyA) {
    player.dir -= dt * (0.8 + Math.abs(player.speed) * 0.02) * angularForce;
  }
  if (keyState.KeyD) {
    player.dir += dt * (0.8 + Math.abs(player.speed) * 0.02) * angularForce;
  }

  player.speed = clamp(player.speed, -16, maxSpeed);

  const turnSlip = Math.abs((keyState.KeyA || keyState.KeyD) ? player.speed * 0.12 : 0);
  const surfaceBreak = terrain.surface * (state.build.boggers ? 0.85 : 1);
  player.slip = clamp((Math.abs(player.speed) / (stats.maxSpeed + 1)) * 100 * (1 / effectiveTraction) * surfaceBreak + turnSlip, 0, 100);

  if (Math.abs(player.speed) < 4 && (keyState.KeyA || keyState.KeyD)) {
    player.slip *= 0.7;
  }

  const sideways = Math.sin(player.dir) * player.speed;
  const forward = Math.cos(player.dir) * player.speed;
  player.x += forward * dt * 16;
  player.y += sideways * dt * 16;

  player.x = clamp(player.x, 30, world.width - 30);
  player.y = clamp(player.y, 30, world.height - 30);
  terrain = sampleTerrain(player.x, player.y);
  if ((terrain.type === 'mud' || terrain.type === 'peat') && Math.abs(player.speed) > 2) {
    const key = rutKey(player.x, player.y);
    const compaction = dt * terrain.surface * (0.012 + player.slip / 100 * 0.045);
    state.rutDepth[key] = clamp((state.rutDepth[key] || 0) + compaction, 0, 1);
  }

  if (terrain.type === 'water') {
    const riverPush = 0.15 + (player.speed * 0.02);
    player.x += Math.cos(Math.PI * 0.5) * riverPush * dt * 80;
    player.y += Math.sin(Math.PI * 0.75) * riverPush * dt * 48;
    player.waterDepth = clamp(1.05 * (1 - getRiverDistance(player.x, player.y) / 50), 0.05, 1.05);
  } else {
    player.waterDepth = 0;
  }

  if (terrain.type === 'peat') {
    player.speed *= 0.994;
    if (Math.abs(player.speed) < 3) player.speed *= 0.98;
  }

  if (terrain.type === 'mud') {
    player.speed *= 0.996;
  }

  if (terrain.type === 'snow') {
    player.speed *= 0.999;
  }

  if (terrain.type === 'rock') {
    player.speed *= 0.999;
    player.chassis = clamp(player.chassis - 0.01 * (1 - stats.shockProtection), 0, 100);
  }

  if (terrain.type === 'water') {
    const waterSpeed = Math.abs(player.speed);
    const overFordLimit = player.waterDepth > stats.fordDepth;
    const fastUnsnorkelledCrossing = waterSpeed > 12 && !state.build.snorkel;
    const crossingDamage = overFordLimit
      ? (state.build.sealedIgnition ? 0.025 : 0.065) * (fastUnsnorkelledCrossing ? 1.35 : 1)
      : 0.008;
    player.engine = clamp(player.engine - crossingDamage * (state.build.radiatorRelocation ? 0.88 : 1) * dt * 60, 0, 100);
    if (player.waterDepth > stats.fordDepth + 0.15) {
      player.chassis = clamp(player.chassis - 0.012 * dt * 60, 0, 100);
    }
  }

  if (state.winchActive && state.winchAnchor) {
    const hook = getWinchHookPosition();
    const dx = state.winchAnchor.x - hook.x;
    const dy = state.winchAnchor.y - hook.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 12) {
      const pull = Math.min(distance - 12, stats.recoveryPower * 9 * dt);
      player.x += (dx / distance) * pull;
      player.y += (dy / distance) * pull;
      player.speed *= 0.92;
    } else {
      state.winchActive = false;
      state.winchAnchor = null;
      showToast('WINCH ANCHOR REACHED');
    }
  }

  if (player.speed < 0) {
    player.selectedGear = 'R';
    player.gearMode = 'LOW';
  } else if (Math.abs(player.speed) > 0.5) {
    player.selectedGear = state.lowRange ? '2' : '4';
    player.gearMode = state.lowRange ? 'LOW' : 'HIGH';
  } else {
    player.selectedGear = 'N';
    player.gearMode = state.lowRange ? 'LOW' : 'HIGH';
  }

  player.rpm = 830 + Math.abs(player.speed) * 28 + (state.lowRange ? 150 : 0);
  player.fuel = clamp(player.fuel - Math.abs(player.speed) * 0.004 * dt * 60, 0, 100);
  player.tyres = clamp(player.tyres - (player.slip / 220) * stats.tireWearMultiplier * dt * 60, 0, 100);
  player.engine = clamp(player.engine - (player.slip / 210) * (state.build.radiatorRelocation ? 0.88 : 1) * dt * 60, 0, 100);
  player.chassis = clamp(player.chassis - (player.slip > 65 ? 0.015 : 0) * (1 - stats.shockProtection) * dt * 48, 0, 100);

  if (player.engine <= 10 || player.fuel <= 0) {
    player.speed *= 0.91;
  }

  const towFactor = state.build.winch ? 1.1 : 1;
  player.speed *= 0.999 + (0.001 * towFactor);

  const truckBias = state.build.portalAxles ? 0.12 : 0;
  if (terrain.type === 'road' && Math.abs(player.speed) < 10) {
    player.slip = clamp(player.slip * 0.97 - truckBias, 0, 100);
  }

  player.x = clamp(player.x, 30, world.width - 30);
  player.y = clamp(player.y, 30, world.height - 30);
  checkMission();
  updateVehicleUI();
  if (Math.floor(state.time / 8) !== Math.floor((state.time - dt) / 8)) saveGame();
}

function syncBuildSummary() {
  const spec = getVehicleStats();
  document.getElementById('weightSpec').innerHTML = `${1620 + (state.build.portalAxles ? 120 : 0) + (state.build.springOver ? 90 : 0)} <i>KG</i>`;
  document.getElementById('clearanceSpec').innerHTML = `${Math.round(spec.clearance)} <i>MM</i>`;
  document.getElementById('winchSpec').innerHTML = `${spec.recoveryPower.toFixed(1)} <i>T</i>`;
  document.getElementById('torqueSpec').innerHTML = `${(1 + (state.build.transferCase ? 0.35 : 0) + (state.build.portalAxles ? 0.15 : 0)).toFixed(2)} <i>×</i>`;
}

function generateUpgradeGrid() {
  const grid = document.getElementById('upgradeGrid');
  const currentFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';

  grid.innerHTML = upgrades.map((item) => {
    const installed = state.build[item.id] || false;
    const price = state.money >= item.cost ? 'AVAILABLE' : 'LOW FUNDS';
    const type = item.type;
    const visible = currentFilter === 'all' || type === currentFilter;
    if (!visible) return '';

    return `
      <article class="upgrade-card ${installed ? 'installed' : state.money >= item.cost ? '' : 'locked'}" data-id="${item.id}">
        <span class="upgrade-type">${item.type.toUpperCase()}</span>
        <h3>${item.name}</h3>
        <p>${item.description}</p>
        <div class="upgrade-bottom">
          <span class="upgrade-cost">₽ ${formatCash(item.cost)}</span>
          <span class="upgrade-state ${installed ? '' : 'lock'}">${installed ? 'INSTALLED' : state.money >= item.cost ? 'BUY' : 'LOCKED'}</span>
        </div>
        <button class="upgrade-action" type="button" data-upgrade="${item.id}" aria-label="Upgrade ${item.name}"></button>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.upgrade-action').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.upgrade;
      const match = upgrades.find((item) => item.id === id);
      if (!match) return;
      if (state.build[id]) {
        showToast(`${match.name} already installed.`);
        return;
      }
      if (state.money < match.cost) {
        showToast('Not enough funds for this part.');
        return;
      }
      state.money -= match.cost;
      state.build[id] = true;
      generateUpgradeGrid();
      syncBuildSummary();
      showToast(`${match.name} installed.`);
    });
  });
}

function bindGlobalControls() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.toggle('active', btn === button));
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${button.dataset.view}-view`));
      state.activeBtn = button.dataset.view;
    });
  });

  document.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.open;
      document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.toggle('active', nav.dataset.view === target));
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${target}-view`));
      state.activeBtn = target;
    });
  });

  document.querySelectorAll('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((btn) => btn.classList.toggle('active', btn === button));
      generateUpgradeGrid();
    });
  });

  document.getElementById('lowRange').addEventListener('click', () => {
    state.lowRange = true;
    document.getElementById('lowRange').classList.add('active');
    document.getElementById('highRange').classList.remove('active');
    showToast('LOW RANGE ENGAGED');
  });

  document.getElementById('highRange').addEventListener('click', () => {
    state.lowRange = false;
    document.getElementById('highRange').classList.add('active');
    document.getElementById('lowRange').classList.remove('active');
    showToast('HIGH RANGE ENGAGED');
  });

  document.getElementById('awdBtn').addEventListener('click', () => {
    state.awd = !state.awd;
    document.getElementById('awdBtn').classList.toggle('active', state.awd);
    document.getElementById('awdBtn').innerHTML = state.awd ? '4×4 <small>LOCKED</small>' : '2×2 <small>ROAD</small>';
    showToast(state.awd ? '4×4 ENGAGED' : '2×2 MODE');
  });

  document.getElementById('diffBtn').addEventListener('click', () => {
    if (!state.build.lockerRear && !state.build.lockerFront) {
      showToast('INSTALL A DIFFERENTIAL LOCKER IN THE WORKSHOP FIRST');
      return;
    }
    state.diffLock = !state.diffLock;
    document.getElementById('diffBtn').textContent = state.diffLock ? 'LOCKED ⌃' : 'OPEN ⌄';
    document.getElementById('diffBtn').setAttribute('aria-pressed', String(state.diffLock));
    showToast(state.diffLock ? 'DIFFERENTIAL LOCKED' : 'DIFFERENTIAL OPEN');
  });

  document.getElementById('ctisBtn').addEventListener('click', () => {
    if (!state.build.ctis) {
      showToast('INSTALL CTIS IN THE WORKSHOP FIRST');
      return;
    }
    state.tirePressure = state.tirePressure > 18 ? 18 : 30;
    document.getElementById('tirePressure').textContent = `${state.tirePressure} PSI`;
    showToast(`TYRE PRESSURE ${state.tirePressure} PSI`);
  });

  document.getElementById('winchBtn').addEventListener('click', engageWinch);

  document.getElementById('repairBtn').addEventListener('click', () => {
    if (state.money < 250) {
      showToast('Need ₽250 for field repair spares.');
      return;
    }
    state.money -= 250;
    player.engine = clamp(player.engine + 10, 0, 100);
    player.chassis = clamp(player.chassis + 10, 0, 100);
    player.tyres = clamp(player.tyres + 8, 0, 100);
    showToast('FIELD REPAIR COMPLETE');
    updateVehicleUI();
  });

  document.getElementById('recoverBtn').addEventListener('click', recoverVehicle);

  document.getElementById('radioBtn').addEventListener('click', () => {
    state.radioIndex = (state.radioIndex + 1) % radioMessages.length;
    document.getElementById('radioText').textContent = radioMessages[state.radioIndex];
  });

  document.getElementById('mapToggle').addEventListener('click', openTopoMap);
  document.getElementById('mapClose').addEventListener('click', closeTopoMap);
  document.getElementById('mapOverlay').addEventListener('click', (event) => {
    if (event.target.id === 'mapOverlay') closeTopoMap();
  });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && !document.getElementById('mapOverlay').hidden) closeTopoMap();
  });

  document.getElementById('resetBuild').addEventListener('click', () => {
    for (const key in state.build) state.build[key] = false;
    state.money = 12400;
    generateUpgradeGrid();
    syncBuildSummary();
    showToast('FACTORY BUILD RESTORED');
  });
}

function tick(timestamp) {
  const dt = 0.016;
  updateState(dt);
  drawWorld();
  drawMiniMap();
  if (!document.getElementById('mapOverlay').hidden) drawTopoMap();
  requestAnimationFrame(tick);
}

window.addEventListener('keydown', (event) => {
  keyState[event.code] = true;
  if (event.code === 'KeyQ') document.getElementById('winchBtn').click();
  if (event.code === 'KeyE') document.getElementById('ctisBtn').click();
  if (event.code === 'KeyX') document.getElementById('diffBtn').click();
  if (event.code === 'KeyL') document.getElementById('lowRange').click();
  if (event.code === 'KeyH') document.getElementById('highRange').click();
  if (event.code === 'Space') {
    event.preventDefault();
    player.speed *= 0.8;
  }
});

window.addEventListener('keyup', (event) => {
  keyState[event.code] = false;
});

window.addEventListener('resize', resizeCanvas);

resizeCanvas();
updateMission();
bindGlobalControls();
generateUpgradeGrid();
syncBuildSummary();
updateVehicleUI();
requestAnimationFrame(tick);
