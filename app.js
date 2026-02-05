/*
 * LiftAI v7.45 - CLOUD SYNC REFACTORED VERSION
 * 
 * ALL FIXES APPLIED:
 * ✅ Robust Supabase initialization with polling
 * ✅ Global supabaseClient declaration
 * ✅ Safety checks in all API calls
 * ✅ Proper timeout handling
 * ✅ All supabase.from changed to supabaseClient.from
 */

'use strict';

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
  const t = document.getElementById('toast');
  if (t) {
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(notify._timer);
    notify._timer = setTimeout(() => { t.classList.remove('show'); }, 2200);
  }
  console.log(msg);
}

// ============================================================================
// CLOUD SYNC - Robust Implementation with Polling
// ============================================================================

const SUPABASE_URL = 'https://xbqlejwtfbeebucrdvqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhicWxland0ZmJlZWJ1Y3JkdnFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODgzODEsImV4cCI6MjA4NTY2NDM4MX0.1RdmT3twtadvxTjdepaqSYaqZRFkOAMhWyRQOjf-Zp0';

// Global Supabase client
let supabaseClient = null;

// Get anonymous user ID
function getAnonymousUserId() {
  let userId = localStorage.getItem('liftai_user_id');
  if (!userId) {
    userId = 'anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('liftai_user_id', userId);
  }
  return userId;
}

// Initialize Supabase with polling and timeout
function initSupabase() {
  let attempts = 0;
  const maxAttempts = 50; // 50 attempts * 100ms = 5 seconds
  
  const pollInterval = setInterval(() => {
    attempts++;
    
    // Check if window.supabase is available
    if (window.supabase && window.supabase.createClient) {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        clearInterval(pollInterval);
        console.log('✅ Cloud sync ready');
        notify('☁️ Cloud sync enabled');
      } catch (e) {
        console.error('❌ Failed to initialize Supabase:', e);
        clearInterval(pollInterval);
      }
      return;
    }
    
    // Timeout after 5 seconds
    if (attempts >= maxAttempts) {
      clearInterval(pollInterval);
      console.warn('⚠️ Cloud sync unavailable (timeout)');
    }
  }, 100);
}

// Push to cloud
async function pushToCloud() {
  // Safety check
  if (!supabaseClient) {
    console.warn('Supabase not ready');
    notify('⚠️ Cloud sync not ready');
    return;
  }
  
  if (!state.currentBlock) {
    notify('⚠️ No block to save');
    return;
  }
  
  try {
    notify('☁️ Saving...');
    const userId = getAnonymousUserId();
    const blockName = state.currentBlock.name || `Block ${new Date().toLocaleDateString()}`;
    
    // Check if block already exists
    const { data: existing } = await supabaseClient
      .from('training_blocks')
      .select('id')
      .eq('user_id', userId)
      .eq('block_name', blockName)
      .maybeSingle();
    
    const blockData = {
      user_id: userId,
      block_name: blockName,
      block_data: state.currentBlock,
      profile_data: { maxes: state.profile.maxes },
      block_length: state.currentBlock.weeks?.length || 0,
      program_type: state.profile.programType || 'general',
      is_active: true
    };
    
    if (existing?.id) {
      await supabaseClient.from('training_blocks').update(blockData).eq('id', existing.id);
      notify('✅ Updated in cloud');
    } else {
      await supabaseClient.from('training_blocks').insert([blockData]);
      notify('✅ Saved to cloud');
    }
  } catch (e) {
    notify('❌ Save failed');
    console.error(e);
  }
}

// Pull from cloud
async function pullFromCloud() {
  // Safety check
  if (!supabaseClient) {
    console.warn('Supabase not ready');
    notify('⚠️ Cloud sync not ready');
    return;
  }
  
  try {
    notify('☁️ Loading...');
    const userId = getAnonymousUserId();
    
    const { data: blocks } = await supabaseClient
      .from('training_blocks')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(20);
    
    if (!blocks || blocks.length === 0) {
      notify('📦 No saved blocks');
      return;
    }
    
    showCloudModal(blocks);
  } catch (e) {
    notify('❌ Load failed');
    console.error(e);
  }
}

// Show cloud blocks modal
function showCloudModal(blocks) {
  const html = blocks.map(b => `
    <div onclick="window.restoreFromCloud('${b.id}')" style="padding:12px;margin:8px 0;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;cursor:pointer;">
      <div style="font-weight:600">${b.block_name.replace(/'/g, '&#39;')}</div>
      <div style="font-size:13px;color:#9ca3af">${b.block_length} weeks • ${b.program_type}</div>
    </div>
  `).join('');
  
  const modal = document.createElement('div');
  modal.id = 'cloudModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;';
  modal.innerHTML = `
    <div style="background:#111827;border-radius:12px;padding:24px;max-width:500px;width:100%;">
      <h3 style="margin:0 0 16px 0">☁️ Saved Blocks</h3>
      <div style="max-height:400px;overflow-y:auto;">${html}</div>
      <button onclick="window.closeCloudModal()" style="margin-top:16px;width:100%;padding:10px;background:#374151;border:none;border-radius:8px;color:white;cursor:pointer;">Cancel</button>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) window.closeCloudModal(); };
  document.body.appendChild(modal);
}

// Restore from cloud
window.restoreFromCloud = async function(blockId) {
  // Safety check
  if (!supabaseClient) {
    console.warn('Supabase not ready');
    notify('⚠️ Cloud sync not ready');
    return;
  }
  
  try {
    notify('☁️ Restoring...');
    const { data } = await supabaseClient.from('training_blocks').select('*').eq('id', blockId).single();
    if (data) {
      state.currentBlock = data.block_data;
      if (data.profile_data?.maxes) state.profile.maxes = data.profile_data.maxes;
      saveState();
      ui.weekIndex = 0;
      renderDashboard();
      renderWorkout();
      window.closeCloudModal();
      notify('✅ Restored');
    }
  } catch (e) {
    notify('❌ Restore failed');
    console.error(e);
  }
};

// Close modal
window.closeCloudModal = function() {
  document.getElementById('cloudModal')?.remove();
};

// ============================================================================
// END CLOUD SYNC
// ============================================================================


// v7.16 STAGE 4: Rest Timer
let restTimer = {
  active: false,
  startTime: null,
  duration: 180, // 3 minutes default
  intervalId: null,
  exerciseKey: null
};

function startRestTimer(durationSeconds = 180, exerciseKey = '') {
  // Clear any existing timer
  stopRestTimer();
  
  restTimer = {
    active: true,
    startTime: Date.now(),
    duration: durationSeconds,
    intervalId: null,
    exerciseKey
  };
  
  // Update timer display every second
  restTimer.intervalId = setInterval(() => {
    updateRestTimerDisplay();
  }, 1000);
  
  updateRestTimerDisplay();
}

function stopRestTimer() {
  if (restTimer.intervalId) {
    clearInterval(restTimer.intervalId);
  }
  restTimer.active = false;
  restTimer.intervalId = null;
  
  // Clear all timer displays
  document.querySelectorAll('[data-rest-timer]').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

function updateRestTimerDisplay() {
  if (!restTimer.active) return;
  
  const elapsed = Math.floor((Date.now() - restTimer.startTime) / 1000);
  const remaining = Math.max(0, restTimer.duration - elapsed);
  
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  // Update all timer displays for this exercise
  document.querySelectorAll(`[data-rest-timer="${restTimer.exerciseKey}"]`).forEach(el => {
    el.textContent = remaining > 0 ? `⏱️ ${timeStr}` : '✅ Ready';
    el.style.display = 'block';
    el.style.color = remaining > 0 ? '#f59e0b' : '#10b981';
  });
  
  // Stop timer when complete
  if (remaining === 0) {
    stopRestTimer();
    notify('✅ Rest period complete!');
  }
}

const STORAGE_KEY = 'liftai_v7_state';

function DEFAULT_PROFILE() {
  return {
    name: 'Default',
    units: 'kg',
    maxes: { snatch: 100, cj: 130, fs: 150, bs: 180 },
    workingMaxes: {},
    programType: 'balanced',
    includeBlocks: true,
    volumePref: 'reduced',
    autoCut: false,
    aiEnabled: false,
    aiModel: '',
    readiness: { soreness: 3, fatigue: 3, stress: 3 },
    preferences: {
      squatThreshold: 0,
      complexFreq: 0,
      heavyPullPref: 0,
      cleanBalPref: 0,
      snatchBalPref: 0,
      jerkPref: 0
    },
    injuries: []
  };
}

function DEFAULT_STATE() {
  const p = DEFAULT_PROFILE();
  p.workingMaxes = computeWorkingMaxes(p.maxes);
  return {
    version: '7.45',
    activeProfile: 'Default',
    profiles: { Default: p },
    currentBlock: null,
    blockHistory: [],
    history: [],
    ui: { weekIndex: 0 }
  };
}

let state = safeJsonParse(localStorage.getItem(STORAGE_KEY), DEFAULT_STATE());
if (!state.version) state = DEFAULT_STATE();
if (!state.profiles) state.profiles = { Default: DEFAULT_PROFILE() };
if (!state.activeProfile) state.activeProfile = 'Default';
if (!state.profiles[state.activeProfile]) state.profiles[state.activeProfile] = DEFAULT_PROFILE();
if (!state.currentBlock) state.currentBlock = null;
if (!state.blockHistory) state.blockHistory = [];
if (!state.history) state.history = [];

let ui = { weekIndex: state.ui?.weekIndex || 0 };

function saveState() {
  state.ui = { weekIndex: ui.weekIndex };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function computeWorkingMaxes(maxes) {
  return {
    snatch: Math.round(maxes.snatch * 0.9),
    cj: Math.round(maxes.cj * 0.9),
    fs: Math.round(maxes.fs * 0.9),
    bs: Math.round(maxes.bs * 0.9)
  };
}

function getProfile() {
  const prof = state.profiles[state.activeProfile];
  if (!prof) return DEFAULT_PROFILE();
  if (!prof.maxes) prof.maxes = { snatch: 100, cj: 130, fs: 150, bs: 180 };
  if (!prof.workingMaxes || Object.keys(prof.workingMaxes).length === 0) {
    prof.workingMaxes = computeWorkingMaxes(prof.maxes);
  }
  if (!prof.readiness) prof.readiness = { soreness: 3, fatigue: 3, stress: 3 };
  if (!prof.preferences) {
    prof.preferences = {
      squatThreshold: 0,
      complexFreq: 0,
      heavyPullPref: 0,
      cleanBalPref: 0,
      snatchBalPref: 0,
      jerkPref: 0
    };
  }
  if (!prof.injuries) prof.injuries = [];
  return prof;
}

Object.defineProperty(state, 'profile', {
  get() { return getProfile(); },
  enumerable: false
});

function setActiveProfile(name) {
  if (!state.profiles[name]) return;
  state.activeProfile = name;
  saveState();
}

const EXERCISE_DB = {
  snatch: {
    variations: [
      { name: 'Snatch', type: 'full' },
      { name: 'Power Snatch', type: 'power' },
      { name: 'Hang Snatch', type: 'position' },
      { name: 'Snatch Pull', type: 'pull' },
      { name: 'Snatch Balance', type: 'skill' },
      { name: 'Overhead Squat', type: 'strength' }
    ]
  },
  clean: {
    variations: [
      { name: 'Clean & Jerk', type: 'full' },
      { name: 'Clean', type: 'full' },
      { name: 'Power Clean', type: 'power' },
      { name: 'Hang Clean', type: 'position' },
      { name: 'Clean Pull', type: 'pull' },
      { name: 'Clean Deadlift', type: 'pull' }
    ]
  },
  jerk: {
    variations: [
      { name: 'Jerk', type: 'full' },
      { name: 'Push Jerk', type: 'power' },
      { name: 'Split Jerk', type: 'full' },
      { name: 'Jerk Balance', type: 'skill' },
      { name: 'Behind Neck Jerk', type: 'variation' }
    ]
  },
  squat: {
    variations: [
      { name: 'Front Squat', type: 'strength' },
      { name: 'Back Squat', type: 'strength' },
      { name: 'Overhead Squat', type: 'strength' },
      { name: 'Pause Squat', type: 'tempo' },
      { name: 'Tempo Squat', type: 'tempo' }
    ]
  },
  accessories: [
    'Romanian Deadlift',
    'Good Mornings',
    'Bulgarian Split Squat',
    'Lunges',
    'Press',
    'Push Press',
    'Bent Over Row',
    'Pull-ups',
    'Dips',
    'Core Work'
  ]
};

function selectExerciseVariation(category, weekIndex, dayIndex) {
  const db = EXERCISE_DB[category];
  if (!db || !db.variations) return category;
  const seed = weekIndex * 7 + dayIndex;
  const idx = seed % db.variations.length;
  return db.variations[idx].name;
}

function MAKE_OLYMPIC_WORKOUT(profile, weekIndex, dayData) {
  const { maxes, workingMaxes } = profile;
  const intensityMap = {
    'Light': 0.75,
    'Moderate': 0.85,
    'Heavy': 0.92,
    'Max Effort': 0.98
  };
  const baseIntensity = intensityMap[dayData.intensity] || 0.85;

  const exercises = [];

  const snatchEx = selectExerciseVariation('snatch', weekIndex, dayData.dayNum || 1);
  const cleanEx = selectExerciseVariation('clean', weekIndex, dayData.dayNum || 1);
  const squatEx = selectExerciseVariation('squat', weekIndex, dayData.dayNum || 1);

  if (dayData.primaryFocus?.includes('Snatch')) {
    exercises.push({
      name: snatchEx,
      sets: dayData.volume === 'High' ? 5 : 4,
      reps: '2-3',
      intensity: `${Math.round(baseIntensity * 100)}%`,
      weight: Math.round(workingMaxes.snatch * baseIntensity),
      notes: 'Focus on speed and technique'
    });
  }

  if (dayData.primaryFocus?.includes('Clean')) {
    exercises.push({
      name: cleanEx,
      sets: dayData.volume === 'High' ? 5 : 4,
      reps: '2-3',
      intensity: `${Math.round(baseIntensity * 100)}%`,
      weight: Math.round(workingMaxes.cj * baseIntensity),
      notes: 'Maintain positions'
    });
  }

  if (dayData.squats) {
    exercises.push({
      name: squatEx,
      sets: 4,
      reps: dayData.intensity === 'Heavy' ? '3-4' : '4-5',
      intensity: `${Math.round((baseIntensity - 0.05) * 100)}%`,
      weight: Math.round(workingMaxes.fs * (baseIntensity - 0.05)),
      notes: 'Depth and control'
    });
  }

  if (dayData.accessories && dayData.accessories.length) {
    dayData.accessories.forEach(acc => {
      exercises.push({
        name: acc,
        sets: 3,
        reps: '8-10',
        intensity: 'Moderate',
        weight: 0,
        notes: 'Hypertrophy focus'
      });
    });
  }

  return exercises;
}

function MAKE_STRENGTH_WORKOUT(profile, weekIndex, dayData) {
  const { workingMaxes } = profile;
  const exercises = [];

  if (dayData.primaryFocus?.includes('Squat')) {
    exercises.push({
      name: 'Back Squat',
      sets: 5,
      reps: '5',
      intensity: '85%',
      weight: Math.round(workingMaxes.bs * 0.85),
      notes: 'Linear progression'
    });
  }

  if (dayData.accessories && dayData.accessories.length) {
    dayData.accessories.forEach(acc => {
      exercises.push({
        name: acc,
        sets: 3,
        reps: '8-12',
        intensity: 'Moderate',
        weight: 0,
        notes: 'Muscle building'
      });
    });
  }

  return exercises;
}

function makeWeekPlan(profile, weekIndex) {
  const daysPerWeek = 4;
  const week = { weekNum: weekIndex + 1, days: [] };

  const dayTemplates = [
    {
      dayNum: 1,
      type: 'Olympic',
      primaryFocus: ['Snatch', 'Clean'],
      intensity: 'Moderate',
      volume: 'Medium',
      squats: true,
      accessories: ['Romanian Deadlift', 'Core Work']
    },
    {
      dayNum: 2,
      type: 'Strength',
      primaryFocus: ['Squat'],
      intensity: 'Heavy',
      volume: 'High',
      squats: false,
      accessories: ['Lunges', 'Press']
    },
    {
      dayNum: 3,
      type: 'Olympic',
      primaryFocus: ['Snatch'],
      intensity: 'Light',
      volume: 'Low',
      squats: true,
      accessories: ['Pull-ups']
    },
    {
      dayNum: 4,
      type: 'Olympic',
      primaryFocus: ['Clean'],
      intensity: 'Heavy',
      volume: 'Medium',
      squats: true,
      accessories: ['Good Mornings', 'Dips']
    }
  ];

  dayTemplates.forEach((template, i) => {
    let exercises = [];
    if (template.type === 'Olympic') {
      exercises = MAKE_OLYMPIC_WORKOUT(profile, weekIndex, template);
    } else {
      exercises = MAKE_STRENGTH_WORKOUT(profile, weekIndex, template);
    }

    week.days.push({
      dayNum: i + 1,
      type: template.type,
      primaryFocus: template.primaryFocus,
      intensity: template.intensity,
      volume: template.volume,
      exercises,
      completed: false,
      selectedDate: null
    });
  });

  return week;
}

function showPage(pageName) {
  ['Setup', 'Dashboard', 'Workout', 'History', 'Settings'].forEach(p => {
    const sec = document.getElementById(`page${p}`);
    if (sec) sec.style.display = (p === pageName) ? 'block' : 'none';
    const btn = document.getElementById(`nav${p}`);
    if (btn) {
      if (p === pageName) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  if (pageName === 'Dashboard') renderDashboard();
  if (pageName === 'Workout') renderWorkout();
  if (pageName === 'History') renderHistory();
  if (pageName === 'Settings') renderSettings();
}

function renderDashboard() {
  const out = $('dashboardContent');
  if (!out) return;

  if (!state.currentBlock || !state.currentBlock.weeks || state.currentBlock.weeks.length === 0) {
    out.innerHTML = '<div class="card"><p>No active training block. Create one in Setup.</p></div>';
    return;
  }

  const block = state.currentBlock;
  const weekData = block.weeks[ui.weekIndex];
  if (!weekData) {
    out.innerHTML = '<div class="card"><p>Week data not available.</p></div>';
    return;
  }

  const completedDays = weekData.days.filter(d => d.completed).length;
  const totalDays = weekData.days.length;

  let html = `
    <div class="card">
      <div class="card-title">Week ${weekData.weekNum} Overview</div>
      <div class="card-subtitle">${block.name || 'Training Block'}</div>
      <div style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Progress</span>
          <span>${completedDays}/${totalDays} days</span>
        </div>
        <div style="background:rgba(255,255,255,0.1);height:8px;border-radius:4px;overflow:hidden;">
          <div style="background:var(--success);height:100%;width:${(completedDays/totalDays)*100}%;transition:width 0.3s;"></div>
        </div>
      </div>
    </div>
  `;

  weekData.days.forEach((day, i) => {
    const dayBadge = day.completed ? '<span class="mini-badge success">✓ Done</span>' : '';
    const dateStr = day.selectedDate ? new Date(day.selectedDate).toLocaleDateString() : '';
    
    html += `
      <div class="card" style="cursor:pointer;" onclick="showWorkoutDetail(${i})">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="card-title">Day ${day.dayNum} - ${day.type}</div>
            <div class="card-subtitle">${day.primaryFocus.join(', ')} • ${day.intensity}</div>
            ${dateStr ? `<div class="card-subtitle" style="margin-top:4px;">📅 ${dateStr}</div>` : ''}
          </div>
          <div style="text-align:right;">
            ${dayBadge}
            <div style="font-size:13px;color:var(--text-dim);margin-top:4px;">${day.exercises?.length || 0} exercises</div>
          </div>
        </div>
      </div>
    `;
  });

  out.innerHTML = html;
}

function showWorkoutDetail(dayIndex) {
  const weekData = state.currentBlock.weeks[ui.weekIndex];
  if (!weekData || !weekData.days[dayIndex]) return;
  
  showPage('Workout');
  ui.selectedDayIndex = dayIndex;
  renderWorkout();
}

function renderWorkout() {
  const out = $('workoutContent');
  if (!out) return;

  if (!state.currentBlock || !state.currentBlock.weeks || state.currentBlock.weeks.length === 0) {
    out.innerHTML = '<div class="card"><p>No active block.</p></div>';
    return;
  }

  const weekData = state.currentBlock.weeks[ui.weekIndex];
  if (!weekData) {
    out.innerHTML = '<div class="card"><p>No week data.</p></div>';
    return;
  }

  const dayIndex = ui.selectedDayIndex ?? 0;
  const day = weekData.days[dayIndex];
  if (!day) {
    out.innerHTML = '<div class="card"><p>No day data.</p></div>';
    return;
  }

  let html = `
    <div class="card">
      <div class="card-title">Day ${day.dayNum} - ${day.type}</div>
      <div class="card-subtitle">${day.primaryFocus.join(', ')} • ${day.intensity} • ${day.volume} Volume</div>
      ${day.selectedDate ? `<div class="card-subtitle" style="margin-top:8px;">📅 ${new Date(day.selectedDate).toLocaleDateString()}</div>` : ''}
      <div style="margin-top:16px;">
        <button class="secondary" onclick="toggleDayComplete(${dayIndex})">
          ${day.completed ? '✓ Completed' : 'Mark Complete'}
        </button>
      </div>
    </div>
  `;

  if (day.exercises && day.exercises.length) {
    day.exercises.forEach((ex, i) => {
      html += `
        <div class="card">
          <div class="card-title">${ex.name}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px;margin-top:12px;">
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">SETS</div>
              <div style="font-size:18px;font-weight:700;">${ex.sets}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">REPS</div>
              <div style="font-size:18px;font-weight:700;">${ex.reps}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">WEIGHT</div>
              <div style="font-size:18px;font-weight:700;">${ex.weight} ${state.profile.units}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">INTENSITY</div>
              <div style="font-size:18px;font-weight:700;">${ex.intensity}</div>
            </div>
          </div>
          ${ex.notes ? `<div style="margin-top:12px;font-size:13px;color:var(--text-dim);">💡 ${ex.notes}</div>` : ''}
          <div style="margin-top:12px;">
            <button class="secondary small" onclick="startRestTimer(180, 'ex_${i}')">Start Rest Timer</button>
            <div data-rest-timer="ex_${i}" style="margin-top:8px;display:none;font-size:14px;font-weight:600;"></div>
          </div>
        </div>
      `;
    });
  }

  out.innerHTML = html;
}

function toggleDayComplete(dayIndex) {
  const weekData = state.currentBlock.weeks[ui.weekIndex];
  if (!weekData || !weekData.days[dayIndex]) return;
  
  weekData.days[dayIndex].completed = !weekData.days[dayIndex].completed;
  saveState();
  renderDashboard();
  renderWorkout();
  notify(weekData.days[dayIndex].completed ? '✅ Day completed!' : 'Day unmarked');
}

function renderHistory() {
  const out = $('historyContent');
  if (!out) return;

  if (!state.blockHistory || state.blockHistory.length === 0) {
    out.innerHTML = '<div class="card"><p>No training history yet.</p></div>';
    return;
  }

  let html = '<div class="card"><div class="card-title">Training Block History</div></div>';

  state.blockHistory.forEach((block, i) => {
    const endDate = block.endDate ? new Date(block.endDate).toLocaleDateString() : 'N/A';
    html += `
      <div class="card">
        <div class="card-title">${block.name}</div>
        <div class="card-subtitle">${block.weeks?.length || 0} weeks • Ended ${endDate}</div>
        <button class="secondary small" style="margin-top:12px;" onclick="restoreBlock(${i})">Restore</button>
      </div>
    `;
  });

  out.innerHTML = html;
}

function restoreBlock(index) {
  if (!state.blockHistory[index]) return;
  
  if (confirm('Restore this training block? This will replace your current active block.')) {
    state.currentBlock = JSON.parse(JSON.stringify(state.blockHistory[index]));
    delete state.currentBlock.endDate;
    ui.weekIndex = 0;
    saveState();
    showPage('Dashboard');
    notify('✅ Block restored');
  }
}

function renderSettings() {
  const out = $('settingsContent');
  if (!out) return;

  const p = getProfile();
  
  const profileSelect = $('settingsProfileSelect');
  if (profileSelect) {
    profileSelect.innerHTML = Object.keys(state.profiles).map(name => 
      `<option value="${name}" ${name === state.activeProfile ? 'selected' : ''}>${name}</option>`
    ).join('');
  }

  const unitsSelect = $('settingsUnits');
  if (unitsSelect) unitsSelect.value = p.units || 'kg';

  const volumeSelect = $('settingsVolumePref');
  if (volumeSelect) volumeSelect.value = p.volumePref || 'reduced';

  const includeBlocks = $('settingsIncludeBlocks');
  if (includeBlocks) includeBlocks.checked = !!p.includeBlocks;

  const autoCut = $('settingsAutoCut');
  if (autoCut) autoCut.checked = !!p.autoCut;

  const aiEnabled = $('settingsAIEnabled');
  if (aiEnabled) aiEnabled.checked = !!p.aiEnabled;

  const aiModel = $('settingsAIModel');
  if (aiModel) aiModel.value = p.aiModel || '';

  const snatch = $('settingsSnatch');
  if (snatch) snatch.value = p.maxes.snatch || 100;

  const cj = $('settingsCJ');
  if (cj) cj.value = p.maxes.cj || 130;

  const fs = $('settingsFS');
  if (fs) fs.value = p.maxes.fs || 150;

  const bs = $('settingsBS');
  if (bs) bs.value = p.maxes.bs || 180;
}

function bindWorkoutDetailControls() {
  // Placeholder for future workout detail controls
}

function bindReadinessModal() {
  // Placeholder for readiness modal
}

function ensureDaySelectorsBound() {
  // Placeholder for day selector binding
}

function wireButtons() {
  // Navigation
  $('navSetup')?.addEventListener('click', () => showPage('Setup'));
  $('navDashboard')?.addEventListener('click', () => showPage('Dashboard'));
  $('navWorkout')?.addEventListener('click', () => showPage('Workout'));
  $('navHistory')?.addEventListener('click', () => showPage('History'));
  $('navSettings')?.addEventListener('click', () => showPage('Settings'));

  // Setup page
  $('btnStartBlock')?.addEventListener('click', () => {
    const p = getProfile();
    const blockLength = 4; // Default 4 weeks
    
    const weeks = [];
    for (let w = 0; w < blockLength; w++) {
      weeks.push(makeWeekPlan(p, w));
    }

    state.currentBlock = {
      name: `Training Block ${new Date().toLocaleDateString()}`,
      profileName: state.activeProfile,
      blockLength,
      weeks,
      startDate: new Date().toISOString()
    };

    ui.weekIndex = 0;
    saveState();
    showPage('Dashboard');
    notify('✅ Training block created!');
  });

  $('btnEndBlock')?.addEventListener('click', () => {
    if (!state.currentBlock) {
      notify('No active block');
      return;
    }

    if (confirm('End current training block? It will be saved to history.')) {
      const block = { ...state.currentBlock };
      block.endDate = new Date().toISOString();
      state.blockHistory.push(block);
      state.currentBlock = null;
      saveState();
      showPage('Setup');
      notify('✅ Block ended and saved to history');
    }
  });

  // Week navigation
  $('btnPrevWeek')?.addEventListener('click', () => {
    if (!state.currentBlock || !state.currentBlock.weeks) return;
    ui.weekIndex = Math.max(0, ui.weekIndex - 1);
    saveState();
    renderDashboard();
    renderWorkout();
  });

  $('btnNextWeek')?.addEventListener('click', () => {
    if (!state.currentBlock || !state.currentBlock.weeks) return;
    ui.weekIndex = Math.min(state.currentBlock.weeks.length - 1, ui.weekIndex + 1);
    saveState();
    renderDashboard();
    renderWorkout();
  });

  // Cloud sync buttons
  $('btnPushCloud')?.addEventListener('click', pushToCloud);
  $('btnPullCloud')?.addEventListener('click', pullFromCloud);

  // Export/Import
  $('btnExport')?.addEventListener('click', () => {
    const exportData = {
      version: state.version,
      exportDate: new Date().toISOString(),
      currentBlock: state.currentBlock,
      blockHistory: state.blockHistory,
      profiles: state.profiles,
      history: state.history
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liftai_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('✅ Data exported');
  });

  $('btnImport')?.addEventListener('click', () => {
    const fileInput = $('fileImport');
    if (fileInput) fileInput.click();
  });

  $('fileImport')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        if (!importData.version) {
          alert('Invalid file format.');
          return;
        }

        if (!confirm(`Import data from ${importData.exportDate || 'backup'}?\n\nThis will MERGE with your current data.`)) {
          return;
        }

        if (importData.blockHistory) {
          state.blockHistory = state.blockHistory || [];
          importData.blockHistory.forEach(block => {
            if (!state.blockHistory.find(b => b.id === block.id)) {
              state.blockHistory.push(block);
            }
          });
        }

        if (importData.profiles) {
          Object.keys(importData.profiles).forEach(profileName => {
            if (!state.profiles[profileName]) {
              state.profiles[profileName] = importData.profiles[profileName];
            }
          });
        }

        if (importData.history) {
          state.history = state.history || [];
          state.history.push(...importData.history);
        }

        if (importData.currentBlock && confirm('Also import the active training block?')) {
          state.currentBlock = importData.currentBlock;
        }

        saveState();
        renderHistory();
        renderSettings();
        notify('✅ Data imported!');
      } catch (err) {
        console.error('Import error:', err);
        alert('Failed to import file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
      alert('Profile exists.');
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
      alert('Enter all 1RMs.');
      return;
    }
    
    p.maxes = { snatch: sn, cj, fs, bs };
    p.workingMaxes = computeWorkingMaxes(p.maxes);
    
    if (state.currentBlock && state.currentBlock.profileName === state.activeProfile) {
      const len = state.currentBlock.blockLength;
      const weeks = [];
      for (let w = 0; w < len; w++) weeks.push(makeWeekPlan(p, w));
      state.currentBlock.weeks = weeks;
      ui.weekIndex = clamp(ui.weekIndex, 0, weeks.length - 1);
    }
    
    saveState();
    notify('Settings saved');
    renderDashboard();
    renderWorkout();
    renderSettings();
  });

  $('btnResetAll')?.addEventListener('click', () => {
    if (!confirm('Reset all data?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = DEFAULT_STATE();
    ui.weekIndex = 0;
    saveState();
    showPage('Setup');
    notify('✅ All data reset');
  });
}

// Boot function - NO LONGER CALLED IN app.js
// This will be moved to index.html
function boot() {
  wireButtons();
  bindWorkoutDetailControls();
  bindReadinessModal();
  ensureDaySelectorsBound();
  showPage('Setup');
  if (state.currentBlock && state.currentBlock.weeks?.length) {
    ui.weekIndex = 0;
  }
  initSupabase(); // Initialize cloud sync with polling
}

// REMOVED: document.addEventListener('DOMContentLoaded', boot);
// Boot will be called from index.html instead
