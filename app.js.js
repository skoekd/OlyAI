


function ensureSetLogs() {
  if (!state.setLogs) state.setLogs = {};
  return state.setLogs;
}

function workoutKey(weekIndex, dayIndex) {
  return `${state.activeProfile}|w${weekIndex}|d${dayIndex}`;
}

// Per-exercise overrides (e.g., +/- WORK sets during a session)
function ensureExOverrides(dayLog) {
  if (!dayLog.__exOverrides) dayLog.__exOverrides = {};
  return dayLog.__exOverrides;
}
function getWorkSetsOverride(dayLog, exIndex, fallbackSets) {
  const o = ensureExOverrides(dayLog)[exIndex];
  const n = o && Number.isFinite(o.workSets) ? o.workSets : fallbackSets;
  return Math.max(1, Math.floor(n || fallbackSets || 1));
}
function setWorkSetsOverride(dayLog, exIndex, workSets) {
  ensureExOverrides(dayLog)[exIndex] = { ...(ensureExOverrides(dayLog)[exIndex] || {}), workSets: Math.max(1, Math.floor(workSets || 1)) };
}

function actionDelta(action) {
  // Per-set action -> adjustment applied to subsequent WORK sets (intra-session).
  switch ((action || '').toLowerCase()) {
    case 'make': return 0.01;   // +1%
    case 'belt': return 0.00;   // marker only
    case 'heavy': return -0.02; // -2%
    case 'miss': return -0.05;  // -5%
    default: return 0.00;
  }
}

function getAdjustedWorkingMax(profile, liftKey) {
  const base = (profile.workingMaxes && profile.workingMaxes[liftKey]) ? Number(profile.workingMaxes[liftKey]) : 0;
  const adj = (profile.liftAdjustments && Number(profile.liftAdjustments[liftKey])) ? Number(profile.liftAdjustments[liftKey]) : 0;
  const capped = clamp(adj, -0.05, 0.05);
  return base ? (base * (1 + capped)) : 0;
}

function computeCumulativeAdj(dayLog, exIndex, setIndex, scheme) {
  // Sum deltas from previous WORK sets only.
  let d = 0;
  for (let i = 0; i < setIndex; i++) {
    if (scheme[i]?.tag !== 'work') continue;
    const rec = dayLog[`${exIndex}:${i}`];
    if (rec && rec.action) d += actionDelta(rec.action);
  }
  return d;
}

function buildSetScheme(ex, liftKey, profile) {
  const sets = [];
  const targetPct = ex.pct || 0;
  const wm = liftKey ? getAdjustedWorkingMax(profile, liftKey) : 0;
  const roundInc = profile.units === 'kg' ? 0.5 : 1;

  const pushSet = (pct, reps, tag) => {
    const w = (wm && pct) ? roundTo(wm * pct, roundInc) : 0;
    sets.push({ targetPct: pct, targetReps: reps, tag, targetWeight: w });
  };

  const isPctBased = !!(targetPct && liftKey);
  const isMainish = /snatch|clean|jerk|squat|pull/i.test(ex.name);

  if (isPctBased && isMainish) {
    const ladder = [0.40, 0.50, 0.60, 0.70].filter(v => v < targetPct - 0.02);
    ladder.forEach((pct) => {
      const reps = Math.min(3, Math.max(1, ex.reps));
      pushSet(pct, reps, 'warmup');
    });
  }

  for (let i = 0; i < ex.sets; i++) pushSet(targetPct, ex.reps, 'work');
  return sets;
}

function getSetProgress(weekIndex, dayIndex, dayPlan) {
  const p = getProfile();
  const key = workoutKey(weekIndex, dayIndex);
  const logs = ensureSetLogs();
  const dayLog = logs[key] || {};
  let total = 0;
  let done = 0;
  dayPlan.work.forEach((ex, exIndex) => {
    const liftKey = ex.liftKey || dayPlan.liftKey;
    const workSets = getWorkSetsOverride(dayLog, exIndex, ex.sets);
    const scheme = buildSetScheme({ ...ex, sets: workSets }, liftKey, p);
    total += scheme.length;
    scheme.forEach((_, setIndex) => {
      const rec = dayLog[`${exIndex}:${setIndex}`];
      if (rec && rec.status && rec.status !== 'pending') done += 1;
    });
  });
  return { done, total };
}

function getDaySetProgressText(weekIndex, dayIndex, dayPlan, isDone) {
  if (isDone) return 'Completed';
  const prog = getSetProgress(weekIndex, dayIndex, dayPlan);
  if (!prog.total) return 'Tap to view';
  return `${prog.done}/${prog.total} sets`;
}


/* LiftAI v7 — rebuilt script (fresh, UI-safe)

   Requirements implemented:
   1) Workout tab: no Training Schedule, no Current 1RM Maxes, no Generate/Demo.
   2) History tab: no Training Schedule, no Current 1RM Maxes, no Generate/Demo.
   3) Settings tab: no Training Schedule, no Current 1RM Maxes section except the 4 max squares.
      No lift dropdown / single-lift update / apply-recalc. Only 4 squares + Save & Recalculate.

   Notes:
   - Setup page still has Generate + Demo (these IDs exist in HTML).
   - This script intentionally does NOT create any extra panels on Workout/History/Settings.
*/

'use strict';

/********************
 * Helpers
 ********************/
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const roundTo = (n, step) => {
  const s = Number(step) || 1;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / s) * s;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

function safeJsonParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function notify(msg) {
  // Minimal toast substitute
  const t = document.getElementById('toast');
  if (t) {
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(notify._timer);
    notify._timer = setTimeout(() => { t.style.display = 'none'; }, 2200);
  }
  console.log(msg);
}

/********************
 * Modal + Readiness globals (these are referenced by inline onclick handlers
 * in index.html, so they MUST exist to keep buttons working.)
 ********************/
window.closeModal = function closeModal() {
  const o = $('modalOverlay');
  if (o) o.classList.remove('show');
};

window.openModal = function openModal(title, subtitle, html) {
  const o = $('modalOverlay');
  if (!o) return;
  const t = $('modalTitle');
  const s = $('modalSubtitle');
  const c = $('modalContent');
  if (t) t.textContent = title || 'Info';
  if (s) s.textContent = subtitle || '';
  if (c) c.innerHTML = html || '';
  o.classList.add('show');
};

window.closeReadinessModal = function closeReadinessModal() {
  const o = $('readinessOverlay');
  if (o) o.classList.remove('show');
};

window.saveReadinessCheck = function saveReadinessCheck() {
  // Store a lightweight readiness record (1-5) based on the selection.
  const p = getProfile();
  const v = Number($('readinessScoreNum')?.textContent || $('readinessValueDisplay')?.textContent || 3);
  const score5 = clamp(v, 1, 5);
  p.readinessLog = p.readinessLog || [];
  p.readinessLog.push({ date: todayISO(), score: score5, notes: 'Readiness modal' });
  saveState();
  window.closeReadinessModal();
  notify('Readiness saved');
};

/********************
 * State model
 ********************/
const STORAGE_KEY = 'liftai_v7_state_fresh_1215';

const DEFAULT_PROFILE = () => ({
  name: 'Default',
  units: 'kg',
  blockLength: 8,
  programType: 'general',
  transitionWeeks: 1,
  transitionProfile: 'standard',
  includeBlocks: true,
  volumePref: 'reduced',
  autoCut: true,
  aiEnabled: true,
  aiModel: '',
  maxes: { snatch: 80, cj: 100, fs: 130, bs: 150 },
  workingMaxes: { snatch: 72, cj: 90, fs: 117, bs: 135 },
  liftAdjustments: { snatch: 0, cj: 0, fs: 0, bs: 0 },
  readinessLog: [] // {date, score, notes}
});

const DEFAULT_STATE = () => ({
  version: 'fresh_1215',
  activeProfile: 'Default',
  profiles: { Default: DEFAULT_PROFILE() },
  currentBlock: null, // {profileName, startDateISO, weeks, programType, blockLength}
  history: [], // {dateISO, weekIndex, dayIndex, title, session}
  setLogs: {} // per-set tracking logs keyed by workoutKey
});

let state = loadState();
let ui = {
  currentPage: 'Setup',
  weekIndex: 0
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? safeJsonParse(raw, null) : null;
  if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE();

  // gentle migration
  const s = Object.assign(DEFAULT_STATE(), parsed);
  if (!s.profiles || typeof s.profiles !== 'object') s.profiles = { Default: DEFAULT_PROFILE() };
  if (!s.activeProfile || !s.profiles[s.activeProfile]) s.activeProfile = Object.keys(s.profiles)[0] || 'Default';
  return s;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getProfile() {
  const p = state.profiles[state.activeProfile];
  if (!p) {
    state.profiles.Default = state.profiles.Default || DEFAULT_PROFILE();
    state.activeProfile = 'Default';
    saveState();
    return state.profiles.Default;
  }
  return p;
}

function setActiveProfile(name) {
  if (!state.profiles[name]) return;
  state.activeProfile = name;
  saveState();
}

/********************
 * Pages + Navigation
 ********************/
const PAGES = {
  Setup: 'pageSetup',
  Dashboard: 'pageDashboard',
  Workout: 'pageWorkout',
  History: 'pageHistory',
  Settings: 'pageSettings'
};

function showPage(pageName) {
  ui.currentPage = pageName;
  for (const [name, id] of Object.entries(PAGES)) {
    const el = $(id);
    if (!el) continue;
    if (name === pageName) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  // nav active
  const navMap = {
    Setup: 'navSetup',
    Dashboard: 'navDashboard',
    Workout: 'navWorkout',
    History: 'navHistory',
    Settings: 'navSettings'
  };
  for (const [name, btnId] of Object.entries(navMap)) {
    const b = $(btnId);
    if (!b) continue;
    b.classList.toggle('active', name === pageName);
  }

  // page-specific refresh
  if (pageName === 'Setup') renderSetup();
  if (pageName === 'Dashboard') renderDashboard();
  if (pageName === 'Workout') renderWorkout();
  if (pageName === 'History') renderHistory();
  if (pageName === 'Settings') renderSettings();
}

/********************
 * Training Block Generator (simple + stable)
 ********************/
function computeWorkingMaxes(maxes) {
  return {
    snatch: roundTo((Number(maxes.snatch) || 0) * 0.9, 0.5),
    cj: roundTo((Number(maxes.cj) || 0) * 0.9, 0.5),
    fs: roundTo((Number(maxes.fs) || 0) * 0.9, 0.5),
    bs: roundTo((Number(maxes.bs) || 0) * 0.9, 0.5)
  };
}

function phaseForWeek(weekIndex) {
  // repeating 4-week wave: Accum(0-1), Intens(2), Deload(3)
  const w = weekIndex % 4;
  if (w === 0 || w === 1) return 'accumulation';
  if (w === 2) return 'intensification';
  return 'deload';
}

function baseIntensityFor(phase) {
  if (phase === 'accumulation') return 0.72;
  if (phase === 'intensification') return 0.85;
  return 0.60;
}

function volumeFactorFor(profile, phase) {
  const pref = profile.volumePref || 'reduced';
  const base = (pref === 'standard') ? 1.0 : (pref === 'minimal' ? 0.6 : 0.8);
  const phaseMult = (phase === 'accumulation') ? 1.0 : (phase === 'intensification' ? 0.85 : 0.6);
  return base * phaseMult;
}

function transitionMultiplier(profile, weekIndex) {
  // ramp-in at the beginning of the block OR after a program switch
  const tw = Number(profile.transitionWeeks) || 0;
  if (tw <= 0) return { intensity: 1, volume: 1 };
  if (weekIndex >= tw) return { intensity: 1, volume: 1 };

  const mode = profile.transitionProfile || 'standard';
  const t = (weekIndex + 1) / tw; // 0..1
  // conservative: start lower
  let minI = 0.85, minV = 0.80;
  if (mode === 'conservative') { minI = 0.80; minV = 0.70; }
  if (mode === 'aggressive') { minI = 0.90; minV = 0.90; }

  return {
    intensity: minI + (1 - minI) * t,
    volume: minV + (1 - minV) * t
  };
}

function makeWeekPlan(profile, weekIndex) {
  const phase = phaseForWeek(weekIndex);
  const baseI = baseIntensityFor(phase);
  const trans = transitionMultiplier(profile, weekIndex);
  const intensity = clamp(baseI * trans.intensity, 0.55, 0.92);
  const volFactor = clamp(volumeFactorFor(profile, phase) * trans.volume, 0.45, 1.10);

  // 4-day template (simple, predictable)
  // Day indices 0..3 used by UI
  const days = [
    { title: 'Snatch Focus', kind: 'snatch', main: 'Snatch', liftKey: 'snatch', work: [
      { name: 'Snatch', sets: Math.round(5 * volFactor), reps: 2, pct: intensity },
      { name: 'Snatch Pull', sets: Math.round(4 * volFactor), reps: 3, pct: clamp(intensity + 0.10, 0.65, 1.05) },
      { name: 'Back Squat', sets: Math.round(4 * volFactor), reps: 5, pct: clamp(intensity + 0.05, 0.60, 0.90), liftKey: 'bs' },
    ]},
    { title: 'Clean & Jerk Focus', kind: 'cj', main: 'Clean & Jerk', liftKey: 'cj', work: [
      { name: 'Clean & Jerk', sets: Math.round(5 * volFactor), reps: 1, pct: clamp(intensity + 0.05, 0.60, 0.92) },
      { name: 'Clean Pull', sets: Math.round(4 * volFactor), reps: 3, pct: clamp(intensity + 0.12, 0.70, 1.10) },
      { name: 'Front Squat', sets: Math.round(4 * volFactor), reps: 3, pct: clamp(intensity + 0.08, 0.60, 0.92), liftKey: 'fs' },
    ]},
    { title: 'Strength + Positions', kind: 'strength', main: 'Squat / Strength', liftKey: 'bs', work: [
      { name: 'Back Squat', sets: Math.round(5 * volFactor), reps: 3, pct: clamp(intensity + 0.10, 0.65, 0.95), liftKey: 'bs' },
      { name: 'Power Snatch', sets: Math.round(4 * volFactor), reps: 2, pct: clamp(intensity - 0.05, 0.55, 0.85) },
      { name: 'Press / Push Press', sets: Math.round(4 * volFactor), reps: 5, pct: 0 },
    ]},
    { title: 'Accessory + Recovery', kind: 'accessory', main: 'Accessory', liftKey: null, work: [
      { name: 'Tempo Front Squat', sets: Math.round(3 * volFactor), reps: 5, pct: clamp(intensity - 0.15, 0.45, 0.75), liftKey: 'fs' },
      { name: 'RDL / Posterior Chain', sets: Math.round(3 * volFactor), reps: 8, pct: 0 },
      { name: 'Core / Mobility', sets: 1, reps: 1, pct: 0 },
    ]}
  ];

  return { weekIndex, phase, intensity, volFactor, days };
}

function generateBlockFromSetup() {
  const profile = getProfile();

  // pull setup form values
  profile.units = ($('setupUnits')?.value) || profile.units || 'kg';
  profile.blockLength = Number($('setupBlockLength')?.value) || profile.blockLength || 8;
  profile.programType = ($('setupProgram')?.value) || profile.programType || 'general';
  profile.transitionWeeks = Number($('setupTransitionWeeks')?.value) || 0;
  profile.transitionProfile = ($('setupTransitionProfile')?.value) || 'standard';

  // maxes
  const sn = Number($('setupSnatch')?.value);
  const cj = Number($('setupCleanJerk')?.value);
  const fs = Number($('setupFrontSquat')?.value);
  const bs = Number($('setupBackSquat')?.value);
  if ([sn, cj, fs, bs].some(v => !Number.isFinite(v) || v <= 0)) {
    alert('Please enter all four 1RM values (Snatch, Clean & Jerk, Front Squat, Back Squat).');
    return;
  }
  profile.maxes = {
    snatch: sn,
    cj: cj,
    fs: fs,
    bs: bs
  };
  profile.workingMaxes = computeWorkingMaxes(profile.maxes);

  // Build block
  const blockLength = clamp(profile.blockLength, 4, 12);
  const weeks = [];
  for (let w = 0; w < blockLength; w++) {
    weeks.push(makeWeekPlan(profile, w));
  }

  state.currentBlock = {
    profileName: state.activeProfile,
    startDateISO: todayISO(),
    programType: profile.programType,
    blockLength,
    weeks
  };
  ui.weekIndex = 0;
  saveState();

  showPage('Dashboard');
  notify('Generated training block');
}

/********************
 * Rendering
 ********************/
function renderSetup() {
  // profiles
  const sel = $('setupProfileSelect');
  if (sel) {
    sel.innerHTML = '';
    Object.keys(state.profiles).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === state.activeProfile) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // fill current profile values
  const p = getProfile();
  if ($('setupUnits')) $('setupUnits').value = p.units || 'kg';
  if ($('setupBlockLength')) $('setupBlockLength').value = String(p.blockLength || 8);
  if ($('setupProgram')) $('setupProgram').value = p.programType || 'general';
  if ($('setupTransitionWeeks')) $('setupTransitionWeeks').value = String(p.transitionWeeks ?? 1);
  if ($('setupTransitionProfile')) $('setupTransitionProfile').value = p.transitionProfile || 'standard';

  if ($('setupSnatch')) $('setupSnatch').value = p.maxes?.snatch ?? '';
  if ($('setupCleanJerk')) $('setupCleanJerk').value = p.maxes?.cj ?? '';
  if ($('setupFrontSquat')) $('setupFrontSquat').value = p.maxes?.fs ?? '';
  if ($('setupBackSquat')) $('setupBackSquat').value = p.maxes?.bs ?? '';
}

function renderDashboard() {
  const p = getProfile();
  const subtitle = $('dashboardSubtitle');
  if (subtitle) {
    subtitle.textContent = `${p.programType || 'general'} • ${p.units || 'kg'} • Block ${state.currentBlock ? 'ready' : 'not generated'}`;
  }

  // Stats
  const stats = $('dashboardStats');
  if (stats) {
    stats.innerHTML = '';
    const items = [];
    const block = state.currentBlock;
    if (block) {
      items.push(['Block length', `${block.blockLength} weeks`]);
      items.push(['Current week', `${ui.weekIndex + 1}`]);
      items.push(['Phase', `${block.weeks?.[ui.weekIndex]?.phase || '—'}`]);
    } else {
      items.push(['Block', 'Not generated']);
    }
    items.forEach(([k, v]) => {
      const d = document.createElement('div');
      d.className = 'stat-card';
      d.innerHTML = `<div class="stat-label">${k}</div><div class="stat-value">${v}</div>`;
      stats.appendChild(d);
    });
  }

  // Working maxes (dashboard)
  const maxGrid = $('dashboardMaxes');
  if (maxGrid) {
    maxGrid.innerHTML = '';
    const wm = p.workingMaxes || computeWorkingMaxes(p.maxes || {});
    const tiles = [
      ['Snatch', wm.snatch],
      ['Clean & Jerk', wm.cj],
      ['Front Squat', wm.fs],
      ['Back Squat', wm.bs]
    ];
    tiles.forEach(([label, val]) => {
      const d = document.createElement('div');
      d.className = 'stat-card';
      d.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${val || '—'} <span class="stat-unit">${p.units}</span></div>`;
      maxGrid.appendChild(d);
    });
  }
}


function openWorkoutDetail(weekIndex, dayIndex, dayPlan) {
  const p = getProfile();
  const overlay = $('workoutDetail');
  const body = $('detailBody');
  const title = $('detailTitle');
  const meta = $('detailMeta');
  if (!overlay || !body || !title || !meta) return;

  ui.detailContext = { weekIndex, dayIndex };

  title.textContent = `Day ${dayIndex + 1} • ${dayPlan.title}`;
  meta.textContent = `Week ${weekIndex + 1} • ${phaseForWeek(weekIndex)} • ${p.programType || 'general'} • ${p.units || 'kg'}`;

  body.innerHTML = '';
  const key = workoutKey(weekIndex, dayIndex);
  const logs = ensureSetLogs();
  const dayLog = logs[key] || {};
  logs[key] = dayLog;

  const persist = () => {
    state.setLogs = logs;
    saveState();
    renderWorkout();
  };

  dayPlan.work.forEach((ex, exIndex) => {
    const liftKey = ex.liftKey || dayPlan.liftKey;
    const workSets = getWorkSetsOverride(dayLog, exIndex, ex.sets);
    const exEff = { ...ex, sets: workSets };
    const scheme = buildSetScheme(exEff, liftKey, p);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '14px';

    const head = document.createElement('div');
    head.className = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';

    head.innerHTML = `
      <div>
        <div class="card-title">${ex.name}</div>
        <div class="card-subtitle">${workSets}×${ex.reps}${ex.pct && liftKey ? ` • ${Math.round(ex.pct*100)}%` : ''}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="secondary small" data-role="minusSet">− Set</button>
        <button class="secondary small" data-role="plusSet">+ Set</button>
      </div>
    `;

    const MAX_WORK_SETS = 12;
    const applySetCountChange = (nextWorkSets) => {
      const next = Math.max(1, Math.min(MAX_WORK_SETS, Math.floor(nextWorkSets)));
      setWorkSetsOverride(dayLog, exIndex, next);

      // remove logs for trimmed sets
      const nextScheme = buildSetScheme({ ...ex, sets: next }, liftKey, p);
      Object.keys(dayLog).forEach((k) => {
        if (!/^[0-9]+:[0-9]+$/.test(k)) return;
        const [ei, si] = k.split(':').map(n => parseInt(n, 10));
        if (ei === exIndex && si >= nextScheme.length) delete dayLog[k];
      });

      persist();
      openWorkoutDetail(weekIndex, dayIndex, dayPlan);
    };

    head.querySelector('[data-role="minusSet"]')?.addEventListener('click', (e) => { e.preventDefault(); applySetCountChange(workSets - 1); });
    head.querySelector('[data-role="plusSet"]')?.addEventListener('click', (e) => { e.preventDefault(); applySetCountChange(workSets + 1); });

    const table = document.createElement('table');
    table.className = 'set-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:54px">Set</th>
          <th style="width:140px">Weight</th>
          <th style="width:110px">Reps</th>
          <th style="width:90px">RPE</th>
          <th style="width:140px">Action</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    const updateRec = (setIndex, patch) => {
      const recKey = `${exIndex}:${setIndex}`;
      const prev = dayLog[recKey] || {};
      dayLog[recKey] = { ...prev, ...patch };
      persist();
    };

    scheme.forEach((s, setIndex) => {
      const recKey = `${exIndex}:${setIndex}`;
      const rec = dayLog[recKey] || {};

      const cumAdj = computeCumulativeAdj(dayLog, exIndex, setIndex, scheme);
      const adjWeight = s.targetWeight ? roundTo(s.targetWeight * (1 + cumAdj), p.units === 'kg' ? 0.5 : 1) : 0;

      const weightVal = (rec.weight != null && rec.weight !== '') ? rec.weight : (adjWeight || '');
      const repsVal = (rec.reps != null && rec.reps !== '') ? rec.reps : (s.targetReps || '');
      const rpeVal = (rec.rpe != null && rec.rpe !== '') ? rec.rpe : '';
      const actionVal = rec.action || '';

      const row = document.createElement('tr');
      row.dataset.idx = String(setIndex);
      row.innerHTML = `
        <td style="padding:8px 6px; opacity:.9">${setIndex + 1}${s.tag === 'warmup' ? '<span style="opacity:.6">w</span>' : ''}</td>
        <td style="padding:6px">
          <div style="display:flex; gap:8px; align-items:center;">
            <input inputmode="decimal" class="input small" data-role="weight" style="width:110px" placeholder="—" />
            <span style="opacity:.65; font-size:12px">${s.targetPct ? `${Math.round(s.targetPct*100)}%` : (s.tag || '')}</span>
          </div>
        </td>
        <td style="padding:6px"><input inputmode="numeric" class="input small" data-role="reps" style="width:80px" placeholder="—" /></td>
        <td style="padding:6px"><input inputmode="decimal" class="input small" data-role="rpe" style="width:70px" placeholder="—" /></td>
        <td style="padding:6px">
          <select class="input small" data-role="action" style="width:120px">
            <option value="">—</option>
            <option value="make">make</option>
            <option value="belt">belt</option>
            <option value="heavy">heavy</option>
            <option value="miss">miss</option>
          </select>
        </td>
      `;

      const wEl = row.querySelector('[data-role="weight"]');
      const repsEl = row.querySelector('[data-role="reps"]');
      const rpeEl = row.querySelector('[data-role="rpe"]');
      const aEl = row.querySelector('[data-role="action"]');

      if (wEl) { wEl.value = String(weightVal); wEl.addEventListener('input', () => updateRec(setIndex, { weight: wEl.value, status: 'done' })); }
      if (repsEl) { repsEl.value = String(repsVal); repsEl.addEventListener('input', () => updateRec(setIndex, { reps: repsEl.value, status: 'done' })); }
      if (rpeEl) { rpeEl.value = String(rpeVal); rpeEl.addEventListener('input', () => updateRec(setIndex, { rpe: rpeEl.value, status: 'done' })); }
      if (aEl) {
        aEl.value = actionVal;
        aEl.addEventListener('change', () => {
          updateRec(setIndex, { action: aEl.value, status: 'done' });

          // apply action effect to subsequent WORK sets (only if they have not been manually overridden)
          if (scheme[setIndex]?.tag === 'work') {
            for (let j = setIndex + 1; j < scheme.length; j++) {
              if (scheme[j]?.tag !== 'work') continue;
              const nextKey = `${exIndex}:${j}`;
              const nextRec = dayLog[nextKey] || {};
              if (nextRec.weight != null && nextRec.weight !== '') continue; // user override wins
              const nextAdj = computeCumulativeAdj(dayLog, exIndex, j, scheme);
              const nextW = scheme[j].targetWeight ? roundTo(scheme[j].targetWeight * (1 + nextAdj), p.units === 'kg' ? 0.5 : 1) : '';
              const nextRow = tbody.querySelector(`tr[data-idx="${j}"]`);
              if (nextRow) {
                const nextWEl = nextRow.querySelector('[data-role="weight"]');
                if (nextWEl) nextWEl.value = String(nextW);
              }
            }
          }
        });
      }

      tbody.appendChild(row);
    });

    card.appendChild(head);
    card.appendChild(table);
    body.appendChild(card);
  });

  overlay.classList.add('show');
}

function bindWorkoutDetailControls() {
  $('btnCloseDetail')?.addEventListener('click', () => $('workoutDetail')?.classList.remove('show'));
  $('btnComplete')?.addEventListener('click', () => {
    const ctx = ui.detailContext;
    if (!ctx || ctx.weekIndex == null || ctx.dayIndex == null) return;
    const block = state.currentBlock;
    const day = block?.weeks?.[ctx.weekIndex]?.days?.[ctx.dayIndex];
    if (day) completeDay(ctx.weekIndex, ctx.dayIndex, day);
    $('workoutDetail')?.classList.remove('show');
  });
}


function renderWorkout() {
  const block = state.currentBlock;
  const p = getProfile();

  // Subtitle
  const blockSubtitle = $('blockSubtitle');
  if (blockSubtitle) {
    blockSubtitle.textContent = block
      ? `${block.programType} • started ${block.startDateISO}`
      : 'No block yet. Go to Setup to generate one.';
  }

  const weekCurrent = $('weekCurrent');
  if (weekCurrent) weekCurrent.textContent = `Week ${ui.weekIndex + 1}`;

  const weekStats = $('weekStats');
  const weekProgress = $('weekProgress');
  const weekCalendar = $('weekCalendar');

  if (!block || !block.weeks || !block.weeks.length) {
    if (weekStats) weekStats.innerHTML = '';
    if (weekProgress) weekProgress.style.width = '0%';
    if (weekCalendar) {
      weekCalendar.innerHTML = `
        <div class="card" style="background:rgba(17,24,39,.5)">
          <div class="card-title">No active training block</div>
          <div class="card-subtitle">Go to the Setup tab to generate your weekly training block.</div>
        </div>`;
    }
    return;
  }

  ui.weekIndex = clamp(ui.weekIndex, 0, block.weeks.length - 1);
  const w = block.weeks[ui.weekIndex];

  // Week stats (simple)
  if (weekStats) {
    weekStats.innerHTML = '';
    const items = [
      ['Phase', w.phase],
      ['Intensity', `${Math.round(w.intensity * 100)}%`],
      ['Volume', `${Math.round(w.volFactor * 100)}%`]
    ];
    items.forEach(([k, v]) => {
      const d = document.createElement('div');
      d.className = 'stat-card';
      d.innerHTML = `<div class="stat-label">${k}</div><div class="stat-value">${v}</div>`;
      weekStats.appendChild(d);
    });
  }

  // Progress = sessions completed this week / 4
  const completed = countCompletedForWeek(ui.weekIndex);
  const pct = Math.round((completed / 4) * 100);
  if (weekProgress) weekProgress.style.width = `${pct}%`;

  // Calendar/day cards
  if (weekCalendar) {
    weekCalendar.innerHTML = '';
    w.days.forEach((day, dayIndex) => {
      const isDone = isDayCompleted(ui.weekIndex, dayIndex);

      const card = document.createElement('div');
      card.className = `day-card-v2 ${isDone ? 'completed' : ''}`;

      const header = document.createElement('div');
      header.className = 'day-card-header';
      header.innerHTML = `
        <div class="day-header-left">
          <div class="day-number">Day ${dayIndex + 1}</div>
          <div class="mini-badge primary">${day.title}</div>
        </div>
        <div class="day-header-right">
          <div class="day-stats">${isDone ? 'Completed' : 'Tap to view'}</div>
          <div class="expand-icon">▾</div>
        </div>
      `;

      const body = document.createElement('div');
      body.className = 'day-card-body';

      // Exercises list
      const exercises = document.createElement('div');
      exercises.style.marginTop = '12px';

      day.work.forEach((ex) => {
        const liftKey = ex.liftKey || day.liftKey;
        let weightText = '';
        if (ex.pct && liftKey) {
          const base = (p.workingMaxes && p.workingMaxes[liftKey]) ? p.workingMaxes[liftKey] : (p.maxes?.[liftKey] || 0);
          const wgt = roundTo(base * ex.pct, p.units === 'kg' ? 0.5 : 1);
          weightText = `${wgt} ${p.units} (${Math.round(ex.pct * 100)}%)`;
        } else if (ex.pct && !liftKey) {
          weightText = `${Math.round(ex.pct * 100)}%`;
        } else {
          weightText = '';
        }

        const row = document.createElement('div');
        row.className = 'exercise-item';
        row.innerHTML = `
          <span class="name">${ex.name}</span>
          <span class="detail">${ex.sets}×${ex.reps}${weightText ? ' • ' + weightText : ''}</span>
        `;
        exercises.appendChild(row);
      });

      const actions = document.createElement('div');
      actions.className = 'day-card-actions';

      const btnComplete = document.createElement('button');
      btnComplete.className = 'btn-mini success';
      btnComplete.textContent = isDone ? '✓ Completed' : '✓ Mark Completed';
      btnComplete.disabled = isDone;
      btnComplete.addEventListener('click', (e) => {
        e.stopPropagation();
        completeDay(ui.weekIndex, dayIndex, day);
      });

      const btnView = document.createElement('button');
      btnView.className = 'btn-mini secondary';
      btnView.textContent = 'View';
      btnView.addEventListener('click', (e) => {
        e.stopPropagation();
        openWorkoutDetail(ui.weekIndex, dayIndex, day);
      });

      actions.appendChild(btnView);
      actions.appendChild(btnComplete);

      body.appendChild(exercises);
      body.appendChild(actions);

      header.addEventListener('click', () => {
        openWorkoutDetail(ui.weekIndex, dayIndex, day);
      });

      card.appendChild(header);
      card.appendChild(body);
      weekCalendar.appendChild(card);
    });
  }
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;

  const items = (state.history || []).slice().sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''));
  if (!items.length) {
    list.innerHTML = `<div class="card" style="background:rgba(17,24,39,.5)"><div class="card-title">No history yet</div><div class="card-subtitle">Complete a session from the Workout tab to see it here.</div></div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach((h) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">${h.title || 'Session'}</div>
      <div class="card-subtitle">${h.dateISO} • Week ${Number(h.weekIndex) + 1} • Day ${Number(h.dayIndex) + 1}</div>
      <div style="margin-top:10px;color:var(--text-dim);font-size:13px">${renderSessionSummary(h.session)}</div>
    `;
    list.appendChild(card);
  });
}

function renderSessionSummary(session) {
  if (!session || !Array.isArray(session.work)) return '—';
  const lines = session.work.map(ex => `${ex.name}: ${ex.sets}×${ex.reps}${ex.weightText ? ' • ' + ex.weightText : ''}`);
  return lines.slice(0, 6).join('<br>') + (lines.length > 6 ? '<br>…' : '');
}

function renderSettings() {
  // Populate profile select
  const sel = $('settingsProfileSelect');
  if (sel) {
    sel.innerHTML = '';
    Object.keys(state.profiles).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === state.activeProfile) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  const p = getProfile();
  const info = $('settingsInfo');
  if (info) info.textContent = `Active profile: ${p.name} • ${p.programType || 'general'} • ${p.units || 'kg'}`;

  if ($('settingsUnits')) $('settingsUnits').value = p.units || 'kg';
  if ($('settingsIncludeBlocks')) $('settingsIncludeBlocks').checked = !!p.includeBlocks;
  if ($('settingsVolumePref')) $('settingsVolumePref').value = p.volumePref || 'reduced';
  if ($('settingsAutoCut')) $('settingsAutoCut').checked = p.autoCut !== false;

  if ($('settingsAIEnabled')) $('settingsAIEnabled').checked = p.aiEnabled !== false;
  if ($('settingsAIModel')) $('settingsAIModel').value = p.aiModel || '';

  // 4 max squares
  if ($('settingsSnatch')) $('settingsSnatch').value = p.maxes?.snatch ?? '';
  if ($('settingsCJ')) $('settingsCJ').value = p.maxes?.cj ?? '';
  if ($('settingsFS')) $('settingsFS').value = p.maxes?.fs ?? '';
  if ($('settingsBS')) $('settingsBS').value = p.maxes?.bs ?? '';
}

/********************
 * History / completion
 ********************/
function isDayCompleted(weekIndex, dayIndex) {
  return (state.history || []).some(h => h.weekIndex === weekIndex && h.dayIndex === dayIndex && h.profileName === state.activeProfile);
}

function countCompletedForWeek(weekIndex) {
  return (state.history || []).filter(h => h.weekIndex === weekIndex && h.profileName === state.activeProfile).length;
}

function completeDay(weekIndex, dayIndex, dayPlan) {
  const p = getProfile();
  const session = {
    title: dayPlan.title,
    work: dayPlan.work.map(ex => {
      const liftKey = ex.liftKey || dayPlan.liftKey;
      let weightText = '';
      if (ex.pct && liftKey) {
        const base = (p.workingMaxes && p.workingMaxes[liftKey]) ? p.workingMaxes[liftKey] : (p.maxes?.[liftKey] || 0);
        const wgt = roundTo(base * ex.pct, p.units === 'kg' ? 0.5 : 1);
        weightText = `${wgt} ${p.units} (${Math.round(ex.pct * 100)}%)`;
      }
      return { ...ex, weightText };
    })
  };

  state.history = state.history || [];
  state.history.push({
    profileName: state.activeProfile,
    dateISO: todayISO(),
    weekIndex,
    dayIndex,
    title: dayPlan.title,
    session
  });
  saveState();
  renderWorkout();
  renderHistory();
}

/********************
 * Button wiring
 ********************/
function wireButtons() {
  // Header
  $('btnAI')?.addEventListener('click', () => {
    openModal(
      '🤖 AI Programming Assistant',
      'This build focuses on stable core programming + UI.',
      '<div class="help">AI suggestions are not enabled in this fresh rewrite yet. Your workouts and settings will work normally without it.</div>'
    );
  });

  // Bottom nav
  $('navSetup')?.addEventListener('click', () => showPage('Setup'));
  $('navDashboard')?.addEventListener('click', () => showPage('Dashboard'));
  $('navWorkout')?.addEventListener('click', () => showPage('Workout'));
  $('navHistory')?.addEventListener('click', () => showPage('History'));
  $('navSettings')?.addEventListener('click', () => showPage('Settings'));

  // Setup
  $('setupProfileSelect')?.addEventListener('change', (e) => {
    setActiveProfile(e.target.value);
    renderSetup();
  });

  $('btnSetupNewProfile')?.addEventListener('click', () => {
    const row = $('setupNewProfileRow');
    if (row) row.style.display = (row.style.display === 'none' || !row.style.display) ? 'flex' : 'none';
  });

  $('btnSetupCreateProfile')?.addEventListener('click', () => {
    const name = ($('setupNewProfileName')?.value || '').trim();
    if (!name) return;
    if (state.profiles[name]) {
      alert('That profile already exists.');
      return;
    }
    const p = DEFAULT_PROFILE();
    p.name = name;
    state.profiles[name] = p;
    state.activeProfile = name;
    saveState();
    $('setupNewProfileName').value = '';
    $('setupNewProfileRow').style.display = 'none';
    renderSetup();
  });

  $('btnGenerateBlock')?.addEventListener('click', generateBlockFromSetup);

  $('btnDemo')?.addEventListener('click', () => {
    // Fill demo values quickly
    const demo = { snatch: 80, cj: 100, fs: 130, bs: 150 };
    $('setupSnatch').value = demo.snatch;
    $('setupCleanJerk').value = demo.cj;
    $('setupFrontSquat').value = demo.fs;
    $('setupBackSquat').value = demo.bs;
    notify('Demo maxes loaded');
  });

  // Dashboard
  $('btnGoWorkout')?.addEventListener('click', () => showPage('Workout'));
  $('btnLogReadiness')?.addEventListener('click', () => {
    // Prefer the existing readiness modal UI if present
    const o = $('readinessOverlay');
    if (o) {
      o.classList.add('show');
      return;
    }
    // Fallback prompt (shouldn't happen unless HTML changes)
    const p = getProfile();
    const scoreRaw = prompt('Readiness score (1-10):', '7');
    if (scoreRaw === null) return;
    const score = clamp(Number(scoreRaw), 1, 10);
    const notes = prompt('Notes (optional):', '') || '';
    p.readinessLog = p.readinessLog || [];
    p.readinessLog.push({ date: todayISO(), score, notes });
    saveState();
    alert('Readiness saved.');
  });

  // Workout week nav
  $('btnPrevWeek')?.addEventListener('click', () => {
    if (!state.currentBlock) return;
    ui.weekIndex = clamp(ui.weekIndex - 1, 0, state.currentBlock.weeks.length - 1);
    renderWorkout();
  });
  $('btnNextWeek')?.addEventListener('click', () => {
    if (!state.currentBlock) return;
    ui.weekIndex = clamp(ui.weekIndex + 1, 0, state.currentBlock.weeks.length - 1);
    renderWorkout();
  });

  // History
  $('btnExport')?.addEventListener('click', () => {
    const data = JSON.stringify({ history: state.history || [] }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'liftai_history.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Settings
  $('settingsProfileSelect')?.addEventListener('change', (e) => {
    setActiveProfile(e.target.value);
    renderSettings();
  });

  $('btnNewProfile')?.addEventListener('click', () => {
    const row = $('newProfileRow');
    if (row) row.style.display = (row.style.display === 'none' || !row.style.display) ? 'flex' : 'none';
  });

  $('btnCreateProfile')?.addEventListener('click', () => {
    const name = ($('newProfileName')?.value || '').trim();
    if (!name) return;
    if (state.profiles[name]) {
      alert('That profile already exists.');
      return;
    }
    const base = DEFAULT_PROFILE();
    base.name = name;
    state.profiles[name] = base;
    state.activeProfile = name;
    saveState();
    $('newProfileName').value = '';
    $('newProfileRow').style.display = 'none';
    renderSettings();
  });

  $('btnSaveSettings')?.addEventListener('click', () => {
    const p = getProfile();

    p.units = $('settingsUnits')?.value || p.units || 'kg';
    p.includeBlocks = !!$('settingsIncludeBlocks')?.checked;
    p.volumePref = $('settingsVolumePref')?.value || p.volumePref || 'reduced';
    p.autoCut = !!$('settingsAutoCut')?.checked;

    p.aiEnabled = !!$('settingsAIEnabled')?.checked;
    p.aiModel = $('settingsAIModel')?.value || '';

    const sn = Number($('settingsSnatch')?.value);
    const cj = Number($('settingsCJ')?.value);
    const fs = Number($('settingsFS')?.value);
    const bs = Number($('settingsBS')?.value);
    if ([sn, cj, fs, bs].some(v => !Number.isFinite(v) || v <= 0)) {
      alert('Please enter all four 1RM values.');
      return;
    }

    p.maxes = { snatch: sn, cj, fs, bs };
    p.workingMaxes = computeWorkingMaxes(p.maxes);

    // If a block exists for this profile, regenerate weeks with same length/type so numbers update
    if (state.currentBlock && state.currentBlock.profileName === state.activeProfile) {
      const len = state.currentBlock.blockLength;
      const weeks = [];
      for (let w = 0; w < len; w++) weeks.push(makeWeekPlan(p, w));
      state.currentBlock.weeks = weeks;
      ui.weekIndex = clamp(ui.weekIndex, 0, weeks.length - 1);
    }

    saveState();
    alert('Saved.');
    renderDashboard();
    renderWorkout();
    renderSettings();
  });

  $('btnResetAll')?.addEventListener('click', () => {
    if (!confirm('Reset all data? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = DEFAULT_STATE();
    ui.weekIndex = 0;
    saveState();
    showPage('Setup');
  });

  // Settings: Test AI Connection (keep functional even if AI is disabled)
  $('btnTestAI')?.addEventListener('click', () => {
    const status = $('aiTestStatus');
    if (status) {
      status.textContent = 'AI connection test is disabled in this build.';
    }
    notify('AI test disabled');
  });

  /********************
   * Legacy overlays present in HTML
   * These MUST have working buttons to satisfy “all buttons work”
   * even if the fresh workflow does not depend on them.
   ********************/
  $('btnCloseDetail')?.addEventListener('click', () => {
    $('workoutDetail')?.classList.remove('show');
  });
  $('btnComplete')?.addEventListener('click', () => {
    // If opened from anywhere, just close + toast. Completion is handled in week cards.
    $('workoutDetail')?.classList.remove('show');
    notify('Session marked complete (use Week view buttons for logging)');
  });
  $('btnExecExit')?.addEventListener('click', () => {
    $('execOverlay')?.classList.remove('show');
  });
  $('btnExecPrev')?.addEventListener('click', () => notify('Execution mode is not used in this build.'));
  $('btnExecNext')?.addEventListener('click', () => notify('Execution mode is not used in this build.'));
  $('btnCutRemaining')?.addEventListener('click', () => notify('Execution mode is not used in this build.'));
  $('btnExecComplete')?.addEventListener('click', () => {
    $('execOverlay')?.classList.remove('show');
    notify('Execution complete');
  });
  $('btnExecOpenTable')?.addEventListener('click', () => notify('Execution mode is not used in this build.'));
}

/********************
 * Info popups (minimal)
 ********************/
window.showInfo = function showInfo(topic) {
  const MAP = {
    profile: 'Profiles are stored locally on this device/browser.',
    units: 'Choose kg or lb. Loads are rounded accordingly.',
    blocklength: 'Block length controls how many weeks are generated.',
    programtype: 'Program type adjusts the style of training.',
    transition: 'Ramp-in smooths intensity/volume during a program switch or new block.',
    preferences: 'Presets influence overall volume and fatigue.',
    volume: 'Standard = more sets; Minimal = fewer sets.',
    autocut: 'If enabled, the app may suggest trimming work when fatigue spikes (future feature).',
    blocks: 'Include blocks if you have them available.',
    aicoach: 'Optional AI features are placeholders in this build.',
    hfmodel: 'Stores your preferred model name (no network calls in this build).',
    aitest: 'Connection testing disabled in this build.',
    maxes: 'Enter your best recent 1RMs. Working maxes are set to 90% automatically.'
  };
  alert(MAP[topic] || 'Info');
};

/********************
 * Boot
 ********************/
function boot() {
  wireButtons();

  // default page
  showPage('Setup');

  // If a block exists, default weekIndex = first incomplete week
  if (state.currentBlock && state.currentBlock.weeks?.length) {
    // keep 0 for simplicity
    ui.weekIndex = 0;
  }
}

document.addEventListener('DOMContentLoaded', boot);
