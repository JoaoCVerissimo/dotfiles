// A skin is a small palette laid over Claude Code's dark theme: an accent
// for the prompt box and the marks that draw the eye, a softer second color,
// and a tinted surface for your own messages.
export type Skin = {
  id: string
  title: string
  accent: string
  soft: string
  surface: string
  hover: string
  select: string
}

export const SKINS: readonly Skin[] = [
  { id: 'ocean', title: 'Ocean', accent: '#4fc3f7', soft: '#80deea', surface: '#10212b', hover: '#16303f', select: '#1d4257' },
  { id: 'forest', title: 'Forest', accent: '#81c784', soft: '#a5d6a7', surface: '#14241a', hover: '#1c3325', select: '#274a35' },
  { id: 'sunset', title: 'Sunset', accent: '#ff8a65', soft: '#ffb74d', surface: '#2b1a14', hover: '#3c251c', select: '#573427' },
  { id: 'grape', title: 'Grape', accent: '#b39ddb', soft: '#ce93d8', surface: '#1f1830', hover: '#2b2242', select: '#3d305e' },
  { id: 'rose', title: 'Rose', accent: '#f48fb1', soft: '#f8bbd0', surface: '#2b1620', hover: '#3c1f2d', select: '#572c41' },
  { id: 'amber', title: 'Amber', accent: '#ffd54f', soft: '#ffe082', surface: '#2a2410', hover: '#3a3217', select: '#544821' },
  { id: 'mint', title: 'Mint', accent: '#4db6ac', soft: '#80cbc4', surface: '#10231f', hover: '#17322c', select: '#21483f' },
  { id: 'ember', title: 'Ember', accent: '#ef5350', soft: '#ff8a80', surface: '#2b1414', hover: '#3c1c1c', select: '#572828' },
  { id: 'slate', title: 'Slate', accent: '#90a4ae', soft: '#b0bec5', surface: '#1a2126', hover: '#242e35', select: '#34424c' },
  { id: 'cobalt', title: 'Cobalt', accent: '#5c8dff', soft: '#82b1ff', surface: '#121a30', hover: '#1a2544', select: '#253562' },
]

export function skinOf(id: string): Skin | undefined {
  return SKINS.find(skin => skin.id === id)
}

function hash(text: string): number {
  let value = 0
  for (const char of text) {
    value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }

  return value
}

export function baseName(path: string): string {
  return path.split('/').filter(part => part !== '').at(-1) ?? 'project'
}

// The theme file a project owns: named for its folder, told apart from a
// namesake elsewhere by a few characters of its path's hash.
export function slugOf(root: string): string {
  const name = baseName(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

  return `proj-${name === '' ? 'project' : name}-${hash(root).toString(36).padStart(5, '0').slice(0, 5)}`
}

// The skin a project gets when it is given one unasked: the same every time.
export function autoSkin(root: string): Skin {
  return SKINS[hash(root) % SKINS.length] ?? SKINS[0]!
}

// The theme file's content: the dark theme with the skin's colors on the
// tokens that carry an accent. With no skin, the dark theme as it is.
export function themeOf(root: string, skin: Skin | undefined): string {
  const overrides: Record<string, string> =
    skin === undefined
      ? {}
      : {
          claude: skin.accent,
          promptBorder: skin.accent,
          suggestion: skin.soft,
          permission: skin.soft,
          remember: skin.soft,
          ide: skin.soft,
          fastMode: skin.accent,
          userMessageBackground: skin.surface,
          userMessageBackgroundHover: skin.hover,
          selectionBg: skin.select,
        }
  const name = `${baseName(root)}${skin === undefined ? '' : ` · ${skin.title}`}`

  return `${JSON.stringify({ name, base: 'dark', overrides }, null, 2)}\n`
}

// A project's local settings with its theme set to `theme`, or cleared when
// the theme there is the one named `clear`. Null when the file is not JSON
// this may rewrite.
export function withTheme(raw: string, theme: string | null, clear: string): string | null {
  let parsed: unknown = {}
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const settings: Record<string, unknown> = { ...parsed }
  if (theme !== null) {
    settings.theme = theme
  } else if (settings.theme === clear) {
    delete settings.theme
  }

  return `${JSON.stringify(settings, null, 2)}\n`
}

export function themeIn(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    const theme = typeof parsed === 'object' && parsed !== null ? (parsed as { theme?: unknown }).theme : undefined

    return typeof theme === 'string' ? theme : ''
  } catch {
    return ''
  }
}
