/** Pure state for the Design/Home buttons (kept apart from the DOM code so node:test can load it). */

export type RouteButtonState = { disabled: boolean; designLabel: string; homeLabel: string };

/** Button state while a creator enter/exit transition is (or isn't) running. */
export function getRouteButtonState(transitionInFlight: boolean): RouteButtonState {
  return {
    disabled: transitionInFlight,
    designLabel: transitionInFlight ? 'Designing...' : 'Design',
    homeLabel: 'Home',
  };
}
