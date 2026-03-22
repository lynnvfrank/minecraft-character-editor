# Configuration

This document describes what can be configured vs code defaults. Config is optional; code defaults remain when config is absent.

**Audience:** humans and coding agents working in this repo.

---

## What can be configured

| Concern | Default | Config location | Notes |
|---------|---------|-----------------|-------|
| Idle animation preference | `['bored', 'shrugging', 'crying', 'laughing']` | `PREFERRED_IDLE_KEYS` in `src/config/scene.config.ts` | First available is used for idle |
| Preview base skin | `skin-base.png`, then primary fallback | `getPreviewBaseSkinCandidates()` in `src/config/scene.config.ts` | For composed preview overlays |
| Fallback skins/animations | Defined in `main.ts` | `FALLBACK_SKINS`, `FALLBACK_ANIMATIONS` | Used when API index fails |
| Scene FOV | `45` (or `?fov=`) | URL params | `params.get('fov')` |
| Character ID | `runningboy` | `DEFAULT_CHARACTER_ID` in `src/domain/characters.ts` | Primary character |

---

## File locations

- **Scene/character config:** `src/config/scene.config.ts`
- **Character ID:** `src/domain/characters.ts`
- **URL params:** Parsed at startup in `main.ts` (`?fov=`, `?turn=`, `?creatorIdleMinDuration=`, etc.)

---

## Merge order (future JSON config)

If JSON config is added later:

1. Load defaults from code (`scene.config.ts`, `domain/characters.ts`)
2. Load optional `scene.config.json` (or similar)
3. Merge: JSON overrides code defaults
4. Use merged result for `PREFERRED_IDLE_KEYS`, character list, camera defaults, etc.

---

## Reference

- **AGENT-README** — orientation, high-value files
- **CHARACTERS.md** — character data model
- **SCENE-CONTEXT.md** — scene ownership
