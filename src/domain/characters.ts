/**
 * Character ID constants and helpers.
 * Single source of truth for default/primary character in single-character mode.
 */

export const DEFAULT_CHARACTER_ID = 'runningboy';

export function getPrimaryCharacterId(): string {
  return DEFAULT_CHARACTER_ID;
}
