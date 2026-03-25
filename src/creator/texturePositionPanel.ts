import type { CreatorTexturePositionDetail } from '../events/appEvents';
import { creatorTexturePositionSlice } from '../state/creatorSlices';
import { TOOL_LABELS, type DrawingTool } from './api';
import { getCreatorPanelsContainer } from './container';

export function buildTexturePositionPanel(): void {
  const container = getCreatorPanelsContainer();
  if (!container) return;

  let panel = document.getElementById('creator-hover-info-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-hover-info-panel';
  panel.className = 'creator-hover-info-panel';
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Current tool and skin coordinates');
  const textSpan = document.createElement('span');
  textSpan.className = 'creator-hover-info-text';

  const toolSpan = document.createElement('span');
  toolSpan.className = 'creator-hover-info-tool';

  const colorSpan = document.createElement('span');
  colorSpan.className = 'creator-hover-info-color';
  const colorLabelSpan = document.createElement('span');
  colorLabelSpan.className = 'creator-hover-info-label';
  colorLabelSpan.textContent = '';
  const colorSwatch = document.createElement('span');
  colorSwatch.className = 'creator-hover-info-swatch';
  colorSwatch.setAttribute('aria-hidden', 'true');
  const colorValueSpan = document.createElement('span');
  colorValueSpan.className = 'creator-hover-info-value';
  colorSpan.append(colorLabelSpan, colorSwatch, colorValueSpan);

  const coordsSpan = document.createElement('span');
  coordsSpan.className = 'creator-hover-info-coords';

  textSpan.append(toolSpan, colorSpan, coordsSpan);
  panel.appendChild(textSpan);

  const formatToolName = (tool: CreatorTexturePositionDetail['tool'] | undefined): string => {
    return tool && tool in TOOL_LABELS ? TOOL_LABELS[tool as DrawingTool] : TOOL_LABELS.navigate;
  };

  const setEmpty = () => {
    textSpan.textContent = '—';
  };

  creatorTexturePositionSlice.subscribe((detail: CreatorTexturePositionDetail) => {
    if (document.body.dataset.route !== 'creator') return;
    const { skinX, skinY, tool, currentColor, hoverColor } = detail;

    if (skinX < 0 || skinY < 0) {
      setEmpty();
      return;
    }

    if (!textSpan.contains(toolSpan)) {
      textSpan.replaceChildren(toolSpan, colorSpan, coordsSpan);
    }

    toolSpan.textContent = `${formatToolName(tool)}`;

    const showCurrentColorSwatch = tool === 'brush' || tool === 'fill';
    const showHoverColorSwatch = tool === 'eyedropper' || tool === 'eraser';
    colorSpan.style.display = showCurrentColorSwatch || showHoverColorSwatch ? 'inline-flex' : 'none';
    if (showCurrentColorSwatch) {
      colorLabelSpan.textContent = '';
      const normalizedColor = currentColor ?? '#000000';
      colorSwatch.style.backgroundColor = normalizedColor;
    }
    if (showHoverColorSwatch) {
      colorLabelSpan.textContent = '';
      const eyedropColor = hoverColor ?? null;
      colorSwatch.style.backgroundColor = eyedropColor ?? 'transparent';
    }

    coordsSpan.textContent = `(${skinX},${skinY})`;
  });

  container.appendChild(panel);
}
