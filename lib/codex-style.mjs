import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultCodexStylePreset,
  deriveCodexPalette,
  sanitizeFontFamily,
  sanitizeHexColor
} from './codex-style-helpers.mjs';

let DatabaseSync;
try {
  ({ DatabaseSync } = process.getBuiltinModule?.('node:sqlite')
    || (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')
      ? createRequire(import.meta.url)('node:sqlite')
      : (typeof require === 'function' ? require('node:sqlite') : {})));
} catch { /* Older Node builds without node:sqlite fall back to TOML/preset. */ }

function boundedNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function sanitizeThemeId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[;{}\n\r<>\\"'\0]/g, '').trim().slice(0, 64);
}

function stripTomlComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') quote = '';
    } else if (quote === "'") {
      if (ch === "'") quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function readQuotedString(text, start, quoteChar) {
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (quoteChar === '"') {
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined) return null;
        if (next === '"' || next === '\\') { out += next; i += 2; continue; }
        if (next === 'n') { out += '\n'; i += 2; continue; }
        if (next === 'r') { out += '\r'; i += 2; continue; }
        if (next === 't') { out += '\t'; i += 2; continue; }
        if (next === 'b') { out += '\b'; i += 2; continue; }
        if (next === 'f') { out += '\f'; i += 2; continue; }
        if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCodePoint(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (next === 'U' && /^[0-9a-fA-F]{8}$/.test(text.slice(i + 2, i + 10))) {
          const codePoint = parseInt(text.slice(i + 2, i + 10), 16);
          if (codePoint <= 0x10FFFF) out += String.fromCodePoint(codePoint);
          i += 10;
          continue;
        }
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') return { value: out, end: i + 1 };
      out += ch;
      i++;
    } else {
      if (ch === "'") return { value: out, end: i + 1 };
      out += ch;
      i++;
    }
  }
  return null;
}

function parseTomlKeyParts(text) {
  const parts = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    while (i < len && /\s/.test(text[i])) i++;
    if (i >= len) return null;
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const parsed = readQuotedString(text, i, ch);
      if (!parsed) return null;
      parts.push(parsed.value);
      i = parsed.end;
    } else {
      const start = i;
      while (i < len && /[A-Za-z0-9_-]/.test(text[i])) i++;
      if (i === start) return null;
      parts.push(text.slice(start, i));
    }
    while (i < len && /\s/.test(text[i])) i++;
    if (i < len) {
      if (text[i] !== '.') return null;
      i++;
      if (i >= len) return null;
    }
  }
  return parts.length ? parts : null;
}

function splitTopLevelCommas(text) {
  const items = [];
  let quote = '';
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') quote = '';
    } else if (quote === "'") {
      if (ch === "'") quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  }
  items.push(text.slice(start));
  return items;
}

function parseTomlValue(raw) {
  const value = raw.trim();
  if (!value) return undefined;
  if (value[0] === '"' || value[0] === "'") {
    const parsed = readQuotedString(value, 0, value[0]);
    if (!parsed || value.slice(parsed.end).trim() !== '') return undefined;
    return parsed.value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?$/.test(value)) {
    const num = Number(value.replaceAll('_', ''));
    return Number.isFinite(num) ? num : undefined;
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const obj = Object.create(null);
    if (!inner) return obj;
    for (const part of splitTopLevelCommas(inner)) {
      const kv = parseTomlKeyValue(part);
      if (!kv) continue;
      if (kv.keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) continue;
      let cursor = obj;
      for (let idx = 0; idx < kv.keys.length - 1; idx++) {
        const k = kv.keys[idx];
        if (!Object.hasOwn(cursor, k) || !cursor[k] || typeof cursor[k] !== 'object') {
          cursor[k] = Object.create(null);
        }
        cursor = cursor[k];
      }
      cursor[kv.keys[kv.keys.length - 1]] = kv.value;
    }
    return obj;
  }
  return undefined;
}

function parseTomlKeyValue(line) {
  let quote = '';
  let eqIndex = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') quote = '';
    } else if (quote === "'") {
      if (ch === "'") quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '=') {
      eqIndex = i;
      break;
    }
  }
  if (eqIndex <= 0) return null;
  const keys = parseTomlKeyParts(line.slice(0, eqIndex).trim());
  if (!keys) return null;
  const value = parseTomlValue(line.slice(eqIndex + 1));
  if (value === undefined) return null;
  return { keys, value };
}

function isAllowedDesktopSection(parts) {
  if (!parts || parts[0] !== 'desktop') return false;
  if (parts.length === 1) return true;
  const theme = parts[1];
  if (theme !== 'appearanceDarkChromeTheme' && theme !== 'appearanceLightChromeTheme') return false;
  if (parts.length === 2) return true;
  return parts.length === 3 && (parts[2] === 'fonts' || parts[2] === 'semanticColors');
}

function applyChromeThemeField(target, pathParts, value) {
  if (!pathParts.length) return;
  if (pathParts.length === 1) {
    const key = pathParts[0];
    if (key === 'surface' || key === 'ink' || key === 'accent') {
      const hex = sanitizeHexColor(value);
      if (hex) {
        target.values[key] = hex;
        target.hasData = true;
      }
      return;
    }
    if (key === 'contrast') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        target.values.contrast = Math.max(0, Math.min(100, value));
        target.hasData = true;
      }
      return;
    }
    if (key === 'opaqueWindows') {
      if (typeof value === 'boolean') {
        target.values.opaqueWindows = value;
        target.hasData = true;
      }
      return;
    }
    if (key === 'fonts' && value && typeof value === 'object' && !Array.isArray(value)) {
      applyChromeThemeField(target, ['fonts', 'ui'], value.ui);
      applyChromeThemeField(target, ['fonts', 'code'], value.code);
      return;
    }
    if (key === 'semanticColors' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [semKey, semVal] of Object.entries(value)) {
        applyChromeThemeField(target, ['semanticColors', semKey], semVal);
      }
    }
    return;
  }
  if (pathParts.length === 2 && pathParts[0] === 'fonts') {
    const fontKey = pathParts[1];
    if (fontKey === 'ui' || fontKey === 'code') {
      const cleaned = sanitizeFontFamily(value);
      if (cleaned) {
        target.values.fonts[fontKey] = cleaned;
        target.hasData = true;
      }
    }
    return;
  }
  if (pathParts.length === 2 && pathParts[0] === 'semanticColors') {
    const hex = sanitizeHexColor(value);
    if (hex) {
      target.values.semanticColors[pathParts[1]] = hex;
      target.hasData = true;
    }
  }
}

export function normalizeCodexHomeInput(rawPath, homeDir = homedir()) {
  if (typeof rawPath !== 'string') return '';
  let clean = rawPath.trim();
  if (!clean) return '';
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return '';
  if (clean.startsWith('file://')) {
    try {
      clean = fileURLToPath(clean);
    } catch {
      return '';
    }
  }
  const baseHome = homeDir || homedir();
  if (clean === '~') {
    clean = baseHome;
  } else if (clean.startsWith('~/') || clean.startsWith('~\\')) {
    clean = join(baseHome, clean.slice(2));
  }
  if (clean.length > 1) {
    clean = clean.replace(/[\\/]+$/, '') || '/';
  }
  if (!clean) return '';
  const base = basename(clean);
  if (base === 'config.toml' || base === '.codex-global-state.sqlite' || base === 'state_5.vscdb') {
    return dirname(clean);
  }
  return clean;
}

export function resolveCodexHome({ codexHome, home, env } = {}) {
  const baseHome = home || homedir();
  const explicit = normalizeCodexHomeInput(codexHome, baseHome);
  if (explicit) return explicit;
  const activeEnv = env === undefined ? (home ? undefined : process.env) : env;
  const fromEnv = normalizeCodexHomeInput(activeEnv?.CODEX_HOME, baseHome);
  if (fromEnv) return fromEnv;
  return join(baseHome, '.codex');
}

export function parseCodexDesktopToml(tomlText) {
  const empty = () => ({
    appearanceDarkCodeThemeId: '',
    appearanceLightCodeThemeId: '',
    appearanceDarkChromeTheme: null,
    appearanceLightChromeTheme: null
  });
  if (typeof tomlText !== 'string' || !tomlText.trim()) return empty();

  let currentSection = null;
  let darkCodeThemeId = '';
  let lightCodeThemeId = '';
  const darkChrome = { hasData: false, values: { fonts: {}, semanticColors: {} } };
  const lightChrome = { hasData: false, values: { fonts: {}, semanticColors: {} } };

  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    if (line.startsWith('[')) {
      if (line.startsWith('[[')) {
        currentSection = null;
        continue;
      }
      if (line.endsWith(']')) {
        const parts = parseTomlKeyParts(line.slice(1, -1).trim());
        currentSection = isAllowedDesktopSection(parts) ? parts : null;
      } else {
        currentSection = null;
      }
      continue;
    }

    if (!currentSection) continue;
    const kv = parseTomlKeyValue(line);
    if (!kv) continue;

    const fullPath = [...currentSection, ...kv.keys];
    if (fullPath.length === 2 && fullPath[0] === 'desktop') {
      if (fullPath[1] === 'appearanceDarkCodeThemeId') {
        darkCodeThemeId = sanitizeThemeId(kv.value);
      } else if (fullPath[1] === 'appearanceLightCodeThemeId') {
        lightCodeThemeId = sanitizeThemeId(kv.value);
      }
      continue;
    }

    if (fullPath[0] === 'desktop' && fullPath[1] === 'appearanceDarkChromeTheme') {
      applyChromeThemeField(darkChrome, fullPath.slice(2), kv.value);
    } else if (fullPath[0] === 'desktop' && fullPath[1] === 'appearanceLightChromeTheme') {
      applyChromeThemeField(lightChrome, fullPath.slice(2), kv.value);
    }
  }

  return {
    appearanceDarkCodeThemeId: darkCodeThemeId,
    appearanceLightCodeThemeId: lightCodeThemeId,
    appearanceDarkChromeTheme: darkChrome.hasData ? darkChrome.values : null,
    appearanceLightChromeTheme: lightChrome.hasData ? lightChrome.values : null
  };
}

export function readCodexSqliteAppearance(sqlitePath) {
  if (!DatabaseSync || typeof sqlitePath !== 'string' || !sqlitePath || !existsSync(sqlitePath)) {
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'appearance-analytics-snapshots-v1'").get();
    if (!row || typeof row.value !== 'string') return null;

    const parsed = JSON.parse(row.value);
    const entries = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    for (let i = entries.length - 1; i >= 0; i--) {
      const rawFp = entries[i]?.fingerprint;
      let fp = null;
      if (typeof rawFp === 'string') {
        try { fp = JSON.parse(rawFp); } catch { fp = null; }
      } else if (rawFp && typeof rawFp === 'object') {
        fp = rawFp;
      }
      if (!fp || typeof fp !== 'object' || Array.isArray(fp)) continue;
      const hasKnown = 'configuredMode' in fp || 'uiFontSizePx' in fp || 'codeFontSizePx' in fp
        || 'fontSmoothing' in fp || 'pagesFullWidth' in fp || 'darkTheme' in fp || 'lightTheme' in fp;
      if (!hasKnown) continue;

      return {
        configuredMode: typeof fp.configuredMode === 'string' ? fp.configuredMode : '',
        uiFontSizePx: boundedNumber(fp.uiFontSizePx, 11, 20),
        codeFontSizePx: boundedNumber(fp.codeFontSizePx, 10, 20),
        fontSmoothing: typeof fp.fontSmoothing === 'boolean' ? fp.fontSmoothing : null,
        pagesFullWidth: typeof fp.pagesFullWidth === 'boolean' ? fp.pagesFullWidth : false,
        darkContrast: boundedNumber(fp.darkTheme?.contrast, 0, 100),
        lightContrast: boundedNumber(fp.lightTheme?.contrast, 0, 100)
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

export function inspectLocalCodexConfig(options = {}) {
  const codexHome = resolveCodexHome(options);
  const tomlPath = join(codexHome, 'config.toml');
  const sqlitePath = join(codexHome, '.codex-global-state.sqlite');
  if (options.skipLocal) {
    return {
      codexHome,
      configToml: { path: tomlPath, exists: false, parsed: false, data: null },
      sqliteState: { path: sqlitePath, exists: false, parsed: false, data: null }
    };
  }

  const tomlExists = existsSync(tomlPath);
  let tomlData = null;
  let tomlParsed = false;
  if (tomlExists) {
    try {
      tomlData = parseCodexDesktopToml(readFileSync(tomlPath, 'utf8'));
      tomlParsed = Boolean(
        tomlData.appearanceDarkChromeTheme
        || tomlData.appearanceLightChromeTheme
        || tomlData.appearanceDarkCodeThemeId
        || tomlData.appearanceLightCodeThemeId
      );
    } catch {
      tomlData = null;
      tomlParsed = false;
    }
  }

  const sqliteExists = existsSync(sqlitePath);
  const sqliteData = sqliteExists ? readCodexSqliteAppearance(sqlitePath) : null;
  const sqliteParsed = Boolean(sqliteData);

  return {
    codexHome,
    configToml: { path: tomlPath, exists: tomlExists, parsed: tomlParsed, data: tomlData },
    sqliteState: { path: sqlitePath, exists: sqliteExists, parsed: sqliteParsed, data: sqliteData }
  };
}

export function resolveCodexStyleProfile(options = {}) {
  const preset = defaultCodexStylePreset();
  const inspected = inspectLocalCodexConfig(options);
  const toml = inspected.configToml.data;
  const sqlite = inspected.sqliteState.data;
  const detected = Boolean(inspected.configToml.parsed || inspected.sqliteState.parsed);

  let local = null;
  if (detected) {
    const rawDark = {
      ...(toml?.appearanceDarkChromeTheme || {}),
      ...(toml?.appearanceDarkChromeTheme?.contrast == null && sqlite?.darkContrast != null
        ? { contrast: sqlite.darkContrast }
        : {})
    };
    const rawLight = {
      ...(toml?.appearanceLightChromeTheme || {}),
      ...(toml?.appearanceLightChromeTheme?.contrast == null && sqlite?.lightContrast != null
        ? { contrast: sqlite.lightContrast }
        : {})
    };
    const pagesFullWidth = Boolean(sqlite?.pagesFullWidth);
    local = {
      id: 'local',
      dark: deriveCodexPalette(rawDark, true, preset.dark),
      light: deriveCodexPalette(rawLight, false, preset.light),
      typography: {
        ...preset.typography,
        pagesFullWidth,
        maxWidth: '48rem',
        uiFontSizePx: sqlite?.uiFontSizePx ?? preset.typography.uiFontSizePx,
        codeFontSizePx: sqlite?.codeFontSizePx ?? preset.typography.codeFontSizePx,
        fontSmoothing: sqlite?.fontSmoothing ?? true
      },
      raw: {
        darkCodeThemeId: toml?.appearanceDarkCodeThemeId || '',
        lightCodeThemeId: toml?.appearanceLightCodeThemeId || '',
        configuredMode: sqlite?.configuredMode || ''
      }
    };
  }

  return {
    detected,
    sources: {
      codexHome: inspected.codexHome,
      customPath: Boolean(typeof options.codexHome === 'string' && options.codexHome.trim()),
      configToml: {
        path: inspected.configToml.path,
        exists: inspected.configToml.exists,
        parsed: inspected.configToml.parsed
      },
      sqliteState: {
        path: inspected.sqliteState.path,
        exists: inspected.sqliteState.exists,
        parsed: inspected.sqliteState.parsed
      }
    },
    preset,
    local,
    inspectedAt: Date.now()
  };
}
