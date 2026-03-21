/**
 * Socket.io client with fallback to local fake mode.
 * When the server is unavailable, runs in fake mode: same API, events only from local UI.
 *
 * Set VITE_SOCKET_ENABLED=true when you have a Socket.io server to connect to;
 * otherwise it skips the connection attempt and avoids WebSocket console errors.
 */
import { io, Socket } from 'socket.io-client';
import { logger } from '../lib/logger';

type SocketEventHandler = (data: { type: string; name: string }) => void;

export type SocketManager = {
  isConnected: () => boolean;
  on: (event: 'skin' | 'animation', handler: SocketEventHandler) => void;
  off: (event: 'skin' | 'animation', handler: SocketEventHandler) => void;
  /** Fake mode only: simulate server events (e.g. for testing without backend) */
  emitSkin: (name: string) => void;
  emitAnimation: (name: string) => void;
  destroy: () => void;
};

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : '';
const SOCKET_ENABLED = import.meta.env.VITE_SOCKET_ENABLED === 'true';

export function createSocketManager(): SocketManager {
  const handlers: { skin: SocketEventHandler[]; animation: SocketEventHandler[] } = {
    skin: [],
    animation: []
  };

  let socket: Socket | null = null;
  let fakeMode = !SOCKET_ENABLED;

  const emit = (type: 'skin' | 'animation', name: string) => {
    const list = handlers[type];
    list.forEach((h) => h({ type, name }));
  };

  if (SOCKET_ENABLED) {
    try {
      socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        timeout: 3000
      });

      socket.on('connect', () => {
        fakeMode = false;
        logger.info('messaging', 'Socket connect', {});
      });

      socket.on('skin', (name: string) => emit('skin', name));
      socket.on('animation', (name: string) => emit('animation', name));

      socket.on('connect_error', () => {
        if (!fakeMode) {
          fakeMode = true;
          logger.warn('messaging', 'Socket connection failed — fake mode', {});
        }
      });

      socket.on('disconnect', () => {
        fakeMode = true;
        logger.info('messaging', 'Socket disconnect', {});
      });
    } catch (e) {
      fakeMode = true;
      logger.warn('messaging', 'Socket init failed — fake mode', { error: String(e) });
    }
  }

  return {
    isConnected: () => !!socket?.connected,
    on(event: 'skin' | 'animation', handler: SocketEventHandler) {
      handlers[event].push(handler);
    },
    off(event: 'skin' | 'animation', handler: SocketEventHandler) {
      const list = handlers[event];
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    },
    emitSkin(name: string) {
      emit('skin', name);
    },
    emitAnimation(name: string) {
      emit('animation', name);
    },
    destroy() {
      socket?.disconnect();
      socket?.removeAllListeners();
      socket = null;
    }
  };
}
