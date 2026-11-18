/**
 * Emoji and friendly names for animation keys, shared by the Move panel and the dance studio.
 * Pure data (no DOM), so tests can import it.
 */

/** Emoji and a short friendly name per animation key. Unknown keys fall back to a clapperboard and the manifest label. */
export const MOVE_INFO: Record<string, { emoji: string; label: string }> = {
  acknowledging: { emoji: '🙂', label: 'Say Hi' },
  'arm-stretching': { emoji: '🙆', label: 'Stretch' },
  backflip: { emoji: '🤸', label: 'Backflip' },
  bashful: { emoji: '😊', label: 'Bashful' },
  'blow-akiss': { emoji: '😘', label: 'Blow a Kiss' },
  bored: { emoji: '😑', label: 'Bored' },
  clapping: { emoji: '👏', label: 'Clap' },
  crying: { emoji: '😢', label: 'Cry' },
  'dancing-twerk': { emoji: '💃', label: 'Dance' },
  excited: { emoji: '🤩', label: 'Excited' },
  'female-walk': { emoji: '🚶', label: 'Strut' },
  'happy-idle': { emoji: '😌', label: 'Happy Idle' },
  happy: { emoji: '😄', label: 'Happy' },
  'hard-head-nod': { emoji: '🤘', label: 'Head Nod' },
  idle: { emoji: '🧍', label: 'Idle' },
  jump: { emoji: '🦘', label: 'Jump' },
  laughing: { emoji: '😂', label: 'Laugh' },
  laying: { emoji: '🛌', label: 'Lie Down' },
  'look-around': { emoji: '👀', label: 'Look Around' },
  pointing: { emoji: '👉', label: 'Point' },
  'quick-informal-bow': { emoji: '🙇', label: 'Bow' },
  shrugging: { emoji: '🤷', label: 'Shrug' },
  'sit-to-stand': { emoji: '⬆️', label: 'Stand Up' },
  'sitting-clap': { emoji: '🙌', label: 'Sitting Clap' },
  'sitting-talking': { emoji: '💬', label: 'Sitting Talk' },
  'sitting-yell': { emoji: '📣', label: 'Sitting Yell' },
  'stand-to-sit': { emoji: '🪑', label: 'Sit Down' },
  'standing-thumbs-up': { emoji: '👍', label: 'Thumbs Up' },
  surprised: { emoji: '😮', label: 'Surprised' },
  texting: { emoji: '📱', label: 'Texting' },
  thinking: { emoji: '🤔', label: 'Thinking' },
  'thoughtful-head-shake': { emoji: '🙅', label: 'Head Shake' },
  waving: { emoji: '👋', label: 'Wave' },
  yawn: { emoji: '🥱', label: 'Yawn' },
  // Quaternius Universal Animation Library (CC0), see assets-src/animations/quaternius/clips.json
  'relaxed-idle': { emoji: '😮‍💨', label: 'Relax' },
  chatting: { emoji: '🗣️', label: 'Chat' },
  stroll: { emoji: '🚶', label: 'Stroll' },
  'formal-walk': { emoji: '🎩', label: 'Formal Walk' },
  jog: { emoji: '🏃', label: 'Jog' },
  sprint: { emoji: '💨', label: 'Sprint' },
  crouch: { emoji: '🧎', label: 'Crouch' },
  sneak: { emoji: '🥷', label: 'Sneak' },
  groove: { emoji: '🕺', label: 'Groove' },
  roll: { emoji: '🌀', label: 'Roll' },
  jab: { emoji: '🥊', label: 'Jab' },
  punch: { emoji: '👊', label: 'Punch' },
  oof: { emoji: '😣', label: 'Oof' },
  bonk: { emoji: '🤕', label: 'Bonk' },
  faint: { emoji: '😵', label: 'Faint' },
  interact: { emoji: '🖐️', label: 'Interact' },
  'pick-up': { emoji: '📦', label: 'Pick Up' },
  push: { emoji: '🫸', label: 'Push' },
  'fix-it': { emoji: '🔧', label: 'Fix It' },
  'cast-spell': { emoji: '🪄', label: 'Cast Spell' },
  'sit-still': { emoji: '🪑', label: 'Sit Still' },
  swim: { emoji: '🏊', label: 'Swim' },
  'tread-water': { emoji: '🛟', label: 'Tread Water' },
};

/** Movement building blocks (turns, walk phases): not fun on their own. */
export const MOVEMENT_CLIPS = /^(walking|start-walking|stop-walking|start-walking-movement|stop-walking-movement|left-turn|right-turn|walking-backwards)$/;

/** Friendly label for a clip; unknown keys split the manifest label's camelCase. */
export function moveLabel(key: string, manifestLabel = key): string {
  return MOVE_INFO[key]?.label ?? manifestLabel.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function moveEmoji(key: string): string {
  return MOVE_INFO[key]?.emoji ?? '🎬';
}
