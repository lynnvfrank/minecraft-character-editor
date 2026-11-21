/**
 * Creator shortcuts into the world: "Send to village" and "Dance in studio".
 *
 * The creator's save panel only publishes the two bus events (creator code can't reach the
 * residents roster or the routes); this controller does the work and answers with
 * `app:creator:world-status`, which the panel shows.
 *
 * - Send to village: keep the current skin as an outfit (the same image is kept once), make the
 *   main character officially wear it, add `outfit:<id>` to the residents roster, then leave the
 *   creator through the normal Home transition. A full village keeps the outfit but stays in the
 *   creator so the message can be read.
 * - Dance in studio: the main character already wears the creator's skin; leave the creator
 *   through the same exit transition, landing on `#/studio` instead of Home.
 */
import { outfitSaveMessage, type AddOutfitOutcome, type Outfit } from '../domain/outfits';
import { addResident, outfitRosterKey } from '../domain/residents';
import { APP_EVENTS, publish, subscribe } from '../events/appEvents';
import type { ArmModel } from '../skin/armModel';

export const STUDIO_HASH = '#/studio';

export type CreatorToWorldDeps = {
  getRoute: () => string;
  /** Whether the creator holds a skin at all (false before anything was loaded or drawn). */
  hasSkin: () => boolean;
  /** The creator's skin as a 64×64 PNG data URL ('' if it can't be exported). */
  exportSkin: () => string;
  /** Arm model the character is shown with right now. */
  getArmModel: () => ArmModel;
  outfits: {
    add: (input: { dataUrl: string; armModel: ArmModel }) => {
      outfit: Outfit | null;
      outcome: AddOutfitOutcome;
      persisted: boolean;
    };
  };
  residents: {
    get: () => readonly string[] | null;
    set: (roster: readonly string[]) => void;
  };
  /** Roster entries in the world right now (the main character's first). */
  getPresentSkins: () => readonly string[];
  /** Every roster entry that exists: bundled skin paths and outfit keys. */
  getAvailableSkins: () => readonly string[];
  /** Most residents at once. */
  cap: number;
  /** Record that the main character now wears this outfit image (it already looks like it). */
  wearOutfit: (dataUrl: string) => void;
  /** Leave the creator with its exit transition, to Home or to another route's hash. */
  exitCreator: (targetHash?: string) => Promise<void>;
  /** Tell the user (defaults to the `app:creator:world-status` bus event). */
  say?: (message: string) => void;
};

export function createCreatorToWorld(deps: CreatorToWorldDeps) {
  const say = deps.say ?? ((message: string) => publish(APP_EVENTS['app:creator:world-status'], { message }));

  /** Returns whether the creator was left for the village. */
  async function sendToVillage(): Promise<boolean> {
    if (deps.getRoute() !== 'creator') return false;
    const dataUrl = deps.hasSkin() ? deps.exportSkin() : '';
    if (!dataUrl) {
      say('Nothing to send yet. Pick or paint a skin first.');
      return false;
    }
    const kept = deps.outfits.add({ dataUrl, armModel: deps.getArmModel() });
    if (!kept.outfit) {
      say(outfitSaveMessage(kept.outcome, kept.persisted));
      return false;
    }
    // The main character is the one wearing it; in the village it is this resident, not a twin.
    deps.wearOutfit(kept.outfit.dataUrl);
    const key = outfitRosterKey(kept.outfit.id);
    const result = addResident(deps.residents.get(), deps.getPresentSkins(), deps.getAvailableSkins(), deps.cap, key);
    if (result.outcome === 'full') {
      say(`Kept in My outfits. The village is full (${deps.cap}), so send someone home from Residents first.`);
      return false;
    }
    if (result.outcome === 'unknown') {
      say(outfitSaveMessage('invalid'));
      return false;
    }
    // With no stored roster (random visitors) the outfit already counts as present because the main
    // character wears it; store the roster anyway, or it would be gone after a reload.
    if (result.outcome === 'added' || deps.residents.get() === null) deps.residents.set(result.roster);
    say(kept.persisted ? 'Off to the village!' : `Off to the village! ${outfitSaveMessage('added', false)}`);
    await deps.exitCreator();
    return true;
  }

  /** Returns whether the creator was left for the studio. */
  async function danceInStudio(): Promise<boolean> {
    if (deps.getRoute() !== 'creator') return false;
    if (!deps.hasSkin()) {
      say('Nothing to dance in yet. Pick or paint a skin first.');
      return false;
    }
    say('To the studio!');
    await deps.exitCreator(STUDIO_HASH);
    return true;
  }

  /** Listen for the creator's two requests. App lifetime; returns the unsubscribe. */
  function start(): () => void {
    const offSend = subscribe(APP_EVENTS['app:creator:send-to-village'], () => void sendToVillage());
    const offDance = subscribe(APP_EVENTS['app:creator:dance-in-studio'], () => void danceInStudio());
    return () => {
      offSend();
      offDance();
    };
  }

  return { sendToVillage, danceInStudio, start };
}

export type CreatorToWorld = ReturnType<typeof createCreatorToWorld>;
