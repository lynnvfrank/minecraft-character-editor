/**
 * Resolve the DOM container for creator side panels (color picker, swatches, layers, etc.).
 * Panels mount into this container when the creator is shown.
 */
export function getCreatorPanelsContainer(): HTMLElement | null {
  return (
    document.getElementById('creator-right-panels-group') ??
    document.getElementById('creator-lower-right-panels') ??
    document.getElementById('creator-view-wrapper')
  );
}
