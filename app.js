(function(){'use strict';

/* LiftAI v8.0.0 - Enhanced with Analytics, Recovery Tracking & Safety Features */

const VERSION='v8.0.0';
const GLOBAL_KEYS={
  profilesIndex:'liftai_profiles_index_v1',
  activeProfile:'liftai_active_profile_v1'
};

const SK_BASE={
  profile:'liftai_profile_v7',
  block:'liftai_block_v7',
  sessions:'liftai_sessions_v7',
  sets:'liftai_sets_v7',
  logs:'liftai_logs_v7',
  injuries:'liftai_injuries_v8',
  recovery:'liftai_recovery_v8',
  prs:'liftai_prs_v8',
  analytics:'liftai_analytics_v8',
  trainingHistory:'liftai_training_history_v7',
  archivedBlocks:'liftai_archived_blocks_v1',
  aiLog:'liftai_ai_log_v1',
  ui:'liftai_ui_v1',
  savedBlocks:'liftai_saved_blocks_v2',
  sessionReadiness:'liftai_session_readiness_v9',
  pendingTransition:'liftai_pending_transition_v1'
};

let ACTIVE_PROFILE_ID='default';
let SK=null;

function makeProfiledKey(baseKey, profileId){
  const pid=String(profileId||'default');
  // Backwards compatible: default profile uses legacy keys (no suffix)
  if(pid==='default') return baseKey;
  return `${baseKey}__${pid}`;
}

function refreshSK(){
  SK={
    profile: makeProfiledKey(SK_BASE.profile, ACTIVE_PROFILE_ID),
    block: makeProfiledKey(SK_BASE.block, ACTIVE_PROFILE_ID),
    sessions: makeProfiledKey(SK_BASE.sessions, ACTIVE_PROFILE_ID),
    sets: makeProfiledKey(SK_BASE.sets, ACTIVE_PROFILE_ID),
    logs: makeProfiledKey(SK_BASE.logs, ACTIVE_PROFILE_ID),
    injuries: makeProfiledKey(SK_BASE.injuries, ACTIVE_PROFILE_ID),
    recovery: makeProfiledKey(SK_BASE.recovery, ACTIVE_PROFILE_ID),
    prs: makeProfiledKey(SK_BASE.prs, ACTIVE_PROFILE_ID),
    analytics: makeProfiledKey(SK_BASE.analytics, ACTIVE_PROFILE_ID),
    trainingHistory: makeProfiledKey(SK_BASE.trainingHistory, ACTIVE_PROFILE_ID),
    archivedBlocks: makeProfiledKey(SK_BASE.archivedBlocks, ACTIVE_PROFILE_ID),
    aiLog: makeProfiledKey(SK_BASE.aiLog, ACTIVE_PROFILE_ID),
    ui: makeProfiledKey(SK_BASE.ui, ACTIVE_PROFILE_ID),
    savedBlocks: makeProfiledKey(SK_BASE.savedBlocks, ACTIVE_PROFILE_ID),
    sessionReadiness: makeProfiledKey(SK_BASE.sessionReadiness, ACTIVE_PROFILE_ID),
    pendingTransition: makeProfiledKey(SK_BASE.pendingTransition, ACTIVE_PROFILE_ID)
  };
}

function defaultProfile(){
  return {
    units:'kg',
    
    athleteMode:'recreational',
    transitionWeeks:1,
    transitionProfile:'standard',
snatch:0,
    cleanJerk:0,
    frontSquat:0,
    backSquat:0,
    includeBlocks:true,
    volumePreference:'reduced',
    autoCutEnabled:true,
    aiEnabled:true,
    aiModel:'',
    accessoryDays:[],
    daysPerWeek:3,
    sessionDuration:75
  };
}


// Profile normalization / schema evolution (non-breaking)
function normalizeProfile(prof){
  const base=defaultProfile();
  const p={...base, ...(prof||{})};

  // Athlete profile fields (optional)
  if(p.age===undefined) p.age=null; // number or null
  if(p.trainingAgeYears===undefined) p.trainingAgeYears=1; // years of consistent WL training
  if(p.recoveryCapacity===undefined) p.recoveryCapacity=3; // 1-5
  if(p.macroPeriod===undefined) p.macroPeriod='PP'; // GDP, PP, CC, TP
  if(p.taperStyle===undefined) p.taperStyle='default'; // default | cwfhc
  if(p.heavySingleExposure===undefined) p.heavySingleExposure=false; // opt-in

  // Injury flags (optional)
  if(!p.injuries || typeof p.injuries!=='object'){
    p.injuries={shoulder:false, wrist:false, elbow:false, back:false, hip:false, knee:false, ankle:false};
  } else {
    const d={shoulder:false, wrist:false, elbow:false, back:false, hip:false, knee:false, ankle:false};
    p.injuries={...d, ...p.injuries};
  }

  // Working max layer (Juggernaut-style conservative)
  // workingMaxAuto=true means WM is derived from entered 1RMs (default).
  // If you later add an advanced UI to set WM manually, set workingMaxAuto=false.
  if(p.workingMaxAuto===undefined) p.workingMaxAuto=true;
  if(!p.workingMax || typeof p.workingMax!=='object'){
    p.workingMax={
      snatch: p.snatch? Math.round(p.snatch*0.90):0,
      cleanJerk: p.cleanJerk? Math.round(p.cleanJerk*0.90):0,
      frontSquat: p.frontSquat? Math.round(p.frontSquat*0.90):0,
      backSquat: p.backSquat? Math.round(p.backSquat*0.90):0
    };
  } else {
    const wm=p.workingMax;
    p.workingMax={
      snatch: (wm.snatch||0) || (p.snatch? Math.round(p.snatch*0.90):0),
      cleanJerk: (wm.cleanJerk||0) || (p.cleanJerk? Math.round(p.cleanJerk*0.90):0),
      frontSquat: (wm.frontSquat||0) || (p.frontSquat? Math.round(p.frontSquat*0.90):0),
      backSquat: (wm.backSquat||0) || (p.backSquat? Math.round(p.backSquat*0.90):0)
    };
  }

  // Meet planning (optional)
  if(p.competitionDate===undefined) p.competitionDate=null; // ISO date string or null
  if(p.autoMacroFromMeet===undefined) p.autoMacroFromMeet=false;

  // Weak-point focus (optional)
  if(p.limiter===undefined) p.limiter='balanced';

  // Variant windows / rotation state (stored per block)
  if(!p.variantState || typeof p.variantState!=='object') p.variantState={};

  // Derived flags
  p.isMasters = (typeof p.age==='number' && p.age>=35) ? true : !!p.isMasters;

  return p;
}

function getLiftBaseMax(prof, liftKey){
  const p=normalizeProfile(prof);
  const wm=(p.workingMax && p.workingMax[liftKey]) ? p.workingMax[liftKey] : 0;
  const rm=(p[liftKey]||0);
  return wm>0 ? wm : rm;
}

// Macrocycle multipliers (kept conservative to avoid breaking existing output)
function getMacroMultipliers(prof, periodOverride){
  const p=normalizeProfile(prof);
  const period=String(periodOverride||p.macroPeriod||'PP').toUpperCase();
  if(period==='GDP') return {intensity:0.95, volume:1.10, specificityBias:'general'};
  if(period==='CC')  return {intensity:1.03, volume:0.92, specificityBias:'specific'};
  if(period==='TP')  return {intensity:0.85, volume:0.70, specificityBias:'restore'};
  return {intensity:1.00, volume:1.00, specificityBias:'balanced'}; // PP
}

function getAgeMultipliers(prof){
  const p=normalizeProfile(prof);
  const age=(typeof p.age==='number')?p.age:null;
  const rec=Math.max(1, Math.min(5, parseInt(p.recoveryCapacity,10)||3));
  let intensity=1.0, volume=1.0;
  if(age!==null){
    if(age>=40){ volume*=0.95; }
    if(age>=50){ volume*=0.88; intensity*=0.97; }
    if(age>=60){ volume*=0.78; intensity*=0.94; }
  }
  if(rec<=2) volume*=0.92;
  if(rec>=4) volume*=1.04;
  return {intensity, volume};
}

function getTrainingAgeMultipliers(prof){
  const p=normalizeProfile(prof);
  const ta=Math.max(0, parseFloat(p.trainingAgeYears)||1);
  if(ta<1) return {intensity:0.97, volume:1.05};
  if(ta<3) return {intensity:1.00, volume:1.00};
  return {intensity:1.00, volume:0.98};
}

function getWeeklyStressCap(prof){
  const p=normalizeProfile(prof);
  let cap=120;
  if(p.isMasters) cap=100;
  const ta=Math.max(0, parseFloat(p.trainingAgeYears)||1);
  if(ta<1) cap=110;
  const rec=Math.max(1, Math.min(5, parseInt(p.recoveryCapacity,10)||3));
  if(rec<=2) cap*=0.90;
  if(rec>=4) cap*=1.05;
  return Math.round(cap);
}

function weeksBetween(d1,d2){
  const ms= (d2.getTime()-d1.getTime());
  return ms/ (1000*60*60*24*7);
}

function getMeetDate(prof){
  const p=normalizeProfile(prof);
  if(!p.competitionDate) return null;
  const d=new Date(p.competitionDate);
  if(isNaN(d.getTime())) return null;
  return d;
}

// If autoMacroFromMeet is enabled and a meet date exists, derive the effective macro period for a given week start.
function getEffectiveMacroPeriod(prof, weekStartDate){
  const p=normalizeProfile(prof);
  const meet=getMeetDate(p);
  if(!meet || !p.autoMacroFromMeet) return String(p.macroPeriod||'PP').toUpperCase();
  const w=weeksBetween(weekStartDate, meet); // positive if meet in future
  if(w>12) return 'GDP';
  if(w>8)  return 'PP';
  if(w>2)  return 'CC';
  if(w>=-1 && w<=2) return 'CC'; // include meet + immediate aftermath as CC (taper/meet)
  return 'TP';
}

function isMeetWeek(prof, weekStartDate){
  const meet=getMeetDate(prof);
  if(!meet) return false;
  const end=new Date(weekStartDate); end.setDate(end.getDate()+7);
  return meet>=weekStartDate && meet<end;
}

function isControlTestWeek(prof, weekStartDate){
  const p=normalizeProfile(prof);
  const meet=getMeetDate(p);
  if(!meet) return false;
  const w=Math.round(weeksBetween(weekStartDate, meet));
  // Common checkpoints: ~6 weeks out and ~3 weeks out
  return (w===6 || w===3);
}


function loadProfilesIndex(){
  const idx=getStorage(GLOBAL_KEYS.profilesIndex, null);
  if(idx && Array.isArray(idx.profiles)) return idx;
  const fresh={profiles:[{id:'default', name:'Default', createdAt:Date.now()}]};
  setStorage(GLOBAL_KEYS.profilesIndex, fresh);
  return fresh;
}

function saveProfilesIndex(idx){
  setStorage(GLOBAL_KEYS.profilesIndex, idx);
}

function setActiveProfile(profileId){
  ACTIVE_PROFILE_ID=String(profileId||'default');
  setStorage(GLOBAL_KEYS.activeProfile, ACTIVE_PROFILE_ID);
  refreshSK();
  // Ensure a profile object exists for this profile
  if(!getStorage(SK.profile)){
    const baseProf=getStorage(makeProfiledKey(SK_BASE.profile,'default')) || defaultProfile();
    const cloned={...baseProf};
    setStorage(SK.profile, cloned);
  }
  // Re-render views safely
  try{renderWeekPage();}catch(e){}
  try{renderDashboard();}catch(e){}
  try{renderSettingsPage();}catch(e){}
}

function createProfile(name){
  const idx=loadProfilesIndex();
  const n=String(name||'').trim().slice(0,40);
  if(!n){toast('⚠️ Enter a profile name');return null;}
  const id='p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  idx.profiles.push({id, name:n, createdAt:Date.now()});
  saveProfilesIndex(idx);

  // Start from default settings/maxes as a reasonable baseline
  const baseProf=getStorage(SK.profile) || getStorage(makeProfiledKey(SK_BASE.profile,'default')) || defaultProfile();
  setStorage(makeProfiledKey(SK_BASE.profile,id), {...baseProf});
  setStorage(makeProfiledKey(SK_BASE.block,id), null);
  setStorage(makeProfiledKey(SK_BASE.sessions,id), []);
  setStorage(makeProfiledKey(SK_BASE.sets,id), []);
  return id;
}

function initProfiles(){
  const idx=loadProfilesIndex();
  let active=getStorage(GLOBAL_KEYS.activeProfile, 'default');
  if(!idx.profiles.find(p=>p.id===active)){
    active='default';
    setStorage(GLOBAL_KEYS.activeProfile, active);
  }
  ACTIVE_PROFILE_ID=active;
  refreshSK();

  // Migrate legacy archived blocks (pre-profile builds) into the new per-profile key.
  // This only runs once and only if the new storage is empty.
  try{
    const legacy=getStorage('liftai_block_history_v7',null);
    const current=getStorage(SK.archivedBlocks,[]);
    if(Array.isArray(legacy) && legacy.length>0 && (!Array.isArray(current) || current.length===0)){
      setStorage(SK.archivedBlocks, legacy);
    }
  }catch(e){}
}


// Legacy compatibility: some earlier builds created a block without `generated:true`.
// Treat such blocks as active and opportunistically backfill the flag.
function hasActiveBlock(block){
  return !!(block && (block.generated===true || block.generated===undefined));
}

// Constants for better maintainability
const PULL_MAX_MULTIPLIER = 1.10;
const CONSERVATIVE_ESTIMATE_FACTOR = 0.85;
const MIN_INCREASE_THRESHOLD = 0.03;

// Utility Functions
const $=id=>document.getElementById(id);
function uuid(){return'id_'+Date.now()+'_'+Math.random().toString(36).substr(2,9)}
function toast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function showModal(title,sub,content){$('modalTitle').textContent=title;$('modalSubtitle').textContent=sub||'';$('modalContent').innerHTML=content||'';$('modalOverlay').classList.add('show')}
// Close the generic modal overlay safely (iOS Safari can be finicky with event timing)
function closeModal(){
  try{
    $('modalOverlay')?.classList.remove('show');
  }catch(err){
    console.error('closeModal error:',err);
  }
}

// Setup info helper popups (used by ⓘ buttons on Setup page)
window.showInfo=function(key){
  const map={
    profile:{
      title:'Profiles',
      body:'Profiles are stored on this device/browser only. Switching profiles keeps everyone’s blocks separate.'
    },
    units:{
      title:'Units',
      body:'Choose kilograms or pounds for inputs and display. Working weights are rounded to practical plate jumps.'
    },
    blocklength:{
      title:'Block length',
      body:'Controls how many weeks are generated. Longer blocks ramp volume/intensity more gradually; shorter blocks progress faster.'
    },
    programtype:{
      title:'Program type',
      body:'Adjusts the emphasis of each week: General balances technique + strength, Strength pushes heavier squats/pulls, Hypertrophy adds more volume, Competition tightens specificity, Technique adds more lighter-quality reps.'
    },

    athletedetails:{
      title:'Athlete details',
      body:'Optional inputs used to make the program more individualized and safer. Age/training age/recovery adjust weekly stress and exercise selection. Injury flags bias toward lower-impact variations. Macro period shifts general→specific emphasis.'
    },
    trainingage:{
      title:'Training age',
      body:'How long you’ve trained Olympic weightlifting consistently. Newer lifters usually tolerate higher frequency but need more technical stability; advanced lifters generate more stress per rep and often need more recovery.'
    },
    recovery:{
      title:'Recovery capacity',
      body:'A simple 1–5 slider that scales weekly stress. Low recovery reduces volume and heavy exposures; high recovery allows a bit more work (still conservative).'
    },
    limiter:{
      title:'Primary limiter',
      body:'Biases exercise selection toward what you most need (e.g., Pull selects more pull-strength/positional work; Overhead selects more jerk/overhead stability). Balanced keeps a normal mix.'
    },
    meetplanning:{
      title:'Meet planning',
      body:'If you enter a competition date, the app can auto-derive the macro period (GDP→PP→CC→taper) and schedule control test weeks (~6 and ~3 weeks out).'
    },
    macroperiod:{
      title:'Macro period',
      body:'A season-level focus: GDP = more variety + base work, PP = build strength/technique, CC = more classic-lift specificity, TP = restore/rebuild. “Auto” uses your meet date if set.'
    },
    taper:{
      title:'Taper style',
      body:'This only matters when a meet date is set and you’re in the final week. Default = a gentle deload with a bit of intensity preserved. CWFHC 90/70/50 = 3 sessions before the meet where the *overall session load/volume* is scaled to ~90%, then ~70%, then ~50% of normal—keeping speed and confidence while reducing fatigue.'
    },
    heavysingle:{
      title:'Heavy single exposure',
      body:'Adds a controlled heavy single before back-off work on main lift days (more common in competition-focused plans). Keep Off for newer lifters or when recovering from injury.'
    },
    injuries:{
      title:'Injury',
      body:'Selecting an injury biases the plan away from higher-risk variations and reduces stress where appropriate. “Multiple” reveals checkboxes if you want to specify more than one.'
    },

    
    mode:{
      title:'Athlete mode',
      body:'Recreational prioritizes sustainable progression (more conservative intensity/volume and stronger safety rails). Competition increases specificity and supports a clearer taper/peak, with slightly higher intensity exposure but managed volume.'
    },
    transition:{
      title:'Program switch ramp-in',
      body:'If you start a new program while coming off another block, ramp-in reduces early-week intensity and volume to lower overtraining/injury risk. Week 1 is the biggest reduction, week 2 eases closer to normal.'
    },
blocks:{
      title:'Blocks equipment',
      body:'If you have lifting blocks, the program can include “from blocks” variations. If disabled, those are swapped for hang/alternate variations so the plan still works with minimal equipment.'
    },
    volume:{
      title:'Volume preference',
      body:'Reduced keeps intensity exposure but cuts working sets ~25%. Minimal cuts ~40% and caps main lift work to stay sharp.'
    },
    autocut:{
      title:'Auto-volume regulation',
      body:'When fatigue spikes, the app can suggest cutting the remaining sets for that exercise. Triggers include marking a set Tough/Miss, or logging an RPE ≥ 1 above the target.'
    },
    maindays:{
      title:'Main lifting days',
      body:'These are your primary Olympic-lift sessions (snatch, clean & jerk, and squats). Pick the days you can consistently train with good focus and recovery.'
    },
    accessorydays:{
      title:'Accessory days',
      body:'Optional supplemental strength days (pulls, pressing, extra squats). These cannot overlap with main days; any remaining days default to recovery.'
    },
    duration:{
      title:'Average session duration',
      body:'Used to size your workouts. Shorter durations prioritize the highest‑impact lifts and reduce accessory volume; longer durations add more technique work and accessories when recovery allows.'
    },
    aicoach:{
      title:'AI Coach',
      body:'Enables optional AI-powered help (via your Netlify Function) for things like plan tweaks and explanations. If disabled, the app runs fully offline/local.'
    },
    hfmodel:{
      title:'Hugging Face model',
      body:'Optional override for the model your Netlify Function calls. Leave blank to use the server default (HF_MODEL).'
    },
    aitest:{
      title:'Test AI connection',
      body:'Sends a small request to your Netlify Function to confirm your server-side token and selected model are working.'
    },
    maxes:{
      title:'Current maxes',
      body:'These 1RMs drive your percentage-based working weights. Update them anytime—your future sessions will reflect the changes.'
    }
  };
  const item=map[key]||{title:'Info',body:''};
  // IMPORTANT: Modal already includes a Close button (#modalClose). Do not duplicate it in the content.
  const content=`<div class="help-text" style="margin-top:6px">${item.body}</div>`;
  showModal(item.title,'',content);
};

function getStorage(key,fallback=null){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch(e){console.error('Storage read error:',e);return fallback}}
function setStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch(e){console.error('Storage write error:',e);if(e.name==='QuotaExceededError'){toast('⚠️ Storage full! Clear old data.')}else{toast('⚠️ Storage error: '+e.message)};return false}}
function removeStorage(key){try{localStorage.removeItem(key);return true}catch(e){console.error('Storage remove error:',e);return false}}
function roundTo(val,step){return Math.round(val/step)*step}
function calculateWeight(oneRM,pct,units){const raw=oneRM*pct;return units==='lb'?roundTo(raw,2.5):roundTo(raw,2.5)}
function formatDate(dateStr){try{const d=new Date(dateStr);return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}catch(e){return dateStr}}

// =============================
// AI Programming Assistant (HF via Netlify Function)
// =============================
function safeJsonParse(str){
  try{return{ok:true,value:JSON.parse(str)}}catch(e){return{ok:false,error:e}}
}

function extractFirstJsonObject(text){
  // Robust-ish extraction: find first '{' and attempt to parse the smallest valid JSON object.
  const s=String(text||'');
  const start=s.indexOf('{');
  if(start<0) return null;
  // Try progressively larger slices until JSON parses (cap to avoid runaway)
  const maxLen=Math.min(s.length, start+50000);
  for(let end=start+2; end<=maxLen; end++){
    const slice=s.slice(start,end);
    const parsed=safeJsonParse(slice);
    if(parsed.ok && parsed.value && typeof parsed.value==='object') return parsed.value;
  }
  return null;
}

function buildAiContext(scope){
  const prof=getStorage(SK.profile)||{};
  const block=getStorage(SK.block)||{};
  const sessions=getStorage(SK.sessions,[]);
  const sets=getStorage(SK.sets,[]);

  const includeBlocks=(prof.includeBlocks !== false);

  // Provide compact session summaries (avoid huge payloads)
  const currentWeek=block.currentWeek||1;
  const weekSessions=sessions.filter(s=>s.week===currentWeek).map(s=>({
    id:s.id, week:s.week, day:s.day, focusType:s.focusType, phase:s.phase,
    title:s.title,
    exercises:s.exercises||{}
  }));

  const selectedSessionId = block.selectedSession || null;
  const selectedSession = selectedSessionId ? sessions.find(s=>s.id===selectedSessionId) : null;

  // Candidate exercise lists (names only) for safe swaps
  const candidateExercises={
    snatch:getCandidateNamesForFamily('snatch', prof),
    clean:getCandidateNamesForFamily('clean', prof),
    jerk:getCandidateNamesForFamily('jerk', prof),
    pulls_snatch:getCandidateNamesForFamily('pulls_snatch', prof),
    pulls_clean:getCandidateNamesForFamily('pulls_clean', prof),
    squat:getCandidateNamesForFamily('squat', prof),
    accessory:getCandidateNamesForFamily('accessory', prof)
  };

  return {
    scope,
    profile:{
      units:prof.units||'kg',
      includeBlocks,
      volumePreference:prof.volumePreference||'reduced',
      autoCutEnabled:!!prof.autoCutEnabled,
      daysPerWeek:prof.daysPerWeek||3,
      mainLiftingDays:prof.mainLiftingDays||[],
      accessoryDays:prof.accessoryDays||[],
      sessionDuration:prof.sessionDuration||75
    },
    block:{
      id:block.id||null,
      programType:block.programType||prof.programType||'general',
      blockLength:block.blockLength||prof.blockLength||8,
      currentWeek:currentWeek
    },
    selectedSession: selectedSession ? {
      id:selectedSession.id,
      week:selectedSession.week,
      day:selectedSession.day,
      focusType:selectedSession.focusType,
      phase:selectedSession.phase,
      title:selectedSession.title,
      exercises:selectedSession.exercises||{}
    } : null,
    weekSessions,
    // Provide a small slice of sets for the selected session so the model can reference blockOrder
    selectedSessionSets: selectedSessionId ? sets.filter(x=>x.sessionId===selectedSessionId).slice(0,120).map(x=>({
      id:x.id,
      blockOrder:x.blockOrder,
      setIndex:x.setIndex,
      exercise:x.exercise,
      exerciseType:x.exerciseType,
      targetReps:x.targetReps,
      targetIntensity:x.targetIntensity
    })) : [],
    candidateExercises
  };
}

function summarizePatchForUi(patch){
  try{
    const changes=Array.isArray(patch?.changes)?patch.changes:[];
    if(changes.length===0) return '<div style="color:var(--text-dim)">No changes proposed.</div>';
    const items=changes.slice(0,20).map((c,i)=>{
      const t=escapeHtml(String(c.type||'change'));
      const detail=escapeHtml(JSON.stringify(c));
      return `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-top:10px;background:rgba(255,255,255,.03)">
        <div style="font-weight:800">${i+1}. ${t}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:6px;word-break:break-word">${detail}</div>
      </div>`;
    }).join('');
    return items;
  }catch(e){
    return '<div style="color:var(--danger)">Failed to summarize patch.</div>';
  }
}

function resolveSwapTarget(sessionId, fromExercise){
  const sets=getStorage(SK.sets,[]);
  const sessionSets=sets.filter(s=>s.sessionId===sessionId);
  if(sessionSets.length===0) return null;

  // 1) Try exact match first (fast path)
  const exact=sessionSets.find(s=>String(s.exercise||'')===String(fromExercise||''));
  if(exact) return {blockOrder:exact.blockOrder, exerciseType:exact.exerciseType, exerciseName:exact.exercise};

  // 2) Robust matching (handles aliases like "high hang snatch" vs "Hang Snatch (knee)")
  const normalize=(name)=>String(name||'')
    .toLowerCase()
    .replace(/\(.*?\)/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const inferMovement=(name)=>{
    const n=normalize(name);
    if(n.includes('snatch')) return 'snatch';
    if(n.includes('clean') && n.includes('jerk')) return 'clean_jerk';
    if(n.includes('clean')) return 'clean';
    if(n.includes('jerk')) return 'jerk';
    if(n.includes('squat')) return 'squat';
    if(n.includes('pull')) return 'pull';
    if(n.includes('press')) return 'press';
    return '';
  };

  const fromNorm=normalize(fromExercise);
  const movement=inferMovement(fromExercise);
  const fromTokens=new Set(fromNorm.split(' ').filter(Boolean));

  const candidates = movement
    ? sessionSets.filter(s=>inferMovement(s.exercise)===movement)
    : sessionSets.slice();

  const scoreCandidate=(candName)=>{
    const cNorm=normalize(candName);
    if(!cNorm) return 0;
    if(cNorm===fromNorm) return 100;
    // Substring bonus
    if(cNorm.includes(fromNorm) && fromNorm.length>=4) return 85;
    if(fromNorm.includes(cNorm) && cNorm.length>=4) return 80;

    // Token overlap score
    const cTokens=cNorm.split(' ').filter(Boolean);
    if(cTokens.length===0 || fromTokens.size===0) return 0;
    let inter=0;
    for(const t of cTokens){ if(fromTokens.has(t)) inter++; }
    const union = new Set([...fromTokens, ...cTokens]).size;
    let s = (inter / Math.max(1, union)) * 60;

    // Hang/high-hang specific nudges (common user phrasing)
    const wantsHang = fromNorm.includes('hang');
    const wantsHighHang = fromNorm.includes('high hang');
    const isHang = cNorm.includes('hang');
    const isHighHang = cNorm.includes('high hang');
    if(wantsHighHang && isHighHang) s += 15;
    else if(wantsHang && isHang) s += 10;

    return s;
  };

  let best=null;
  let bestScore=0;
  for(const s of candidates){
    const sc=scoreCandidate(s.exercise);
    if(sc>bestScore){ bestScore=sc; best=s; }
  }

  // Require a minimum similarity so we don't swap the wrong thing.
  if(!best || bestScore < 25) return null;
  return {blockOrder:best.blockOrder, exerciseType:best.exerciseType, exerciseName:best.exercise};
}

function applyProgramPatch(patch){
  const changes=Array.isArray(patch?.changes)?patch.changes:[];
  if(changes.length===0) return {applied:0, errors:[]};
  const prof=getStorage(SK.profile)||{};
  const errors=[];
  let applied=0;
  let needsRegen=false;

  changes.forEach(ch=>{
    try{
      const type=String(ch.type||'').toLowerCase();
      if(type==='set_profile' || type==='update_profile'){
        const field=String(ch.field||'');
        if(!field) throw new Error('Missing field');
        prof[field]=ch.value;
        applied++;
      }
      else if(type==='toggle_blocks'){
        prof.includeBlocks = !!ch.value;
        setStorage(SK.profile, prof);
        applyBlocksPreferenceToPlannedWork(prof);
        applied++;
      }
      else if(type==='adjust_volume_preference'){
        const v=String(ch.value||'').toLowerCase();
        if(!['standard','reduced','minimal'].includes(v)) throw new Error('Invalid volumePreference');
        prof.volumePreference=v;
        applied++;
      }
      else if(type==='set_accessory_days'){
        prof.accessoryDays = Array.isArray(ch.value) ? ch.value : [];
        applied++;
        needsRegen=true;
      }
      else if(type==='remove_accessories'){
        prof.accessoryDays=[];
        applied++;
        needsRegen=true;
      }
      else if(type==='swap_exercise'){
        const sessionId=String(ch.sessionId||'');
        const from=String(ch.fromExercise||ch.fromExerciseName||'');
        const to=String(ch.toExercise||ch.toExerciseName||'');
        if(!sessionId||!from||!to) throw new Error('swap_exercise requires sessionId/fromExercise/toExercise');
        const resolved=resolveSwapTarget(sessionId, from);
        if(!resolved) throw new Error('Could not locate swap target in planned sets');
        const ok=performSwapExercise({
          sessionId,
          blockOrder:resolved.blockOrder,
          // Use the actual exercise string found in planned sets, not the AI/user alias.
          exercise:resolved.exerciseName || from,
          exerciseType:resolved.exerciseType,
          newExercise:to
        });
        if(!ok) throw new Error('performSwapExercise failed');
        applied++;
      }
      else if(type==='regenerate_block'){
        needsRegen=true;
        applied++;
      }
      else{
        throw new Error('Unsupported change type: '+type);
      }
    }catch(err){
      errors.push(String(err.message||err));
    }
  });

  setStorage(SK.profile, prof);

  if(needsRegen){
    // Regenerate block safely using existing generator.
    generateTrainingBlock(prof);
  }else{
    // Ensure block mirrors profile for key fields.
    const block=getStorage(SK.block);
    if(block){
      block.includeBlocks = (prof.includeBlocks !== false);
      block.volumePreference = prof.volumePreference || block.volumePreference;
      block.accessoryDays = prof.accessoryDays || block.accessoryDays;
      setStorage(SK.block, block);
    }
  }

  // Re-render views
  try{renderWeekPage();}catch(e){}
  try{renderDashboard();}catch(e){}
  try{renderSettingsPage();}catch(e){}

  return {applied, errors};
}

// Expand a ProgramPatch to the user-selected scope.
// - scope="session": apply swap_exercise changes only to the current session
// - scope="block": apply swap_exercise changes across all sessions in the block (best-effort)
// Other change types remain block-scoped (profile/block settings).
function expandPatchForScope(patch, scope, currentSessionId){
  const changes=Array.isArray(patch?.changes)?patch.changes:[];
  const out={ changes: [] };

  const sessions=getStorage(SK.sessions,[]);
  const sScope=String(scope||'block').toLowerCase();

  for(const ch of changes){
    const type=String(ch.type||'').toLowerCase();
    if(type!=='swap_exercise'){
      out.changes.push(ch);
      continue;
    }

    const from=String(ch.fromExercise||ch.fromExerciseName||'').trim();
    const to=String(ch.toExercise||ch.toExerciseName||'').trim();
    if(!from || !to){
      out.changes.push(ch);
      continue;
    }

    if(sScope==='session'){
      const sid=currentSessionId || String(ch.sessionId||'');
      if(!sid){
        // Can't apply session-scoped swap without a session id; keep original.
        out.changes.push(ch);
      }else{
        out.changes.push({ ...ch, sessionId: sid, fromExercise: from, toExercise: to });
      }
      continue;
    }

    // Default/block scope: apply best-effort to every session that contains a matching target.
    let appliedToAny=false;
    for(const s of sessions){
      const resolved=resolveSwapTarget(s.id, from);
      if(resolved){
        out.changes.push({ ...ch, sessionId: s.id, fromExercise: from, toExercise: to });
        appliedToAny=true;
      }
    }
    // If nothing matched, keep original so the user sees an error instead of silently dropping it.
    if(!appliedToAny){
      out.changes.push(ch);
    }
  }

  return out;
}

async function requestAiProgramPatch(userMessage, scope){
  const prof=getStorage(SK.profile)||{};
  if(prof.aiEnabled===false){
    throw new Error('AI is disabled in Settings');
  }
  const payload={
    message:String(userMessage||'').trim(),
    context:buildAiContext(scope),
    model:(prof.aiModel||'').trim()||undefined
  };
  const res=await fetch('/.netlify/functions/ai-program',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const data=await res.json().catch(()=>({ok:false,error:'Invalid JSON response'}));
  if(!res.ok || !data?.ok){
    const errMsg=data?.error||('HTTP '+res.status);
    throw new Error(errMsg);
  }
  return data.patch;
}

function openAIProgrammingAssistant(){
  const block=getStorage(SK.block)||{};
  const sessions=getStorage(SK.sessions,[]);
  const hasSession=!!block.selectedSession;
  const currentWeek=block.currentWeek||1;
  const firstWeekSession=sessions.find(s=>s.week===currentWeek)||null;
  // "Current workout" = selected session if the user has one open, otherwise the first session of the current week.
  const currentSessionId = block.selectedSession || (firstWeekSession ? firstWeekSession.id : null);
  const html=`
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="color:var(--text-dim);font-size:13px;line-height:1.45">
        Ask for programming changes (e.g., <b>"reduce volume"</b>, <b>"swap snatch to hang"</b>, <b>"remove accessories"</b>).\n
        The assistant proposes a <b>safe JSON patch</b>; nothing is applied until you confirm.
      </div>

      <div>
        <label>Safety</label>
        <div style="font-size:13px;color:var(--text-dim);padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.03)">
          ✅ Category-safe swaps<br>
          ✅ Respects blocks toggle<br>
          ✅ Validates before apply<br>
          <span style="display:inline-block;margin-top:6px">You’ll choose whether changes apply to <b>Current workout</b> or the <b>Entire block</b> before anything is applied.</span>
        </div>
      </div>

      <div>
        <label>Your request</label>
        <textarea id="aiMessage" style="width:100%;min-height:110px;background:rgba(17,24,39,.8);border:1px solid var(--border);border-radius:10px;padding:12px 14px;color:var(--text);font-size:14px;resize:vertical" placeholder="Example: Reduce main lift volume 30% and remove accessory days."></textarea>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="secondary" id="aiCancel">Cancel</button>
        <button class="success" id="aiSubmit">Enter</button>
      </div>

      <div id="aiResult" style="margin-top:6px"></div>
    </div>
  `;

  showModal('🤖 AI Programming Assistant','Create safe program changes using a Hugging Face model via Netlify.',html);

  const cancelBtn=$('aiCancel');
  const submitBtn=$('aiSubmit');
  const msgEl=$('aiMessage');
  const resultEl=$('aiResult');

  cancelBtn?.addEventListener('click',()=>closeModal());
  submitBtn?.addEventListener('click',async()=>{
    const msg=String(msgEl?.value||'').trim();
    if(!msg){toast('⚠️ Enter a request');return;}
    submitBtn.disabled=true;
    resultEl.innerHTML='<div style="color:var(--text-dim)">Calling model…</div>';
    try{
      // Ask the model about the *current workout* (when available) so proposals are specific.
      // The user will choose final scope (current workout vs entire block) before apply.
      const patch=await requestAiProgramPatch(msg, (currentSessionId ? 'session' : 'block'));
      const summary=summarizePatchForUi(patch);
      resultEl.innerHTML=`
        <div style="margin-top:10px">
          <div style="font-weight:800;margin-bottom:6px">Proposed changes</div>
          ${summary}

          <div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.03)">
            <div style="font-weight:800;margin-bottom:6px">Apply changes to</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--text-dim)">
              <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
                <input type="radio" name="aiApplyScope" value="session" checked ${currentSessionId?'' : 'disabled'}>
                Current workout
              </label>
              <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
                <input type="radio" name="aiApplyScope" value="block">
                Entire block
              </label>
            </div>
            ${currentSessionId ? '' : '<div style="margin-top:6px;font-size:12px;color:var(--warning)">No current workout selected; defaulting to Entire block.</div>'}
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
            <button class="secondary" id="aiReject">Discard</button>
            <button class="success" id="aiApply">Apply changes</button>
          </div>
        </div>
      `;
      $('aiReject')?.addEventListener('click',()=>{resultEl.innerHTML='';});
      $('aiApply')?.addEventListener('click',()=>{
        const scope = (()=>{
          const el=document.querySelector('input[name="aiApplyScope"]:checked');
          const v=el ? String(el.value) : 'block';
          if(v==='session' && !currentSessionId) return 'block';
          return v;
        })();
        const expanded=expandPatchForScope(patch, scope, currentSessionId);
        const out=applyProgramPatch(expanded);
        if(out.errors.length){
          toast('⚠️ Some changes failed');
          resultEl.innerHTML += `<div style="margin-top:10px;color:var(--warning);font-size:12px">Errors: ${escapeHtml(out.errors.join(' | '))}</div>`;
        }else{
          toast('✅ Changes applied');
          closeModal();
        }
      });
    }catch(err){
      console.error('AI patch error:',err);
      resultEl.innerHTML=`<div style="color:var(--danger)">AI request failed: ${escapeHtml(String(err.message||err))}</div>
        <div style="color:var(--text-dim);font-size:12px;margin-top:8px">Make sure you set <b>HUGGINGFACE_API_KEY</b> (or <b>HF_API_TOKEN</b>) in Netlify env vars and redeploy.</div>`;
    }finally{
      submitBtn.disabled=false;
    }
  });
}

// NEW: Volume tracking function
function calculateSessionVolume(sessionId){
  try{
    const sets=getStorage(SK.sets,[]).filter(s=>s.sessionId===sessionId);
    const logs=getStorage(SK.logs,[]);
    
    let totalVolume=0;
    let volumeByType={snatch:0,cleanJerk:0,squat:0,accessory:0,recovery:0};
    let totalReps=0;
    
    sets.forEach(set=>{
      const log=logs.find(l=>l.setId===set.id);
      if(log&&isSuccessfulStatus(log.status)&&log.weight&&log.reps){
        const setVolume=log.weight*log.reps;
        totalVolume+=setVolume;
        totalReps+=log.reps;
        if(volumeByType[set.exerciseType]!==undefined){
          volumeByType[set.exerciseType]+=setVolume;
        }
      }
    });
    
    return{totalVolume,volumeByType,totalReps};
  }catch(err){
    console.error('Volume calculation error:',err);
    return{totalVolume:0,volumeByType:{},totalReps:0};
  }
}

// NEW: Calculate weekly volume
function calculateWeeklyVolume(weekNum){
  try{
    const sessions=getStorage(SK.sessions,[]).filter(s=>s.week===weekNum);
    let weekVolume=0;
    let weekVolumeByType={snatch:0,cleanJerk:0,squat:0,accessory:0,recovery:0};
    
    sessions.forEach(session=>{
      const vol=calculateSessionVolume(session.id);
      weekVolume+=vol.totalVolume;
      Object.keys(vol.volumeByType).forEach(type=>{
        weekVolumeByType[type]=(weekVolumeByType[type]||0)+vol.volumeByType[type];
      });
    });
    
    return{weekVolume,weekVolumeByType};
  }catch(err){
    console.error('Weekly volume error:',err);
    return{weekVolume:0,weekVolumeByType:{}};
  }
}

// NEW: PR Detection and Recording
function detectAndRecordPR(exerciseType,exerciseName,weight,reps,profile){
  try{
    const estimated1RM=reps===1?weight:weight*(1+reps/30);
    let currentMax=0;
    let maxType='';
    
    if(exerciseType==='snatch'){
      currentMax=profile.snatch;
      maxType='snatch';
    }else if(exerciseType==='cleanJerk'){
      currentMax=profile.cleanJerk;
      maxType='cleanJerk';
    }else if(exerciseType==='squat'){
      if(exerciseName.includes('Front')){
        currentMax=profile.frontSquat;
        maxType='frontSquat';
      }else{
        currentMax=profile.backSquat;
        maxType='backSquat';
      }
    }else{
      return{isPR:false};
    }
    
    if(estimated1RM>currentMax){
      const pr={
        id:uuid(),
        date:new Date().toISOString(),
        exercise:exerciseName,
        exerciseType:maxType,
        oldMax:currentMax,
        newMax:Math.round(estimated1RM*2)/2,
        weight:weight,
        reps:reps,
        increase:Math.round((estimated1RM-currentMax)*2)/2,
        percentIncrease:((estimated1RM-currentMax)/currentMax*100).toFixed(1)
      };
      
      // Save to PR history
      const prs=getStorage(SK.prs,[]);
      prs.unshift(pr);
      if(prs.length>50)prs.splice(50); // Keep last 50 PRs
      setStorage(SK.prs,prs);
      
      return{isPR:true,...pr};
    }
    
    return{isPR:false};
  }catch(err){
    console.error('PR detection error:',err);
    return{isPR:false};
  }
}

// NEW: Recovery/Readiness tracking
function logDailyRecovery(sleepHours,sleepQuality,stressLevel,soreness,readiness){
  try{
    const recovery={
      id:uuid(),
      date:new Date().toISOString(),
      sleepHours:sleepHours||7,
      sleepQuality:sleepQuality||3, // 1-5
      stressLevel:stressLevel||3, // 1-5
      soreness:soreness||3, // 1-5
      readiness:readiness||3 // 1-5
    };
    
    const recoveryLog=getStorage(SK.recovery,[]);
    recoveryLog.unshift(recovery);
    if(recoveryLog.length>90)recoveryLog.splice(90); // Keep 90 days
    setStorage(SK.recovery,recoveryLog);
    
    return recovery;
  }catch(err){
    console.error('Recovery log error:',err);
    return null;
  }
}

function getTodaysRecovery(){
  const recoveryLog=getStorage(SK.recovery,[]);
  const today=new Date().toISOString().split('T')[0];
  return recoveryLog.find(r=>r.date.startsWith(today));
}

// NEW: Per-session readiness (so readiness can be logged for each workout)
function getSessionReadiness(sessionId){
  const all=getStorage(SK.sessionReadiness,[]);
  return all.find(r=>r.sessionId===sessionId)||null;
}

function upsertSessionReadiness(entry){
  const all=getStorage(SK.sessionReadiness,[]);
  const idx=all.findIndex(r=>r.sessionId===entry.sessionId);
  if(idx>=0)all[idx]=entry;
  else all.unshift(entry);
  // Keep recent 200 session readiness entries
  if(all.length>200)all.splice(200);
  setStorage(SK.sessionReadiness,all);
}

function clamp(num,min,max){return Math.max(min,Math.min(max,num))}

function readinessMultiplier(score){
  // score is expected 1.0 - 5.0 (float ok)
  if(score<2.5)return{intensity:0.90,weight:0.90,reps:0.85,label:'Low'};
  if(score<3.2)return{intensity:0.95,weight:0.95,reps:0.92,label:'Below'};
  if(score<4.2)return{intensity:1.00,weight:1.00,reps:1.00,label:'Normal'};
  return{intensity:1.02,weight:1.02,reps:1.00,label:'High'};
}

function isSuccessfulStatus(status){return status==='made'||status==='easy'}


function cutRemainingSetsForExercise(sessionId, exerciseName, afterSetIndex){
  try{
    const sets=getStorage(SK.sets,[]).filter(s=>s.sessionId===sessionId && s.exercise===exerciseName);
    const logs=getStorage(SK.logs,[]);
    let changed=false;
    sets.forEach(s=>{
      if(s.setIndex>afterSetIndex){
        let log=logs.find(l=>l.setId===s.id);
        if(!log){
          logs.push({setId:s.id,status:'skip',weight:0,reps:0,rpe:null,ts:new Date().toISOString()});
          changed=true;
        }else if(!log.status || log.status==='none'){
          log.status='skip';
          if(log.weight==null) log.weight=0;
          if(log.reps==null) log.reps=0;
          changed=true;
        }
      }
    });
    if(changed) setStorage(SK.logs,logs);
    return changed;
  }catch(err){
    console.error('Cut remaining sets error:',err);
    return false;
  }
}
// -----------------------------
// Execution Mode (one-set-at-a-time)
// -----------------------------
const execState={
  open:false,
  sessionId:null,
  orderedSetIds:[],
  currentIdx:0
};

function buildExecutionQueue(sessionId){
  const allSets=getStorage(SK.sets,[]).filter(s=>s.sessionId===sessionId);
  // Stable deterministic ordering: blockOrder -> exercise -> setIndex
  allSets.sort((a,b)=>{
    if(a.blockOrder!==b.blockOrder)return a.blockOrder-b.blockOrder;
    const exA=(a.exercise||'').toLowerCase();
    const exB=(b.exercise||'').toLowerCase();
    if(exA<exB)return -1;
    if(exA>exB)return 1;
    return (a.setIndex||0)-(b.setIndex||0);
  });
  return allSets.map(s=>s.id);
}

function getLogForSet(setId){
  const logs=getStorage(SK.logs,[]);
  return logs.find(l=>l.setId===setId)||null;
}

function upsertLogForSet(setId,patch){
  const allSets=getStorage(SK.sets,[]);
  const set=allSets.find(s=>s.id===setId);
  if(!set) return null;
  let logs=getStorage(SK.logs,[]);
  let log=logs.find(l=>l.setId===setId);
  if(!log){
    log={id:uuid(),setId,weight:set.suggestedWeight,reps:set.targetReps,rpe:set.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
    logs.push(log);
  }
  Object.assign(log,patch);
  log.timestamp=new Date().toISOString();
  setStorage(SK.logs,logs);
  return log;
}

function openExecutionMode(sessionId){
  try{
    const sessions=getStorage(SK.sessions,[]);
    const session=sessions.find(s=>s.id===sessionId);
    if(!session){toast('⚠️ Session not found');return;}

    execState.open=true;
    execState.sessionId=sessionId;
    execState.orderedSetIds=buildExecutionQueue(sessionId);

    // Start at first un-successful set if possible
    const logs=getStorage(SK.logs,[]);
    const startIdx=Math.max(0,execState.orderedSetIds.findIndex(id=>{
      const l=logs.find(x=>x.setId===id);
      return !(l && isSuccessfulStatus(l.status));
    }));
    execState.currentIdx=startIdx===-1?0:startIdx;

    // Header
    $('execTitle').textContent=session.title||'Workout';
    $('execSubtitle').textContent=`${formatDate(session.date)} • Phase: ${session.phase||'—'}`;

    $('execOverlay').classList.add('show');
    renderExecutionSet();
  }catch(err){
    console.error('openExecutionMode error:',err);
    toast('⚠️ Unable to start');
  }
}

function closeExecutionMode(){
  execState.open=false;
  execState.sessionId=null;
  execState.orderedSetIds=[];
  execState.currentIdx=0;
  const overlay=$('execOverlay');
  if(overlay) overlay.classList.remove('show');
}

function getCurrentSet(){
  const setId=execState.orderedSetIds[execState.currentIdx];
  if(!setId) return null;
  const allSets=getStorage(SK.sets,[]);
  return allSets.find(s=>s.id===setId)||null;
}

function renderExecutionSet(){
  try{
    if(!execState.open) return;
    const set=getCurrentSet();
    if(!set){
      $('execExercise').textContent='—';
      $('execTarget').textContent='No sets found.';
      return;
    }

    const block=getStorage(SK.block);
    const units=(getStorage(SK.profile)?.units)||block?.units||'kg';
    const log=getLogForSet(set.id);
    const status=log?.status||'none';

    $('execExercise').textContent=set.exercise||'—';
    const intensityDisplay=set.targetIntensity>0?`${Math.round(set.targetIntensity*100)}%`:'BW';
    $('execSetMeta').textContent=`Set ${(set.setIndex??0)+1} • ${set.targetReps}×${intensityDisplay}`;
    $('execProgress').textContent=`${execState.currentIdx+1}/${execState.orderedSetIds.length}`;
    $('execTarget').textContent=`Target: ${set.targetReps} reps • ${intensityDisplay}${set.suggestedWeight?` • Suggested ${set.suggestedWeight}${units}`:''}`;

    // Inputs
    $('execWeight').value=log?.weight ?? set.suggestedWeight ?? '';
    $('execReps').value=log?.reps ?? set.targetReps ?? '';
    $('execRpe').value=log?.rpe ?? set.targetRPE ?? 8;

    // Status buttons active state
    const btns=$('execStatusBtns').querySelectorAll('button');
    btns.forEach(b=>{
      b.classList.remove('active');
      if(b.dataset.status===status) b.classList.add('active');
    });

    // Next preview
    const nextSetId=execState.orderedSetIds[execState.currentIdx+1];
    if(nextSetId){
      const allSets=getStorage(SK.sets,[]);
      const nextSet=allSets.find(s=>s.id===nextSetId);
      if(nextSet){
        const nextLog=getLogForSet(nextSetId);
        const w=(nextLog?.weight ?? nextSet.suggestedWeight);
        const r=(nextLog?.reps ?? nextSet.targetReps);
        $('execNextPreview').textContent=`Next: ${nextSet.exercise} • ${w}${units} × ${r}`;
      }else{
        $('execNextPreview').textContent='Next: —';
      }
    }else{
      $('execNextPreview').textContent='Next: —';
    }

    // Nav buttons
    $('btnExecPrev').disabled=execState.currentIdx<=0;
    $('btnExecNext').disabled=execState.currentIdx>=execState.orderedSetIds.length-1;
  }catch(err){
    console.error('renderExecutionSet error:',err);
  }
}

function execPersistInputs(){
  const set=getCurrentSet();
  if(!set) return;
  const weight=parseFloat($('execWeight').value);
  const reps=parseInt($('execReps').value,10);
  const rpe=parseFloat($('execRpe').value);
  const patch={};
  if(!isNaN(weight)) patch.weight=weight;
  if(!isNaN(reps)) patch.reps=reps;
  if(!isNaN(rpe)) patch.rpe=rpe;
  if(Object.keys(patch).length){
    upsertLogForSet(set.id,patch);
  }
}

function execSetStatus(status){
  const set=getCurrentSet();
  if(!set) return;
  execPersistInputs();
  const existing=getLogForSet(set.id);
  const newStatus=(existing?.status===status)?'none':status;
  upsertLogForSet(set.id,{status:newStatus});

  // Apply autoregulation to remaining sets when a real status is selected
  if(newStatus!=='none'){
    applySetFeedbackImpact(set.id,newStatus);
  }

  // Optional: auto-cut remaining sets for this exercise when fatigue spikes
  if(newStatus!=='none'){
    const prof=getStorage(SK.profile);
    if(prof && prof.autoCutEnabled!==false){
      const log=getLogForSet(set.id);
      const rpeVal=(log && log.rpe!=null && log.rpe!=='')?parseFloat(log.rpe):null;
      const tgt=(set.targetRPE!=null)?Number(set.targetRPE):null;
      const rpeTrigger=(rpeVal!=null && !isNaN(rpeVal) && tgt!=null && !isNaN(tgt) && rpeVal>=tgt+1.0);
      const statusTrigger=(newStatus==='tough'||newStatus==='miss');
      if(statusTrigger || rpeTrigger){
        const ok=confirm('Fatigue spike detected. Cut the remaining sets for this exercise?');
        if(ok){
          const changed=cutRemainingSetsForExercise(execState.sessionId,set.exercise,set.setIndex);
          if(changed){
            toast('✂ Remaining sets skipped');
            renderExecutionSet();
          }
        }
      }
    }
  }

  // Re-render + auto-advance when a final status is chosen
  renderExecutionSet();
  if(newStatus!=='none'){
    // Move to next set, staying within bounds
    if(execState.currentIdx<execState.orderedSetIds.length-1){
      execState.currentIdx++;
      renderExecutionSet();
    }
  }
}

function execPrev(){
  execPersistInputs();
  if(execState.currentIdx>0){
    execState.currentIdx--;
    renderExecutionSet();
  }
}

function execNext(){
  execPersistInputs();
  if(execState.currentIdx<execState.orderedSetIds.length-1){
    execState.currentIdx++;
    renderExecutionSet();
  }
}


function applyReadinessToSession(sessionId,score,opts={}){
  try{
    const block=getStorage(SK.block);
    const prof=getStorage(SK.profile);
    const units=(prof&&prof.units)|| (block&&block.units) || 'kg';
    const mult=readinessMultiplier(score);
    const sets=getStorage(SK.sets,[]);
    const logs=getStorage(SK.logs,[]);
    let changed=false;

    sets.forEach(set=>{
      if(set.sessionId!==sessionId)return;

      // Cache base values the first time we ever apply readiness
      // If opts.resetBase is true, recompute baseline from current suggestedWeight
      if(opts&&opts.resetBase){
        set.baseSuggestedWeight=set.suggestedWeight;
      }else if(set.baseSuggestedWeight==null){
        set.baseSuggestedWeight=set.suggestedWeight;
      }
      if(set.baseTargetIntensity==null)set.baseTargetIntensity=set.targetIntensity;
      if(set.baseTargetReps==null)set.baseTargetReps=set.targetReps;

      // Intensity/weight adjustments (only when intensity-based)
      if(typeof set.baseTargetIntensity==='number' && set.baseTargetIntensity>0){
        set.targetIntensity=clamp(set.baseTargetIntensity*mult.intensity,0.50,1.10);
      }
      if(typeof set.baseSuggestedWeight==='number' && set.baseSuggestedWeight>0){
        set.suggestedWeight=calculateWeight(set.baseSuggestedWeight,mult.weight,units);
      }

      // Volume adjustments (primarily on strength/accessory)
      const isMain=set.blockOrder===1;
      if(!isMain && typeof set.baseTargetReps==='number'){
        const newReps=Math.max(1,Math.round(set.baseTargetReps*mult.reps));
        set.targetReps=newReps;
      }

      set.readinessApplied=true;
      set.readinessScore=score;
      set.readinessMultiplier=mult;
      changed=true;

      // Keep uncommitted logs in sync so the UI reflects changes immediately
      if(opts&&opts.updateUncommittedLogs){
        const log=logs.find(l=>l.setId===set.id);
        if(log && (log.status==='none' || !log.status)){
          log.weight=set.suggestedWeight;
          log.reps=set.targetReps;
          if(log.baseWeight==null)log.baseWeight=log.weight;
          if(log.baseReps==null)log.baseReps=log.reps;
        }
      }
    });

    if(changed){
      setStorage(SK.sets,sets);
      if(opts&&opts.updateUncommittedLogs){
        setStorage(SK.logs,logs);
      }
      return true;
    }
    return false;
  }catch(err){
    console.error('Apply readiness error:',err);
    return false;
  }
}

function getAverageReadiness(days=7){
  try{
    const recoveryLog=getStorage(SK.recovery,[]);
    const recent=recoveryLog.slice(0,days);
    if(recent.length===0)return null;
    
    const avgReadiness=recent.reduce((sum,r)=>sum+r.readiness,0)/recent.length;
    const avgSleep=recent.reduce((sum,r)=>sum+r.sleepHours,0)/recent.length;
    const avgStress=recent.reduce((sum,r)=>sum+r.stressLevel,0)/recent.length;
    const avgSoreness=recent.reduce((sum,r)=>sum+r.soreness,0)/recent.length;
    
    return{avgReadiness,avgSleep,avgStress,avgSoreness,days:recent.length};
  }catch(err){
    console.error('Average readiness error:',err);
    return null;
  }
}

// Readiness Modal State
let readinessState={
  sleepHours:7,
  sleepQuality:3,
  stressLevel:3,
  soreness:3,
  readiness:3,
  pendingSessionId:null
};

function openReadinessModal(sessionId=null){
  readinessState.pendingSessionId=sessionId;

  // Prefer per-session readiness if it exists; otherwise fall back to today's daily values
  const existingSession=sessionId?getSessionReadiness(sessionId):null;
  const today=getTodaysRecovery();

  const seed=existingSession||today||{sleepHours:7,sleepQuality:3,stressLevel:3,soreness:3,readiness:3};
  readinessState={
    sleepHours:seed.sleepHours||7,
    sleepQuality:seed.sleepQuality||3,
    stressLevel:seed.stressLevel||3,
    soreness:seed.soreness||3,
    readiness:seed.readiness||3,
    pendingSessionId:sessionId
  };
  
  // Update UI
  $('sleepSlider').value=readinessState.sleepHours;
  $('sleepValue').textContent=readinessState.sleepHours;
  
  ['sleepQuality','stress','soreness','readiness'].forEach(type=>{
    const scale=$(type==='readiness'?'readinessScale':type+'Scale');
    const val=readinessState[type==='stress'?'stressLevel':type==='readiness'?'readiness':type];
    if(scale){
      scale.querySelectorAll('.readiness-btn').forEach(btn=>{
        btn.classList.toggle('selected',parseInt(btn.dataset.val)===val);
      });
    }
  });
  
  updateReadinessScoreDisplay();
  $('readinessOverlay').classList.add('show');
}

function closeReadinessModal(){
  $('readinessOverlay').classList.remove('show');
  readinessState.pendingSessionId=null;
}

function updateReadinessScoreDisplay(){
  // Calculate weighted score
  // Higher sleep + sleep quality = good, higher stress + soreness = bad
  const sleepScore=Math.min(5,readinessState.sleepHours/2); // 3-10 hours -> 1.5-5
  const qualityScore=readinessState.sleepQuality;
  const stressScore=6-readinessState.stressLevel; // Invert: 1->5, 5->1
  const sorenessScore=6-readinessState.soreness; // Invert
  const manualReadiness=readinessState.readiness;
  
  // Weighted average favoring manual readiness
  const calculatedScore=((sleepScore+qualityScore+stressScore+sorenessScore)/4*0.4+manualReadiness*0.6).toFixed(1);
  
  $('readinessScoreNum').textContent=calculatedScore;
  
  const summary=$('readinessScoreSummary');
  summary.classList.remove('low','med','high');
  
  let hint='';
  if(calculatedScore<2.5){
    summary.classList.add('low');
    hint='Consider lighter weights or recovery work today';
  }else if(calculatedScore>=4){
    summary.classList.add('high');
    hint='Great readiness - push for PRs if programmed!';
  }else{
    summary.classList.add('med');
    hint='Moderate readiness - normal training load';
  }
  $('readinessHint').textContent=hint;
}

function saveReadinessCheck(){
  // Persist daily (for trends) and per-session (for workout-specific adjustments)
  logDailyRecovery(
    readinessState.sleepHours,
    readinessState.sleepQuality,
    readinessState.stressLevel,
    readinessState.soreness,
    readinessState.readiness
  );

  const calculatedScore=parseFloat($('readinessScoreNum')?.textContent||'0')||0;
  const sessionId=readinessState.pendingSessionId;
  if(sessionId){
    upsertSessionReadiness({
      id:uuid(),
      sessionId,
      date:new Date().toISOString(),
      sleepHours:readinessState.sleepHours,
      sleepQuality:readinessState.sleepQuality,
      stressLevel:readinessState.stressLevel,
      soreness:readinessState.soreness,
      readiness:readinessState.readiness,
      calculatedScore
    });

    // Adjust this workout immediately based on readiness
    applyReadinessToSession(sessionId,calculatedScore);
  }

  toast(sessionId?'✅ Readiness logged + workout adjusted':'✅ Readiness logged');
  closeReadinessModal();

  // Re-render whichever tab is visible
  renderDashboard();
  renderWeekPage();
}

function initReadinessModal(){
  // Sleep slider
  const sleepSlider=$('sleepSlider');
  if(sleepSlider){
    sleepSlider.addEventListener('input',function(){
      readinessState.sleepHours=parseFloat(this.value);
      $('sleepValue').textContent=this.value;
      updateReadinessScoreDisplay();
    });
  }
  
  // Scale buttons
  ['sleepQualityScale','stressScale','sorenessScale','readinessScale'].forEach(scaleId=>{
    const scale=$(scaleId);
    if(scale){
      scale.addEventListener('click',function(e){
        const btn=e.target.closest('.readiness-btn');
        if(!btn)return;
        
        const val=parseInt(btn.dataset.val);
        scale.querySelectorAll('.readiness-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        
        // Update state
        if(scaleId==='sleepQualityScale'){
          readinessState.sleepQuality=val;
          $('sleepQualityValue').textContent=val;
        }else if(scaleId==='stressScale'){
          readinessState.stressLevel=val;
          $('stressValue').textContent=val;
        }else if(scaleId==='sorenessScale'){
          readinessState.soreness=val;
          $('sorenessValue').textContent=val;
        }else if(scaleId==='readinessScale'){
          readinessState.readiness=val;
          $('readinessValueDisplay').textContent=val;
        }
        
        updateReadinessScoreDisplay();
      });
    }
  });
  
  // Close on overlay click
  const overlay=$('readinessOverlay');
  if(overlay){
    overlay.addEventListener('click',function(e){
      if(e.target===this)closeReadinessModal();
    });
  }
}

// NEW: Injury tracking
function addInjury(bodyPart,severity,restrictedExercises,notes){
  try{
    const injury={
      id:uuid(),
      bodyPart:bodyPart,
      severity:severity, // mild, moderate, severe
      date:new Date().toISOString(),
      restrictedExercises:restrictedExercises||[],
      status:'active',
      notes:notes||''
    };
    
    const injuries=getStorage(SK.injuries,[]);
    injuries.unshift(injury);
    setStorage(SK.injuries,injuries);
    
    toast(`📋 Injury logged: ${bodyPart}`);
    return injury;
  }catch(err){
    console.error('Add injury error:',err);
    return null;
  }
}

function getActiveInjuries(){
  return getStorage(SK.injuries,[]).filter(i=>i.status==='active');
}

function markInjuryHealed(injuryId){
  try{
    const injuries=getStorage(SK.injuries,[]);
    const injury=injuries.find(i=>i.id===injuryId);
    if(injury){
      injury.status='healed';
      injury.healedDate=new Date().toISOString();
      setStorage(SK.injuries,injuries);
      toast(`✅ ${injury.bodyPart} marked as healed`);
      return true;
    }
    return false;
  }catch(err){
    console.error('Mark healed error:',err);
    return false;
  }
}

// NEW: Check if deload is needed based on fatigue indicators
function checkDeloadNeed(){
  try{
    const recentRecovery=getAverageReadiness(7);
    if(!recentRecovery)return{needsDeload:false,reason:'No recovery data'};
    
    const recentSessions=getStorage(SK.sessions,[])
      .filter(s=>s.status==='completed')
      .sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt))
      .slice(0,5);
    
    if(recentSessions.length<3)return{needsDeload:false,reason:'Insufficient data'};
    
    // Calculate miss rate and average RPE
    let totalSets=0;
    let missedSets=0;
    let totalRPE=0;
    let rpeCount=0;
    
    const logs=getStorage(SK.logs,[]);
    recentSessions.forEach(session=>{
      const sessionSets=getStorage(SK.sets,[]).filter(s=>s.sessionId===session.id);
      sessionSets.forEach(set=>{
        const log=logs.find(l=>l.setId===set.id);
        if(log){
          totalSets++;
          if(log.status==='missed')missedSets++;
          if(log.rpe){
            totalRPE+=log.rpe;
            rpeCount++;
          }
        }
      });
    });
    
    const missRate=totalSets>0?missedSets/totalSets:0;
    const avgRPE=rpeCount>0?totalRPE/rpeCount:0;
    
    // Fatigue indicators
    const indicators={
      highRPE:avgRPE>=9.0,
      frequentMisses:missRate>=0.15,
      poorSleep:recentRecovery.avgSleep<6,
      highStress:recentRecovery.avgStress>=4,
      lowReadiness:recentRecovery.avgReadiness<2.5
    };
    
    const flagCount=Object.values(indicators).filter(v=>v).length;
    
    if(flagCount>=3){
      return{
        needsDeload:true,
        reason:'Multiple fatigue indicators detected',
        indicators:indicators,
        suggestion:'Consider adding a deload week or reducing volume/intensity',
        details:`RPE: ${avgRPE.toFixed(1)}, Miss Rate: ${(missRate*100).toFixed(0)}%, Sleep: ${recentRecovery.avgSleep.toFixed(1)}h, Readiness: ${recentRecovery.avgReadiness.toFixed(1)}/5`
      };
    }
    
    return{needsDeload:false,indicators:indicators};
  }catch(err){
    console.error('Deload check error:',err);
    return{needsDeload:false,reason:'Error checking'};
  }
}

// NEW: Export training data
function exportTrainingData(){
  try{
    const data={
      version:VERSION,
      exportDate:new Date().toISOString(),
      profile:getStorage(SK.profile),
      block:getStorage(SK.block),
      sessions:getStorage(SK.sessions,[]),
      sets:getStorage(SK.sets,[]),
      logs:getStorage(SK.logs,[]),
      history:getStorage(SK.archivedBlocks,[]),
      prs:getStorage(SK.prs,[]),
      recovery:getStorage(SK.recovery,[]),
      injuries:getStorage(SK.injuries,[])
    };
    
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`liftai_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast('📥 Data exported successfully');
    return true;
  }catch(err){
    console.error('Export error:',err);
    toast('⚠️ Export failed: '+err.message);
    return false;
  }
}

// Recalculate programming weights when maxes change.
// IMPORTANT: Also sync any "uncommitted" logs (status==='none') so the UI updates immediately,
// including the current day if the user already opened execution mode / created logs.
/**
 * Resolve an appropriate 1RM for a set, even for legacy blocks where exerciseType may be missing.
 * Returns { maxToUse, effectiveMax } where effectiveMax accounts for pulls.
 */
function resolveEffectiveMaxForSet(set,prof){
  try{
    const name=String(set?.exercise||'').toLowerCase();
    const exType=String(set?.exerciseType||'').toLowerCase();
    let base=0;

    const isSnatch = exType==='snatch' || name.includes('snatch');
    const isCJ = exType==='cleanjerk' || exType==='clean_jerk' || exType==='clean&jerk' || name.includes('clean') || name.includes('jerk');
    const isFrontSquat = exType==='squat_front' || name.includes('front squat');
    const isBackSquat = exType==='squat_back' || name.includes('back squat') || (name.includes('squat') && !name.includes('front squat'));

    if(isSnatch) base=prof?.snatch||0;
    else if(isCJ) base=prof?.cleanJerk||0;
    else if(isFrontSquat) base=prof?.frontSquat||0;
    else if(isBackSquat) base=prof?.backSquat||0;
    else if(exType==='squat') base=(name.includes('front')? (prof?.frontSquat||0):(prof?.backSquat||0));
    else if(exType==='accessory') base=(name.includes('front')? (prof?.frontSquat||0):(prof?.backSquat||0));

    // Pulls use a slightly higher effective max based on the related classic lift.
    let effective=base;
    if(name.includes('pull')){
      const liftMax = name.includes('snatch') ? (prof?.snatch||0) : (prof?.cleanJerk||0);
      if(liftMax>0) effective=liftMax*PULL_MAX_MULTIPLIER;
    }

    return {maxToUse:base||0, effectiveMax:effective||0};
  }catch(err){
    return {maxToUse:0, effectiveMax:0};
  }
}


function recalculateProgrammingForNewMaxes(newProf,{syncUncommittedLogs=true}={}){
  // Recompute ALL planned (non-completed) set suggestions from the latest maxes.
  // This is intentionally "strong" because users expect max changes to immediately
  // repopulate the current day and all future work.
  try{
    const prof=newProf || getStorage(SK.profile) || {};
    const sessions=getStorage(SK.sessions,[]);
    const sets=getStorage(SK.sets,[]);
    const logs=getStorage(SK.logs,[]);
    if(!sessions.length || !sets.length) return {updated:0, updatedLogs:0};

    const plannedSessionIds=new Set(
      sessions
        .filter(s=>!s || s.status!=='completed')
        .map(s=>s.id)
    );
    if(plannedSessionIds.size===0) return {updated:0, updatedLogs:0};

    // If a session has readiness recorded, we'll re-apply it after resetting baselines.
    const readinessBySession=new Map();
    const readinessStore=getStorage(SK.sessionReadiness,{});
    if(readinessStore && typeof readinessStore==='object'){
      Object.keys(readinessStore).forEach(k=>{
        const v=readinessStore[k];
        if(v && typeof v.score==='number') readinessBySession.set(k, v.score);
        else if(typeof v === 'number') readinessBySession.set(k, v);
      });
    }

    const units = prof.units || (getStorage(SK.block)||{}).units || 'kg';

    // Helper to determine which max to use for a set (robust to older data).
    const inferMaxKey=(set)=>{
      const name=String(set?.exercise||'').toLowerCase();
      const exType=String(set?.exerciseType||'').toLowerCase();

      // Prefer explicit exerciseType when it matches our known buckets.
      if(exType==='snatch') return 'snatch';
      if(exType==='cleanjerk' || exType==='clean_jerk') return 'cleanJerk';
      if(exType==='squat_front') return 'frontSquat';
      if(exType==='squat_back') return 'backSquat';

      // Common older variants / name inference
      if(name.includes('snatch')) return 'snatch';
      if(name.includes('clean') || name.includes('jerk')) return 'cleanJerk';
      if(name.includes('front squat')) return 'frontSquat';
      if(name.includes('back squat')) return 'backSquat';
      if(name.includes('squat')) return name.includes('front') ? 'frontSquat' : 'backSquat';

      // Accessories: default to back squat if % based (matches prior behavior)
      if(exType==='accessory' || exType==='strength' || exType==='squat') return 'backSquat';
      return null;
    };

    const calcSuggestedWeight=(set)=>{
      const pct = (typeof set?.baseTargetIntensity==='number' && set.baseTargetIntensity>0)
        ? set.baseTargetIntensity
        : set.targetIntensity;

      // If pct isn't usable, don't overwrite.
      if(!(typeof pct==='number') || pct<=0) return null;

      const maxKey=inferMaxKey(set);
      let baseMax = maxKey ? (Number(prof[maxKey])||0) : 0;

      // Pulls use classic-lift max * multiplier (if available)
      const name=String(set?.exercise||'').toLowerCase();
      let effectiveMax=baseMax;
      if(name.includes('pull')){
        const liftKey = name.includes('snatch') ? 'snatch' : 'cleanJerk';
        const liftMax = Number(prof[liftKey])||0;
        if(liftMax>0) effectiveMax = liftMax * PULL_MAX_MULTIPLIER;
      }

      if(effectiveMax<=0) return null;
      return calculateWeight(effectiveMax, pct, units);
    };

    let updated=0;
    const nextSets=sets.map(set=>{
      if(!set || !plannedSessionIds.has(set.sessionId)) return set;

      const w = calcSuggestedWeight(set);
      if(w==null) return set;

      // Reset baseline reps/intensity for consistency after a max update.
      const baseIntensity=(typeof set.baseTargetIntensity==='number' && set.baseTargetIntensity>0)
        ? set.baseTargetIntensity
        : set.targetIntensity;
      const baseReps=(typeof set.baseTargetReps==='number')
        ? set.baseTargetReps
        : set.targetReps;

      const changed = (set.suggestedWeight!==w) || (set.baseSuggestedWeight!=null && set.baseSuggestedWeight!==w);
      if(!changed && set.targetIntensity===baseIntensity && set.targetReps===baseReps) return set;

      updated++;
      return {
        ...set,
        targetIntensity: baseIntensity,
        targetReps: baseReps,
        baseSuggestedWeight: w,
        suggestedWeight: w
      };
    });

    // Persist sets first
    if(updated>0){
      const ok=setStorage(SK.sets,nextSets);
      if(!ok) throw new Error('Failed to save updated sets');
    }

    // Re-apply readiness per session after baselines updated.
    readinessBySession.forEach((score, sessionId)=>{
      if(!plannedSessionIds.has(sessionId)) return;
      applyReadinessToSession(sessionId, score, {resetBase:true, updateUncommittedLogs:syncUncommittedLogs});
    });

    // Sync logs so the UI changes immediately.
    let updatedLogs=0;
    if(syncUncommittedLogs){
      const latestSets=getStorage(SK.sets,[]);
      const byId=new Map(latestSets.map(s=>[s.id,s]));
      for(const log of logs){
        if(!log || !log.setId) continue;
        // Only rewrite logs that are not "committed" (no final status)
        if(log.status && log.status!=='none') continue;
        const set=byId.get(log.setId);
        if(!set || !plannedSessionIds.has(set.sessionId)) continue;
        let changed=false;
        if(typeof set.suggestedWeight==='number' && set.suggestedWeight>0 && log.weight!==set.suggestedWeight){
          log.weight=set.suggestedWeight; changed=true;
        }
        if(typeof set.targetReps==='number' && log.reps!==set.targetReps){
          log.reps=set.targetReps; changed=true;
        }
        if(typeof set.targetRPE==='number' && log.rpe!==set.targetRPE){
          log.rpe=set.targetRPE; changed=true;
        }
        if(changed){
          updatedLogs++;
          log.timestamp=new Date().toISOString();
          if(log.baseWeight==null) log.baseWeight=log.weight;
          if(log.baseReps==null) log.baseReps=log.reps;
        }
      }
      if(updatedLogs>0){
        setStorage(SK.logs,logs);
      }
    }

    return {updated, updatedLogs};
  }catch(err){
    console.error('Recalculation error:',err);
    throw err;
  }
}


// Backwards-compatible wrapper (older callers)
function recalculateFutureSessions(newMaxes){
  return recalculateProgrammingForNewMaxes(newMaxes,{syncUncommittedLogs:true});
}

// ENHANCED: Analyze performance with volume, RPE, and recommendations
function analyzePerformance(sessionId){
  try{
    const sets=getStorage(SK.sets,[]).filter(s=>s.sessionId===sessionId);
    const logs=getStorage(SK.logs,[]);
    const block=getStorage(SK.block);
    const profile=getStorage(SK.profile);
    
    if(!sets.length||!profile)return null;
    
    const analysis={snatch:null,cleanJerk:null,frontSquat:null,backSquat:null};
    
    // NEW: Additional metrics
    let totalRPE=0;
    let rpeCount=0;
    let missedCount=0;
    let madeCount=0;
    
    sets.forEach(set=>{
      const log=logs.find(l=>l.setId===set.id);
      if(!log)return;
      
      // Track RPE and misses
      if(log.rpe){
        totalRPE+=log.rpe;
        rpeCount++;
      }
      if(log.status==='missed')missedCount++;
      if(isSuccessfulStatus(log.status))madeCount++;
      
      // Original max detection logic
      if(log.status!=='made'||!log.weight||!log.reps||log.rpe>=9.5)return;
      
      const estimated1RM=log.reps===1?log.weight:log.weight*(1+log.reps/30);
      
      let maxKey=null;
      let currentMax=0;
      
      if(set.exerciseType==='snatch'){
        maxKey='snatch';
        currentMax=profile.snatch;
      }else if(set.exerciseType==='cleanJerk'){
        maxKey='cleanJerk';
        currentMax=profile.cleanJerk;
      }else if(set.exerciseType==='squat'){
        if(set.exercise.includes('Front')){
          maxKey='frontSquat';
          currentMax=profile.frontSquat;
        }else{
          maxKey='backSquat';
          currentMax=profile.backSquat;
        }
      }
      
      if(maxKey&&currentMax>0){
        const percentIncrease=(estimated1RM-currentMax)/currentMax;
        if(percentIncrease>MIN_INCREASE_THRESHOLD){
          const conservativeEstimate=currentMax+(estimated1RM-currentMax)*CONSERVATIVE_ESTIMATE_FACTOR;
          const rounded=profile.units==='lb'?Math.round(conservativeEstimate):Math.round(conservativeEstimate*2)/2;
          
          if(!analysis[maxKey]||rounded>analysis[maxKey]){
            analysis[maxKey]=rounded;
          }
        }
      }
    });
    
    // NEW: Add metrics to analysis
    const avgRPE=rpeCount>0?totalRPE/rpeCount:null;
    const missRate=missedCount+madeCount>0?missedCount/(missedCount+madeCount):0;
    const volume=calculateSessionVolume(sessionId);
    const recommendations=generateRecommendations(avgRPE,missRate);
    
    analysis.metrics={
      avgRPE:avgRPE,
      missRate:missRate,
      volume:volume.totalVolume,
      volumeByType:volume.volumeByType,
      recommendations:recommendations
    };
    
    return analysis;
  }catch(err){
    console.error('Performance analysis error:',err);
    return null;
  }
}

// NEW: Generate training recommendations based on session data
function generateRecommendations(avgRPE,missRate){
  const recs=[];
  
  if(avgRPE&&avgRPE>=9.0){
    recs.push('⚠️ RPE very high - consider reducing intensity next session');
  }
  
  if(missRate>=0.15){
    recs.push('⚠️ High miss rate - review technique or reduce load');
  }
  
  if(avgRPE&&avgRPE<=7.0&&missRate<0.05){
    recs.push('✅ Good session - technique looked solid, consider small increase');
  }
  
  if(missRate>=0.25){
    recs.push('🔴 Critical: Too many misses - reduce weight by 5-10% next time');
  }
  
  return recs;
}

// Apply performance-based adjustments to next week

function updateWorkingMaxFromAnalysis(analysis){
  try{
    const profile=getStorage(SK.profile);
    if(!profile || !analysis) return {updated:false};
    const p=normalizeProfile(profile);
    const wm={...p.workingMax};
    // Use conservative updates: move 20% toward 90% of estimated true max
    const smooth=0.20;
    const unit=p.units||'kg';
    const updates=[];
    const apply=(key, estTrueMax)=>{
      if(!estTrueMax || !isFinite(estTrueMax) || estTrueMax<=0) return;
      const target=estTrueMax*0.90;
      const cur=wm[key]||0;
      const next=(cur>0) ? (cur*(1-smooth) + target*smooth) : target;
      wm[key]=roundToIncrement(next, p.units);
      updates.push(`${key}: ${wm[key]}${unit}`);
    };
    apply('snatch', analysis.snatch);
    apply('cleanJerk', analysis.cleanJerk);
    apply('frontSquat', analysis.frontSquat);
    apply('backSquat', analysis.backSquat);
    if(updates.length){
      p.workingMax=wm;
      p.lastWorkingMaxUpdate=new Date().toISOString();
      setStorage(SK.profile, p);
      return {updated:true, updates};
    }
    return {updated:false};
  }catch(e){ return {updated:false, error:e.message}; }
}
function applyPerformanceAdjustments(completedSessionId){
  try{
    const sessions=getStorage(SK.sessions,[]);
    const completedSession=sessions.find(s=>s.id===completedSessionId);
    if(!completedSession)return{applied:false};
    
    const analysis=analyzePerformance(completedSessionId);
    if(!analysis)return{applied:false};
    
    const hasAdjustments=Object.values(analysis).some(v=>v!==null);
    if(!hasAdjustments)return{applied:false};
    
    const nextWeek=completedSession.week+1;
    const futureSessions=sessions.filter(s=>s.week>=nextWeek&&s.status==='planned');
    
    if(futureSessions.length===0)return{applied:false,reason:'No future sessions'};
    
    const sets=getStorage(SK.sets,[]);
    const futureSessionIds=new Set(futureSessions.map(s=>s.id));
    let adjustedCount=0;
    
    const updatedSets=sets.map(set=>{
      if(!futureSessionIds.has(set.sessionId))return set;
      
      let adjustedMax=null;
      if(set.exerciseType==='snatch'&&analysis.snatch){
        adjustedMax=analysis.snatch;
      }else if(set.exerciseType==='cleanJerk'&&analysis.cleanJerk){
        adjustedMax=analysis.cleanJerk;
      }else if(set.exerciseType==='squat'){
        if(set.exercise.includes('Front')&&analysis.frontSquat){
          adjustedMax=analysis.frontSquat;
        }else if(!set.exercise.includes('Front')&&analysis.backSquat){
          adjustedMax=analysis.backSquat;
        }
      }
      
      if(adjustedMax){
        const profile=getStorage(SK.profile);
        let effectiveMax=adjustedMax;
        if(set.exercise.includes('Pull')){
          const liftMax=set.exercise.includes('Snatch')?analysis.snatch||profile.snatch:analysis.cleanJerk||profile.cleanJerk;
          effectiveMax=liftMax*PULL_MAX_MULTIPLIER;
        }
        
        const newWeight=calculateWeight(effectiveMax,set.targetIntensity,profile.units);
        if(newWeight!==set.suggestedWeight){
          adjustedCount++;
          return{...set,suggestedWeight:newWeight};
        }
      }
      
      return set;
    });
    
    if(adjustedCount>0){
      const success=setStorage(SK.sets,updatedSets);
      if(!success)throw new Error('Failed to apply adjustments');

      const wmUpdate=updateWorkingMaxFromAnalysis(analysis);
      const profile=getStorage(SK.profile);
      const unit=profile?.units||'kg';
      const increases=[];
      if(analysis.snatch)increases.push(`Snatch: ${analysis.snatch}${unit}`);
      if(analysis.cleanJerk)increases.push(`C&J: ${analysis.cleanJerk}${unit}`);
      if(analysis.frontSquat)increases.push(`FS: ${analysis.frontSquat}${unit}`);
      if(analysis.backSquat)increases.push(`BS: ${analysis.backSquat}${unit}`);
      
      return{applied:true,adjustedCount,increases,analysis};
    }
    
    return{applied:false};
  }catch(err){
    console.error('Adjustment application error:',err);
    return{applied:false,error:err.message};
  }
}


// =====================================================
// ENHANCED EXERCISE DATABASE (Based on PDF Blueprint)
// =====================================================

const EXERCISE_DATABASE = {
  snatch: {
    classic: [
      { name: 'Snatch', specificityScore: 1.0, fatigueScore: 4, bestPhases: ['intensification', 'peak'], variationType: ['classic'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.75, 0.90], peak: [0.80, 0.95], deload: [0.50, 0.70] } }
    ],
    power: [
      { name: 'Power Snatch', specificityScore: 0.85, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['power'], intensityRange: { accumulation: [0.60, 0.75], intensification: [0.65, 0.85], peak: [0.70, 0.80], deload: [0.55, 0.70] } },
      { name: 'Hang Power Snatch', specificityScore: 0.75, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['power', 'hang'], intensityRange: { accumulation: [0.55, 0.70], intensification: [0.60, 0.75], peak: [0.60, 0.70], deload: [0.50, 0.65] } }
    ],
    hang: [
      { name: 'Hang Snatch (knee)', specificityScore: 0.80, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['hang'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.65, 0.80], peak: [0.60, 0.75], deload: [0.55, 0.70] } },
      { name: 'High Hang Snatch', specificityScore: 0.70, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['hang', 'high_hang'], intensityRange: { accumulation: [0.55, 0.75], intensification: [0.60, 0.75], peak: [0.55, 0.70], deload: [0.50, 0.65] } },
      { name: 'Hang Snatch (mid-thigh)', specificityScore: 0.78, fatigueScore: 3, bestPhases: ['accumulation'], variationType: ['hang'], intensityRange: { accumulation: [0.58, 0.78], intensification: [0.62, 0.78], peak: [0.58, 0.72], deload: [0.52, 0.68] } }
    ],
    blocks: [
      { name: 'Snatch from Blocks', specificityScore: 0.75, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['blocks'], intensityRange: { accumulation: [0.65, 0.85], intensification: [0.70, 0.90], peak: [0.70, 0.85], deload: [0.60, 0.75] } },
      { name: 'Block Power Snatch', specificityScore: 0.70, fatigueScore: 2, bestPhases: ['accumulation'], variationType: ['blocks', 'power'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.65, 0.82], peak: [0.65, 0.78], deload: [0.55, 0.70] } }
    ],
    pause: [
      { name: 'Pause Snatch (knee)', specificityScore: 0.75, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['pause'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.65, 0.80], peak: [0.60, 0.75], deload: [0.55, 0.70] } },
      { name: 'Tempo Snatch', specificityScore: 0.65, fatigueScore: 2, bestPhases: ['accumulation', 'technique', 'deload'], variationType: ['tempo'], intensityRange: { accumulation: [0.55, 0.72], intensification: [0.58, 0.72], peak: [0.55, 0.68], deload: [0.50, 0.65] } }
    ],
    receiving: [
      { name: 'Snatch Balance', specificityScore: 0.70, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['receiving'], intensityRange: { accumulation: [0.60, 0.85], intensification: [0.70, 0.90], peak: [0.65, 0.85], deload: [0.55, 0.75] } },
      { name: 'Heaving Snatch Balance', specificityScore: 0.65, fatigueScore: 2, bestPhases: ['accumulation'], variationType: ['receiving'], intensityRange: { accumulation: [0.70, 1.00], intensification: [0.75, 0.95], peak: [0.70, 0.90], deload: [0.60, 0.80] } },
      { name: 'Overhead Squat', specificityScore: 0.60, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['receiving'], intensityRange: { accumulation: [0.60, 0.85], intensification: [0.65, 0.85], peak: [0.60, 0.80], deload: [0.55, 0.75] } }
    ],
    turnover: [
      { name: 'Muscle Snatch', specificityScore: 0.50, fatigueScore: 1, bestPhases: ['accumulation', 'technique', 'deload'], variationType: ['turnover'], intensityRange: { accumulation: [0.30, 0.55], intensification: [0.35, 0.50], peak: [0.30, 0.45], deload: [0.25, 0.40] } },
      { name: 'Snatch High Pull', specificityScore: 0.55, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['turnover'], intensityRange: { accumulation: [0.70, 0.90], intensification: [0.75, 0.95], peak: [0.70, 0.85], deload: [0.60, 0.80] } }
    ]
  },
  clean: {
    classic: [
      { name: 'Clean', specificityScore: 0.95, fatigueScore: 4, bestPhases: ['intensification', 'peak'], variationType: ['classic'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.75, 0.90], peak: [0.80, 0.95], deload: [0.50, 0.70] } },
      { name: 'Clean & Jerk', specificityScore: 1.0, fatigueScore: 5, bestPhases: ['intensification', 'peak'], variationType: ['classic'], intensityRange: { accumulation: [0.60, 0.78], intensification: [0.75, 0.90], peak: [0.80, 0.95], deload: [0.50, 0.68] } }
    ],
    power: [
      { name: 'Power Clean', specificityScore: 0.85, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['power'], intensityRange: { accumulation: [0.60, 0.75], intensification: [0.65, 0.85], peak: [0.70, 0.80], deload: [0.55, 0.70] } },
      { name: 'Hang Power Clean', specificityScore: 0.75, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['power', 'hang'], intensityRange: { accumulation: [0.55, 0.70], intensification: [0.60, 0.75], peak: [0.60, 0.70], deload: [0.50, 0.65] } },
      { name: 'Power Clean + Power Jerk', specificityScore: 0.80, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['power'], intensityRange: { accumulation: [0.55, 0.72], intensification: [0.60, 0.78], peak: [0.62, 0.75], deload: [0.50, 0.65] } }
    ],
    hang: [
      { name: 'Hang Clean (knee)', specificityScore: 0.80, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['hang'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.65, 0.80], peak: [0.60, 0.75], deload: [0.55, 0.70] } },
      { name: 'High Hang Clean', specificityScore: 0.70, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['hang', 'high_hang'], intensityRange: { accumulation: [0.55, 0.75], intensification: [0.60, 0.75], peak: [0.55, 0.70], deload: [0.50, 0.65] } },
      { name: 'Hang Clean (mid-thigh)', specificityScore: 0.78, fatigueScore: 3, bestPhases: ['accumulation'], variationType: ['hang'], intensityRange: { accumulation: [0.58, 0.78], intensification: [0.62, 0.78], peak: [0.58, 0.72], deload: [0.52, 0.68] } }
    ],
    blocks: [
      { name: 'Clean from Blocks', specificityScore: 0.75, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['blocks'], intensityRange: { accumulation: [0.65, 0.85], intensification: [0.70, 0.90], peak: [0.70, 0.85], deload: [0.60, 0.75] } }
    ],
    pause: [
      { name: 'Pause Clean (knee)', specificityScore: 0.75, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['pause'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.65, 0.80], peak: [0.60, 0.75], deload: [0.55, 0.70] } }
    ],
    receiving: [
      { name: 'Clean Recovery', specificityScore: 0.65, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['receiving'], intensityRange: { accumulation: [0.80, 1.05], intensification: [0.85, 1.10], peak: [0.80, 1.00], deload: [0.70, 0.90] } },
      { name: 'Tall Clean', specificityScore: 0.50, fatigueScore: 1, bestPhases: ['accumulation', 'technique', 'deload'], variationType: ['turnover'], intensityRange: { accumulation: [0.30, 0.55], intensification: [0.35, 0.55], peak: [0.30, 0.50], deload: [0.25, 0.45] } }
    ]
  },
  jerk: {
    classic: [
      { name: 'Split Jerk', specificityScore: 0.95, fatigueScore: 3, bestPhases: ['intensification', 'peak'], variationType: ['classic'], intensityRange: { accumulation: [0.60, 0.80], intensification: [0.70, 0.90], peak: [0.75, 0.95], deload: [0.55, 0.70] } }
    ],
    power: [
      { name: 'Power Jerk', specificityScore: 0.80, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['power'], intensityRange: { accumulation: [0.60, 0.85], intensification: [0.65, 0.90], peak: [0.65, 0.85], deload: [0.55, 0.75] } },
      { name: 'Push Jerk', specificityScore: 0.75, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['power'], intensityRange: { accumulation: [0.55, 0.80], intensification: [0.60, 0.85], peak: [0.60, 0.80], deload: [0.50, 0.70] } }
    ],
    blocks: [
      { name: 'Jerk from Blocks', specificityScore: 0.75, fatigueScore: 3, bestPhases: ['intensification'], variationType: ['blocks'], intensityRange: { accumulation: [0.70, 0.95], intensification: [0.75, 1.05], peak: [0.75, 0.95], deload: [0.65, 0.85] } }
    ],
    technique: [
      { name: 'Jerk Balance', specificityScore: 0.55, fatigueScore: 1, bestPhases: ['accumulation', 'technique', 'deload'], variationType: ['footwork'], intensityRange: { accumulation: [0.30, 0.60], intensification: [0.35, 0.55], peak: [0.30, 0.50], deload: [0.25, 0.45] } },
      { name: 'Tall Jerk', specificityScore: 0.50, fatigueScore: 1, bestPhases: ['accumulation', 'technique', 'deload'], variationType: ['lockout'], intensityRange: { accumulation: [0.20, 0.50], intensification: [0.25, 0.45], peak: [0.20, 0.40], deload: [0.15, 0.35] } },
      { name: 'Behind-the-Neck Jerk', specificityScore: 0.65, fatigueScore: 2, bestPhases: ['accumulation'], variationType: ['btn'], intensityRange: { accumulation: [0.50, 0.85], intensification: [0.55, 0.85], peak: [0.50, 0.75], deload: [0.45, 0.70] } }
    ]
  },
  pulls: {
    snatch: [
      { name: 'Snatch Pull', specificityScore: 0.70, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['pull'], usesPullMax: true, intensityRange: { accumulation: [0.90, 1.10], intensification: [0.95, 1.20], peak: [0.90, 1.10], deload: [0.80, 1.00] } },
      { name: 'Paused Snatch Pull', specificityScore: 0.60, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['pause', 'pull'], usesPullMax: true, intensityRange: { accumulation: [0.85, 1.05], intensification: [0.90, 1.10], peak: [0.80, 1.00], deload: [0.70, 0.90] } },
      { name: 'Snatch High Pull', specificityScore: 0.55, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['high_pull'], intensityRange: { accumulation: [0.70, 0.90], intensification: [0.75, 0.95], peak: [0.70, 0.85], deload: [0.60, 0.80] } }
    ],
    clean: [
      { name: 'Clean Pull', specificityScore: 0.70, fatigueScore: 3, bestPhases: ['accumulation', 'intensification'], variationType: ['pull'], usesPullMax: true, intensityRange: { accumulation: [0.90, 1.15], intensification: [0.95, 1.30], peak: [0.90, 1.10], deload: [0.80, 1.00] } },
      { name: 'Paused Clean Pull', specificityScore: 0.60, fatigueScore: 3, bestPhases: ['accumulation', 'technique'], variationType: ['pause', 'pull'], usesPullMax: true, intensityRange: { accumulation: [0.85, 1.10], intensification: [0.90, 1.15], peak: [0.80, 1.05], deload: [0.70, 0.95] } },
      { name: 'Clean High Pull', specificityScore: 0.55, fatigueScore: 2, bestPhases: ['accumulation', 'technique'], variationType: ['high_pull'], intensityRange: { accumulation: [0.70, 0.95], intensification: [0.75, 1.00], peak: [0.70, 0.90], deload: [0.60, 0.85] } }
    ]
  }
};

// Block philosophies for variety
const BLOCK_PHILOSOPHIES = {
  power_focused: { name: 'Power & Speed', exerciseWeights: { power: 1.5, hang: 1.2, blocks: 1.3, pause: 0.8, classic: 1.0 }, intensityMod: -0.03, volumeMod: 1.1, preferredCategories: ['power', 'hang'] },
  position_focused: { name: 'Position & Control', exerciseWeights: { power: 0.8, hang: 1.4, blocks: 0.9, pause: 1.5, classic: 1.0 }, intensityMod: -0.02, volumeMod: 1.0, preferredCategories: ['pause', 'hang'] },
  strength_focused: { name: 'Strength & Max Effort', exerciseWeights: { power: 0.7, hang: 0.9, blocks: 1.4, pause: 1.1, classic: 1.5 }, intensityMod: 0.05, volumeMod: 0.85, preferredCategories: ['classic', 'blocks'] },
  technique_focused: { name: 'Technique & Consistency', exerciseWeights: { power: 1.2, hang: 1.3, blocks: 0.8, pause: 1.2, classic: 1.1 }, intensityMod: -0.08, volumeMod: 1.2, preferredCategories: ['hang', 'receiving'] },
  pull_focused: { name: 'Pull & First Pull', exerciseWeights: { power: 0.9, hang: 1.0, blocks: 1.5, pause: 1.3, classic: 0.9 }, intensityMod: 0.0, volumeMod: 1.0, preferredCategories: ['blocks', 'pause'] },
  receiving_focused: { name: 'Receiving & Overhead', exerciseWeights: { power: 0.8, hang: 0.9, blocks: 0.8, pause: 1.0, classic: 1.2 }, intensityMod: -0.02, volumeMod: 1.0, preferredCategories: ['receiving', 'classic'] }
};


// =====================================================
// EQUIPMENT PREFERENCES: BLOCKS ON/OFF + SUBSTITUTIONS
// =====================================================

const BLOCK_SUBSTITUTIONS = {
  'Snatch from Blocks': 'Hang Snatch (knee)',
  'Block Power Snatch': 'Hang Power Snatch',
  'Clean from Blocks': 'Hang Clean (knee)',
  'Jerk from Blocks': 'Behind-the-Neck Jerk'
};

// Replace block variations when blocks aren't available.
// Keeps it predictable: swap to a close hang/alt variant.
function substituteIfNoBlocks(exerciseName, includeBlocks){
  const name = String(exerciseName || '');
  if(includeBlocks) return name;
  if(!name) return name;

  if(BLOCK_SUBSTITUTIONS[name]) return BLOCK_SUBSTITUTIONS[name];

  const lower = name.toLowerCase();
  if(lower.includes('block')){
    if(lower.includes('snatch') && lower.includes('power')) return 'Hang Power Snatch';
    if(lower.includes('snatch')) return 'Hang Snatch (knee)';
    if(lower.includes('clean')) return 'Hang Clean (knee)';
    if(lower.includes('jerk')) return 'Power Jerk';
  }
  return name;
}

function getNextBlockPhilosophy(prevBlocks) {
  const keys = Object.keys(BLOCK_PHILOSOPHIES);
  if (!prevBlocks || prevBlocks.length === 0) return 'technique_focused';
  const recent = prevBlocks.slice(0, 3).map(b => b.philosophy || 'technique_focused');
  const rotation = {
    power_focused: ['position_focused', 'strength_focused'],
    position_focused: ['power_focused', 'pull_focused'],
    strength_focused: ['technique_focused', 'power_focused'],
    technique_focused: ['strength_focused', 'pull_focused'],
    pull_focused: ['receiving_focused', 'power_focused'],
    receiving_focused: ['pull_focused', 'strength_focused']
  };
  const opts = rotation[recent[0]] || keys;
  const filtered = opts.filter(p => !recent.includes(p));
  return filtered.length > 0 ? filtered[Math.floor(Math.random() * filtered.length)] : keys[Math.floor(Math.random() * keys.length)];
}

function getAllExercisesForFamily(family, opts = {}) {
  const data = EXERCISE_DATABASE[family];
  if (!data) return [];
  let all = [];
  Object.values(data).forEach(cat => { if (Array.isArray(cat)) all = all.concat(cat); });

  // Equipment filter (blocks)
  if (opts && opts.includeBlocks === false) {
    all = all.filter(ex => {
      const v = ex?.variationType || [];
      const n = String(ex?.name || '').toLowerCase();
      return !v.includes('blocks') && !n.includes('block');
    });
  }

  return all;
}


function inferExerciseTags(exName){
  const n=String(exName||'').toLowerCase();
  const tags=new Set();
  if(n.includes('power')) tags.add('speed');
  if(n.includes('hang')||n.includes('block')||n.includes('pause')||n.includes('knee')||n.includes('hip')) tags.add('positional');
  if(n.includes('pull')) tags.add('pull_strength');
  if(n.includes('deficit')||n.includes('snatch pull')||n.includes('clean pull')) tags.add('pull_strength');
  if(n.includes('balance')||n.includes('overhead')||n.includes('press')||n.includes('jerk')) tags.add('overhead');
  if(n.includes('drop')||n.includes('from blocks')||n.includes('high hang')||n.includes('tall')) tags.add('turnover');
  if(n.includes('snatch balance')||n.includes('oh squat')||n.includes('overhead squat')||n.includes('jerk balance')) tags.add('receiving');
  if(n.includes('squat')) tags.add('squat_strength');
  return tags;
}

function limiterDesiredTags(limiter){
  const l=String(limiter||'balanced').toLowerCase();
  if(l==='pull') return ['pull_strength','positional'];
  if(l==='turnover') return ['turnover','positional'];
  if(l==='receiving') return ['receiving','overhead'];
  if(l==='overhead') return ['overhead','receiving'];
  if(l==='squat') return ['squat_strength'];
  if(l==='speed') return ['speed'];
  return []; // balanced
}
function selectExerciseFromCategory(category, opts = {}) {
  const { phase, philosophy, recentExercises = [], includeBlocks = true, limiter='balanced', injuries={}, masters=false, macroBias='balanced' } = opts;
  if (!category || category.length === 0) return null;
  const cfg = BLOCK_PHILOSOPHIES[philosophy] || BLOCK_PHILOSOPHIES.technique_focused;

  // Equipment filter (blocks)
  let baseCategory = category;
  if (includeBlocks === false) {
    baseCategory = category.filter(ex => {
      const v = ex?.variationType || [];
      const n = String(ex?.name || '').toLowerCase();
      return !v.includes('blocks') && !n.includes('block');
    });
  }

  let candidates = baseCategory.filter(ex => phase === 'deload' || ex.bestPhases.includes(phase));
  if (candidates.length === 0) candidates = baseCategory;
  const scored = candidates.map(ex => {
    let score = ex.specificityScore || 0.5;
    if (ex.bestPhases.includes(phase)) score += 0.2;
    if (ex.variationType) ex.variationType.forEach(vt => { if (cfg.exerciseWeights[vt]) score *= cfg.exerciseWeights[vt]; });
    // Weak-point targeting (light touch; keeps output stable unless user chooses a limiter)
    const desired=limiterDesiredTags(limiter);
    if(desired.length){
      const tags=inferExerciseTags(ex.name);
      let matches=0;
      desired.forEach(t=>{ if(tags.has(t)) matches++; });
      score += matches*0.12;
    }
    // Macro bias: in CC prefer more specific, in GDP prefer more general (nudges, not hard rules)
    if(macroBias==='specific' && (ex.specificityScore||0.5)>=0.85) score += 0.05;
    if(macroBias==='general' && (ex.specificityScore||0.5)<=0.80) score += 0.05;
    // Masters / injury nudges away from very fatiguing options
    if(masters) score -= (ex.fatigueScore||0)*0.03;
    if(injuries && (injuries.shoulder||injuries.wrist||injuries.elbow)){
      if(String(ex.name||'').toLowerCase().includes('jerk') || String(ex.name||'').toLowerCase().includes('overhead')) score -= 0.08;
    }
    score -= recentExercises.filter(r => r === ex.name).length * 0.25;
    if (phase === 'deload') score -= ex.fatigueScore * 0.1;
    return { ex, score: Math.max(0.1, score) };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  const total = top.reduce((s, c) => s + c.score, 0);
  let r = Math.random() * total;
  for (const c of top) { r -= c.score; if (r <= 0) return c.ex; }
  return top[0]?.ex || candidates[0];
}

function selectSnatchExercise(opts) {
  const { phase, philosophy, preferredCategory } = opts;
  const cfg = BLOCK_PHILOSOPHIES[philosophy] || BLOCK_PHILOSOPHIES.technique_focused;

  let cat = preferredCategory ||
    ((phase === 'peak' || phase === 'intensification') ? 'classic'
      : (cfg.preferredCategories.find(p => EXERCISE_DATABASE.snatch[p]) || 'power'));


// Masters / restoration bias: prefer lower-impact variations unless peaking
if (opts && (opts.macroBias === 'restore')) {
  cat = 'power';
}
if (opts && opts.masters) {
  const inj = opts.injuries || {};
  const highRisk = !!(inj.wrist || inj.shoulder || inj.elbow);
  if ((phase !== 'peak' && phase !== 'intensification') || highRisk) {
    cat = 'power';
  }
}


  if (opts && opts.includeBlocks === false && cat === 'blocks') {
    cat = 'hang';
  }

  const fromCat = EXERCISE_DATABASE.snatch[cat] || getAllExercisesForFamily('snatch', opts);
  return selectExerciseFromCategory(fromCat, opts);
}

function selectCleanExercise(opts) {
  const { phase, philosophy, preferredCategory } = opts;
  const cfg = BLOCK_PHILOSOPHIES[philosophy] || BLOCK_PHILOSOPHIES.technique_focused;

  let cat = preferredCategory ||
    ((phase === 'peak' || phase === 'intensification') ? 'classic'
      : (cfg.preferredCategories.find(p => EXERCISE_DATABASE.clean[p]) || 'power'));


// Masters / restoration bias: prefer lower-impact variations unless peaking
if (opts && (opts.macroBias === 'restore')) {
  cat = 'power';
}
if (opts && opts.masters) {
  const inj = opts.injuries || {};
  const highRisk = !!(inj.wrist || inj.shoulder || inj.elbow);
  if ((phase !== 'peak' && phase !== 'intensification') || highRisk) {
    cat = 'power';
  }
}


  if (opts && opts.includeBlocks === false && cat === 'blocks') {
    cat = 'hang';
  }

  const fromCat = EXERCISE_DATABASE.clean[cat] || getAllExercisesForFamily('clean', opts);
  return selectExerciseFromCategory(fromCat, opts);
}

function selectJerkExercise(opts) {
  const { phase, preferredCategory } = opts;

  let cat = preferredCategory ||
    ((phase === 'peak' || phase === 'intensification') ? 'classic' : 'power');


// Masters / restoration bias: prefer lower-impact variations unless peaking
if (opts && (opts.macroBias === 'restore')) {
  cat = 'power';
}
if (opts && opts.masters) {
  const inj = opts.injuries || {};
  const highRisk = !!(inj.wrist || inj.shoulder || inj.elbow);
  if ((phase !== 'peak' && phase !== 'intensification') || highRisk) {
    cat = 'power';
  }
}


  if (opts && opts.includeBlocks === false && cat === 'blocks') {
    cat = 'power';
  }

  const fromCat = EXERCISE_DATABASE.jerk[cat] || getAllExercisesForFamily('jerk', opts);
  return selectExerciseFromCategory(fromCat, opts);
}

function selectPullExercise(family, opts) {
  const pulls = EXERCISE_DATABASE.pulls[family === 'snatch' ? 'snatch' : 'clean'];
  return selectExerciseFromCategory(pulls, opts);
}

function getExerciseIntensity(ex, phase, baseInt) {
  if (!ex || !ex.intensityRange) return baseInt;
  const range = ex.intensityRange[phase] || ex.intensityRange.accumulation;
  if (!range) return baseInt;
  const [min, max] = range;
  const norm = (baseInt - 0.50) / 0.50;
  return min + (max - min) * Math.min(1, Math.max(0, norm));
}

function trackExerciseUsage(name) {
  const h = getStorage(SK.exerciseHistory, []);
  h.unshift({ name, date: new Date().toISOString() });
  if (h.length > 100) h.splice(100);
  setStorage(SK.exerciseHistory, h);
}

function getRecentExercises(days = 14) {
  const h = getStorage(SK.exerciseHistory, []);
  const cut = new Date(); cut.setDate(cut.getDate() - days);
  return h.filter(x => new Date(x.date) >= cut).map(x => x.name);
}
// Evidence-Based Accessory Exercise Database
const ACCESSORY_EXERCISES = {
  pulls: [
    {name: 'Snatch Pull', priority: 1, time: 3, sets: 3, reps: 3, intensity: 0.95, targetMuscles: ['posterior chain', 'traps'], benefit: 'Develops pulling strength and speed'},
    {name: 'Clean Pull', priority: 1, time: 3, sets: 3, reps: 3, intensity: 0.95, targetMuscles: ['posterior chain', 'traps'], benefit: 'Develops pulling power'},
    {name: 'Snatch High Pull', priority: 2, time: 2.5, sets: 4, reps: 4, intensity: 0.75, targetMuscles: ['traps', 'shoulders'], benefit: 'Triple extension power'},
    {name: 'Clean High Pull', priority: 2, time: 2.5, sets: 4, reps: 4, intensity: 0.75, targetMuscles: ['traps', 'shoulders'], benefit: 'Explosive pulling'},
  ],
  
  squats: [
    {name: 'Pause Front Squat', priority: 1, time: 4, sets: 4, reps: 3, intensity: 0.75, targetMuscles: ['quads', 'core'], benefit: 'Position strength, core stability'},
    {name: 'Tempo Front Squat', priority: 2, time: 4, sets: 3, reps: 4, intensity: 0.70, targetMuscles: ['quads', 'core'], benefit: 'Control and strength endurance'},
    {name: 'Pause Back Squat', priority: 1, time: 4, sets: 4, reps: 3, intensity: 0.80, targetMuscles: ['posterior chain', 'quads'], benefit: 'Maximum strength development'},
    {name: 'Bulgarian Split Squat', priority: 3, time: 3, sets: 3, reps: 8, intensity: 0.50, targetMuscles: ['quads', 'glutes'], benefit: 'Unilateral strength, stability'},
  ],
  
  pressing: [
    {name: 'Push Press', priority: 1, time: 2.5, sets: 4, reps: 4, intensity: 0.75, targetMuscles: ['shoulders', 'triceps'], benefit: 'Overhead power and drive'},
    {name: 'Strict Press', priority: 2, time: 2, sets: 4, reps: 5, intensity: 0.70, targetMuscles: ['shoulders', 'core'], benefit: 'Shoulder strength and stability'},
    {name: 'Push Jerk', priority: 2, time: 3, sets: 3, reps: 3, intensity: 0.80, targetMuscles: ['shoulders', 'legs'], benefit: 'Explosive overhead power'},
    {name: 'Incline Bench Press', priority: 3, time: 3, sets: 4, reps: 6, intensity: 0.70, targetMuscles: ['chest', 'shoulders'], benefit: 'Upper body pressing strength'},
  ],
  
  posteriorChain: [
    {name: 'Romanian Deadlift', priority: 1, time: 3, sets: 4, reps: 6, intensity: 0.65, targetMuscles: ['hamstrings', 'glutes'], benefit: 'Hip hinge pattern, hamstring strength'},
    {name: 'Good Morning', priority: 2, time: 2.5, sets: 3, reps: 8, intensity: 0.50, targetMuscles: ['hamstrings', 'lower back'], benefit: 'Hip extension strength'},
    {name: 'Nordic Hamstring Curl', priority: 2, time: 2, sets: 3, reps: 5, intensity: 0, targetMuscles: ['hamstrings'], benefit: 'Eccentric hamstring strength'},
    {name: 'Back Extension', priority: 3, time: 2, sets: 3, reps: 12, intensity: 0, targetMuscles: ['lower back', 'glutes'], benefit: 'Spinal erector strength'},
    {name: 'Glute Ham Raise', priority: 1, time: 2.5, sets: 3, reps: 6, intensity: 0, targetMuscles: ['hamstrings', 'glutes'], benefit: 'Posterior chain integration'},
  ],
  
  core: [
    {name: 'Plank Hold', priority: 2, time: 1.5, sets: 3, reps: 45, intensity: 0, targetMuscles: ['core'], benefit: 'Core stability and endurance'},
    {name: 'Pallof Press', priority: 1, time: 2, sets: 3, reps: 10, intensity: 0, targetMuscles: ['core', 'obliques'], benefit: 'Anti-rotation strength'},
    {name: 'Hanging Leg Raise', priority: 2, time: 2, sets: 3, reps: 10, intensity: 0, targetMuscles: ['core', 'hip flexors'], benefit: 'Core strength and control'},
    {name: 'Ab Wheel Rollout', priority: 3, time: 2, sets: 3, reps: 8, intensity: 0, targetMuscles: ['core'], benefit: 'Dynamic core stability'},
  ],
  
  upperBack: [
    {name: 'Pendlay Row', priority: 1, time: 3, sets: 4, reps: 6, intensity: 0.70, targetMuscles: ['lats', 'traps'], benefit: 'Back thickness and pulling power'},
    {name: 'Pull-ups', priority: 1, time: 2.5, sets: 4, reps: 8, intensity: 0, targetMuscles: ['lats', 'biceps'], benefit: 'Vertical pulling strength'},
    {name: 'Barbell Row', priority: 2, time: 3, sets: 4, reps: 8, intensity: 0.65, targetMuscles: ['lats', 'traps'], benefit: 'Horizontal pulling strength'},
    {name: 'Face Pull', priority: 3, time: 2, sets: 3, reps: 15, intensity: 0, targetMuscles: ['rear delts', 'traps'], benefit: 'Shoulder health and posture'},
  ],
  
  trunk: [
    {name: 'Weighted Carry', priority: 1, time: 2, sets: 3, reps: 40, intensity: 0, targetMuscles: ['core', 'traps'], benefit: 'Loaded carry strength'},
    {name: 'Turkish Get-up', priority: 2, time: 3, sets: 3, reps: 3, intensity: 0, targetMuscles: ['core', 'shoulders'], benefit: 'Total body stability'},
    {name: 'Suitcase Carry', priority: 3, time: 2, sets: 3, reps: 30, intensity: 0, targetMuscles: ['core', 'obliques'], benefit: 'Anti-lateral flexion'},
  ]
};

// Get evidence-based accessory workout based on time available
function selectAccessoryExercises(duration, phase, weekInPhase, profile) {
  const exercises = [];
  let remainingTime = duration;
  
  const warmupTime = 8;
  const cooldownTime = 5;
  remainingTime -= (warmupTime + cooldownTime);
  
  const priorityOrder = [
    'pulls',
    'posteriorChain',
    'squats',
    'core',
    'pressing',
    'upperBack',
    'trunk'
  ];
  
  let setsMultiplier = 1.0;
  let intensityAdjustment = 0;
  
  if (phase === 'accumulation') {
    setsMultiplier = 1.2;
    intensityAdjustment = -0.05;
  } else if (phase === 'intensification') {
    setsMultiplier = 0.85;
    intensityAdjustment = 0.05;
  } else if (phase === 'deload' || phase === 'taper') {
    setsMultiplier = 0.6;
    intensityAdjustment = -0.10;
  }
  
  for (const category of priorityOrder) {
    if (remainingTime <= 5) break;
    
    const categoryExercises = ACCESSORY_EXERCISES[category];
    if (!categoryExercises) continue;
    
    const sortedEx = [...categoryExercises].sort((a, b) => a.priority - b.priority);
    
    for (const ex of sortedEx) {
      const adjustedTime = ex.time * setsMultiplier;
      if (adjustedTime <= remainingTime) {
        const adjustedSets = Math.max(2, Math.round(ex.sets * setsMultiplier));
        const adjustedIntensity = Math.max(0.5, Math.min(1.0, ex.intensity + intensityAdjustment));
        
        exercises.push({
          ...ex,
          sets: adjustedSets,
          intensity: adjustedIntensity,
          category: category
        });
        
        remainingTime -= adjustedTime;
        break;
      }
    }
  }
  
  return exercises;
}

// Generate recovery session exercises
function getRecoveryExercises(phase, weekInPhase){
  const exercises={
    main:'Active Recovery',
    mainType:'recovery',
    secondary:'Mobility Work',
    secType:'recovery',
    strength:'Core Strength',
    strengthType:'accessory',
    accessory:'Stretching'
  };
  
  if(phase==='accumulation'){
    exercises.main='Light Technique Work';
    exercises.secondary='Tempo Squats';
    exercises.strength='Core & Stability';
  }else if(phase==='intensification'){
    exercises.main='Active Recovery';
    exercises.secondary='Mobility & Stretching';
    exercises.strength='Light Cardio';
  }else if(phase==='deload'||phase==='taper'){
    exercises.main='Easy Movement';
    exercises.secondary='Flexibility';
    exercises.strength='Restorative';
  }
  
  return exercises;
}

// Phase Info
function getPhaseInfo(weekNum,blockLen,progType){
  const cycleLen=4;
  const weekInCycle=((weekNum-1)%cycleLen)+1;
  if(progType==='competition'&&weekNum>=blockLen-1){
    return{phase:'taper',intensity:0.93,volume:0.4,distribution:{classical:60,assistance:40}};
  }
  if(weekInCycle===1){
    return{phase:'accumulation',intensity:0.72,volume:1.1,distribution:{classical:25,assistance:75}};
  }else if(weekInCycle===2){
    return{phase:'accumulation',intensity:0.78,volume:1.0,distribution:{classical:30,assistance:70}};
  }else if(weekInCycle===3){
    return{phase:'intensification',intensity:0.90,volume:0.65,distribution:{classical:40,assistance:60}};
  }else{
    return{phase:'deload',intensity:0.68,volume:0.5,distribution:{classical:30,assistance:70}};
  }
}

// Set Schemes
function getSetScheme(progType,phase){
  const schemes={
    general:{accumulation:{warmup:[3,3,2],top:[3,3,3],backoff:3,topSets:3,backoffSets:3},intensification:{warmup:[3,2,1],top:[1,1,1,1],backoff:2,topSets:4,backoffSets:2},deload:{warmup:[3,2],top:[3,2],backoff:3,topSets:2,backoffSets:2},taper:{warmup:[3,2,1],top:[1,1],backoff:1,topSets:2,backoffSets:1}},
    strength:{accumulation:{warmup:[3,2,2],top:[3,3,2],backoff:2,topSets:3,backoffSets:4},intensification:{warmup:[3,2,1],top:[2,1,1,1],backoff:2,topSets:4,backoffSets:3},deload:{warmup:[3,2],top:[3,2],backoff:2,topSets:2,backoffSets:2},taper:{warmup:[3,2,1],top:[1,1],backoff:2,topSets:2,backoffSets:1}},
    hypertrophy:{accumulation:{warmup:[4,3,3],top:[4,3,3],backoff:3,topSets:3,backoffSets:4},intensification:{warmup:[3,3,2],top:[3,2,2],backoff:3,topSets:3,backoffSets:3},deload:{warmup:[4,3],top:[3,3],backoff:3,topSets:2,backoffSets:2},taper:{warmup:[3,2],top:[2,2],backoff:2,topSets:2,backoffSets:2}},
    competition:{accumulation:{warmup:[3,2,1],top:[2,2,2],backoff:2,topSets:3,backoffSets:3},intensification:{warmup:[3,2,1],top:[1,1,1,1,1],backoff:1,topSets:5,backoffSets:2},deload:{warmup:[3,2,1],top:[2,2],backoff:2,topSets:2,backoffSets:1},taper:{warmup:[3,2,1],top:[1,1],backoff:1,topSets:2,backoffSets:0}},
    technique:{accumulation:{warmup:[3,3,3],top:[4,3,3],backoff:3,topSets:3,backoffSets:3},intensification:{warmup:[3,3,2],top:[3,2,2],backoff:2,topSets:3,backoffSets:2},deload:{warmup:[3,3],top:[3,2],backoff:3,topSets:2,backoffSets:2},taper:{warmup:[3,2],top:[2,2],backoff:2,topSets:2,backoffSets:2}}
  };
  return schemes[progType]?.[phase]||schemes.general[phase];
}

// Squat Scheme
function getSquatScheme(progType,phase){
  const base={general:{reps:4,sets:4,intensity:0.75},strength:{reps:3,sets:5,intensity:0.82},hypertrophy:{reps:5,sets:5,intensity:0.72},competition:{reps:2,sets:4,intensity:0.87},technique:{reps:4,sets:3,intensity:0.70}};
  const cfg={...base[progType]||base.general};
  if(phase==='accumulation'){cfg.reps=Math.min(5,cfg.reps+1);cfg.intensity-=0.03}
  else if(phase==='intensification'){cfg.intensity+=0.08;cfg.reps=Math.max(2,cfg.reps-1);cfg.sets=Math.min(5,cfg.sets+1)}
  else if(phase==='deload'){cfg.intensity-=0.12;cfg.sets=Math.max(2,Math.floor(cfg.sets*0.5))}
  else if(phase==='taper'){cfg.intensity-=0.02;cfg.reps=Math.max(1,cfg.reps-2);cfg.sets=2}
  return cfg;
}

// Exercise Selection for main lifting days - INTELLIGENT VERSION

function getVariantWindowLength(slot, prof, macroPeriod){
  const p=normalizeProfile(prof);
  const period=String(macroPeriod||p.macroPeriod||'PP').toUpperCase();
  // Main lift variants should be stable longer; secondary rotates a bit faster.
  let base = (slot==='main') ? 3 : 2;
  if(period==='GDP') base = (slot==='main') ? 2 : 1;
  if(period==='CC')  base = (slot==='main') ? 4 : 2;
  if(period==='TP')  base = 1;
  // Newer lifters benefit from stable variants
  const ta=Math.max(0, parseFloat(p.trainingAgeYears)||1);
  if(ta<1 && base<4) base += 1;
  if(p.isMasters && base>3) base -= 1;
  return Math.max(1, Math.min(6, base));
}

function getLockedVariant(variantState, focusKey, slot, week){
  const vs=variantState||{};
  const fk=String(focusKey||'').toLowerCase();
  if(!vs[fk] || !vs[fk][slot]) return null;
  const st=vs[fk][slot];
  if(st && st.name && typeof st.expiresWeek==='number' && week<=st.expiresWeek) return st.name;
  return null;
}

function lockVariant(variantState, focusKey, slot, name, week, windowLen){
  if(!variantState) return;
  const fk=String(focusKey||'').toLowerCase();
  if(!variantState[fk]) variantState[fk]={};
  variantState[fk][slot]={name:name, startWeek:week, expiresWeek:week+windowLen-1};
}
function selectExercises(focusType, progType, phase, weekInPhase, philosophy, prof, recentExercises, variantState, weekNumber, macroPeriodEffective) {
  const result = { main: '', mainType: '', secondary: '', secType: '', strength: '', strengthType: '', accessory: '' };
  
  const selectionOpts = {
    phase: phase,
    philosophy: philosophy || 'technique_focused',
    includeBlocks: prof?.includeBlocks !== false,
    recentExercises: recentExercises || [],
    masters: !!prof?.isMasters,
    macroBias: getMacroMultipliers(prof, macroPeriodEffective).specificityBias,
    limiter: prof?.limiter || 'balanced',
    injuries: prof?.injuries || {}
  };
  
  if (focusType === 'snatch') {
    result.mainType = 'snatch';
    result.secType = 'snatch';
    result.strengthType = 'squat';
    
    // Use intelligent selection from database
    const lockedMain = getLockedVariant(variantState, 'snatch', 'main', weekNumber);
    const mainEx = lockedMain ? { name: lockedMain } : selectSnatchExercise(selectionOpts);
    if(!lockedMain && mainEx && mainEx.name){
      lockVariant(variantState,'snatch','main',mainEx.name,weekNumber,getVariantWindowLength('main',prof,macroPeriodEffective));
    };
    result.main = mainEx ? mainEx.name : 'Snatch';
    
    // Select secondary (pull or receiving exercise)
    const pullEx = selectPullExercise('snatch', selectionOpts);
    if (pullEx && (phase === 'accumulation' || phase === 'intensification')) {
      result.secondary = pullEx.name;
    } else {
      const recEx = selectExerciseFromCategory(
        [...(EXERCISE_DATABASE.snatch.receiving || []), ...(EXERCISE_DATABASE.snatch.turnover || [])],
        selectionOpts
      );
      result.secondary = recEx ? recEx.name : 'Snatch Balance';
    }
    
    result.strength = 'Back Squat';
    result.accessory = 'Back Extension';
    
  } else if (focusType === 'cleanJerk') {
    result.mainType = 'cleanJerk';
    result.secType = 'cleanJerk';
    result.strengthType = 'squat';
    
    const mainEx = selectCleanExercise(selectionOpts);
    result.main = mainEx ? mainEx.name : 'Clean & Jerk';
    
    // Select secondary (pull or jerk variant)
    const pullEx = selectPullExercise('clean', selectionOpts);
    if (pullEx && (phase === 'accumulation' || phase === 'intensification')) {
      result.secondary = pullEx.name;
    } else {
      const jerkEx = selectJerkExercise(selectionOpts);
      result.secondary = jerkEx ? jerkEx.name : 'Push Press';
    }
    
    result.strength = 'Front Squat';
    result.accessory = 'Romanian Deadlift';
    
  } else {
    result.mainType = 'snatch';
    result.secType = 'cleanJerk';
    result.strengthType = 'squat';
    
    const snatchEx = selectSnatchExercise({ ...selectionOpts, preferredCategory: 'power' });
    const cleanEx = selectCleanExercise({ ...selectionOpts, preferredCategory: 'power' });
    
    result.main = snatchEx ? snatchEx.name : 'Power Snatch';
    result.secondary = cleanEx ? cleanEx.name : 'Power Clean';
    result.strength = 'Back Squat';
    result.accessory = 'Good Morning';
  }
  
  // Final safety: swap any remaining block variants if blocks are disabled
  const _incBlocks = selectionOpts.includeBlocks;
  result.main = substituteIfNoBlocks(result.main, _incBlocks);
  result.secondary = substituteIfNoBlocks(result.secondary, _incBlocks);
  result.strength = substituteIfNoBlocks(result.strength, _incBlocks);
  result.accessory = substituteIfNoBlocks(result.accessory, _incBlocks);

  return result;
}

// Get day type from schedule
function getDayType(dayNum, mainDays, accessoryDays) {
  if (mainDays && mainDays.includes(dayNum)) return 'main';
  if (accessoryDays && accessoryDays.includes(dayNum)) return 'accessory';
  return 'recovery';
}

// Generate Training Block - INTELLIGENT VERSION

// NEW: Transition (ramp-in) helpers for safer program switching
function getTransitionProfileDefaults(transitionProfile){
  const p=String(transitionProfile||'standard').toLowerCase();
  if(p==='aggressive') return { w1:{intensity:0.96, volume:0.85}, w2:{intensity:0.98, volume:0.93} };
  if(p==='conservative') return { w1:{intensity:0.90, volume:0.70}, w2:{intensity:0.95, volume:0.85} };
  return { w1:{intensity:0.92, volume:0.75}, w2:{intensity:0.96, volume:0.90} }; // standard
}

function getModeAdjustedTransition(athleteMode, base){
  const mode=String(athleteMode||'recreational').toLowerCase();
  // Competition lifters often keep intensity exposure slightly higher but reduce volume more.
  if(mode==='competition'){
    return {
      w1:{ intensity:Math.min(0.97, Math.max(0.88, base.w1.intensity+0.02)), volume:Math.max(0.60, base.w1.volume-0.05) },
      w2:{ intensity:Math.min(0.99, Math.max(0.90, base.w2.intensity+0.01)), volume:Math.max(0.75, base.w2.volume-0.03) }
    };
  }
  return base;
}

function getTransitionMultipliersForWeek(prof, week){
  const weeks=parseInt(prof.transitionWeeks||0,10)||0;
  if(!weeks || week>weeks) return { intensity:1.0, volume:1.0 };
  const base=getModeAdjustedTransition(prof.athleteMode, getTransitionProfileDefaults(prof.transitionProfile));
  if(week===1) return { intensity:base.w1.intensity, volume:base.w1.volume };
  if(week===2) return { intensity:base.w2.intensity, volume:base.w2.volume };
  // If user ever chooses >2 in future, just use week2 values for the remainder.
  return { intensity:base.w2.intensity, volume:base.w2.volume };
}

function generateTrainingBlock(prof){
  prof=normalizeProfile(prof);
  const blockId=uuid();
  
  // Determine block philosophy based on history
  const blockHistory = getStorage(SK.blockHistory, []);
  const philosophy = getNextBlockPhilosophy(blockHistory);
  const philosophyConfig = BLOCK_PHILOSOPHIES[philosophy] || BLOCK_PHILOSOPHIES.technique_focused;
  
  const defaultBlockName = `${philosophyConfig.name} Block`;
  
  const block={
    id:blockId,
    createdAt:new Date().toISOString(),
    name:prof.blockName||defaultBlockName,
    generated:true,
    philosophy: philosophy,
    philosophyName: philosophyConfig.name,
    ...prof,
    currentWeek:1,
    selectedSession:null
  };
  const sessions=[], sets=[];
  
  const mainDays = prof.mainLiftingDays || [];
  const accessoryDays = prof.accessoryDays || [];
  const totalDays = prof.daysPerWeek;
  
  // Track exercises for variety
  const blockExerciseUsage = [];
  const recentExercises = getRecentExercises(14);
  const variantState = {};
  
  for(let week=1;week<=prof.blockLength;week++){
    const phaseInfo=getPhaseInfo(week,prof.blockLength,prof.programType);
    const weekStartDate=new Date();
    weekStartDate.setDate(weekStartDate.getDate()+((week-1)*7));
    const macroPeriodEffective=getEffectiveMacroPeriod(prof, weekStartDate);
    const macroMult=getMacroMultipliers(prof, macroPeriodEffective);
    const ageMult=getAgeMultipliers(prof);
    const taMult=getTrainingAgeMultipliers(prof);
    const meetWeek=isMeetWeek(prof, weekStartDate);
    const controlTestWeek=isControlTestWeek(prof, weekStartDate);
    let cwfhcSessionIdx=0;
    
    // Apply philosophy modifiers to phase intensity
    const adjustedIntensity = Math.max(0.50, Math.min(0.98, phaseInfo.intensity + philosophyConfig.intensityMod));
    const volumePref = (prof && prof.volumePreference) ? prof.volumePreference : 'reduced';
    const volumeMultMap = { standard: 1.0, reduced: 0.75, minimal: 0.60 };
    const volumePreferenceMult = volumeMultMap[volumePref] ?? 0.75;
    const adjustedVolume = phaseInfo.volume * philosophyConfig.volumeMod * volumePreferenceMult;

    // Apply macro/age/training-age multipliers (kept conservative)
    const adjustedIntensityFinal = Math.max(0.50, Math.min(0.98, adjustedIntensity * macroMult.intensity * ageMult.intensity * taMult.intensity));
    const adjustedVolumeFinal = Math.max(0.40, adjustedVolume * macroMult.volume * ageMult.volume * taMult.volume);

    // Apply ramp-in multipliers when switching programs mid-cycle (weeks 1-2)
    const transitionMult = getTransitionMultipliersForWeek(prof, week);
    const rampedIntensity = Math.max(0.50, Math.min(0.98, adjustedIntensityFinal * transitionMult.intensity));
    const rampedVolume = adjustedVolumeFinal * transitionMult.volume;

    
    const weekInPhase=week%4||4;
    
    let mainDayIndex = 0;
    const mainPattern = ['snatch', 'cleanJerk'];
    
    for(let day=1;day<=totalDays;day++){
      const sessionId=uuid();
      const startDate=new Date();
      startDate.setDate(startDate.getDate()+((week-1)*7)+(day-1));
      
      const dayType = getDayType(day, mainDays, accessoryDays);
      
      // RECOVERY DAY
      if(dayType === 'recovery'){
        const recoveryEx=getRecoveryExercises(phaseInfo.phase,weekInPhase);
        sessions.push({
          id:sessionId,
          blockId,
          week,
          day,
          date:startDate.toISOString(),
          focusType:'recovery',
          phase:phaseInfo.phase,
          title:`Week ${week}, Day ${day} — RECOVERY`,
          status:'planned',
          completedAt:null,
          exercises:recoveryEx
        });
        
        let setIdx=0;
        const recoveryWork=[
          {exercise:'Foam Rolling',reps:10,sets:1},
          {exercise:'Band Pull-Aparts',reps:15,sets:3},
          {exercise:'Dead Hangs',reps:30,sets:3},
          {exercise:'Hip Mobility',reps:10,sets:2},
          {exercise:'Core Work',reps:12,sets:3}
        ];
        
        recoveryWork.forEach(work=>{
          for(let i=0;i<work.sets;i++){
            sets.push({
              id:uuid(),
              sessionId,
              blockOrder:1,
              setIndex:++setIdx,
              exercise:work.exercise,
              type:'recovery',
              exerciseType:'recovery',
              targetReps:work.reps,
              targetIntensity:0,
              suggestedWeight:0,
              targetRPE:3.0
            });
          }
        });
        
        continue;
      }
      
      // ACCESSORY DAY
      if(dayType === 'accessory'){
        const accessoryExercises = selectAccessoryExercises(
          prof.sessionDuration,
          phaseInfo.phase,
          weekInPhase,
          prof
        );
        
        sessions.push({
          id:sessionId,
          blockId,
          week,
          day,
          date:startDate.toISOString(),
          focusType:'accessory',
          phase:phaseInfo.phase,
          title:`Week ${week}, Day ${day} — ACCESSORY`,
          status:'planned',
          completedAt:null,
          exercises:{
            main: accessoryExercises[0]?.name || 'Accessory Work',
            mainType: 'accessory'
          }
        });
        
        let blockOrder = 0;
        accessoryExercises.forEach((ex, exIdx) => {
          blockOrder++;
          let setIdx = 0;
          
          let baseMax = prof.backSquat;
          if (ex.category === 'squats') {
            baseMax = ex.name.includes('Front') ? getLiftBaseMax(prof,'frontSquat') : getLiftBaseMax(prof,'backSquat');
          } else if (ex.category === 'pulls') {
            baseMax = ex.name.includes('Snatch') ? getLiftBaseMax(prof,'snatch') * PULL_MAX_MULTIPLIER : getLiftBaseMax(prof,'cleanJerk') * PULL_MAX_MULTIPLIER;
          } else if (ex.category === 'pressing') {
            baseMax = getLiftBaseMax(prof,'cleanJerk') * 0.6;
          } else if (ex.category === 'posteriorChain') {
            baseMax = getLiftBaseMax(prof,'backSquat') * 0.7;
          }
          
          for(let i=0;i<ex.sets;i++){
            setIdx++;
            sets.push({
              id:uuid(),
              sessionId,
              blockOrder,
              setIndex:setIdx,
              exercise:ex.name,
              type:'accessory',
              exerciseType:'accessory',
              targetReps:ex.reps,
              targetIntensity:ex.intensity,
              suggestedWeight:ex.intensity > 0 ? calculateWeight(baseMax, ex.intensity, prof.units) : 0,
              targetRPE:7.5
            });
          }
        });
        
        continue;
      }
      
      // MAIN LIFTING DAY
      const focusType = mainPattern[mainDayIndex % mainPattern.length];
      mainDayIndex++;
      
      // Use intelligent exercise selection with philosophy and variety tracking
      const allRecentExercises = [...recentExercises, ...blockExerciseUsage];
      const exercises=selectExercises(focusType, prof.programType, phaseInfo.phase, weekInPhase, philosophy, prof, allRecentExercises, variantState, week, macroPeriodEffective);
      
      // Track exercise usage for variety
      if (exercises.main) blockExerciseUsage.push(exercises.main);
      if (exercises.secondary) blockExerciseUsage.push(exercises.secondary);
      
      const scheme=getSetScheme(prof.programType,phaseInfo.phase);
      const sqScheme=getSquatScheme(prof.programType,phaseInfo.phase);

      // Meet / taper / test day context
      const meetDate=getMeetDate(prof);
      const isMeetW=!!meetWeek;
      const isControlTest = !!(controlTestWeek && !isMeetW);
      let sessionScale=1.0;
      if(prof.taperStyle==='cwfhc' && isMeetW && meetDate && startDate < meetDate && cwfhcSessionIdx<3){
        const scales=[0.90,0.70,0.50];
        sessionScale=scales[cwfhcSessionIdx]||1.0;
        cwfhcSessionIdx++;
      }
      // Reduce volume slightly on control test sessions to keep fatigue manageable
      const isTestSession = isControlTest && (weekInPhase===3 || phaseInfo.phase==='intensification');
      
      sessions.push({
        id:sessionId,
        blockId,
        week,
        day,
        date:startDate.toISOString(),
        focusType,
        phase:phaseInfo.phase,
        macroPeriod: macroPeriodEffective,
        isTestSession: !!isTestSession,
        sessionScale: sessionScale,
        philosophy: philosophy,
        title:`Week ${week}, Day ${day} — ${focusType.toUpperCase()}`,
        status:'planned',
        completedAt:null,
        exercises:exercises
      });
      
      const mainMax=exercises.mainType==='snatch'?getLiftBaseMax(prof,'snatch'):getLiftBaseMax(prof,'cleanJerk');
      const secMax=exercises.secType==='snatch'?getLiftBaseMax(prof,'snatch'):getLiftBaseMax(prof,'cleanJerk');
      const sqMax=exercises.strength==='Front Squat'?getLiftBaseMax(prof,'frontSquat'):getLiftBaseMax(prof,'backSquat');
      
      let setIdx=0;
      const warmupInts=[0.60,0.70,0.78,0.85];
      
      let timeMultiplier = 1.0;
      if (prof.sessionDuration <= 60) {
        timeMultiplier = 0.75;
      } else if (prof.sessionDuration >= 90) {
        timeMultiplier = 1.15;
      }
      
      // Use adjusted intensity from philosophy
      const volScaleBase = sessionScale * (isTestSession ? 0.85 : 1.0);
      const mainIntensity = Math.max(0.50, Math.min(0.98, rampedIntensity*sessionScale));
      
      scheme.warmup.forEach((reps,i)=>{
        if(i<warmupInts.length){
          const intensity=warmupInts[i]*mainIntensity;
          sets.push({
            id:uuid(),
            sessionId,
            blockOrder:1,
            setIndex:++setIdx,
            exercise:exercises.main,
            type:'warmup',
            exerciseType:exercises.mainType,
            targetReps:reps,
            targetIntensity:intensity,
            suggestedWeight:calculateWeight(mainMax,intensity,prof.units),
            targetRPE:null
          });
        }
      });
      
      // Optional heavy single exposure (and required on test sessions)
      const doHeavySingle = (!!prof.heavySingleExposure || !!isTestSession) && phaseInfo.phase!=='deload';
      if(doHeavySingle){
        let singleInt = mainIntensity;
        if(phaseInfo.phase==='accumulation') singleInt = Math.min(0.90, mainIntensity+0.04);
        else if(phaseInfo.phase==='intensification') singleInt = Math.min(0.97, mainIntensity+0.05);
        else if(phaseInfo.phase==='peak') singleInt = Math.min(1.02, mainIntensity+0.06);
        if(isTestSession) singleInt = Math.min(1.05, mainIntensity+0.08);
        if(prof.isMasters) singleInt = Math.max(0.70, singleInt-0.02);
        sets.push({
          id:uuid(),
          sessionId,
          blockOrder:1,
          setIndex:++setIdx,
          exercise:exercises.main,
          type:(isTestSession?'test_single':'heavy_single'),
          exerciseType:exercises.mainType,
          targetReps:1,
          targetIntensity:Math.max(0.65, Math.min(1.05, singleInt)),
          suggestedWeight:calculateWeight(mainMax,Math.max(0.65, Math.min(1.05, singleInt)),prof.units),
          targetRPE:(isTestSession?8.5:8.0)
        });
      }

      // Recreational volume controls (applies to WORKING sets only; warmups unchanged)
      const maxMainWorkRepsMap={standard:18,reduced:12,minimal:10};
      const baseMaxMainWorkReps=maxMainWorkRepsMap[volumePref]||12;
      const maxMainWorkReps=Math.max(6,Math.round(baseMaxMainWorkReps*timeMultiplier*volScaleBase));
      const capTopSetsMap={standard:999,reduced:3,minimal:2};
      const capBackoffSetsMap={standard:999,reduced:2,minimal:1};
      let mainWorkReps=0;
      let topSetsDone=0;
for(let i=0;i<scheme.top.length;i++){
        const reps=scheme.top[i];
        if(topSetsDone >= (capTopSetsMap[volumePref]||999)) break;
        let intensity;
        if(phaseInfo.phase==='intensification'){
          const waveIntensities=[0.88,0.93,0.88,0.93,0.93];
          intensity=waveIntensities[i]||mainIntensity;
        }else{
          intensity=i===0?mainIntensity:(mainIntensity-0.02);
        }
        if(mainWorkReps + reps > maxMainWorkReps) break;
        sets.push({
          id:uuid(),
          sessionId,
          blockOrder:1,
          setIndex:++setIdx,
          exercise:exercises.main,
          type:'top',
          exerciseType:exercises.mainType,
          targetReps:reps,
          targetIntensity:intensity,
          suggestedWeight:calculateWeight(mainMax,intensity,prof.units),
          targetRPE:phaseInfo.phase==='intensification'?9.0:8.5
        });
        mainWorkReps += reps;
        topSetsDone++;
      }
      
      const backoffInt=phaseInfo.phase==='intensification'?(mainIntensity-0.08):(mainIntensity-0.10);
      const rawBackoffCount=Math.floor(scheme.backoffSets*rampedVolume*timeMultiplier*volScaleBase);
      const backoffCount=Math.min(rawBackoffCount,(capBackoffSetsMap[volumePref]||rawBackoffCount));
      for(let i=0;i<backoffCount;i++){
        if(mainWorkReps + scheme.backoff > maxMainWorkReps) break;
        sets.push({
          id:uuid(),
          sessionId,
          blockOrder:1,
          setIndex:++setIdx,
          exercise:exercises.main,
          type:'backoff',
          exerciseType:exercises.mainType,
          targetReps:scheme.backoff,
          targetIntensity:backoffInt,
          suggestedWeight:calculateWeight(mainMax,backoffInt,prof.units),
          targetRPE:8.0
        });
        mainWorkReps += scheme.backoff;
      }
      
      setIdx=0;
      const secInt=phaseInfo.phase==='accumulation'?0.75:0.80;
      const secSets=Math.floor(3*rampedVolume*timeMultiplier);
      const secReps=exercises.secondary.includes('Pull')?3:scheme.backoff;
      const pullMax=exercises.secondary.includes('Pull')?(secMax*PULL_MAX_MULTIPLIER):secMax;
      
      for(let i=0;i<secSets;i++){
        sets.push({
          id:uuid(),
          sessionId,
          blockOrder:2,
          setIndex:++setIdx,
          exercise:exercises.secondary,
          type:'secondary',
          exerciseType:exercises.secType,
          targetReps:secReps,
          targetIntensity:secInt,
          suggestedWeight:calculateWeight(pullMax,secInt,prof.units),
          targetRPE:7.5
        });
      }
      
      if (prof.sessionDuration >= 60) {
        setIdx=0;
        const sqSets=Math.floor(sqScheme.sets*rampedVolume*timeMultiplier);
        for(let i=0;i<sqSets;i++){
          sets.push({
            id:uuid(),
            sessionId,
            blockOrder:3,
            setIndex:++setIdx,
            exercise:exercises.strength,
            type:'strength',
            exerciseType:'squat',
            targetReps:sqScheme.reps,
            targetIntensity:sqScheme.intensity,
            suggestedWeight:calculateWeight(sqMax,sqScheme.intensity,prof.units),
            targetRPE:8.0
          });
        }
      }
      
      if (prof.sessionDuration >= 75) {
        setIdx=0;
        const accSets=phaseInfo.phase==='deload'?2:Math.min(3, Math.floor(3 * timeMultiplier));
        for(let i=0;i<accSets;i++){
          sets.push({
            id:uuid(),
            sessionId,
            blockOrder:4,
            setIndex:++setIdx,
            exercise:exercises.accessory,
            type:'accessory',
            exerciseType:'accessory',
            targetReps:exercises.accessory==='Back Extension'?12:5,
            targetIntensity:0.70,
            suggestedWeight:calculateWeight(sqMax,0.70,prof.units),
            targetRPE:7.0
          });
        }
      }
    }
  }
  
  // Save block to history for future variety
  blockHistory.unshift({
    id: blockId,
    philosophy: philosophy,
    philosophyName: philosophyConfig.name,
    programType: prof.programType,
    createdAt: block.createdAt,
    exercisesUsed: blockExerciseUsage.slice(0, 20)
  });
  if (blockHistory.length > 20) blockHistory.splice(20);
  setStorage(SK.blockHistory, blockHistory);
  
  const blockSuccess=setStorage(SK.block,block);
  const sessionsSuccess=setStorage(SK.sessions,sessions);
  const setsSuccess=setStorage(SK.sets,sets);
  
  if(!blockSuccess||!sessionsSuccess||!setsSuccess){
    throw new Error('Failed to save training data');
  }
  
  return{block,sessions,sets};
}

// UI Functions
function showPage(pageName){
  // Robust page switching (class + inline display). Some mobile browsers can get into
  // odd states with cached styles; we force the state to avoid "tabs show same content".
  ['Setup','Dashboard','Workout','History','Settings'].forEach(p=>{
    const page=$(`page${p}`);
    if(!page) return;
    const isActive = (p===pageName);
    page.classList.toggle('hidden',!isActive);
    page.style.display = isActive ? 'block' : 'none';
    page.setAttribute('aria-hidden', String(!isActive));
  });
  ['navSetup','navDashboard','navWorkout','navHistory','navSettings'].forEach(id=>{
    const nav=$(id);
    if(nav) nav.classList.toggle('active',id===`nav${pageName}`);
  });

  // Always snap to top when moving between main tabs.
  try{ window.scrollTo({top:0,left:0,behavior:'instant'}); }catch{ window.scrollTo(0,0); }
}

// Centralized Week-page tab activation so landing behavior stays consistent.
function activateWeekTab(tabName){
  const tabBtns=document.querySelectorAll('.tab-btn');
  const tabContents=document.querySelectorAll('.tab-content');
  const t=String(tabName||'').toLowerCase();

  tabBtns.forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`.tab-btn[data-tab="${t}"]`);
  if(btn) btn.classList.add('active');

  tabContents.forEach(content=>{
    const id=`tab${t.charAt(0).toUpperCase()+t.slice(1)}`;
    content.classList.toggle('active',content.id===id);
  });

  if(t==='dashboard')renderDashboard();
  else if(t==='workout')renderWeekPage();
  else if(t==='history')renderHistoryPage();
  else if(t==='settings')renderSettingsPage();
}

function navigateToPage(pageName){
  const prof=getStorage(SK.profile);

  // Setup is always reachable (especially if no active block yet)
  if(pageName==='Setup'){ showPage('Setup'); return; }

  // Dashboard / Workout require an active block
  const block=getStorage(SK.block);
  const hasBlock = block && hasActiveBlock(block);

  if(pageName==='Dashboard' && !hasBlock){
    showPage('Setup');
    return;
  }

  // Workout should be accessible even before a block exists (shows an empty state)
  if(pageName==='Workout' && !hasBlock){
    showPage('Workout');
    renderWeekPage();
    return;
  }

  // History can be viewed anytime (even before making a block)
  showPage(pageName);

  if(pageName==='Dashboard') renderDashboard();
  else if(pageName==='Workout') renderWeekPage();
  else if(pageName==='History') renderHistoryPage();
  else if(pageName==='Settings') renderSettingsPage();
}


// Clear setup form for fresh start
function clearSetupForm(){
  // Ensure profile selector is populated and reflects the active profile.
  renderSetupProfileControls();

  const existingProf=getStorage(SK.profile,null);

  $('setupUnits').value=(existingProf && existingProf.units)?existingProf.units:'kg';
  $('setupBlockLength').value='8';
  $('setupProgram').value='general';

  // NEW: Athlete mode + transition defaults
  if($('setupAthleteMode')) $('setupAthleteMode').value = (existingProf && existingProf.athleteMode) ? existingProf.athleteMode : 'recreational';
  if($('setupTransitionProfile')) $('setupTransitionProfile').value = (existingProf && existingProf.transitionProfile) ? existingProf.transitionProfile : 'standard';
  // If user just started a new block while mid-program, suggest a ramp-in automatically.
  const pending=getStorage(SK.pendingTransition,null);
  if($('setupTransitionWeeks')){
    let w = (existingProf && typeof existingProf.transitionWeeks!=='undefined') ? existingProf.transitionWeeks : 1;
    if(pending && pending.recommendedWeeks!=null){
      w = pending.recommendedWeeks;
    }
    $('setupTransitionWeeks').value = String(w);
  }
  $('setupDuration').value='75';
    if($('setupIncludeBlocks')) $('setupIncludeBlocks').value = (existingProf && existingProf.includeBlocks===false) ? 'no' : 'yes';
    if($('setupVolumePref')) $('setupVolumePref').value = (existingProf && existingProf.volumePreference)?existingProf.volumePreference:'reduced';
    if($('setupAutoCut')) $('setupAutoCut').value = (existingProf && existingProf.autoCutEnabled===false) ? 'no' : 'yes';
  // Pre-fill maxes from profile (reduces clicks). If missing, leave blank.
  $('setupSnatch').value=(existingProf && existingProf.snatch)?existingProf.snatch:'';
  $('setupCleanJerk').value=(existingProf && existingProf.cleanJerk)?existingProf.cleanJerk:'';
  $('setupFrontSquat').value=(existingProf && existingProf.frontSquat)?existingProf.frontSquat:'';
  $('setupBackSquat').value=(existingProf && existingProf.backSquat)?existingProf.backSquat:'';

  // Athlete Details (optional) - keep UI calm but restore user's last selections
  if($('setupAge')) $('setupAge').value = (existingProf && typeof existingProf.age==='number') ? String(existingProf.age) : '';
  if($('setupTrainingAge')) $('setupTrainingAge').value = (existingProf && existingProf.trainingAgeYears!=null) ? String(existingProf.trainingAgeYears) : '1';
  if($('setupRecovery')) $('setupRecovery').value = (existingProf && existingProf.recoveryCapacity!=null) ? String(existingProf.recoveryCapacity) : '3';
  if($('setupLimiter')) $('setupLimiter').value = (existingProf && existingProf.limiter) ? existingProf.limiter : 'balanced';
  if($('setupCompetitionDate')) $('setupCompetitionDate').value = (existingProf && existingProf.competitionDate) ? String(existingProf.competitionDate).slice(0,10) : '';
  // Macro period: if autoMacroFromMeet is enabled, keep selector on AUTO
  if($('setupMacroPeriod')) $('setupMacroPeriod').value = (existingProf && existingProf.autoMacroFromMeet) ? 'AUTO' : String((existingProf && existingProf.macroPeriod) ? existingProf.macroPeriod : 'PP').toUpperCase();
  if($('setupTaperStyle')) $('setupTaperStyle').value = (existingProf && existingProf.taperStyle) ? existingProf.taperStyle : 'default';
  if($('setupHeavySingleExposure')) $('setupHeavySingleExposure').value = (existingProf && existingProf.heavySingleExposure) ? 'on' : 'off';
  if($('setupInjuryPreset')){
    const inj=(existingProf && existingProf.injuries)?existingProf.injuries:{};
    const keys=['shoulder','wrist','elbow','back','hip','knee','ankle'];
    const active=keys.filter(k=>!!inj[k]);
    $('setupInjuryPreset').value = (active.length===0) ? 'none' : (active.length===1 ? active[0] : 'multiple');
    // Set checkbox grid if multiple
    if($('injShoulder')) $('injShoulder').checked=!!inj.shoulder;
    if($('injWrist')) $('injWrist').checked=!!inj.wrist;
    if($('injElbow')) $('injElbow').checked=!!inj.elbow;
    if($('injBack')) $('injBack').checked=!!inj.back;
    if($('injHip')) $('injHip').checked=!!inj.hip;
    if($('injKnee')) $('injKnee').checked=!!inj.knee;
    if($('injAnkle')) $('injAnkle').checked=!!inj.ankle;
  }
  // Clear day selections
  document.querySelectorAll('#mainDaySelector .day-btn').forEach(btn=>{
    btn.classList.remove('active');
  });
  document.querySelectorAll('#accessoryDaySelector .day-btn').forEach(btn=>{
    btn.classList.remove('accessory');
    btn.disabled=false;
    btn.style.opacity='1';
    btn.style.cursor='pointer';
  });
}

function renderSetupProfileControls(){
  try{
    const pidx=loadProfilesIndex();
    const sel=$('setupProfileSelect');
    if(!sel) return;
    sel.innerHTML=pidx.profiles.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value=ACTIVE_PROFILE_ID;
  }catch(e){
    console.error('renderSetupProfileControls',e);
  }
}

// Week Page
function renderWeekPage(){
  const block=getStorage(SK.block);
  const sessions=getStorage(SK.sessions,[]);
  
  if(!block){
    $('blockInfo').textContent='No Active Block';
    $('blockSubtitle').textContent='Generate a block to get started';
    $('weekCalendar').innerHTML='<div style="text-align:center;color:var(--text-dim);padding:40px"><p style="margin-bottom:10px">No training block found.</p><p style="font-size:12px;opacity:.9">Go to the Setup tab to generate one.</p></div>';
    $('weekStats').innerHTML='';
    return;
  }
  
  $('blockInfo').textContent=`${block.philosophyName || block.programType.toUpperCase()} Program`;
  $('blockSubtitle').textContent=`${block.daysPerWeek} days/week • ${block.blockLength} weeks • ${block.sessionDuration}min • ${block.philosophy ? '🎯 ' + block.philosophy.replace('_', ' ') : ''}`;
  $('weekCurrent').textContent=`Week ${block.currentWeek}`;
  
  const weekSessions=sessions.filter(s=>s.week===block.currentWeek);
  const completed=weekSessions.filter(s=>s.status==='completed').length;
  const total=weekSessions.length;
  const allCompleted=sessions.filter(s=>s.status==='completed').length;
  const allTotal=sessions.length;
  const progress=allTotal>0?(allCompleted/allTotal*100):0;
  
  // NEW: Calculate weekly volume
  const weeklyVol=calculateWeeklyVolume(block.currentWeek);
  const prof=getStorage(SK.profile);
  const unit=prof?.units||'kg';
  const volDisplay=weeklyVol.weekVolume>0?Math.round(weeklyVol.weekVolume).toLocaleString():'—';
  
  // NEW: Get readiness data
  const readiness=getAverageReadiness(7);
  const readinessDisplay=readiness?`${readiness.avgReadiness.toFixed(1)}/5`:'—';
  const readinessColor=readiness&&readiness.avgReadiness<2.5?'var(--danger)':readiness&&readiness.avgReadiness>=4?'var(--success)':'var(--text)';
  
  $('weekStats').innerHTML=`
    <div class="stat-box">
      <div class="stat-value">${completed}/${total}</div>
      <div class="stat-label">This Week</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${allCompleted}/${allTotal}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${Math.round(progress)}%</div>
      <div class="stat-label">Complete</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${volDisplay}${weeklyVol.weekVolume>0?unit:''}</div>
      <div class="stat-label">Volume</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color:${readinessColor}">${readinessDisplay}</div>
      <div class="stat-label">Readiness</div>
    </div>`;
  $('weekProgress').style.width=`${progress}%`;
  
  const calendar=$('weekCalendar');
  calendar.innerHTML='';
  
  const today=new Date().toDateString();
  
  weekSessions.forEach(session=>{
    const sessionDate=new Date(session.date).toDateString();
    const isToday=sessionDate===today;
    
    const card=document.createElement('div');
    card.className='day-card-v2';
    if(session.status==='completed')card.classList.add('completed');
    if(session.focusType==='recovery')card.classList.add('recovery-day');
    if(session.focusType==='accessory')card.classList.add('accessory-day');
    if(isToday)card.classList.add('today');
    
    // Per-workout readiness (session-specific)
    const sessionReadiness=getSessionReadiness(session.id);
    const readinessLogged=!!sessionReadiness;
    const readinessScore=sessionReadiness?sessionReadiness.calculatedScore||sessionReadiness.readiness:null;
    const readinessBtnClass=readinessLogged?'btn-readiness logged':'btn-readiness';
    const readinessBtnText=readinessLogged?`✓ ${readinessScore}/5`:'💪 Readiness';

    let badgeClass='badge-strength';
    if(session.focusType==='snatch')badgeClass='badge-snatch';
    else if(session.focusType==='cleanJerk')badgeClass='badge-cj';
    else if(session.focusType==='mixed')badgeClass='badge-mixed';
    else if(session.focusType==='recovery')badgeClass='badge-recovery';
    else if(session.focusType==='accessory')badgeClass='badge-accessory';
    
    const sessionSets=getStorage(SK.sets,[]).filter(s=>s.sessionId===session.id);
    const logs=getStorage(SK.logs,[]);
    
    const exerciseGroups={};
    sessionSets.forEach(set=>{
      const key=`${set.blockOrder}_${set.exercise}`;
      if(!exerciseGroups[key]){
        exerciseGroups[key]={
          exercise:set.exercise,
          blockOrder:set.blockOrder,
          type:set.type,
          // Used for category-safe swaps in the Week view quick editor
          exerciseType:set.exerciseType||inferExerciseTypeFromExerciseName(set.exercise),
          sets:[],
          completed:0
        };
      }
      exerciseGroups[key].sets.push(set);
      const log=logs.find(l=>l.setId===set.id);
      if(log&&isSuccessfulStatus(log.status))exerciseGroups[key].completed++;
    });
    
    const sortedGroups=Object.values(exerciseGroups).sort((a,b)=>a.blockOrder-b.blockOrder);
    
    const totalSets=sessionSets.length;
    const completedSets=sessionSets.filter(s=>{
      const log=logs.find(l=>l.setId===s.id);
      return log&&isSuccessfulStatus(log.status);
    }).length;
    
    const displayType=session.focusType==='recovery'?'Recovery':session.focusType==='accessory'?'Accessory':session.focusType.toUpperCase();
    const completionBadge=session.status==='completed'?'<span class="mini-badge success">✓ Done</span>':'';
    
    let cardHTML=`
      <div class="day-card-header" onclick="toggleDayCard(this)">
        <div class="day-header-left">
          <div class="day-number">Day ${session.day}</div>
          <div class="day-date">${formatDate(session.date)}</div>
          ${isToday?'<span class="mini-badge primary">Today</span>':''}
          ${completionBadge}
        </div>
        <div class="day-header-right">
          <button class="${readinessBtnClass} small" onclick="openReadinessModal('${session.id}');event.stopPropagation()">${readinessBtnText}</button>
          <span class="day-badge ${badgeClass}">${displayType}</span>
          <span class="day-stats">${completedSets}/${totalSets} sets</span>
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="day-card-body ${isToday?'expanded':''}">`;
    
    sortedGroups.forEach((group,idx)=>{
      const firstSet=group.sets[0];
      const label=group.blockOrder===1?'Main':group.blockOrder===2?'Secondary':group.blockOrder===3?'Strength':'Accessory';
      const weight=firstSet.suggestedWeight||0;
      const unit=block.units||'kg';
      const intensity=Math.round(firstSet.targetIntensity*100);
      const progressPct=group.sets.length>0?(group.completed/group.sets.length*100):0;

      // Quick swap dropdown (Week view) — show a few high-quality alternatives
      // based on the same family/scoring logic as the full swap modal.
      const quickSwapOptions=getWeekQuickSwapOptions({
        exercise:group.exercise,
        exerciseType:group.exerciseType||inferExerciseTypeFromExerciseName(group.exercise),
        limit:5
      });
      const quickSwapHtml=quickSwapOptions.length?`
        <select class="quick-swap" title="Swap exercise" 
          data-session-id="${session.id}" 
          data-block-order="${group.blockOrder}" 
          data-exercise="${encodeURIComponent(group.exercise)}" 
          data-exercise-type="${group.exerciseType||inferExerciseTypeFromExerciseName(group.exercise)}"
          onclick="event.stopPropagation()">
          <option value="" disabled selected>Swap…</option>
          <optgroup label="Current">
            <option value="" disabled>${escapeHtml(group.exercise)}</option>
          </optgroup>
          <optgroup label="Suggested">
            ${quickSwapOptions.map(n=>`<option value="${encodeURIComponent(n)}">${escapeHtml(n)}</option>`).join('')}
          </optgroup>
        </select>
      `:'';
      
      cardHTML+=`
        <div class="exercise-quick ${idx===0?'expanded':''}" data-session="${session.id}" data-group="${idx}">
          <div class="exercise-quick-header" onclick="toggleExerciseQuick(this,event)">
            <div class="exercise-info">
              <span class="exercise-label">${label}</span>
              <span class="exercise-name">${group.exercise}</span>
            </div>
            <div class="exercise-meta">
              <span class="exercise-weight">${weight}${unit}</span>
              ${intensity > 0 ? `<span class="exercise-intensity">${intensity}%</span>` : ''}
              <span class="exercise-progress">${group.completed}/${group.sets.length}</span>
              ${quickSwapHtml}
              <span class="exercise-expand">▼</span>
            </div>
          </div>
          <div class="exercise-quick-body">
            <div class="exercise-progress-bar">
              <div class="exercise-progress-fill" style="width:${progressPct}%"></div>
            </div>
            <div class="sets-mini">
              <div class="set-mini set-mini-label-row" aria-hidden="true">
                <span></span>
                <span></span>
                <span class="col-label">Weight</span>
                <span class="col-label">Reps</span>
                <span class="col-label">RPE</span>
                <span class="col-label">Action</span>
              </div>`;
      
      group.sets.forEach((set,setIdx)=>{
        const log=logs.find(l=>l.setId===set.id);
        const status=log?.status||'none';
        const statusIcon=status==='easy'?'⬆':status==='skip'?'⏭':isSuccessfulStatus(status)?'✓':status==='tough'?'⚠':status==='miss'?'✗':'○';
        const statusClass=status==='easy'?'status-easy':status==='skip'?'status-skip':isSuccessfulStatus(status)?'status-made':status==='tough'?'status-tough':status==='miss'?'status-miss':'';
        
        const intensityDisplay = set.targetIntensity > 0 ? `${Math.round(set.targetIntensity*100)}%` : 'BW';
        
        cardHTML+=`
          <div class="set-mini ${statusClass}">
            <span class="set-num">${setIdx+1}</span>
            <span class="set-target">${set.targetReps}×${intensityDisplay}</span>
            <input type="number" step="0.5" value="${log?.weight||set.suggestedWeight}" 
              data-set-id="${set.id}" data-field="weight" 
              onchange="handleSetInput(event)"
              onclick="event.stopPropagation()"
              class="set-input-mini">
            <input type="number" value="${log?.reps||set.targetReps}" 
              data-set-id="${set.id}" data-field="reps" 
              onchange="handleSetInput(event)"
              onclick="event.stopPropagation()"
              class="set-input-mini">
            <input type="number" step="0.5" value="${log?.rpe||set.targetRPE||8}" 
              data-set-id="${set.id}" data-field="rpe" 
              onchange="handleSetInput(event)"
              onclick="event.stopPropagation()"
              class="set-input-mini rpe">
            <div class="set-actions-mini">
              <select class="set-action-select" data-set-id="${set.id}" onchange="handleStatusSelect(event)" onclick="event.stopPropagation()" aria-label="Set action">
                <option value="none" ${status==='none'?'selected':''}>⋯</option>
                <option value="easy" ${status==='easy'?'selected':''}>⬆ Easy</option>
                <option value="made" ${status==='made'?'selected':''}>✓ Made</option>
                <option value="tough" ${status==='tough'?'selected':''}>⚠ Tough</option>
                <option value="miss" ${status==='miss'?'selected':''}>✗ Miss</option>
              </select>
              <div class="set-status-btns-mini">
                <button class="status-btn-mini ${status==='easy'?'active':''}" 
                  data-set-id="${set.id}" data-status="easy" 
                  onclick="handleStatusClick(event)" 
                  title="Easy">⬆</button>
                <button class="status-btn-mini ${status==='made'?'active':''}" 
                  data-set-id="${set.id}" data-status="made" 
                  onclick="handleStatusClick(event)" 
                  title="Made">✓</button>
                <button class="status-btn-mini ${status==='tough'?'active':''}" 
                  data-set-id="${set.id}" data-status="tough" 
                  onclick="handleStatusClick(event)" 
                  title="Tough">⚠</button>
                <button class="status-btn-mini ${status==='miss'?'active':''}" 
                  data-set-id="${set.id}" data-status="miss" 
                  onclick="handleStatusClick(event)" 
                  title="Miss">✗</button>
              </div>
            </div>
          </div>`;
      });
      
      cardHTML+=`
            </div>
          </div>
        </div>`;
    });
    
    const startBtn=session.status==='completed'?
      '<button class="btn-mini secondary" disabled>▶ Start</button>':
      `<button class="btn-mini secondary" onclick="openExecutionMode('${session.id}');event.stopPropagation()">▶ Start</button>`;

    const completeBtn=session.status==='completed'?
      '<button class="btn-mini secondary" disabled>✓ Completed</button>':
      `<button class="btn-mini success" onclick="completeSessionQuick('${session.id}');event.stopPropagation()">✓ Complete</button>`;
    
    cardHTML+=`
        <div class="day-card-actions">
          ${startBtn}
          ${completeBtn}
        </div>
      </div>`;
    
    card.innerHTML=cardHTML;
    calendar.appendChild(card);
  });

  // Wire quick swap dropdowns (Week view)
  // Note: we delegate here after rendering to avoid inline JS beyond stopPropagation.
  calendar.querySelectorAll('select.quick-swap').forEach(sel=>{
    sel.addEventListener('change',function(e){
      try{
        e.stopPropagation();
        const sessionId=this.dataset.sessionId;
        const blockOrder=parseInt(this.dataset.blockOrder||'0',10);
        const current=decodeURIComponent(this.dataset.exercise||'');
        const exerciseType=this.dataset.exerciseType||inferExerciseTypeFromExerciseName(current);
        const newExercise=decodeURIComponent(this.value||'');
        // Reset UI immediately
        this.value='';
        if(!newExercise) return;

        const ok=performSwapExercise({sessionId,blockOrder,exercise:current,exerciseType,newExercise});
        if(ok){
          toast('🔁 Exercise swapped');
          renderWeekPage();
        }
      }catch(err){
        console.error('quick-swap change error:',err);
        toast('⚠️ Swap failed');
      }
    });
  });
}

// Dashboard tab (landing page when a block exists)
function renderDashboard(){
  try{
    const prof=getStorage(SK.profile);
    const block=getStorage(SK.block);
    const sessions=getStorage(SK.sessions,[]);

    if(!prof){
      const sub=$('dashboardSubtitle');
      if(sub)sub.textContent='Complete setup to see your dashboard';
      const stats=$('dashboardStats');
      if(stats)stats.innerHTML='';
      const maxes=$('dashboardMaxes');
      if(maxes)maxes.innerHTML='';
      return;
    }

    const units=prof.units||'kg';

    if(!hasActiveBlock(block)){
      if($('dashboardSubtitle'))$('dashboardSubtitle').textContent='No active block yet — create one to start training';
      if($('dashboardStats'))$('dashboardStats').innerHTML=`
        <div class="stat-box"><div class="stat-value">—</div><div class="stat-label">Block</div></div>
        <div class="stat-box"><div class="stat-value">—</div><div class="stat-label">Week</div></div>
        <div class="stat-box"><div class="stat-value">—</div><div class="stat-label">Volume</div></div>
        <div class="stat-box"><div class="stat-value">—</div><div class="stat-label">Readiness</div></div>`;
    }else{
      const total=sessions.length;
      const done=sessions.filter(s=>s.status==='completed').length;
      const pct=total?Math.round(done/total*100):0;
      const weeklyVol=calculateWeeklyVolume(block.currentWeek||1);
      const volDisplay=weeklyVol.weekVolume>0?Math.round(weeklyVol.weekVolume).toLocaleString()+units:'—';
      const readiness=getAverageReadiness(7);
      const readinessDisplay=readiness?`${readiness.avgReadiness.toFixed(1)}/5`:'—';

      if($('dashboardSubtitle')){
        $('dashboardSubtitle').textContent=`${block.programType?.toUpperCase()||'Program'} • Week ${block.currentWeek||1}/${block.blockLength||'—'} • ${pct}% complete`;
      }
      if($('dashboardStats')){
        $('dashboardStats').innerHTML=`
          <div class="stat-box"><div class="stat-value">${block.name||block.programType?.toUpperCase()||'Program'}</div><div class="stat-label">Block</div></div>
          <div class="stat-box"><div class="stat-value">W${block.currentWeek||1}</div><div class="stat-label">Current Week</div></div>
          <div class="stat-box"><div class="stat-value">${volDisplay}</div><div class="stat-label">Week Volume</div></div>
          <div class="stat-box"><div class="stat-value">${readinessDisplay}</div><div class="stat-label">Readiness</div></div>
          <div class="stat-box"><div class="stat-value">${done}/${total}</div><div class="stat-label">Sessions</div></div>`;
      }
    }

    if($('dashboardMaxes')){
      $('dashboardMaxes').innerHTML=`
        <div class="stat-box">
          <div class="stat-label">Snatch</div>
          <input id="dashMaxSnatch" type="number" inputmode="decimal" step="0.5" placeholder="—" value="${prof.snatch||''}" style="margin-top:8px"/>
          <div class="muted" style="margin-top:6px">${units}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Clean &amp; Jerk</div>
          <input id="dashMaxCJ" type="number" inputmode="decimal" step="0.5" placeholder="—" value="${prof.cleanJerk||''}" style="margin-top:8px"/>
          <div class="muted" style="margin-top:6px">${units}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Front Squat</div>
          <input id="dashMaxFS" type="number" inputmode="decimal" step="0.5" placeholder="—" value="${prof.frontSquat||''}" style="margin-top:8px"/>
          <div class="muted" style="margin-top:6px">${units}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Back Squat</div>
          <input id="dashMaxBS" type="number" inputmode="decimal" step="0.5" placeholder="—" value="${prof.backSquat||''}" style="margin-top:8px"/>
          <div class="muted" style="margin-top:6px">${units}</div>
        </div>
        <div style="grid-column:1/-1;display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
          <button class="primary" id="btnSaveDashMaxes">💾 Save Maxes</button>
        </div>`;

      const saveBtn=$('btnSaveDashMaxes');
      if(saveBtn){
        saveBtn.onclick=()=>saveDashboardMaxesFromDashboard();
      }
    }
  }catch(err){
    console.error('Render dashboard error:',err);
  }
}


// Save maxes directly from dashboard and recalculate future programming weights
function saveDashboardMaxesFromDashboard(){
  try{
    const prof=getStorage(SK.profile);
    if(!prof){toast('⚠️ No profile found');return;}

    const readNum=(id,fallback)=>{
      const el=$(id);
      if(!el)return fallback;
      const v=parseFloat(String(el.value||'').trim());
      return Number.isFinite(v)&&v>0?v:fallback;
    };

    const updated={
      ...prof,
      snatch:readNum('dashMaxSnatch',prof.snatch||0),
      cleanJerk:readNum('dashMaxCJ',prof.cleanJerk||0),
      frontSquat:readNum('dashMaxFS',prof.frontSquat||0),
      backSquat:readNum('dashMaxBS',prof.backSquat||0)
    };

    const ok=setStorage(SK.profile,updated);
    if(!ok)throw new Error('Failed to save profile');

    // Keep block in sync (some parts of UI and older logic read maxes from block)
    const blk=getStorage(SK.block);
    if(blk){
      blk.snatch=updated.snatch;
      blk.cleanJerk=updated.cleanJerk;
      blk.frontSquat=updated.frontSquat;
      blk.backSquat=updated.backSquat;
      blk.units=updated.units||blk.units;
      setStorage(SK.block,blk);
    }

    // Recalculate programming (including the current day) and sync any uncommitted logs
    const recalc=recalculateProgrammingForNewMaxes(updated,{syncUncommittedLogs:true});
    if(recalc&&(recalc.updated>0||recalc.updatedLogs>0)){
      toast(`✅ Maxes saved • Updated ${recalc.updated} sets`);
    }else toast('✅ Maxes saved');

    renderDashboard();
    // If the user is on the Workout tab, weights should update visually
    renderWeekPage();
    // If execution overlay is open, refresh current set display
    const overlay=$('execOverlay');
    if(overlay&&overlay.classList.contains('show')){
      renderExecutionSet();
    }
  }catch(err){
    console.error('Save dashboard maxes error:',err);
    toast('⚠️ '+err.message);
  }
}
// Workout Detail (modal fallback) - keeping for compatibility
function openWorkoutDetail(sessionId){
  const block=getStorage(SK.block);
  const sessions=getStorage(SK.sessions,[]);
  const session=sessions.find(s=>s.id===sessionId);
  if(!session)return;
  
  block.selectedSession=sessionId;
  setStorage(SK.block,block);
  
  $('detailTitle').textContent=session.title;
  $('detailMeta').textContent=`${formatDate(session.date)} • Phase: ${session.phase}`;
  
  renderWorkoutDetail(session);
  $('workoutDetail').classList.add('show');
}

function renderWorkoutDetail(session){
  const allSets=getStorage(SK.sets,[]);
  const logs=getStorage(SK.logs,[]);
  const block=getStorage(SK.block);
  const sessionSets=allSets.filter(s=>s.sessionId===session.id);
  
  const groups={};
  sessionSets.forEach(set=>{
    const key=`${set.blockOrder}_${set.exercise}`;
    if(!groups[key]){groups[key]={exercise:set.exercise,blockOrder:set.blockOrder,type:set.type,exerciseType:set.exerciseType,sets:[],collapsed:true}}
    groups[key].sets.push(set);
  });
  
  const sortedGroups=Object.values(groups).sort((a,b)=>a.blockOrder-b.blockOrder);
  const body=$('detailBody');
  body.innerHTML='';
  
  sortedGroups.forEach((group,groupIdx)=>{
    const label=group.blockOrder===1?'Main Lift':group.blockOrder===2?'Secondary':group.blockOrder===3?'Strength':'Accessory';
    const first=group.sets[0];
    const targetInfo=first.targetIntensity?`${Math.round(first.targetIntensity*100)}% • ${first.suggestedWeight}${block.units}`:'Bodyweight';
    const completed=group.sets.filter(s=>logs.find(l=>l.setId===s.id&&isSuccessfulStatus(l.status))).length;
    const progressText=`${completed}/${group.sets.length} completed`;
    
    const groupDiv=document.createElement('div');
    groupDiv.className='exercise-group';
    groupDiv.innerHTML=`<div class="group-header" data-group="${groupIdx}">
        <div class="group-header-left">
          <div>
            <div class="group-title">${group.exercise}</div>
            <div class="group-meta">${label} • ${targetInfo} • ${progressText}</div>
          </div>
        </div>
        <div class="group-header-right">
          <button class="swap-btn" title="Swap exercise" data-session-id="${session.id}" data-block-order="${group.blockOrder}" data-exercise="${encodeURIComponent(group.exercise)}" data-exercise-type="${group.exerciseType}">🔁</button>
          <span class="group-icon">▼</span>
        </div>
      </div>
      <div class="group-content" id="group${groupIdx}"></div>`;
    body.appendChild(groupDiv);
    
    const content=$(`group${groupIdx}`);
    const table=document.createElement('table');
    table.className='set-table';
    const tableWrap=document.createElement('div');
    tableWrap.className='table-scroll';
    tableWrap.appendChild(table);

    
    group.sets.sort((a,b)=>a.setIndex-b.setIndex).forEach((set,idx)=>{
      const log=logs.find(l=>l.setId===set.id);
      const status=log?.status||'none';
      const tr=document.createElement('tr');
      tr.className='set-row';
      
      const intensityDisplay = set.targetIntensity > 0 ? `${Math.round(set.targetIntensity*100)}%` : 'BW';
      
      tr.innerHTML=`<td>${idx+1}</td><td style="font-size:12px"><div style="color:var(--text-dim)">Target</div>${set.targetReps} × ${intensityDisplay}</td><td><div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">Weight</div><input type="number" step="0.5" value="${log?.weight||set.suggestedWeight}" data-set-id="${set.id}" data-field="weight"></td><td><div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">Reps</div><input type="number" value="${log?.reps||set.targetReps}" data-set-id="${set.id}" data-field="reps"></td><td><div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">RPE</div><input type="number" step="0.5" value="${log?.rpe||set.targetRPE||8}" data-set-id="${set.id}" data-field="rpe"></td><td>
        <select class="status-select" data-set-id="${set.id}" onchange="handleStatusSelect(event)" aria-label="Set status">
          <option value="none" ${status==='none'?'selected':''}>⋯</option>
          <option value="easy" ${status==='easy'?'selected':''}>⬆ Easy</option>
          <option value="made" ${status==='made'?'selected':''}>✓ Made</option>
          <option value="tough" ${status==='tough'?'selected':''}>⚠ Tough</option>
          <option value="miss" ${status==='miss'?'selected':''}>✗ Miss</option>
        </select>
        <div class="status-btns">
          <button class="status-btn ${status==='easy'?'active-easy':''}" data-set-id="${set.id}" data-status="easy" title="Easy">🟢</button>
          <button class="status-btn ${status==='made'?'active-made':''}" data-set-id="${set.id}" data-status="made" title="Made">✅</button>
          <button class="status-btn ${status==='tough'?'active-tough':''}" data-set-id="${set.id}" data-status="tough" title="Tough">⚠️</button>
          <button class="status-btn ${status==='miss'?'active-miss':''}" data-set-id="${set.id}" data-status="miss" title="Miss">❌</button>
        </div></td>`;
      table.appendChild(tr);
    });
    content.appendChild(tableWrap);
  });
  
  body.querySelectorAll('.group-header').forEach(header=>{
    header.addEventListener('click',function(){
      const groupId=this.getAttribute('data-group');
      const content=$(`group${groupId}`);
      if(content.classList.contains('show')){content.classList.remove('show');this.classList.add('collapsed')}
      else{content.classList.add('show');this.classList.remove('collapsed')}
    });
  });

  // Swap exercise button (per-exercise group)
  body.querySelectorAll('.swap-btn').forEach(btn=>{
    btn.addEventListener('click',function(e){
      e.preventDefault();
      e.stopPropagation();
      const sessionId=this.dataset.sessionId;
      const blockOrder=parseInt(this.dataset.blockOrder);
      const exercise=decodeURIComponent(this.dataset.exercise||'');
      const exerciseType=this.dataset.exerciseType||'';
      openSwapExerciseModal({sessionId,blockOrder,exercise,exerciseType});
    });
  });
  
  body.querySelectorAll('input').forEach(input=>{input.addEventListener('change',handleSetInputChange)});
  body.querySelectorAll('.status-btn').forEach(btn=>{btn.addEventListener('click',handleStatusClick)});
}

// =====================================================
// EXERCISE SWAP (Per-exercise group)
// =====================================================

// In some older blocks/sets, exerciseType may be missing.
// We infer it from the exercise name so swaps remain category-safe.
function inferExerciseTypeFromExerciseName(exerciseName){
  const n=String(exerciseName||'').toLowerCase();
  if(n.includes('snatch')) return 'snatch';
  if(n.includes('clean') || n.includes('jerk')) return 'cleanJerk';
  if(n.includes('squat')) return 'squat';
  if(n.includes('press') || n.includes('push press') || n.includes('bench')) return 'accessory';
  if(n.includes('pull')){
    // Pulls can be treated like their parent family but for swap purposes
    // we keep them under snatch/cleanJerk so we recommend the right pull list.
    if(n.includes('snatch')) return 'snatch';
    return 'cleanJerk';
  }
  return 'accessory';
}

function buildExerciseNameIndex(){
  // Map exercise name -> descriptor for fast lookup
  const idx = new Map();

  function add(name, meta){
    if(!name) return;
    const key=String(name);
    if(!idx.has(key)) idx.set(key, meta);
  }

  // Snatch / Clean / Jerk families
  ['snatch','clean','jerk'].forEach(fam=>{
    const famObj = EXERCISE_DATABASE[fam];
    if(!famObj) return;
    Object.keys(famObj).forEach(cat=>{
      (famObj[cat]||[]).forEach(ex=>add(ex.name,{family:fam,category:cat,source:'db',obj:ex}));
    });
  });

  // Pulls
  (EXERCISE_DATABASE?.pulls?.snatch||[]).forEach(ex=>add(ex.name,{family:'pulls_snatch',category:'pulls',source:'db',obj:ex}));
  (EXERCISE_DATABASE?.pulls?.clean||[]).forEach(ex=>add(ex.name,{family:'pulls_clean',category:'pulls',source:'db',obj:ex}));

  // Accessory exercises
  Object.keys(ACCESSORY_EXERCISES||{}).forEach(cat=>{
    (ACCESSORY_EXERCISES[cat]||[]).forEach(ex=>add(ex.name,{family:'accessory',category:cat,source:'accessory',obj:ex}));
  });

  // Core squat staples
  add('Back Squat',{family:'squat',category:'barbell',source:'builtin'});
  add('Front Squat',{family:'squat',category:'barbell',source:'builtin'});

  return idx;
}

let __EX_NAME_INDEX=null;
function getExerciseIndex(){
  if(!__EX_NAME_INDEX) __EX_NAME_INDEX=buildExerciseNameIndex();
  return __EX_NAME_INDEX;
}

function inferSwapFamily(exerciseName, exerciseType){
  const name=String(exerciseName||'');
  const lower=name.toLowerCase();
  if(exerciseType==='snatch'){
    if(lower.includes('pull')) return 'pulls_snatch';
    return 'snatch';
  }
  if(exerciseType==='cleanJerk'){
    if(lower.includes('pull')) return 'pulls_clean';
    // Some programs use jerk-only variations as secondary
    if(lower.includes('jerk')) return 'jerk';
    // Otherwise treat as clean family
    return 'clean';
  }
  if(exerciseType==='squat') return 'squat';
  if(exerciseType==='accessory') return 'accessory';
  if(exerciseType==='recovery') return 'recovery';
  return 'accessory';
}

function getCandidateNamesForFamily(family, prof){
  const includeBlocks = (prof?.includeBlocks !== false);

  if(family==='snatch') return getAllExercisesForFamily('snatch',{includeBlocks}).map(x=>x.name);
  if(family==='clean') return getAllExercisesForFamily('clean',{includeBlocks}).map(x=>x.name);
  if(family==='jerk') return getAllExercisesForFamily('jerk',{includeBlocks}).map(x=>x.name);
  if(family==='pulls_snatch') return (EXERCISE_DATABASE?.pulls?.snatch||[]).map(x=>x.name);
  if(family==='pulls_clean') return (EXERCISE_DATABASE?.pulls?.clean||[]).map(x=>x.name);

  if(family==='squat'){
    const acc=(ACCESSORY_EXERCISES?.squats||[]).map(x=>x.name);
    const base=['Back Squat','Front Squat'];
    return Array.from(new Set(base.concat(acc)));
  }

  if(family==='accessory'){
    const names=[];
    Object.keys(ACCESSORY_EXERCISES||{}).forEach(cat=>{
      (ACCESSORY_EXERCISES[cat]||[]).forEach(ex=>names.push(ex.name));
    });
    return Array.from(new Set(names));
  }

  if(family==='recovery'){
    return ['Foam Rolling','Band Pull-Aparts','Dead Hangs','Hip Mobility','Core Work'];
  }

  return [];
}

function scoreSwapCandidate(currentName, candName){
  const cur=String(currentName||'').toLowerCase();
  const cand=String(candName||'').toLowerCase();
  let score=0;
  // Prefer closer pattern matches (hang/power/pause)
  ['power','hang','high hang','pause','tempo','balance','pull','snatch','clean','jerk','front','back','overhead'].forEach(tok=>{
    const t=tok.toLowerCase();
    const curHas=cur.includes(t);
    const candHas=cand.includes(t);
    if(curHas && candHas) score+=2;
    if(curHas && !candHas) score-=0.5;
  });
  // Small preference for short/simple names (readability)
  score -= Math.max(0,(cand.length-18))*0.02;
  return score;
}

// Lightweight helper for the Week view dropdown.
// Returns a small set of high-quality alternatives based on the same
// swap family and scoring logic used by the full swap modal.
function getWeekQuickSwapOptions({exercise, exerciseType, limit=5}){
  try{
    const prof=getStorage(SK.profile)||{};
    const family=inferSwapFamily(exercise, exerciseType);
    let candidates=getCandidateNamesForFamily(family, prof)
      .map(n=>substituteIfNoBlocks(n, prof?.includeBlocks !== false));

    candidates=Array.from(new Set(candidates)).filter(n=>n && n!==exercise);
    if(candidates.length===0) return [];

    const ranked=candidates
      .map(n=>({name:n,score:scoreSwapCandidate(exercise,n)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0, Math.max(3, Math.min(12, limit)));

    return ranked.map(x=>x.name);
  }catch(err){
    console.error('getWeekQuickSwapOptions error:',err);
    return [];
  }
}

function openSwapExerciseModal({sessionId,blockOrder,exercise,exerciseType}){
  try{
    const sessions=getStorage(SK.sessions,[]);
    const prof=getStorage(SK.profile)||{};
    const session=sessions.find(s=>s.id===sessionId);
    if(!session){toast('⚠️ Session not found');return;}

    const family=inferSwapFamily(exercise, exerciseType);
    let candidates=getCandidateNamesForFamily(family, prof)
      .map(n=>substituteIfNoBlocks(n, prof?.includeBlocks !== false));

    // Remove duplicates + remove current
    candidates=Array.from(new Set(candidates)).filter(n=>n && n!==exercise);

    // Score and rank
    const ranked=candidates
      .map(n=>({name:n,score:scoreSwapCandidate(exercise,n)}))
      .sort((a,b)=>b.score-a.score);

    const top=ranked.slice(0,16);

    const html=`
      <div class="swap-modal">
        <div class="swap-current">Current: <b>${escapeHtml(exercise)}</b></div>
        <div class="swap-hint">Showing best matches for <b>${escapeHtml(family.replace('_',' '))}</b>. Swapping updates planned sets and recalculates suggested weights.</div>
        <div style="margin-top:10px">
          <input id="swapSearch" class="swap-search" placeholder="Search exercises…" />
        </div>
        <div id="swapList" class="swap-list">
          ${top.map(x=>`<button class="swap-choice" data-name="${encodeURIComponent(x.name)}">${escapeHtml(x.name)}</button>`).join('')}
        </div>
        <div class="swap-footer">
          <button class="btn" id="swapShowAll">Show all</button>
          <button class="btn secondary" id="swapCancel">Cancel</button>
        </div>
      </div>
    `;

    showModal('Swap exercise','Pick an alternative that fits the same slot in your program.',html);

    const modal=$('modalContent');
    const listEl=$('swapList');
    const searchEl=$('swapSearch');
    const showAllBtn=$('swapShowAll');
    const cancelBtn=$('swapCancel');

    function renderList(items){
      listEl.innerHTML = items.map(x=>`<button class="swap-choice" data-name="${encodeURIComponent(x.name)}">${escapeHtml(x.name)}</button>`).join('');
      listEl.querySelectorAll('.swap-choice').forEach(b=>{
        b.addEventListener('click',()=>{
          const newName=decodeURIComponent(b.dataset.name||'');
          const ok=performSwapExercise({sessionId,blockOrder,exercise,exerciseType,newExercise:newName});
          if(ok){closeModal();toast('🔁 Exercise swapped');}
        });
      });
    }

    function getFilteredRanked(q){
      const query=String(q||'').trim().toLowerCase();
      if(!query) return top;
      return ranked.filter(x=>x.name.toLowerCase().includes(query)).slice(0,40);
    }

    // Wire initial buttons
    listEl.querySelectorAll('.swap-choice').forEach(b=>{
      b.addEventListener('click',()=>{
        const newName=decodeURIComponent(b.dataset.name||'');
        const ok=performSwapExercise({sessionId,blockOrder,exercise,exerciseType,newExercise:newName});
        if(ok){closeModal();toast('🔁 Exercise swapped');}
      });
    });

    if(cancelBtn) cancelBtn.addEventListener('click',closeModal);

    if(showAllBtn){
      showAllBtn.addEventListener('click',()=>{
        renderList(ranked.slice(0,80));
        showAllBtn.disabled=true;
      });
    }

    if(searchEl){
      searchEl.addEventListener('input',()=>{
        renderList(getFilteredRanked(searchEl.value));
      });
      setTimeout(()=>{try{searchEl.focus()}catch(e){}},50);
    }
  }catch(err){
    console.error('openSwapExerciseModal error:',err);
    toast('⚠️ Could not open swap list');
  }
}

function escapeHtml(str){
  return String(str||'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function getBaseMaxForSet(exerciseType, exerciseName, prof){
  const name=String(exerciseName||'');
  if(exerciseType==='snatch'){
    const base=prof?.snatch||0;
    if(name.toLowerCase().includes('pull')) return base*PULL_MAX_MULTIPLIER;
    return base;
  }
  if(exerciseType==='cleanJerk'){
    const base=prof?.cleanJerk||0;
    if(name.toLowerCase().includes('pull')) return base*PULL_MAX_MULTIPLIER;
    return base;
  }
  if(exerciseType==='squat'){
    return name.includes('Front') ? (prof?.frontSquat||0) : (prof?.backSquat||0);
  }
  if(exerciseType==='accessory'){
    // Best-effort: infer category to pick a reasonable training max
    const idx=getExerciseIndex();
    const meta=idx.get(name);
    const cat=meta?.category;
    if(cat==='squats') return name.includes('Front') ? (prof?.frontSquat||0) : (prof?.backSquat||0);
    if(cat==='pulls'){
      const sn=(prof?.snatch||0)*PULL_MAX_MULTIPLIER;
      const cj=(prof?.cleanJerk||0)*PULL_MAX_MULTIPLIER;
      return name.toLowerCase().includes('snatch') ? sn : cj;
    }
    if(cat==='pressing') return (prof?.cleanJerk||0)*0.6;
    if(cat==='posteriorChain') return (prof?.backSquat||0)*0.7;
    return (prof?.backSquat||0);
  }
  return 0;
}

function lookupExerciseObjectByName(name){
  const idx=getExerciseIndex();
  const meta=idx.get(String(name||''));
  return meta?.obj || null;
}

function performSwapExercise({sessionId,blockOrder,exercise,exerciseType,newExercise}){
  try{
    const prof=getStorage(SK.profile)||{};
    const units=(getStorage(SK.block)||{}).units || prof.units || 'kg';

    // Update sets (only planned/uncompleted)
    const sets=getStorage(SK.sets,[]);
    const logs=getStorage(SK.logs,[]);
    const sessions=getStorage(SK.sessions,[]);
    const session=sessions.find(s=>s.id===sessionId);
    if(!session) return false;

    const includeBlocks=(prof?.includeBlocks !== false);
    const normalizedNew=substituteIfNoBlocks(newExercise, includeBlocks);
    const newObj=lookupExerciseObjectByName(normalizedNew);

    let touched=0;
    const updatedSets=sets.map(s=>{
      if(s.sessionId!==sessionId) return s;
      if(s.blockOrder!==blockOrder) return s;
      if(s.exercise!==exercise) return s;

      // Don't alter completed sets
      const log=logs.find(l=>l.setId===s.id);
      if(log && isSuccessfulStatus(log.status)) return s;

      let newIntensity=s.targetIntensity;
      if(newObj && session?.phase && typeof s.targetIntensity==='number' && s.targetIntensity>0){
        newIntensity=getExerciseIntensity(newObj, session.phase, s.targetIntensity);
      }

      const baseMax=getBaseMaxForSet(exerciseType, normalizedNew, prof);
      const newWeight=(newIntensity>0 && baseMax>0) ? calculateWeight(baseMax,newIntensity,units) : 0;

      touched++;
      return {
        ...s,
        exercise: normalizedNew,
        targetIntensity: newIntensity,
        suggestedWeight: newWeight,
        baseSuggestedWeight: newWeight
      };
    });

    if(touched===0){
      toast('Nothing to swap (already completed or not found).');
      return false;
    }

    setStorage(SK.sets, updatedSets);

    // Update session.exercises reference if it matches the swapped slot
    if(session && session.exercises){
      const ex = { ...session.exercises };
      if(blockOrder===1 && ex.main===exercise) ex.main=normalizedNew;
      if(blockOrder===2 && ex.secondary===exercise) ex.secondary=normalizedNew;
      if(blockOrder===3 && ex.strength===exercise) ex.strength=normalizedNew;
      if(blockOrder>=4 && ex.main===exercise) ex.main=normalizedNew;
      session.exercises=ex;
      setStorage(SK.sessions, sessions);
    }

    // Re-render if currently open
    try{renderWorkoutDetail(session);}catch(e){}
    return true;
  }catch(err){
    console.error('performSwapExercise error:',err);
    toast('⚠️ Swap failed');
    return false;
  }
}

function handleSetInputChange(e){
  const setId=e.target.dataset.setId;
  const field=e.target.dataset.field;
  const value=parseFloat(e.target.value);
  if(!setId||isNaN(value))return;
  
  let logs=getStorage(SK.logs,[]);
  let log=logs.find(l=>l.setId===setId);
  if(!log){
    const allSets=getStorage(SK.sets,[]);
    const set=allSets.find(s=>s.id===setId);
    log={id:uuid(),setId,weight:set.suggestedWeight,reps:set.targetReps,rpe:set.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
    logs.push(log);
  }
  log[field]=value;
  log.timestamp=new Date().toISOString();
  setStorage(SK.logs,logs);
  toast('💾 Saved');
}

function handleSetInput(e){
  try{
    const input=e.target;
    const setId=input.dataset.setId;
    const field=input.dataset.field;
    
    if(!setId||!field){
      console.error('Missing setId or field',{setId,field});
      return;
    }
    
    const value=field==='reps'?parseInt(input.value):parseFloat(input.value);
    
    if(isNaN(value)){
      console.error('Invalid value',{field,value:input.value});
      return;
    }
    
    let logs=getStorage(SK.logs,[]);
    let log=logs.find(l=>l.setId===setId);
    if(!log){
      const allSets=getStorage(SK.sets,[]);
      const set=allSets.find(s=>s.id===setId);
      if(!set){
        console.error('Set not found',setId);
        return;
      }
      log={id:uuid(),setId,weight:set.suggestedWeight,reps:set.targetReps,rpe:set.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
      logs.push(log);
    }
    log[field]=value;
    log.timestamp=new Date().toISOString();
    setStorage(SK.logs,logs);
    toast('💾 Saved');
  }catch(err){
    console.error('handleSetInput error:',err);
    toast('⚠️ Error saving');
  }
}


function getAutoregRule(status,set){
  const isOly=set?.exerciseType==='snatch'||set?.exerciseType==='cleanJerk';
  const baseEasy=isOly?0.02:0.025;
  const baseTough=isOly?0.02:0.025;
  const baseMiss=isOly?0.05:0.05;

  if(status==='easy') return {mult:1+baseEasy, repsDelta:0, note:'Easy — small increase'};
  if(status==='made') return {mult:1.0, repsDelta:0, note:'On target'};
  if(status==='tough') return {mult:1-baseTough, repsDelta:0, note:'Tough — small drop'};
  if(status==='miss') return {mult:1-baseMiss, repsDelta:-1, note:'Miss — decrease & redo'};
  return {mult:1.0, repsDelta:0, note:''};
}

function applySetFeedbackImpact(setId,status){
  try{
    if(!setId||!status||status==='none')return;

    const block=getStorage(SK.block)||{};
    const units=block.units||'kg';

    const sets=getStorage(SK.sets,[]);
    const targetSet=sets.find(s=>s.id===setId);
    if(!targetSet)return;

    const groupSets=sets
      .filter(s=>s.sessionId===targetSet.sessionId && s.exercise===targetSet.exercise && s.blockOrder===targetSet.blockOrder)
      .sort((a,b)=>a.setIndex-b.setIndex);

    const idx=groupSets.findIndex(s=>s.id===setId);
    if(idx<0)return;

    const rule=getAutoregRule(status,targetSet);

    let logs=getStorage(SK.logs,[]);
    const touched=[];

    for(let i=idx+1;i<groupSets.length;i++){
      const s=groupSets[i];
      let log=logs.find(l=>l.setId===s.id);

      // Only adjust future sets that haven't been completed/marked yet
      if(log && log.status && log.status!=='none') continue;

      if(!log){
        log={id:uuid(),setId:s.id,weight:s.suggestedWeight,reps:s.targetReps,rpe:s.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
        logs.push(log);
      }

      // Cache baselines once (avoid compounding)
      if(log.baseWeight==null) log.baseWeight=(log.weight!=null?log.weight:s.suggestedWeight);
      if(log.baseReps==null) log.baseReps=(log.reps!=null?log.reps:s.targetReps);

      const baseW=Number(log.baseWeight)||0;
      const baseR=Number(log.baseReps)||s.targetReps;

      let newW = baseW>0 ? baseW*rule.mult : 0;
      newW = units==='lb'?roundTo(newW,2.5):roundTo(newW,2.5);

      let newR = baseR;
      if(status==='miss' && baseR>1){
        newR = Math.max(1, baseR + rule.repsDelta);
      }

      log.weight=newW;
      log.reps=newR;
      log.autoAdjustedBy=status;
      log.autoAdjustedAt=new Date().toISOString();
      log.timestamp=new Date().toISOString();

      touched.push({setId:s.id,weight:newW,reps:newR});
    }

    setStorage(SK.logs,logs);

    // Update any visible inputs (mini + detail modal)
    touched.forEach(t=>{
      document.querySelectorAll(`input[data-set-id="${t.setId}"][data-field="weight"]`).forEach(inp=>{inp.value=t.weight});
      document.querySelectorAll(`input[data-set-id="${t.setId}"][data-field="reps"]`).forEach(inp=>{inp.value=t.reps});
    });

    if(touched.length>0){
      toast(`↪️ Adjusted next sets (${targetSet.exercise})`);
    }
  }catch(err){
    console.error('applySetFeedbackImpact error:',err);
  }
}

function handleStatusClick(e){
  try{
    e.stopPropagation();
    const btn=e.currentTarget||e.target;
    const setId=btn.dataset.setId;
    const status=btn.dataset.status;
    if(!setId)return;
    
    let logs=getStorage(SK.logs,[]);
    let log=logs.find(l=>l.setId===setId);
    if(!log){
      const allSets=getStorage(SK.sets,[]);
      const set=allSets.find(s=>s.id===setId);
      if(!set)return;
      log={id:uuid(),setId,weight:set.suggestedWeight,reps:set.targetReps,rpe:set.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
      logs.push(log);
    }
    log.status=log.status===status?'none':status;
    log.timestamp=new Date().toISOString();
    setStorage(SK.logs,logs);
    
    const parentRow=btn.closest('.set-mini');
    if(parentRow){
      parentRow.classList.remove('status-made','status-tough','status-miss','status-easy');
      const allBtns=parentRow.querySelectorAll('.status-btn-mini');
      allBtns.forEach(b=>b.classList.remove('active'));
      if(log.status!=='none'){
        btn.classList.add('active');
        parentRow.classList.add(`status-${log.status}`);
      }
    }
    
    const modalRow=btn.closest('.set-row');
    if(modalRow){
      modalRow.querySelectorAll('.status-btn').forEach(b=>{b.classList.remove('active-easy','active-made','active-tough','active-miss')});
      if(log.status!=='none'){btn.classList.add(`active-${status}`)}
    }
    
    applySetFeedbackImpact(setId, log.status);
    toast('✓ Logged');
  }catch(err){
    console.error('handleStatusClick error:',err);
    toast('⚠️ Error');
  }
}

// Mobile-friendly status selection (dropdown)
function handleStatusSelect(e){
  try{
    e.stopPropagation();
    const sel=e.currentTarget||e.target;
    const setId=sel.dataset.setId;
    let status=sel.value;
    if(!setId)return;
    if(status==='none' || status==='') status='none';

    let logs=getStorage(SK.logs,[]);
    let log=logs.find(l=>l.setId===setId);
    if(!log){
      const allSets=getStorage(SK.sets,[]);
      const set=allSets.find(s=>s.id===setId);
      if(!set)return;
      log={id:uuid(),setId,weight:set.suggestedWeight,reps:set.targetReps,rpe:set.targetRPE||8,status:'none',timestamp:new Date().toISOString()};
      logs.push(log);
    }
    log.status=status;
    log.timestamp=new Date().toISOString();
    setStorage(SK.logs,logs);

    const parentRow=sel.closest('.set-mini');
    if(parentRow){
      parentRow.classList.remove('status-made','status-tough','status-miss','status-easy','status-skip');
      // keep button state in sync for non-mobile views
      parentRow.querySelectorAll('.status-btn-mini').forEach(b=>b.classList.remove('active'));
      if(status!=='none'){
        parentRow.classList.add(`status-${status}`);
        const btn=parentRow.querySelector(`.status-btn-mini[data-status="${status}"]`);
        if(btn) btn.classList.add('active');
      }
    }

    applySetFeedbackImpact(setId, status);
    toast('✓ Logged');
  }catch(err){
    console.error('handleStatusSelect error:',err);
    toast('⚠️ Error');
  }
}

function completeSession(){
  try{
    const block=getStorage(SK.block);
    const sessions=getStorage(SK.sessions,[]);
    if(!block||!block.selectedSession)return;
    
    const session=sessions.find(s=>s.id===block.selectedSession);
    if(!session)return;
    if(session.status==='completed'){toast('⚠️ Already completed');return}
    
    session.status='completed';
    session.completedAt=new Date().toISOString();
    setStorage(SK.sessions,sessions);
    
    toast('⏳ Analyzing performance...');
    setTimeout(()=>{
      try{
        const adjustments=applyPerformanceAdjustments(session.id);
        
        closeWorkoutDetail();
        
        if(adjustments.applied&&adjustments.increases){
          const increaseText=adjustments.increases.join(', ');
          showModal(
            '🎉 Session Complete & Weights Adjusted!',
            'Based on your performance, future sessions have been updated',
            `<div style="margin-top:12px"><strong>Detected PRs:</strong><br>${increaseText}<br><br>Next week's weights have been automatically adjusted. Great work!</div>`
          );
          setTimeout(()=>renderWeekPage(),500);
        }else{
          toast('✅ Session completed!');
          setTimeout(()=>renderWeekPage(),500);
        }
      }catch(err){
        console.error('Adjustment error:',err);
        closeWorkoutDetail();
        toast('✅ Session completed!');
        setTimeout(()=>renderWeekPage(),500);
      }
    },300);
  }catch(err){
    console.error('Complete session error:',err);
    toast('⚠️ Error completing session');
  }
}

function closeWorkoutDetail(){$('workoutDetail').classList.remove('show')}

function toggleDayCard(header){
  const body=header.nextElementSibling;
  const icon=header.querySelector('.expand-icon');
  if(!body)return;
  body.classList.toggle('expanded');
  if(icon)icon.style.transform=body.classList.contains('expanded')?'rotate(180deg)':'rotate(0deg)';
}

function toggleExerciseQuick(header,e){
  if(e)e.stopPropagation();
  const body=header.nextElementSibling;
  const icon=header.querySelector('.exercise-expand');
  const parent=header.parentElement;
  if(!parent||!body)return;
  parent.classList.toggle('expanded');
  if(icon)icon.style.transform=parent.classList.contains('expanded')?'rotate(180deg)':'rotate(0deg)';
}

function completeSessionQuick(sessionId){
  try{
    const sessions=getStorage(SK.sessions,[]);
    const session=sessions.find(s=>s.id===sessionId);
    if(!session)return;
    if(session.status==='completed'){toast('⚠️ Already completed');return}
    
    session.status='completed';
    session.completedAt=new Date().toISOString();
    setStorage(SK.sessions,sessions);
    
    toast('⏳ Analyzing performance...');
    setTimeout(()=>{
      try{
        const analysis=analyzePerformance(session.id);
        const adjustments=applyPerformanceAdjustments(session.id);
        
        let modalContent='<div style="margin-top:12px">';
        
        // Show weight adjustments
        if(adjustments.applied&&adjustments.increases){
          modalContent+=`<div style="margin-bottom:16px"><strong>🎉 Performance-Based Increases:</strong><br>${adjustments.increases}<br><br>Next week's weights have been automatically adjusted!</div>`;
        }
        
        // Show metrics and recommendations
        if(analysis&&analysis.metrics){
          if(analysis.metrics.avgRPE){
            modalContent+=`<div style="margin-bottom:8px"><strong>Average RPE:</strong> ${analysis.metrics.avgRPE.toFixed(1)}/10</div>`;
          }
          if(analysis.metrics.volume>0){
            const prof=getStorage(SK.profile);
            const unit=prof?.units||'kg';
            modalContent+=`<div style="margin-bottom:8px"><strong>Total Volume:</strong> ${Math.round(analysis.metrics.volume).toLocaleString()}${unit}</div>`;
          }
          if(analysis.metrics.recommendations&&analysis.metrics.recommendations.length>0){
            modalContent+=`<div style="margin-top:12px;padding:12px;background:var(--bg-dim);border-radius:8px">`;
            analysis.metrics.recommendations.forEach(rec=>{
              modalContent+=`<div style="margin-bottom:4px">${rec}</div>`;
            });
            modalContent+=`</div>`;
          }
        }
        
        modalContent+=`</div>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
            <div style="margin-bottom:12px;font-weight:600">How did this session feel?</div>
            <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px">
              <button class="rating-btn" data-rating="1" style="font-size:24px;padding:8px 16px;background:var(--bg-dim);border:1px solid var(--border);border-radius:8px;cursor:pointer">😫</button>
              <button class="rating-btn" data-rating="2" style="font-size:24px;padding:8px 16px;background:var(--bg-dim);border:1px solid var(--border);border-radius:8px;cursor:pointer">😕</button>
              <button class="rating-btn" data-rating="3" style="font-size:24px;padding:8px 16px;background:var(--bg-dim);border:1px solid var(--border);border-radius:8px;cursor:pointer">😐</button>
              <button class="rating-btn" data-rating="4" style="font-size:24px;padding:8px 16px;background:var(--bg-dim);border:1px solid var(--border);border-radius:8px;cursor:pointer">🙂</button>
              <button class="rating-btn" data-rating="5" style="font-size:24px;padding:8px 16px;background:var(--bg-dim);border:1px solid var(--border);border-radius:8px;cursor:pointer">🔥</button>
            </div>
            <textarea id="sessionNotes" placeholder="Any notes? (optional)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;min-height:60px;margin-bottom:12px"></textarea>
            <div style="display:flex;gap:8px">
              <button id="btnSubmitFeedback" class="success" style="flex:1">Submit Feedback</button>
              <button onclick="closeModal();renderWeekPage()" class="secondary">Skip</button>
            </div>
          </div>`;
        
        showModal(
          adjustments.applied?'🎉 Session Complete & Weights Adjusted!':'✅ Session Complete!',
          'Great work today!',
          modalContent
        );
        
        // Add event listeners for feedback
        setTimeout(()=>{
          document.querySelectorAll('.rating-btn').forEach(btn=>{
            btn.addEventListener('click',function(){
              document.querySelectorAll('.rating-btn').forEach(b=>b.style.background='var(--bg-dim)');
              this.style.background='var(--primary)';
              this.style.color='white';
            });
          });
          
          const submitBtn=document.getElementById('btnSubmitFeedback');
          if(submitBtn){
            submitBtn.addEventListener('click',()=>{
              const selectedRating=document.querySelector('.rating-btn[style*="var(--primary)"]');
              const rating=selectedRating?parseInt(selectedRating.dataset.rating):3;
              const notes=document.getElementById('sessionNotes')?.value||'';
              
              session.feedback={rating,notes,date:new Date().toISOString()};
              setStorage(SK.sessions,sessions);
              
              toast('💬 Feedback saved!');
              closeModal();
              renderWeekPage();
            });
          }
        },100);
        
      }catch(err){
        console.error('Adjustment error:',err);
        toast('✅ Session completed!');
        renderWeekPage();
      }
    },300);
  }catch(err){
    console.error('Complete session error:',err);
    toast('⚠️ Error completing session');
  }
}

function renderHistoryPage(){
  const history=getStorage(SK.archivedBlocks,[]);
  const sessions=getStorage(SK.sessions,[]);
  const completedSessions=sessions.filter(s=>s.status==='completed').sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  const prs=getStorage(SK.prs,[]);
  const list=$('historyList');
  
  let html='';
  
  // NEW: Show deload recommendation if needed
  const deloadCheck=checkDeloadNeed();
  if(deloadCheck.needsDeload){
    html+=`
      <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,rgba(255,152,0,0.1),rgba(255,193,7,0.1));border:1px solid rgba(255,152,0,0.3)">
        <div style="display:flex;align-items:start;gap:12px">
          <div style="font-size:32px">⚠️</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;margin-bottom:4px;color:var(--warning)">Deload Recommended</div>
            <div style="font-size:13px;margin-bottom:8px">${deloadCheck.reason}</div>
            ${deloadCheck.details?`<div style="font-size:12px;color:var(--text-dim);font-family:monospace">${deloadCheck.details}</div>`:''}
            <div style="margin-top:8px;font-size:12px">${deloadCheck.suggestion}</div>
          </div>
        </div>
      </div>`;
  }
  
  // NEW: Show recent PRs
  if(prs.length>0){
    html+='<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">🎉 Recent PRs</div>';
    html+='<div class="card" style="margin-bottom:16px">';
    prs.slice(0,5).forEach((pr,idx)=>{
      html+=`
        <div style="${idx>0?'margin-top:12px;padding-top:12px;border-top:1px solid var(--border)':''}">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <div style="font-size:14px;font-weight:700">${pr.exercise}</div>
              <div style="font-size:12px;color:var(--text-dim);margin-top:2px">${formatDate(pr.date)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:700;color:var(--success)">${pr.newMax}</div>
              <div style="font-size:11px;color:var(--success)">+${pr.increase} (+${pr.percentIncrease}%)</div>
            </div>
          </div>
        </div>`;
    });
    html+='</div>';
  }
  
  // Show archived blocks
  if(history.length>0){
    html+='<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">📦 Archived Blocks</div>';
    history.forEach(block=>{
      const completionRate=block.totalSessions>0?Math.round((block.completedSessions/block.totalSessions)*100):0;
      html+=`
        <div class="card" style="margin-bottom:12px;cursor:pointer;position:relative" data-block-id="${block.id}">
          <button class="danger small delete-history" type="button" data-del-id="${block.id}" style="position:absolute;top:12px;right:12px">Delete</button>
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <div style="font-size:15px;font-weight:700;margin-bottom:4px">${block.programType.toUpperCase()} • ${block.blockLength} weeks</div>
              <div style="font-size:12px;color:var(--text-dim);margin-bottom:4px">${escapeHtml(block.profileName||'Profile')}</div>
              <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px">Archived: ${formatDate(block.archivedAt)}</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap">
                <span style="font-size:12px;color:var(--text-dim)">Weeks: ${block.completedWeeks}/${block.blockLength}</span>
                <span style="font-size:12px;color:var(--text-dim)">Sessions: ${block.completedSessions}/${block.totalSessions}</span>
                <span style="font-size:12px;color:var(--text-dim)">${block.daysPerWeek}d/wk</span>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:24px;font-weight:700;color:var(--primary)">${completionRate}%</div>
              <div style="font-size:11px;color:var(--text-dim)">Complete</div>
            </div>
          </div>
        </div>
      `;
    });
    html+='<div style="height:24px"></div>';
  }
  
  // Show recent completed sessions with volume
  if(completedSessions.length>0){
    html+='<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">✅ Recent Sessions</div>';
    html+=completedSessions.slice(0,20).map(session=>{
      const sessionVol=calculateSessionVolume(session.id);
      const prof=getStorage(SK.profile);
      const unit=prof?.units||'kg';
      const volDisplay=sessionVol.totalVolume>0?`${Math.round(sessionVol.totalVolume).toLocaleString()}${unit}`:'—';
      const feedbackEmoji=session.feedback?['😫','😕','😐','🙂','🔥'][session.feedback.rating-1]||'':'';
      
      return `
      <div class="session-card" style="cursor:pointer" data-session-id="${session.id}">
        <div class="session-header">
          <div>
            <div class="session-title">${session.title}</div>
            <div class="session-meta">Completed: ${formatDate(session.completedAt)} ${feedbackEmoji}</div>
            ${sessionVol.totalVolume>0?`<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Volume: ${volDisplay}</div>`:''}
          </div>
          <span class="badge success" style="font-size:10px;padding:4px 8px">✓</span>
        </div>
      </div>`;
    }).join('');
  }
  
  if(history.length===0 && completedSessions.length===0 && prs.length===0){
    html='<div style="text-align:center;color:var(--text-dim);padding:40px">No history to view yet. Save a block or complete a workout to see it here.</div>';
  }
  
  list.innerHTML=html;

  // Delete archived block
  list.querySelectorAll('.delete-history').forEach(btn=>{
    btn.addEventListener('click',(e)=>{
      e.stopPropagation();
      const id=btn.dataset.delId;
      if(!id) return;
      if(!confirm('Delete this archived block?')) return;
      const hist=getStorage(SK.archivedBlocks,[]);
      const next=hist.filter(b=>String(b.id)!==String(id));
      setStorage(SK.archivedBlocks,next);
      toast('🗑️ Deleted');
      renderHistoryPage();
    });
  });

  
  // Add click handlers for sessions
  list.querySelectorAll('.session-card').forEach(card=>{
    const sessionId=card.dataset.sessionId;
    card.addEventListener('click',()=>openWorkoutDetail(sessionId));
  });
  
  // Add click handlers for archived blocks
  list.querySelectorAll('[data-block-id]').forEach(card=>{
    const blockId=card.dataset.blockId;
    card.addEventListener('click',()=>viewArchivedBlock(blockId));
  });
}

function viewArchivedBlock(blockId){
  const history=getStorage(SK.archivedBlocks,[]);
  const block=history.find(b=>b.id===blockId);
  if(!block)return;
  
  const pLabel = block.profileName ? `Profile: ${escapeHtml(block.profileName)}` : '';
  let html=`
    <div style="padding:20px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">${block.programType.toUpperCase()} Block</h2>
      ${pLabel?`<div style="font-size:12px;color:var(--text-dim);margin-bottom:18px">${pLabel}</div>`:'<div style="margin-bottom:18px"></div>'}
      
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Block Summary</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:12px">
          <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">DURATION</div>
            <div style="font-size:16px;font-weight:700">${block.blockLength} weeks</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">FREQUENCY</div>
            <div style="font-size:16px;font-weight:700">${block.daysPerWeek}d/week</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">COMPLETED</div>
            <div style="font-size:16px;font-weight:700">${block.completedWeeks}/${block.blockLength} weeks</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">SESSIONS</div>
            <div style="font-size:16px;font-weight:700">${block.completedSessions}/${block.totalSessions}</div>
          </div>
        </div>
      </div>
      
      <!-- Maxes removed from History per UI spec -->
      <div class="card">
        <div class="card-title">Completed Sessions (${block.sessions.filter(s=>s.status==='completed').length})</div>
        <div style="margin-top:12px">
          ${block.sessions.filter(s=>s.status==='completed').map(session=>`
            <div style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
              <div style="font-size:14px;font-weight:600;margin-bottom:4px">${session.title}</div>
              <div style="font-size:12px;color:var(--text-dim)">Completed: ${formatDate(session.completedAt)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <button onclick="closeModal()" style="margin-top:20px;width:100%">Close</button>
    </div>
  `;
  
  showModal(html);
}


function applyBlocksPreferenceToPlannedWork(prof){
  try{
    if(!prof || prof.includeBlocks!==false) return {updated:false, touched:0};
    const sessions=getStorage(SK.sessions,[]);
    const sets=getStorage(SK.sets,[]);
    if(!sessions.length || !sets.length) return {updated:false, touched:0};

    const plannedIds=new Set(sessions.filter(s=>s && s.status!=='completed').map(s=>s.id));
    if(plannedIds.size===0) return {updated:false, touched:0};

    let touched=0;
    const updatedSessions=sessions.map(s=>{
      if(!s || !plannedIds.has(s.id)) return s;
      if(!s.exercises) return s;
      const ex={...s.exercises};
      if(typeof ex.main==='string'){const n=substituteIfNoBlocks(ex.main,false); if(n!==ex.main){ex.main=n; touched++;}}
      if(typeof ex.secondary==='string'){const n=substituteIfNoBlocks(ex.secondary,false); if(n!==ex.secondary){ex.secondary=n; touched++;}}
      if(typeof ex.strength==='string'){const n=substituteIfNoBlocks(ex.strength,false); if(n!==ex.strength){ex.strength=n; touched++;}}
      if(typeof ex.accessory==='string'){const n=substituteIfNoBlocks(ex.accessory,false); if(n!==ex.accessory){ex.accessory=n; touched++;}}
      return {...s, exercises: ex};
    });

    const updatedSets=sets.map(set=>{
      if(!set || !plannedIds.has(set.sessionId)) return set;
      const newName=substituteIfNoBlocks(set.exercise,false);
      if(newName!==set.exercise){
        touched++;
        return {...set, exercise:newName};
      }
      return set;
    });

    const ok1=setStorage(SK.sessions,updatedSessions);
    const ok2=setStorage(SK.sets,updatedSets);
    if(!ok1 || !ok2) return {updated:false, touched:0};

    // Recalculate weights to match the new exercise names (pull vs classic etc.)
    const recalc = recalculateProgrammingForNewMaxes(prof,{syncUncommittedLogs:true});
    return {updated:true, touched, recalc};
  }catch(err){
    console.error('applyBlocksPreference error:',err);
    return {updated:false, touched:0, error: err.message};
  }
}



function updateAiAvailabilityUI(){
  const prof=getStorage(SK.profile)||{};
  const enabled=(prof.aiEnabled !== false);
  const aiBtn=$('btnAI');
  if(aiBtn){
    aiBtn.style.display = enabled ? '' : 'none';
    aiBtn.disabled = !enabled;
  }
}

function setAiTestStatus(msg,type){
  const el=$('aiTestStatus');
  if(!el) return;
  el.textContent = msg || '';
  if(type==='ok') el.style.color='var(--success)';
  else if(type==='err') el.style.color='var(--danger)';
  else el.style.color='var(--text-dim)';
}

async function testAiConnection(){
  try{
    const prof=getStorage(SK.profile)||{};
    const enabled = (prof.aiEnabled !== false);
    if(!enabled){
      setAiTestStatus('Enable AI first, then test.','err');
      return;
    }
    const btn=$('btnTestAI');
    if(btn){btn.disabled=true; btn.textContent='Testing...';}
    setAiTestStatus('Sending test request...','');

    const model = String(prof.aiModel||'').trim();
    const context = {
      profile: {
        includeBlocks: (prof.includeBlocks !== false),
        volumePreference: (prof.volumePreference || 'reduced'),
        autoCutEnabled: (prof.autoCutEnabled !== false),
        // keep minimal identifiers only
        units: (prof.units||'kg')
      },
      // keep small to reduce token usage
      candidateExercises: []
    };

    const body = { message: 'Connection test. Return {"changes":[]} and nothing else.', context };
    if(model) body.model = model;

    const res = await fetch('/.netlify/functions/ai-program', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(()=>null);
    if(!res.ok || !data || data.ok !== true){
      const errMsg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      setAiTestStatus('❌ ' + errMsg,'err');
      return;
    }
    const patch = data.patch;
    const changesOk = patch && Array.isArray(patch.changes);
    if(!changesOk){
      setAiTestStatus('❌ Invalid response shape from function','err');
      return;
    }
    const usedModel = model || '(server default)';
    setAiTestStatus(`✅ Connected. Model: ${usedModel}`,'ok');
  }catch(err){
    console.error('testAiConnection error:',err);
    setAiTestStatus('❌ ' + String(err.message||err),'err');
  }finally{
    const btn=$('btnTestAI');
    if(btn){btn.disabled=false; btn.textContent='Test Connection';}
  }
}

function renderSettingsPage(){
  const prof=getStorage(SK.profile);
  const block=getStorage(SK.block);
  // Profile selector
  const pidx=loadProfilesIndex();
  const psel=$('settingsProfileSelect');
  if(psel){
    psel.innerHTML=pidx.profiles.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    psel.value=ACTIVE_PROFILE_ID;
  }
  const pName=(pidx.profiles.find(p=>p.id===ACTIVE_PROFILE_ID)?.name)||'Default';

  if(!prof){navigateToPage('Setup');return}
  $('settingsInfo').textContent=block?`Profile: ${pName} • Active: ${block.programType.toUpperCase()} • ${block.blockLength}w • ${block.daysPerWeek}d/wk • ${block.sessionDuration}min`:`Profile: ${pName} • No active block`;
  $('settingsUnits').value=prof.units;
  if($('settingsIncludeBlocks')) $('settingsIncludeBlocks').checked = (prof.includeBlocks !== false);
  if($('settingsVolumePref')) $('settingsVolumePref').value = (prof.volumePreference || 'reduced');
  if($('settingsAutoCut')) $('settingsAutoCut').checked = (prof.autoCutEnabled !== false);
  if($('settingsAIEnabled')) $('settingsAIEnabled').checked = (prof.aiEnabled !== false);
  if($('settingsAIModel')) $('settingsAIModel').value = (prof.aiModel || '');
  setAiTestStatus('','');
  updateAiAvailabilityUI();
  $('settingsSnatch').value=prof.snatch;
  $('settingsCJ').value=prof.cleanJerk;
  $('settingsFS').value=prof.frontSquat;
  $('settingsBS').value=prof.backSquat;
}

function saveSettings(){
  try{
    const prof=getStorage(SK.profile);
    if(!prof)return;
    
    const oldMaxes={
      snatch:prof.snatch,
      includeBlocks: (prof.includeBlocks !== false),
      cleanJerk:prof.cleanJerk,
      frontSquat:prof.frontSquat,
      backSquat:prof.backSquat,
      units:prof.units
    };
    
    prof.units=$('settingsUnits').value;
    const newSnatch=parseFloat($('settingsSnatch').value);
    const newCJ=parseFloat($('settingsCJ').value);
    const newFS=parseFloat($('settingsFS').value);
    const newBS=parseFloat($('settingsBS').value);
    const newIncludeBlocks = ($('settingsIncludeBlocks') ? !!$('settingsIncludeBlocks').checked : (prof.includeBlocks !== false));
    
    if(isNaN(newSnatch)||isNaN(newCJ)||isNaN(newFS)||isNaN(newBS)){
      toast('⚠️ Invalid max values');
      return;
    }
    if(newSnatch<=0||newCJ<=0||newFS<=0||newBS<=0){
      toast('⚠️ All maxes must be positive');
      return;
    }
    
    prof.snatch=newSnatch;
    prof.cleanJerk=newCJ;
    prof.frontSquat=newFS;
    prof.backSquat=newBS;
    prof.includeBlocks=newIncludeBlocks;

    // Keep Working Max in sync with updated 1RMs (unless opted out).
    // The generator primarily uses Working Max for % calculations, so if WM is stale
    // the user will think their new maxes "aren't applying".
    const np=normalizeProfile(prof);
    if(np.workingMaxAuto!==false){
      np.workingMax={
        snatch: Math.round(np.snatch*0.90),
        cleanJerk: Math.round(np.cleanJerk*0.90),
        frontSquat: Math.round(np.frontSquat*0.90),
        backSquat: Math.round(np.backSquat*0.90)
      };
    }

    // Continue using normalized profile for the rest of this save flow.
    Object.assign(prof, np);

    // New preferences
    if($('settingsVolumePref')) prof.volumePreference = $('settingsVolumePref').value;
    if($('settingsAutoCut')) prof.autoCutEnabled = !!$('settingsAutoCut').checked;
    if($('settingsAIEnabled')) prof.aiEnabled = !!$('settingsAIEnabled').checked;
    if($('settingsAIModel')) prof.aiModel = String($('settingsAIModel').value||'').trim();


    const includeBlocksChanged = oldMaxes.includeBlocks !== (prof.includeBlocks !== false);
    
    const maxesChanged=
      oldMaxes.snatch!==prof.snatch||
      oldMaxes.cleanJerk!==prof.cleanJerk||
      oldMaxes.frontSquat!==prof.frontSquat||
      oldMaxes.backSquat!==prof.backSquat||
      oldMaxes.units!==prof.units;
    
    const saveSuccess=setStorage(SK.profile,prof);
    updateAiAvailabilityUI();
    if(!saveSuccess){
      toast('⚠️ Failed to save settings');
      return;
    }
    
    const block=getStorage(SK.block);
    if(block){
      block.snatch=prof.snatch;
      block.cleanJerk=prof.cleanJerk;
      block.frontSquat=prof.frontSquat;
      block.backSquat=prof.backSquat;
      block.units=prof.units;
      setStorage(SK.block,block);
    }

    if(includeBlocksChanged){
      const r=applyBlocksPreferenceToPlannedWork(prof);
      if(r.updated && r.touched>0){
        toast(`🧱 Blocks off: substituted ${r.touched} items`);
      }
    }
    
    if(maxesChanged&&block){
      toast('⏳ Recalculating workout weights...');
      setTimeout(()=>{
        try{
          const result=recalculateProgrammingForNewMaxes(prof,{syncUncommittedLogs:true});
          if(result.updated>0||result.updatedLogs>0){
            toast(`✅ Updated ${result.updated} sets using new maxes`);
          }else{
            toast('✅ Settings saved!');
          }
          renderSettingsPage();
          renderDashboard();
          renderWeekPage();
          const overlay=$('execOverlay');
          if(overlay&&overlay.classList.contains('show'))renderExecutionSet();
        }catch(err){
          console.error('Recalc error:',err);
          toast('⚠️ Settings saved but recalc failed');
        }
      },100);
    }else{
      toast('✅ Settings saved!');
      renderSettingsPage();
      renderDashboard();
    }
  }catch(err){
    console.error('Save settings error:',err);
    toast('⚠️ Failed to save: '+err.message);
  }
}

function resetAllData(){
  if(!confirm('Delete ALL data? This cannot be undone!'))return;
  Object.values(SK).forEach(key=>localStorage.removeItem(key));
  toast('🗑️ Data cleared');
  setTimeout(()=>location.reload(),1000);
}

function exportData(){
  exportTrainingData();
}

// Setup
function setupApp(){
  initProfiles();
  const prof=getStorage(SK.profile);
  const block=getStorage(SK.block);

  // Backfill equipment preference (blocks) for older profiles
  if(prof && prof.includeBlocks===undefined){
    prof.includeBlocks=true;
    setStorage(SK.profile,prof);
  }

  // Backfill legacy blocks that were created without the `generated` marker.
  if(block && block.generated===undefined){
    block.generated=true;
    setStorage(SK.block,block);
  }

  // Landing behavior:
  // - If no active block: keep current setup landing
  // - If a block exists: go to Workout tab (per spec)
  if(!prof||!hasActiveBlock(block)){
    const navSetup=$('navSetup'); if(navSetup) navSetup.style.display='';
    showPage('Setup');
  }else{
    showPage('Workout');
    renderWeekPage();
    //
    const navSetup=$('navSetup'); if(navSetup) navSetup.style.display='none';
    
  }
  
  // FIXED: Multiple selection logic for both main and accessory days
  let selectedMainDays=[];
  let selectedAccessoryDays=[];
  const mainButtons=document.querySelectorAll('#mainDaySelector .day-btn');
  const accessoryButtons=document.querySelectorAll('#accessoryDaySelector .day-btn');
  
  function updateDaySelectors(){
    // Clear conflicting selections from accessory days
    selectedAccessoryDays=selectedAccessoryDays.filter(d=>!selectedMainDays.includes(d));
    
    // Update accessory day buttons
    accessoryButtons.forEach(btn=>{
      const day=parseInt(btn.dataset.day);
      btn.classList.remove('accessory','active');
      
      if(selectedAccessoryDays.includes(day)){
        btn.classList.add('accessory');
      }
      
      if(selectedMainDays.includes(day)){
        btn.disabled=true;
        btn.style.opacity='0.5';
        btn.style.cursor='not-allowed';
      }else{
        btn.disabled=false;
        btn.style.opacity='1';
        btn.style.cursor='pointer';
      }
    });
  }
  
  // Main day selector - allow 1+ selections (no upper limit except 7 days in week)
  mainButtons.forEach(btn=>{
    btn.addEventListener('click',()=>{
      const day=parseInt(btn.dataset.day);
      
      if(selectedMainDays.includes(day)){
        // Deselect
        selectedMainDays=selectedMainDays.filter(d=>d!==day);
        btn.classList.remove('active');
      }else{
        // Select (no hard limit - can select all 7 days if they want)
        selectedMainDays.push(day);
        selectedMainDays.sort((a,b)=>a-b);
        btn.classList.add('active');
      }
      
      updateDaySelectors();

  // Simplified injury UI: show advanced checkbox grid only when "Multiple" is selected
  function syncInjuryPresetUI(){
    const presetEl=$('setupInjuryPreset');
    const grid=$('injuryAdvancedGrid');
    const hint=$('injuryAdvancedHint');
    if(!presetEl||!grid||!hint) return;
    const on = presetEl.value==='multiple';
    grid.style.display = on ? 'block' : 'none';
    hint.style.display = on ? 'block' : 'none';
    if(!on){
      // clear advanced checks so preset is the single source of truth
      ['injShoulder','injWrist','injElbow','injBack','injHip','injKnee','injAnkle'].forEach(id=>{
        const el=$(id); if(el) el.checked=false;
      });
    }
  }
  const injPreset=$('setupInjuryPreset');
  if(injPreset){
    injPreset.addEventListener('change',syncInjuryPresetUI);
    setTimeout(syncInjuryPresetUI,0);
  }
    });
  });
  
  // Accessory day selector - allow unlimited selections
  accessoryButtons.forEach(btn=>{
    btn.addEventListener('click',()=>{
      const day=parseInt(btn.dataset.day);
      
      if(selectedMainDays.includes(day)){
        toast('⚠️ This day is already a main lifting day');
        return;
      }
      
      if(selectedAccessoryDays.includes(day)){
        // Deselect
        selectedAccessoryDays=selectedAccessoryDays.filter(d=>d!==day);
        btn.classList.remove('accessory');
      }else{
        // Select - no limit on accessory days
        selectedAccessoryDays.push(day);
        selectedAccessoryDays.sort((a,b)=>a-b);
        btn.classList.add('accessory');
      }
    });
  });
  
  updateDaySelectors();
  
  // Tab navigation
  const tabBtns=document.querySelectorAll('.tab-btn');
  const tabContents=document.querySelectorAll('.tab-content');
  
  tabBtns.forEach(btn=>{
    btn.addEventListener('click',()=>{
      const targetTab=btn.dataset.tab;

      tabBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      tabContents.forEach(content=>{
        const id=`tab${targetTab.charAt(0).toUpperCase()+targetTab.slice(1)}`;
        content.classList.toggle('active',content.id===id);
      });

      if(targetTab==='dashboard')renderDashboard();
      else if(targetTab==='workout')renderWeekPage();
      else if(targetTab==='history')renderHistoryPage();
      else if(targetTab==='settings')renderSettingsPage();
    });
  });
  // Dashboard quick actions
  const dashReadiness=$('btnLogReadiness');
  if(dashReadiness){
    dashReadiness.addEventListener('click',()=>openReadinessModal(null));
  }
  
  $('btnGenerateBlock').addEventListener('click',()=>{
    try{
      const snatch=parseFloat($('setupSnatch').value);
      const cleanJerk=parseFloat($('setupCleanJerk').value);
      const frontSquat=parseFloat($('setupFrontSquat').value);
      const backSquat=parseFloat($('setupBackSquat').value);
      const sessionDuration=parseInt($('setupDuration').value);
      
      if(!snatch||!cleanJerk||!frontSquat||!backSquat||isNaN(snatch)||isNaN(cleanJerk)||isNaN(frontSquat)||isNaN(backSquat)){
        toast('⚠️ Enter valid maxes');
        return;
      }
      if(snatch<=0||cleanJerk<=0||frontSquat<=0||backSquat<=0){
        toast('⚠️ All maxes must be positive');
        return;
      }
      
      // Validate selections
      if(selectedMainDays.length<1){
        toast('⚠️ Please select at least 1 main lifting day');
        return;
      }

      // Rule: If ZERO accessory days are selected, do not generate any accessory-day sessions.
      // The generator iterates day=1..daysPerWeek; if main days are sparse (e.g., [1,4]) and
      // daysPerWeek is set to just the number of selected days, it can inadvertently create
      // extra non-training days ("recovery") in between. For a clean recreational setup where
      // accessory days are explicitly opted-in, we normalize the day slots so that all programmed
      // days are main lifting days when no accessory days are selected.
      let normalizedMainDays=[...selectedMainDays];
      let normalizedAccessoryDays=[...selectedAccessoryDays];
      if(normalizedAccessoryDays.length===0){
        normalizedMainDays=Array.from({length: normalizedMainDays.length}, (_,i)=>i+1);
      }
      
      // Calculate total days from selections (post-normalization)
      const totalDays=normalizedMainDays.length+normalizedAccessoryDays.length;
      
      if(totalDays<1||totalDays>7){
        toast('⚠️ Total training days must be 1-7');
        return;
      }
      
      const profile={
        units:$('setupUnits').value,
        daysPerWeek:totalDays,
        blockLength:parseInt($('setupBlockLength').value),
        programType:$('setupProgram').value,
        athleteMode: ($('setupAthleteMode') ? $('setupAthleteMode').value : 'recreational'),
        transitionWeeks: ($('setupTransitionWeeks') ? parseInt($('setupTransitionWeeks').value,10) : 0),
        transitionProfile: ($('setupTransitionProfile') ? $('setupTransitionProfile').value : 'standard'),
        mainLiftingDays:normalizedMainDays,
        accessoryDays:normalizedAccessoryDays,
        sessionDuration:sessionDuration,
        includeBlocks: ($('setupIncludeBlocks') ? ($('setupIncludeBlocks').value!=='no') : true),
        volumePreference: ($('setupVolumePref') ? $('setupVolumePref').value : 'reduced'),
        autoCutEnabled: ($('setupAutoCut') ? ($('setupAutoCut').value!=='no') : true),
        snatch,
        cleanJerk,
        frontSquat,
        backSquat,
        // Athlete profile (optional, defaults handled in normalizeProfile)
        age: ($('setupAge') ? ( $('setupAge').value==='' ? null : parseInt($('setupAge').value,10) ) : null),
        trainingAgeYears: ($('setupTrainingAge') ? parseFloat($('setupTrainingAge').value||'1') : 1),
        recoveryCapacity: ($('setupRecovery') ? parseInt($('setupRecovery').value,10) : 3),
        macroPeriod: ($('setupMacroPeriod') && $('setupMacroPeriod').value!=='AUTO') ? $('setupMacroPeriod').value : 'PP',
        competitionDate: ($('setupCompetitionDate') ? ($('setupCompetitionDate').value || null) : null),
        autoMacroFromMeet: ($('setupMacroPeriod') ? ($('setupMacroPeriod').value==='AUTO') : false),
        limiter: ($('setupLimiter') ? $('setupLimiter').value : 'balanced'),
        taperStyle: ($('setupTaperStyle') ? $('setupTaperStyle').value : 'default'),
        heavySingleExposure: ($('setupHeavySingleExposure') ? ($('setupHeavySingleExposure').value==='on') : false),
        injuries: (function(){
          // UI now uses a simple preset dropdown; "Multiple" reveals checkboxes.
          const preset = $('setupInjuryPreset') ? $('setupInjuryPreset').value : 'none';
          const base={shoulder:false,wrist:false,elbow:false,back:false,hip:false,knee:false,ankle:false};
          if(preset && preset!=='none' && preset!=='multiple'){
            base[preset]=true;
            return base;
          }
          if(preset==='multiple'){
            return {
              shoulder: ($('injShoulder') ? !!$('injShoulder').checked : false),
              wrist: ($('injWrist') ? !!$('injWrist').checked : false),
              elbow: ($('injElbow') ? !!$('injElbow').checked : false),
              back: ($('injBack') ? !!$('injBack').checked : false),
              hip: ($('injHip') ? !!$('injHip').checked : false),
              knee: ($('injKnee') ? !!$('injKnee').checked : false),
              ankle: ($('injAnkle') ? !!$('injAnkle').checked : false)
            };
          }
          return base;
        })(),
        createdAt:new Date().toISOString()
      };
      
      const normalizedProfile=normalizeProfile(profile);
      setStorage(SK.profile,normalizedProfile);
      generateTrainingBlock(normalizedProfile);
        // NEW: consume pending transition suggestion
        removeStorage(SK.pendingTransition);
      toast('🚀 Block generated!');
      setTimeout(()=>navigateToPage('Workout'),800);
    }catch(err){
      console.error('Block generation error:',err);
      toast('⚠️ Generation failed: '+err.message);
    }
  });
  
  // Demo button: populate a sensible example profile so users can explore without setup friction.
  // Support both legacy and current button ids.
  const demoBtn = $('btnDemo') || $('btnDemoData');
  demoBtn?.addEventListener('click',()=>{
    $('setupUnits').value='kg';
    $('setupBlockLength').value='8';
    $('setupProgram').value='general';
    if($('setupAthleteMode')) $('setupAthleteMode').value='recreational';
    if($('setupTransitionWeeks')) $('setupTransitionWeeks').value='1';
    if($('setupTransitionProfile')) $('setupTransitionProfile').value='standard';
    $('setupDuration').value='75';
    if($('setupIncludeBlocks')) $('setupIncludeBlocks').value='yes';
    $('setupSnatch').value='80';
    $('setupCleanJerk').value='100';
    $('setupFrontSquat').value='130';
    $('setupBackSquat').value='150';
    
    selectedMainDays=[1,4];  // Mon & Thu
    selectedAccessoryDays=[2];  // Tue
    
    // Update UI to show selections
    mainButtons.forEach(btn=>{
      const day=parseInt(btn.dataset.day);
      if(selectedMainDays.includes(day)){
        btn.classList.add('active');
      }else{
        btn.classList.remove('active');
      }
    });
    
    accessoryButtons.forEach(btn=>{
      const day=parseInt(btn.dataset.day);
      if(selectedAccessoryDays.includes(day)){
        btn.classList.add('accessory');
      }else{
        btn.classList.remove('accessory');
      }
      if(selectedMainDays.includes(day)){
        btn.disabled=true;
        btn.style.opacity='0.5';
      }else{
        btn.disabled=false;
        btn.style.opacity='1';
      }
    });
    
    updateDaySelectors();
    toast('📊 Demo loaded');
  });
  
  $('btnPrevWeek').addEventListener('click',()=>{
    const block=getStorage(SK.block);
    if(block&&block.currentWeek>1){block.currentWeek--;setStorage(SK.block,block);renderWeekPage()}
  });
  
  $('btnNextWeek').addEventListener('click',()=>{
    const block=getStorage(SK.block);
    if(block&&block.currentWeek<block.blockLength){block.currentWeek++;setStorage(SK.block,block);renderWeekPage()}
  });
  
  $('btnCloseDetail').addEventListener('click',closeWorkoutDetail);
  $('btnComplete').addEventListener('click',completeSession);
  $('btnExport').addEventListener('click',exportData);
  const aiBtn=$('btnAI');
  if(aiBtn){
    aiBtn.addEventListener('click',()=>{
      try{openAIProgrammingAssistant();}
      catch(err){console.error('AI UI error:',err);toast('⚠️ AI unavailable');}
    });
  }
  updateAiAvailabilityUI();
  const hdrSettings=$('btnSettings'); if(hdrSettings) hdrSettings.addEventListener('click',()=>navigateToPage('Settings'));
  // Profile controls (local only)
  const profSel=$('settingsProfileSelect');
  if(profSel){
    profSel.addEventListener('change', (e)=>{
      const id=e.target.value;
      if(id && id!==ACTIVE_PROFILE_ID){
        setActiveProfile(id);
        toast('✅ Switched profile');
      }
    });
  }
  const btnNewProf=$('btnNewProfile');
  const newRow=$('newProfileRow');
  const nameInput=$('newProfileName');
  if(btnNewProf && newRow){
    btnNewProf.addEventListener('click', ()=>{
      const show = newRow.style.display==='none' || newRow.style.display==='';
      newRow.style.display = show ? 'flex' : 'none';
      if(show && nameInput) { nameInput.value=''; nameInput.focus(); }
    });
  }
  const btnCreateProf=$('btnCreateProfile');
  if(btnCreateProf){
    btnCreateProf.addEventListener('click', ()=>{
      const nm=nameInput?nameInput.value:'';
      const id=createProfile(nm);
      if(id){
        setActiveProfile(id);
        if(newRow) newRow.style.display='none';
        toast('✅ Profile created');
      }
    });
  }

  // Setup page profile controls (so users don't need to enter a profile when saving)
  const setupProfSel=$('setupProfileSelect');
  if(setupProfSel){
    renderSetupProfileControls();
    setupProfSel.addEventListener('change', (e)=>{
      const id=e.target.value;
      if(id && id!==ACTIVE_PROFILE_ID){
        setActiveProfile(id);
        toast('✅ Switched profile');
        // Refill setup fields from profile to reduce re-entry
        try{clearSetupForm();}catch(err){}
      }
    });
  }
  const btnSetupNew=$('btnSetupNewProfile');
  const setupRow=$('setupNewProfileRow');
  const setupName=$('setupNewProfileName');
  if(btnSetupNew && setupRow){
    btnSetupNew.addEventListener('click', ()=>{
      const show = setupRow.style.display==='none' || setupRow.style.display==='' ;
      setupRow.style.display = show ? 'flex' : 'none';
      if(show && setupName){ setupName.value=''; setupName.focus(); }
    });
  }
  const btnSetupCreate=$('btnSetupCreateProfile');
  if(btnSetupCreate){
    btnSetupCreate.addEventListener('click', ()=>{
      const nm=setupName?setupName.value:'';
      const id=createProfile(nm);
      if(id){
        setActiveProfile(id);
        if(setupRow) setupRow.style.display='none';
        // Refresh both selectors
        try{renderSetupProfileControls();}catch(e){}
        try{renderSettingsPage();}catch(e){}
        toast('✅ Profile created');
      }
    });
  }

  const testBtn=$('btnTestAI');
  if(testBtn){testBtn.addEventListener('click',testAiConnection);}

  const btnSaveSettings=$('btnSaveSettings');
  if(btnSaveSettings){ btnSaveSettings.addEventListener('click',saveSettings); }

  // "New Block" button was removed from Settings (generation lives in Setup).
  // Keep this handler only if the element exists (e.g., older cached HTML).
  const btnNewBlock=$('btnNewBlock');
  if(btnNewBlock) btnNewBlock.addEventListener('click',()=>{
    const pidx=loadProfilesIndex();
    const pName=(pidx.profiles.find(p=>p.id===ACTIVE_PROFILE_ID)?.name)||'Default';
    if(!confirm(`Save current block to history for "${pName}" and start a new block? This will archive your current progress.`))return;
    
    try{
      const block=getStorage(SK.block);
      const prof=getStorage(SK.profile);
      const sessions=getStorage(SK.sessions,[]);
      const sets=getStorage(SK.sets,[]);
      
      // NEW: if starting a new block mid-cycle, store a transition (ramp-in) suggestion
      const priorBlock=getStorage(SK.block);
      const deload=checkDeloadNeed();
      let endedEarly=false;
      try{
        if(priorBlock && priorBlock.blockLength){
          const curW=parseInt(priorBlock.currentWeek||1,10)||1;
          endedEarly = curW>1 && curW<=parseInt(priorBlock.blockLength||curW,10);
        }
      }catch(e){}
      const recommendedWeeks = (endedEarly || (deload && deload.needsDeload)) ? 2 : 1;
      setStorage(SK.pendingTransition, {
        createdAt:new Date().toISOString(),
        fromBlockId: priorBlock ? priorBlock.id : null,
        endedEarly: endedEarly,
        currentWeek: priorBlock ? priorBlock.currentWeek : null,
        deloadCheck: deload || null,
        recommendedWeeks: recommendedWeeks
      });
      // Save current block to history if it exists
      if(block && sessions.length>0){
        // Create archived block record
        const archivedBlock={
          id:uuid(),
          profileId:ACTIVE_PROFILE_ID,
          profileName:pName,
          originalBlockId:block.id,
          archivedAt:new Date().toISOString(),
          programType:block.programType,
          blockLength:block.blockLength,
          daysPerWeek:block.daysPerWeek,
          completedWeeks:block.currentWeek-1,
          totalSessions:sessions.length,
          completedSessions:sessions.filter(s=>s.status==='completed').length,
          maxes:{
            snatch:prof?.snatch||0,
            cleanJerk:prof?.cleanJerk||0,
            frontSquat:prof?.frontSquat||0,
            backSquat:prof?.backSquat||0,
            units:prof?.units||'kg'
          },
          sessions:sessions,
          sets:sets
        };
        
        // Get existing history
        const history=getStorage(SK.archivedBlocks,[]);
        history.unshift(archivedBlock);
        
        // Keep only last 10 blocks in history
        if(history.length>10){
          history.splice(10);
        }
        
        setStorage(SK.archivedBlocks,history);
        toast('✅ Block saved to history');
      }
      
      // Clear current training data
      removeStorage(SK.block);
      removeStorage(SK.sessions);
      removeStorage(SK.sets);
      // Keep profile (name/maxes/settings) so user doesn't have to re-enter.
      
      // Reset day selections (data)
      selectedMainDays=[];
      selectedAccessoryDays=[];
      
      // Reset day selection UI (buttons)
      document.querySelectorAll('#mainDaySelector .day-btn').forEach(btn=>{
        btn.classList.remove('active');
      });
      document.querySelectorAll('#accessoryDaySelector .day-btn').forEach(btn=>{
        btn.classList.remove('accessory');
        btn.disabled=false;
        btn.style.opacity='1';
        btn.style.cursor='pointer';
      });
      
      // Clear all setup form fields
      $('setupSnatch').value='';
      $('setupCleanJerk').value='';
      $('setupFrontSquat').value='';
      $('setupBackSquat').value='';
      $('setupUnits').value='kg';
      $('setupBlockLength').value='8';
      $('setupProgram').value='general';
      $('setupDuration').value='75';
    if($('setupIncludeBlocks')) $('setupIncludeBlocks').value='yes';
      
      toast('🆕 Ready for new block - enter your info');
      setTimeout(()=>navigateToPage('Setup'),800);
      
    }catch(err){
      console.error('New block error:',err);
      toast('⚠️ Failed: '+err.message);
    }
  });
  $('btnResetAll').addEventListener('click',resetAllData);
  $('modalClose').addEventListener('click',closeModal);
  $('navSetup').addEventListener('click',()=>navigateToPage('Setup'));
  $('navDashboard').addEventListener('click',()=>navigateToPage('Dashboard'));
  $('navWorkout').addEventListener('click',()=>navigateToPage('Workout'));
  $('navHistory').addEventListener('click',()=>navigateToPage('History'));
  const navSettings=$('navSettings');
  if(navSettings) navSettings.addEventListener('click',()=>navigateToPage('Settings'));
  const goDash=$('btnGoDashboard'); if(goDash) goDash.addEventListener('click',()=>navigateToPage('Dashboard'));
  const goWk=$('btnGoWorkout'); if(goWk) goWk.addEventListener('click',()=>navigateToPage('Workout'));

  $('workoutDetail').addEventListener('click',function(e){if(e.target===this){closeWorkoutDetail()}});

  // Execution mode UI wiring
  $('btnExecExit').addEventListener('click',closeExecutionMode);
  $('btnExecPrev').addEventListener('click',execPrev);
  $('btnExecNext').addEventListener('click',execNext);
  $('execOverlay').addEventListener('click',function(e){if(e.target===this){closeExecutionMode()}});
  $('execStatusBtns').querySelectorAll('button').forEach(b=>{
    const st=b.dataset.status;
    if(!st) return;
    b.addEventListener('click',()=>execSetStatus(st));
  });
  const cutBtn=$('btnCutRemaining');
  if(cutBtn){
    cutBtn.addEventListener('click',()=>{
      const set=getCurrentSet();
      if(!set||!execState.sessionId) return;
      const prof=getStorage(SK.profile);
      if(prof && prof.autoCutEnabled===false){
        toast('Auto-cut is disabled in Settings');
        return;
      }
      const ok=confirm('Cut the remaining sets for this exercise?');
      if(!ok) return;
      const changed=cutRemainingSetsForExercise(execState.sessionId,set.exercise,set.setIndex);
      if(changed){
        toast('✂ Remaining sets skipped');
        renderExecutionSet();
        openWorkoutDetail(execState.sessionId);
      }
    });
  }
['execWeight','execReps','execRpe'].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener('change',()=>execPersistInputs());
  });
  $('btnExecComplete').addEventListener('click',()=>{
    if(!execState.sessionId) return;
    completeSessionQuick(execState.sessionId);
    closeExecutionMode();
  });
  $('btnExecOpenTable').addEventListener('click',()=>{
    if(!execState.sessionId) return;
    openWorkoutDetail(execState.sessionId);
  });
  
  // Initialize readiness modal
  initReadinessModal();
}

// Expose functions to window for inline handlers
window.openWorkoutDetail=openWorkoutDetail;
window.toggleDayCard=toggleDayCard;
window.toggleExerciseQuick=toggleExerciseQuick;
window.handleSetInput=handleSetInput;
window.handleStatusClick=handleStatusClick;
window.openExecutionMode=openExecutionMode;
window.completeSessionQuick=completeSessionQuick;
window.openReadinessModal=openReadinessModal;
window.closeReadinessModal=closeReadinessModal;
window.saveReadinessCheck=saveReadinessCheck;

document.addEventListener('DOMContentLoaded',setupApp);
window.addEventListener('error',e=>{console.error('Error:',e);toast('⚠️ Error occurred')});

})();
