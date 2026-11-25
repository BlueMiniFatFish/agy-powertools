function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseHexRgb(hex) {
  const clean = sanitizeHexColor(hex);
  if (!clean) return null;
  return [
    parseInt(clean.slice(1, 3), 16),
    parseInt(clean.slice(3, 5), 16),
    parseInt(clean.slice(5, 7), 16)
  ];
}

function hexLuminance(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function formatHexChannel(value) {
  return clampValue(Math.round(value), 0, 255).toString(16).padStart(2, '0').toUpperCase();
}

export function codexStyleSources() {
  return ['preset', 'local'];
}

export function defaultCodexStylePreset() {
  return {
    id: 'preset',
    dark: {
      surface: '#181818',
      ink: '#FFFFFF',
      accent: '#3A83F7',
      contrast: 60,
      opaqueWindows: false,
      primaryFg: '#FFFFFF',
      card: '#212121',
      secondary: '#2A2A2A',
      border: '#383838',
      mutedFg: '#A5A5A5',
      inlineCodeBg: 'rgba(255, 255, 255, 0.11)',
      inlineCodeFg: 'inherit',
      fileLinkColor: '#63A8F8',
      fileLinkHoverColor: '#80B9FA',
      userBubbleBg: '#173E76',
      userBubbleBorder: 'transparent',
      userBubbleFg: '#F6FAFE',
      tableHeadBorderAlpha: 16,
      tableRowBorderAlpha: 4,
      hrAlpha: 16,
      blockquoteBarAlpha: 16,
      fonts: { ui: '', code: '' }
    },
    light: {
      surface: '#FFFFFF',
      ink: '#1A1C1F',
      accent: '#3A83F7',
      contrast: 45,
      opaqueWindows: false,
      primaryFg: '#FFFFFF',
      card: '#FAFAFA',
      secondary: '#F2F2F2',
      border: '#DCDEE0',
      mutedFg: '#737373',
      inlineCodeBg: 'rgba(26, 28, 31, 0.09)',
      inlineCodeFg: 'inherit',
      fileLinkColor: '#1F4E94',
      fileLinkHoverColor: '#163B70',
      userBubbleBg: '#E8F3FE',
      userBubbleBorder: 'transparent',
      userBubbleFg: '#0C274A',
      tableHeadBorderAlpha: 12,
      tableRowBorderAlpha: 5,
      hrAlpha: 12,
      blockquoteBarAlpha: 12,
      fonts: { ui: '', code: '' }
    },
    typography: {
      maxWidth: '48rem',
      pagesFullWidth: false,
      uiFontSizePx: 14,
      codeFontSizePx: 12,
      lineHeight: 1.625,
      blockGapPx: 14,
      fontSmoothing: true
    }
  };
}

export function sanitizeHexColor(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : fallback;
}

export function sanitizeFontFamily(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[;{}\n\r<>\\"'\0]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
}

export function formatCssFontStack(rawFont, fallbackStack) {
  const cleaned = sanitizeFontFamily(rawFont);
  if (!cleaned) return '';
  const genericKeywords = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong'
  ]);
  const formatted = [];
  for (const part of cleaned.split(',')) {
    const token = sanitizeFontFamily(part);
    if (!token) continue;
    const lower = token.toLowerCase();
    formatted.push(genericKeywords.has(lower) ? lower : `"${token}"`);
  }
  if (!formatted.length) return '';
  return fallbackStack ? `${formatted.join(', ')}, ${fallbackStack}` : formatted.join(', ');
}

export function mixHexColors(hexA, hexB, ratio) {
  const a = parseHexRgb(hexA);
  const b = parseHexRgb(hexB);
  if (!a && !b) return '#000000';
  if (!a) return sanitizeHexColor(hexB, '#000000');
  if (!b) return sanitizeHexColor(hexA, '#000000');
  const numeric = Number(ratio);
  const t = Number.isFinite(numeric) ? clampValue(numeric, 0, 1) : 0;
  return `#${formatHexChannel(a[0] + (b[0] - a[0]) * t)}${formatHexChannel(a[1] + (b[1] - a[1]) * t)}${formatHexChannel(a[2] + (b[2] - a[2]) * t)}`;
}

export function pickContrastFg(bgHex) {
  const rgb = parseHexRgb(bgHex);
  if (!rgb) return '#FFFFFF';
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance < 150 ? '#FFFFFF' : '#111827';
}

export function deriveCodexPalette(raw, isDark, fallback) {
  const base = fallback || (isDark ? defaultCodexStylePreset().dark : defaultCodexStylePreset().light);
  const surface = sanitizeHexColor(raw?.surface, base.surface);
  const ink = sanitizeHexColor(raw?.ink, base.ink);
  const accent = sanitizeHexColor(raw?.accent, base.accent);
  const rawContrast = raw?.contrast;
  const parsedContrast = typeof rawContrast === 'number'
    ? rawContrast
    : (typeof rawContrast === 'string' && rawContrast.trim() !== '' ? Number(rawContrast) : NaN);
  const contrast = Number.isFinite(parsedContrast) ? clampValue(parsedContrast, 0, 100) : base.contrast;
  const opaqueWindows = Boolean(raw?.opaqueWindows);
  const fonts = {
    ui: sanitizeFontFamily(raw?.fonts?.ui),
    code: sanitizeFontFamily(raw?.fonts?.code)
  };

  if (surface === base.surface && ink === base.ink && accent === base.accent && contrast === base.contrast) {
    return {
      ...base,
      surface,
      ink,
      accent,
      contrast,
      opaqueWindows,
      fonts
    };
  }

  const inkRgb = parseHexRgb(ink) || (isDark ? [255, 255, 255] : [26, 28, 31]);
  const codeAlpha = isDark
    ? clampValue(0.08 + (contrast - 40) * 0.0015, 0.07, 0.16)
    : clampValue(0.07 + (contrast - 35) * 0.0012, 0.06, 0.14);
  const inlineCodeBg = `rgba(${inkRgb[0]}, ${inkRgb[1]}, ${inkRgb[2]}, ${Number(codeAlpha.toFixed(2))})`;
  const inlineCodeFg = 'inherit';
  const accentLum = hexLuminance(accent);
  let fileLinkColor;
  let fileLinkHoverColor;
  let userBubbleBg;
  let userBubbleFg;
  if (accent === '#3A83F7') {
    fileLinkColor = isDark ? '#63A8F8' : '#1F4E94';
    fileLinkHoverColor = isDark ? '#80B9FA' : '#163B70';
    userBubbleBg = isDark ? '#173E76' : '#E8F3FE';
    userBubbleFg = isDark ? '#F6FAFE' : '#0C274A';
  } else if (accent === '#339CFF') {
    fileLinkColor = isDark ? '#339CFF' : '#0169CC';
    fileLinkHoverColor = isDark ? '#0285FF' : '#013566';
    userBubbleBg = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(26, 28, 31, 0.05)';
    userBubbleFg = ink;
  } else {
    fileLinkColor = isDark
      ? (accentLum < 140 ? mixHexColors(accent, '#FFFFFF', 0.20) : accent)
      : (accentLum > 125 ? mixHexColors(accent, '#000000', 0.18) : accent);
    fileLinkHoverColor = isDark
      ? mixHexColors(fileLinkColor, '#FFFFFF', 0.18)
      : mixHexColors(fileLinkColor, '#000000', 0.24);
    userBubbleBg = isDark
      ? mixHexColors(surface, accent, 0.36)
      : mixHexColors(surface, accent, 0.14);
    userBubbleFg = pickContrastFg(userBubbleBg);
  }
  const userBubbleBorder = 'transparent';
  const primaryFg = pickContrastFg(accent);
  const card = mixHexColors(surface, ink, isDark ? 0.04 : 0.02);
  const secondary = mixHexColors(surface, ink, isDark ? 0.08 : 0.05);
  const border = mixHexColors(
    surface,
    ink,
    clampValue((isDark ? 0.11 : 0.09) + (contrast - (isDark ? 40 : 35)) * 0.0015, isDark ? 0.09 : 0.08, isDark ? 0.22 : 0.20)
  );
  const mutedFg = mixHexColors(
    ink,
    surface,
    clampValue((isDark ? 0.42 : 0.46) - (contrast - (isDark ? 50 : 45)) * 0.003, isDark ? 0.28 : 0.30, isDark ? 0.48 : 0.52)
  );
  const scale = clampValue(contrast / (isDark ? 60 : 45), 0.65, 1.5);

  return {
    surface,
    ink,
    accent,
    contrast,
    opaqueWindows,
    primaryFg,
    card,
    secondary,
    border,
    mutedFg,
    inlineCodeBg,
    inlineCodeFg,
    fileLinkColor,
    fileLinkHoverColor,
    userBubbleBg,
    userBubbleBorder,
    userBubbleFg,
    tableHeadBorderAlpha: Math.round(clampValue((isDark ? 16 : 12) * scale, 10, 28)),
    tableRowBorderAlpha: Math.round(clampValue((isDark ? 4 : 5) * scale, 3, 14)),
    hrAlpha: Math.round(clampValue((isDark ? 16 : 12) * scale, 10, 28)),
    blockquoteBarAlpha: Math.round(clampValue((isDark ? 16 : 12) * scale, 10, 28)),
    fonts
  };
}

export function resolveActiveCodexConfig(profile, source = 'preset') {
  const preset = profile?.preset || defaultCodexStylePreset();
  const usedLocal = Boolean(source === 'local' && profile?.detected && profile?.local);
  const chosen = usedLocal ? profile.local : preset;
  return {
    activeSource: usedLocal ? 'local' : 'preset',
    fellBack: source === 'local' && !usedLocal,
    dark: chosen?.dark || preset.dark,
    light: chosen?.light || preset.light,
    typography: chosen?.typography || preset.typography
  };
}

export function buildCodexCssVars(activeConfig, { applyTheme = true } = {}) {
  const def = defaultCodexStylePreset();
  const dark = activeConfig?.dark || def.dark;
  const light = activeConfig?.light || def.light;
  const typo = activeConfig?.typography || def.typography;

  const vars = {
    '--agy-codex-max-width': typo.maxWidth || '48rem',
    '--agy-codex-font-smoothing': typo.fontSmoothing === false ? 'antialiased' : 'subpixel-antialiased',
    '--agy-codex-line-height': String(typo.lineHeight || 1.625),
    '--agy-codex-block-gap': `${typo.blockGapPx || 14}px`
  };
  const flags = {
    customFontSize: false,
    customCodeFontSize: false,
    customFontSans: false,
    customFontMono: false
  };

  if (Number.isFinite(typo.uiFontSizePx)) {
    vars['--agy-codex-font-size'] = `${typo.uiFontSizePx}px`;
    flags.customFontSize = true;
  }
  if (Number.isFinite(typo.codeFontSizePx)) {
    vars['--agy-codex-code-font-size'] = `${typo.codeFontSizePx}px`;
    flags.customCodeFontSize = true;
  }

  const sansFallback = 'var(--font-sans, system-ui, -apple-system, sans-serif)';
  const monoFallback = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

  for (const [mode, p] of [['dark', dark], ['light', light]]) {
    const uiFontStack = formatCssFontStack(p.fonts?.ui, sansFallback);
    if (uiFontStack) {
      vars[`--agy-codex-${mode}-font-sans`] = uiFontStack;
      flags.customFontSans = true;
    }
    const codeFontStack = formatCssFontStack(p.fonts?.code, monoFallback);
    if (codeFontStack) {
      vars[`--agy-codex-${mode}-font-mono`] = codeFontStack;
      flags.customFontMono = true;
    }

    vars[`--agy-codex-${mode}-code-bg`] = p.inlineCodeBg;
    vars[`--agy-codex-${mode}-code-fg`] = p.inlineCodeFg;
    vars[`--agy-codex-${mode}-link`] = p.fileLinkColor;
    vars[`--agy-codex-${mode}-link-hover`] = p.fileLinkHoverColor || (mode === 'dark' ? '#0285FF' : '#013566');
    vars[`--agy-codex-${mode}-table-head-alpha`] = `${p.tableHeadBorderAlpha}%`;
    vars[`--agy-codex-${mode}-table-row-alpha`] = `${p.tableRowBorderAlpha}%`;
    vars[`--agy-codex-${mode}-hr-alpha`] = `${p.hrAlpha}%`;
    vars[`--agy-codex-${mode}-quote-alpha`] = `${p.blockquoteBarAlpha}%`;

    if (applyTheme !== false) {
      vars[`--agy-codex-${mode}-surface`] = p.surface;
      vars[`--agy-codex-${mode}-ink`] = p.ink;
      vars[`--agy-codex-${mode}-accent`] = p.accent;
      vars[`--agy-codex-${mode}-primary-fg`] = p.primaryFg || pickContrastFg(p.accent);
      vars[`--agy-codex-${mode}-card`] = p.card || mixHexColors(p.surface, p.ink, mode === 'dark' ? 0.04 : 0.02);
      vars[`--agy-codex-${mode}-secondary`] = p.secondary || mixHexColors(p.surface, p.ink, mode === 'dark' ? 0.08 : 0.05);
      vars[`--agy-codex-${mode}-border`] = p.border || mixHexColors(p.surface, p.ink, mode === 'dark' ? 0.14 : 0.12);
      vars[`--agy-codex-${mode}-muted-fg`] = p.mutedFg || mixHexColors(p.ink, p.surface, mode === 'dark' ? 0.35 : 0.45);
      vars[`--agy-codex-${mode}-bubble-bg`] = p.userBubbleBg;
      vars[`--agy-codex-${mode}-bubble-border`] = p.userBubbleBorder;
      vars[`--agy-codex-${mode}-bubble-fg`] = p.userBubbleFg;
    }
  }

  return { vars, flags };
}
