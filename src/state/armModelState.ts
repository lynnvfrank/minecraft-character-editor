/**
 * Arm model state: the user's setting (auto / slim / classic) plus the model detected
 * from the current skin. Subscribers are notified whenever the resolved state may change.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { resolveArmModel, type ArmModel, type ArmModelSetting } from '../skin/armModel';

export type ArmModelStateOptions = {
  initialSetting: ArmModelSetting;
  initialDetected?: ArmModel;
  /** Called when the user changes the setting (e.g. write to localStorage). */
  persist?: (setting: ArmModelSetting) => void;
};

export function createArmModelState(opts: ArmModelStateOptions) {
  let setting = opts.initialSetting;
  let detected: ArmModel = opts.initialDetected ?? 'slim';
  const slice = createSubscribable();

  return {
    getSetting: (): ArmModelSetting => setting,
    getDetected: (): ArmModel => detected,
    getResolved: (): ArmModel => resolveArmModel(setting, detected),
    /** Whether a newly selected skin should be scanned for its arm model. */
    isAuto: (): boolean => setting === 'auto',
    setSetting(next: ArmModelSetting): void {
      setting = next;
      opts.persist?.(next);
      slice.notify();
    },
    /** Record a detection result; null (unknown) or an unchanged value is ignored. Returns true if it changed. */
    setDetected(model: ArmModel | null): boolean {
      if (!model || model === detected) return false;
      detected = model;
      slice.notify();
      return true;
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
    /** Re-broadcast current state (e.g. a panel rendered before detection finished). */
    notify: (): void => slice.notify(),
  };
}

export type ArmModelState = ReturnType<typeof createArmModelState>;
