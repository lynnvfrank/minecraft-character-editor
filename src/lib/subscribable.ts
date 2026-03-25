/**
 * Minimal in-process pub/sub for creator state slices (no document events).
 */

export type Unsubscribe = () => void;

export type Subscribable = {
  subscribe(listener: () => void): Unsubscribe;
  notify(): void;
};

export function createSubscribable(): Subscribable {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const fn of listeners) fn();
    },
  };
}

export type PayloadSubscribable<T> = {
  subscribe(listener: (payload: T) => void): Unsubscribe;
  notify(payload: T): void;
};

export function createPayloadSubscribable<T>(): PayloadSubscribable<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(payload: T) {
      for (const fn of listeners) fn(payload);
    },
  };
}
