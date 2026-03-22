/**
 * Viewer UI: skin previews, animation buttons, sequence buttons,
 * highlightActiveSkin, highlightActiveButton.
 */

import * as THREE from 'three';
import { logger } from '../lib';
import { APP_EVENTS, publish } from '../events/appEvents';
import type { SkinEntry, AnimationEntry } from '../domain';
import type { CharacterState } from './characterTypes';
import type { SequenceStep } from '../animation';

export type Sequence = { id: string; label: string; steps: SequenceStep[] };

export type ViewerUIDeps = {
  getCharacter: (id: string) => CharacterState | undefined;
  getPrimaryCharacterId: () => string;
  getAnimationManager: () => { playSequence: (steps: SequenceStep[]) => void; setLastActivity: () => void } | null;
};

export type ViewerUIController = {
  setupSkinPreviews: (skins: SkinEntry[]) => void;
  setupAnimationButtons: (animations: AnimationEntry[]) => void;
  setupSequenceButtons: (sequences: Sequence[]) => void;
  highlightActiveSkin: (charId: string, skinPath: string) => void;
  highlightActiveButton: (charId: string, action: THREE.AnimationAction) => void;
};

export function createViewerUIController(deps: ViewerUIDeps): ViewerUIController {
  const { getCharacter, getPrimaryCharacterId, getAnimationManager } = deps;

  function highlightActiveSkin(charId: string, skinPath: string) {
    const selector = document.getElementById('skin-selector');
    if (!selector) return;
    selector.querySelectorAll<HTMLElement>('.skin-preview[data-character]').forEach((el) => {
      el.classList.toggle('active', el.dataset.character === charId && el.dataset.skin === skinPath);
    });
  }

  function setupSkinPreviews(skins: SkinEntry[]) {
    const container = document.getElementById('skin-selector');
    if (!container) return;

    container.innerHTML = '';
    const charId = getPrimaryCharacterId();

    skins.forEach((skin) => {
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'skin-preview';
      wrap.dataset.character = charId;
      wrap.dataset.skin = skin.path;
      wrap.setAttribute('aria-label', `Select skin: ${skin.label}`);

      const img = document.createElement('img');
      img.src = skin.preview ?? skin.path;
      img.alt = skin.label;
      img.loading = 'lazy';
      wrap.appendChild(img);

      wrap.addEventListener('click', () => {
        logger.debug('input', 'Skin button click', { skin: skin.path, label: skin.label });
        publish(APP_EVENTS['app:character:skin-change'], { path: skin.path });
      });
      container.appendChild(wrap);
    });

    const char = getCharacter(charId);
    if (char) highlightActiveSkin(charId, char.currentSkin);
  }

  function setupAnimationButtons(animations: AnimationEntry[]) {
    const container = document.getElementById('anim-selector');
    if (!container) return;

    container.innerHTML = '';
    const charId = getPrimaryCharacterId();

    animations.forEach((anim) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'anim-button';
      btn.dataset.character = charId;
      btn.dataset.action = anim.key;
      btn.textContent = anim.label;
      btn.setAttribute('aria-label', `Play animation: ${anim.label}`);
      btn.addEventListener('click', () => {
        logger.debug('input', 'Animation button click', { animation: anim.key, label: anim.label });
        publish(APP_EVENTS['app:character:animation-play'], { name: anim.key });
      });
      container.appendChild(btn);
    });

    const char = getCharacter(charId);
    if (char?.idleAction) highlightActiveButton(charId, char.idleAction);
  }

  function setupSequenceButtons(sequences: Sequence[]) {
    const container = document.getElementById('sequence-selector');
    const animationManager = getAnimationManager();
    if (!container || !animationManager) return;

    container.innerHTML = '';

    sequences.forEach((seq) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sequence-button';
      btn.dataset.sequence = seq.id;
      btn.textContent = seq.label;
      btn.setAttribute('aria-label', `Play sequence: ${seq.label}`);
      btn.addEventListener('click', () => {
        logger.debug('input', 'Sequence button click', { sequence: seq.id, label: seq.label });
        animationManager!.setLastActivity();
        animationManager!.playSequence(seq.steps);
      });
      container.appendChild(btn);
    });
  }

  function highlightActiveButton(charId: string, action: THREE.AnimationAction) {
    const char = getCharacter(charId);
    if (!char) return;
    const matchKey = Object.entries(char.actions).find(([, a]) => a === action)?.[0];
    if (!matchKey) return;

    const btn = document.querySelector<HTMLButtonElement>(
      `.anim-button[data-character="${charId}"][data-action="${matchKey}"]`
    );
    if (!btn) return;

    document
      .querySelectorAll<HTMLButtonElement>(`.anim-button[data-character="${charId}"]`)
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  return {
    setupSkinPreviews,
    setupAnimationButtons,
    setupSequenceButtons,
    highlightActiveSkin,
    highlightActiveButton,
  };
}
