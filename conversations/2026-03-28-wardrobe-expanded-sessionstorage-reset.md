# Wardrobe layer expansion persistence & reset

**Saved:** 2026-03-28  
**Scope:** Ask-mode Q&A on where wardrobe tree expand/collapse is stored and how to clear it; request to archive this thread under `conversations/`.

---

## Question: Reset wardrobe layers / expanded state to “first use”

**Context:** User believed wardrobe layer expansion was saved in generic “browser state” and wanted a way to reset to first-use behavior.

---

## Answer (code-backed)

### Where it lives

Wardrobe **expand/collapse** for the layer tree is **`sessionStorage`**, not `localStorage`.

- **Key:** `creator-wardrobe-expanded`
- **Value:** JSON array of expanded node keys (strings)
- **Code:** `src/creator/wardrobePartsPanel.ts` — `WARDROBE_EXPANDED_KEY`, `getExpandedSet()`, `setExpanded()`

If the key is missing or invalid, `getExpandedSet()` returns an **empty** `Set` (first-use style for that persistence).

### How to reset

1. **Close the tab/window** — `sessionStorage` is cleared when the browsing session for that tab ends.
2. **DevTools** — Application (Chrome) / Storage (Firefox) → Session Storage → origin → delete `creator-wardrobe-expanded` → reload.
3. **Console** — `sessionStorage.removeItem('creator-wardrobe-expanded')` then reload.

Clearing **all** site data for the origin also removes it (and everything else for that site).

### Related (not wardrobe tree expansion)

- **Focused creation** toggle: **`localStorage`** key `creator:focusedCreation` in `src/creator.ts` — separate from wardrobe tree expansion.
- **3D layers panel** collapse and similar may live in **in-memory** `state` until reload; not the same as `creator-wardrobe-expanded`.

---

## Follow-up: Export this conversation

User asked to write the conversation into the `conversations/` directory; this file satisfies that.
