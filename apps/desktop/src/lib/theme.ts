// ─── Theme System ────────────────────────────────────────────────────────────

export interface ThemeDefinition {
  id: string;
  label: string;
  preview: string; // background color for preview swatch
  previewBorder: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'codebook-warm',
    label: 'Codebook Warm',
    preview: '#1C1917',
    previewBorder: '#2A2520',
  },
  {
    id: 'cursor-ide',
    label: 'Cursor IDE',
    preview: '#1E1E1E',
    previewBorder: '#3C3C3C',
  },
  {
    id: 'anysphere-dark',
    label: 'Anysphere Dark',
    preview: '#171817',
    previewBorder: '#383838',
  },
];

export const DEFAULT_THEME = 'codebook-warm';

/**
 * Apply a theme by setting the data-theme attribute on <html>.
 * 'codebook-warm' removes the attribute (uses :root defaults).
 */
export function applyTheme(themeId: string): void {
  if (themeId === 'codebook-warm') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}

/**
 * Get CSS variable value for the current theme.
 */
export function getThemeVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
