// 🔍 LOAD BLOCK DIAGNOSTIC TOOL
// Run this in console after clicking Load to see what's happening

console.log('🔍 ==== LOAD BLOCK DIAGNOSTIC ====\n');

// Check current state
console.log('📊 Current State:');
if (typeof state !== 'undefined') {
  console.log('  state.currentBlock exists:', !!state.currentBlock);
  if (state.currentBlock) {
    console.log('  state.currentBlock.programType:', state.currentBlock.programType);
    console.log('  state.currentBlock.weeks:', state.currentBlock.weeks?.length);
    console.log('  state.currentBlock.startDateISO:', state.currentBlock.startDateISO);
  }
} else {
  console.log('  ❌ state object not found');
}
console.log('');

// Check localStorage
console.log('💾 LocalStorage:');
try {
  const stored = localStorage.getItem('liftai_state');
  if (stored) {
    const parsed = JSON.parse(stored);
    console.log('  currentBlock exists:', !!parsed.currentBlock);
    if (parsed.currentBlock) {
      console.log('  currentBlock.programType:', parsed.currentBlock.programType);
    }
  } else {
    console.log('  ⚠️ No data in localStorage');
  }
} catch (err) {
  console.log('  ❌ Error:', err.message);
}
console.log('');

// Check UI
console.log('🎨 UI Elements:');
const blockSubtitle = document.getElementById('blockSubtitle');
if (blockSubtitle) {
  console.log('  blockSubtitle text:', blockSubtitle.textContent);
} else {
  console.log('  ❌ blockSubtitle element not found');
}

const dashboardSubtitle = document.getElementById('dashboardSubtitle');
if (dashboardSubtitle) {
  console.log('  dashboardSubtitle text:', dashboardSubtitle.textContent);
} else {
  console.log('  ❌ dashboardSubtitle element not found');
}
console.log('');

// Check week index
console.log('📅 Week Index:');
if (typeof ui !== 'undefined') {
  console.log('  ui.weekIndex:', ui.weekIndex);
  console.log('  ui.currentPage:', ui.currentPage);
} else {
  console.log('  ❌ ui object not found');
}
console.log('');

// Diagnostic function to force reload
console.log('🔧 Manual Fix Function:');
console.log('If Workout tab is stale, run: forceWorkoutReload()');
console.log('');

window.forceWorkoutReload = function() {
  console.log('🔄 Forcing workout reload...');
  if (typeof renderWorkout !== 'undefined') {
    renderWorkout();
    console.log('✅ renderWorkout() called');
    if (typeof state !== 'undefined' && state.currentBlock) {
      console.log('   currentBlock.programType:', state.currentBlock.programType);
    }
  } else {
    console.log('❌ renderWorkout() not found');
  }
};

// Check if there's a mismatch
console.log('🔍 Mismatch Check:');
if (typeof state !== 'undefined' && state.currentBlock) {
  const storedProgramType = state.currentBlock.programType;
  const displayedText = blockSubtitle ? blockSubtitle.textContent : 'N/A';
  
  if (displayedText.includes(storedProgramType)) {
    console.log('  ✅ Match: Displayed program type matches stored');
  } else {
    console.log('  ❌ MISMATCH DETECTED!');
    console.log('     Stored:', storedProgramType);
    console.log('     Displayed:', displayedText);
    console.log('');
    console.log('  💡 Fix: Run forceWorkoutReload()');
  }
}

console.log('');
console.log('🔍 ==== DIAGNOSTIC COMPLETE ====');
