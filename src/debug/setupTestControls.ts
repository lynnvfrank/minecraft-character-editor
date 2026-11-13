/**
 * Isolated test page controls. Run turn/walk without characterAI or wanderer.
 * Used when ?movementcontrols=1 in URL.
 */
import * as THREE from 'three';
import { getTrapezoidBounds, WALK_CYCLE_DISTANCE, type TurnStrategy } from '../animation';
import { getPrimaryCharacterId } from '../domain';

type AnimationManager = {
  turnTo: (targetFacingRad: number) => Promise<void>;
  getFacing: () => number;
  walkTo: (target: THREE.Vector3 | [number, number, number], speed?: number) => Promise<void>;
  stop: () => void;
};

type SetupTestControlsDeps = {
  animationManager: AnimationManager;
  getCharacter: (id: string) => { container: THREE.Group; model: THREE.Group } | undefined;
  getCamera: () => THREE.PerspectiveCamera;
  setPaused: (value: boolean) => void;
  isPaused: () => boolean;
  stepOneFrame: () => void;
  turnStrategy: TurnStrategy;
  setTurnStrategy: (s: TurnStrategy) => void;
  turnStrategies: TurnStrategy[];
};

export function setupTestControls(deps: SetupTestControlsDeps): void {
  const { animationManager, getCharacter, getCamera, setPaused, isPaused, stepOneFrame, turnStrategy, setTurnStrategy, turnStrategies } = deps;
  const container = document.getElementById('test-controls');
  if (!container) return;

  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'test-controls-panel';
  panel.innerHTML = '<span class="test-controls-label">Debug Test Controls</span>';

  const strategyRow = document.createElement('div');
  strategyRow.className = 'test-controls-row';
  const strategyLabel = document.createElement('span');
  strategyLabel.className = 'test-controls-strategy-label';
  strategyLabel.textContent = 'Turn:';
  strategyRow.appendChild(strategyLabel);
  turnStrategies.forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'test-control-btn test-control-strategy-btn';
    btn.textContent = s;
    btn.dataset.strategy = s;
    btn.classList.toggle('active', turnStrategy === s);
    btn.addEventListener('click', () => {
      setTurnStrategy(s);
      strategyRow.querySelectorAll('.test-control-strategy-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    strategyRow.appendChild(btn);
  });
  panel.appendChild(strategyRow);

  const buttonRow = (): HTMLDivElement => {
    const row = document.createElement('div');
    row.className = 'test-controls-row';
    return row;
  };

  const addButton = (label: string, onClick: () => void, parent: HTMLElement = panel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'test-control-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      animationManager.stop();
      onClick();
    });
    parent.appendChild(btn);
  };

  const turnRow = buttonRow();
  addButton('Turn left 90°', () => {
    const char = getCharacter(getPrimaryCharacterId());
    if (!char) return;
    const targetFacing = animationManager.getFacing() + Math.PI / 2;
    animationManager.turnTo(targetFacing);
  }, turnRow);
  addButton('Turn right 90°', () => {
    const char = getCharacter(getPrimaryCharacterId());
    if (!char) return;
    const targetFacing = animationManager.getFacing() - Math.PI / 2;
    animationManager.turnTo(targetFacing);
  }, turnRow);
  panel.appendChild(turnRow);

  const pauseRow = buttonRow();
  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'test-control-btn';
  pauseBtn.textContent = 'Pause';
  pauseBtn.addEventListener('click', () => {
    setPaused(true);
    pauseBtn.textContent = 'Paused';
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
    stepFrameBtn.disabled = false;
  });
  const resumeBtn = document.createElement('button');
  resumeBtn.type = 'button';
  resumeBtn.className = 'test-control-btn';
  resumeBtn.textContent = 'Resume';
  resumeBtn.disabled = true;
  resumeBtn.addEventListener('click', () => {
    setPaused(false);
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    stepFrameBtn.disabled = true;
  });
  const stepFrameBtn = document.createElement('button');
  stepFrameBtn.type = 'button';
  stepFrameBtn.className = 'test-control-btn';
  stepFrameBtn.textContent = 'Step Frame';
  stepFrameBtn.disabled = true;
  stepFrameBtn.addEventListener('click', () => {
    if (isPaused()) stepOneFrame();
  });
  pauseRow.appendChild(pauseBtn);
  pauseRow.appendChild(resumeBtn);
  pauseRow.appendChild(stepFrameBtn);
  panel.appendChild(pauseRow);

  const walkRow = buttonRow();
  addButton('Walk to waypoint', () => {
    const bounds = getTrapezoidBounds(getCamera(), 0, 0, WALK_CYCLE_DISTANCE);
    const depth = -1 * WALK_CYCLE_DISTANCE;
    const halfWidth = bounds.getHalfWidthAtDepth(depth);
    const target = new THREE.Vector3(
      bounds.startX + depth * bounds.depthDirX + 0.5 * halfWidth * bounds.perpDirX,
      0,
      bounds.startZ + depth * bounds.depthDirZ + 0.5 * halfWidth * bounds.perpDirZ
    );
    animationManager.walkTo(target, 1);
  }, walkRow);
  addButton('Walk to origin', () => {
    animationManager.walkTo([0, 0, 0], 1);
  }, walkRow);
  panel.appendChild(walkRow);

  const customRow = document.createElement('div');
  customRow.className = 'test-controls-row test-controls-custom';
  const xInput = document.createElement('input');
  xInput.type = 'number';
  xInput.placeholder = 'x';
  xInput.value = '0';
  xInput.step = '0.1';
  const yInput = document.createElement('input');
  yInput.type = 'number';
  yInput.placeholder = 'y';
  yInput.value = '0';
  yInput.step = '0.1';
  const zInput = document.createElement('input');
  zInput.type = 'number';
  zInput.placeholder = 'z';
  zInput.value = '1.2';
  zInput.step = '0.1';
  const speedInput = document.createElement('input');
  speedInput.type = 'number';
  speedInput.placeholder = 'speed';
  speedInput.value = '1';
  speedInput.min = '0.1';
  speedInput.step = '0.1';
  speedInput.className = 'test-control-input-speed';

  addButton('Walk to [x,y,z]', () => {
    const x = parseFloat(xInput.value) || 0;
    const y = parseFloat(yInput.value) || 0;
    const z = parseFloat(zInput.value) || 0;
    const speed = Math.max(0.1, parseFloat(speedInput.value) || 1);
    animationManager.walkTo([x, y, z], speed);
  }, customRow);

  customRow.appendChild(xInput);
  customRow.appendChild(yInput);
  customRow.appendChild(zInput);
  customRow.appendChild(speedInput);
  panel.appendChild(customRow);

  addButton('Stop', () => animationManager.stop(), panel);

  container.appendChild(panel);
}
