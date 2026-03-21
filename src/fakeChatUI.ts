/**
 * Fake chat UI: input, send, message history, canned AI responses, and sequence triggers.
 * 30s no messages → switch to idle.
 * 60s no messages → start idle wandering.
 */
import type { SequenceStep } from './animation';
import { logger } from './logger';

const CANNED_RESPONSES = [
  "Hey! 👋",
  "That's hilarious 😂",
  "Thinking...",
  "Oh wow, really?",
  "Nice! ✨",
  "Hmm, interesting...",
  "I'm on it! 🏃",
  "Gotcha!",
  "Sure thing! 👍",
  "LOL",
  "Wait, what? 🤔",
  "Love it! 💜",
  "Okay okay",
  "No way!",
  "Okay, I'll try that!"
];

export type FakeChatUICallbacks = {
  onUserMessage?: (text: string) => void;
  onFakeReply?: (text: string) => void;
  onPlaySequence: (sequence: SequenceStep[]) => void;
  onMessageSent: () => void;
  getExampleSequences: () => SequenceStep[][];
  setLastActivity: () => void;
  checkIdleTimers: () => void;
};

export function createFakeChatUI(callbacks: FakeChatUICallbacks) {
  const { onPlaySequence, getExampleSequences, setLastActivity, checkIdleTimers } =
    callbacks;

  const container = document.createElement('div');
  container.id = 'fake-chat-container';
  container.innerHTML = `
    <div class="fake-chat-window">
      <div class="fake-chat-messages" id="fake-chat-messages"></div>
      <div class="fake-chat-input-row">
        <input type="text" id="fake-chat-input" placeholder="Type a message..." autocomplete="off" />
        <button type="button" id="fake-chat-send">Send</button>
      </div>
    </div>
  `;

  const messagesEl = container.querySelector('#fake-chat-messages') as HTMLElement;
  const inputEl = container.querySelector('#fake-chat-input') as HTMLInputElement;
  const sendBtn = container.querySelector('#fake-chat-send') as HTMLButtonElement;

  function addMessage(text: string, isUser: boolean) {
    const div = document.createElement('div');
    div.className = `fake-chat-msg ${isUser ? 'user' : 'ai'}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function handleSend() {
    const text = (inputEl.value || '').trim();
    if (!text) return;

    logger.info('messaging', 'User message', { text: text.length > 50 ? text.slice(0, 50) + '…' : text });
    addMessage(text, true);
    inputEl.value = '';

    callbacks.onUserMessage?.(text);
    callbacks.onMessageSent();

    const reply = pickRandom(CANNED_RESPONSES);
    logger.debug('messaging', 'Fake reply', { text: reply });
    addMessage(reply, false);
    callbacks.onFakeReply?.(reply);

    const sequences = getExampleSequences();
    const seq = sequences.length > 0 ? pickRandom(sequences) : null;
    if (seq) {
      logger.debug('input', 'Sequence auto-play after reply', {
        steps: seq.map((s) => (s as { type: string; name?: string }).type + ((s as { name?: string }).name ? ':' + (s as { name?: string }).name : '')).join(' → ')
      });
      onPlaySequence(seq);
    }
  }

  sendBtn.addEventListener('click', () => {
    logger.debug('input', 'Explicit activity', { type: 'click', target: 'send' });
    handleSend();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      logger.debug('input', 'Explicit activity', { type: 'key', key: 'Enter' });
      handleSend();
    }
  });

  document.getElementById('app')?.appendChild(container);

  const idleInterval = setInterval(() => {
    checkIdleTimers();
  }, 1000);

  return {
    destroy() {
      clearInterval(idleInterval);
      container.remove();
    }
  };
}
