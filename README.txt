LiftAI Programming Logic Upgrade (Option 1: keep block structure)

What changed:
- New 1RMs saved in Settings recompute working maxes and regenerate weeks (structure stays the same).
- Prescribed weights everywhere now use adjusted working max (profile.liftAdjustments) for consistency.
- Action dropdown (make/belt/heavy/miss) continues to adjust later WORK sets in-session.
- Manual change to the FIRST work set creates a session-level offset and updates later work sets (unless overridden).
- Completing a day updates profile.liftAdjustments (very conservatively), so future prescriptions adapt.

Deploy:
- Replace repo root files with index.html and app.js from this zip.
- Commit + push.
- If iPhone Safari caches: open in private tab once.
Build timestamp: 1768444172