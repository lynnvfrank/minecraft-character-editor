/**
 * PaperCSS hook surfaces — one id per logical UI chunk.
 *
 * To drop Paper `card` / `paper-btn` styling for a specific area only, add its id to
 * {@link PAPER_UI_OPT_OUT}. Builtin theme ignores this (no Paper stylesheet).
 *
 * Static `index.html` targets are stripped in {@link applyIndexHtmlPaperOptOut} when opted out.
 */

export const PaperUiSurface = {
  enterViewerBtn: 'enterViewerBtn',
  enterCreatorBtn: 'enterCreatorBtn',
  creatorDownloadBtn: 'creatorDownloadBtn',
  outfitsPanel: 'outfitsPanel',
  /** Left column wrapper (#creator-left-panels subtree) and related rows. */
  creatorLeftChrome: 'creatorLeftChrome',
  /** Viewer mode Design button container. */
  appLowerLeftPanels: 'appLowerLeftPanels',
  /** Creator lower-left Home button panel. */
  creatorHomePanel: 'creatorHomePanel',
  controlsBar: 'controlsBar',
  creatorPanel: 'creatorPanel',
  creatorUpperRightRoot: 'creatorUpperRightRoot',
  creatorTopCenter: 'creatorTopCenter',
  creatorBottomCenter: 'creatorBottomCenter',
  creator3dPreviewSlot: 'creator3dPreviewSlot',
  saveDownloadPanel: 'saveDownloadPanel',
  editorModePanel: 'editorModePanel',
  editorOverlaysPanel: 'editorOverlaysPanel',
  editorToolsPanel: 'editorToolsPanel',
  editorUndoRedoPanel: 'editorUndoRedoPanel',
  cameraToolbar: 'cameraToolbar',
  wardrobeLibraryPanel: 'wardrobeLibraryPanel',
  wardrobeLibraryThumbnail: 'wardrobeLibraryThumbnail',
  wardrobePartsPanel: 'wardrobePartsPanel',
  wardrobeLayerButton: 'wardrobeLayerButton',
  skinGalleryOutfitThumbnail: 'skinGalleryOutfitThumbnail',
  skinLayersPanel: 'skinLayersPanel',
  skinLayersHeaderButton: 'skinLayersHeaderButton',
  skinLayersPartButton: 'skinLayersPartButton',
  swatchesPanel: 'swatchesPanel',
  swatchesTab: 'swatchesTab',
  swatchesToggle: 'swatchesToggle',
  swatchGridItem: 'swatchGridItem',
  colorPickerPanel: 'colorPickerPanel',
  colorPickerToggle: 'colorPickerToggle',
  colorPickerSwatchBtn: 'colorPickerSwatchBtn',
  hoverInfoPanel: 'hoverInfoPanel',
  viewerSkinPreview: 'viewerSkinPreview',
  viewerAnimButton: 'viewerAnimButton',
  viewerSequenceButton: 'viewerSequenceButton',
  previewCameraPanel: 'previewCameraPanel',
  previewCameraInfoPanel: 'previewCameraInfoPanel',
  previewCameraPresetBtn: 'previewCameraPresetBtn',
  fakeChat: 'fakeChat',
  electronStatus: 'electronStatus',
  debugTestControls: 'debugTestControls',
  creatorRightPanelsGroup: 'creatorRightPanelsGroup',
  creatorLowerRightPanels: 'creatorLowerRightPanels',
  previewLowerRightPanels: 'previewLowerRightPanels',
  previewRightPanelsGroup: 'previewRightPanelsGroup',
} as const;

export type PaperUiSurfaceId = (typeof PaperUiSurface)[keyof typeof PaperUiSurface];

/** Add ids here to disable Paper class hooks for that surface only. */
export const PAPER_UI_OPT_OUT = new Set<PaperUiSurfaceId>([]);

export function paperHooksEnabled(surface: PaperUiSurfaceId | string): boolean {
  return !PAPER_UI_OPT_OUT.has(surface as PaperUiSurfaceId);
}

/** Tokens removed from opted-out static nodes (must match Paper class names). */
export const PAPER_HOOK_CLASS_TOKENS = [
  'card',
  'paper',
  'paper-btn',
  'btn-small',
  'btn-large',
  'btn-block',
  'btn-primary',
  'btn-secondary',
  'btn-secondary-outline',
  'btn-success',
  'btn-warning',
  'btn-danger',
  'btn-muted',
] as const;

const INDEX_HTML_OPT_OUT_TARGETS: Partial<Record<PaperUiSurfaceId, readonly string[]>> = {
  [PaperUiSurface.enterViewerBtn]: ['#enter-viewer-btn'],
  [PaperUiSurface.enterCreatorBtn]: ['#enter-creator-btn'],
  [PaperUiSurface.creatorDownloadBtn]: ['#creator-download-btn'],
  [PaperUiSurface.outfitsPanel]: ['#creator-wardrobe-outfits-panel'],
  [PaperUiSurface.controlsBar]: ['#controls-bar', '#controls-bar a.nav-link'],
  [PaperUiSurface.debugTestControls]: ['#test-controls'],
  [PaperUiSurface.creatorPanel]: ['#creator-panel'],
  [PaperUiSurface.creatorLeftChrome]: [
    '#creator-left-panels',
    '#creator-left-top-row',
    '#creator-upper-left-panels',
    '#creator-lower-left-panels',
  ],
  [PaperUiSurface.appLowerLeftPanels]: ['#app-lower-left-panels'],
  [PaperUiSurface.creatorHomePanel]: ['#creator-home-panel'],
  [PaperUiSurface.creatorUpperRightRoot]: ['#creator-upper-right-panels-root'],
  [PaperUiSurface.creatorTopCenter]: ['#creator-top-center-panels'],
  [PaperUiSurface.creatorBottomCenter]: ['#creator-bottom-center-panels'],
  [PaperUiSurface.creator3dPreviewSlot]: ['#creator-3d-preview-slot'],
};

/** Run once at startup (e.g. from main) so opted-out surfaces lose Paper classes from index.html. */
export function applyIndexHtmlPaperOptOut(): void {
  for (const surface of PAPER_UI_OPT_OUT) {
    const selectors = INDEX_HTML_OPT_OUT_TARGETS[surface];
    if (!selectors) continue;
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        el.classList.remove(...(PAPER_HOOK_CLASS_TOKENS as unknown as string[]));
      });
    }
  }
}
