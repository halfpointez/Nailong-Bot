# Fix Report: Easter Egg Per-Day Cooldown

**Status:** Fixed

**Commit:** `20123dbc22c2bf0bd797828c9062cfb3ea0a89a4`

**Change:** `bot/database.ts:66` — PRIMARY KEY on `easter_eggs` changed from `(user_id, egg_name)` to `(user_id, egg_name, date)`.

**Verification:** `npx tsc --noEmit` → zero errors.
