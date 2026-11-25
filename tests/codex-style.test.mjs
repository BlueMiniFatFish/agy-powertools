import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  codexStyleSources,
  defaultCodexStylePreset,
  sanitizeHexColor,
  sanitizeFontFamily,
  formatCssFontStack,
  mixHexColors,
  pickContrastFg,
  deriveCodexPalette,
  resolveActiveCodexConfig,
  buildCodexCssVars
} from '../lib/codex-style-helpers.mjs';
import {
  resolveCodexHome,
  parseCodexDesktopToml,
  readCodexSqliteAppearance,
  inspectLocalCodexConfig,
  resolveCodexStyleProfile
} from '../lib/codex-style.mjs';
import { nativeSource } from '../lib/native-host.mjs';

test('parseCodexDesktopToml parses bare/quoted desktop headers, ignores auth/plugins, and blocks CSS injection', () => {
  const toml = `
    # Top-level comment
    [auth]
    token = "sk-secret-do-not-expose"

    [plugins]
    secretHook = "rm -rf"

    ["desktop"]
    followUpQueueMode = "steer" # ignored non-appearance key
    appearanceDarkCodeThemeId = "tokyo-night"
    "appearanceLightCodeThemeId" = 'github-light'

    ["desktop".appearanceDarkChromeTheme]
    surface = "#11161C" # comment after quoted hex
    ink = "#f8fafc"
    accent = "#123;color:red"
    contrast = 75
    opaqueWindows = true

    ["desktop"."appearanceDarkChromeTheme".fonts]
    ui = "Inter; } body {"
    code = '"JetBrains Mono", monospace'

    ["desktop".appearanceDarkChromeTheme.semanticColors]
    diffAdded = "#40c977"
    bad = "#nothex"

    [desktop.appearanceLightChromeTheme]
    surface = "#FAF8F5"
    ink = "#111827"
    accent = "#10b981"
    contrast = 50
    opaqueWindows = false

    [desktop.appearanceLightChromeTheme.fonts]
    ui = "SF Pro Text"
    code = "Fira Code"
  `;

  const parsed = parseCodexDesktopToml(toml);
  assert.equal(Object.hasOwn(parsed, 'auth'), false);
  assert.equal(Object.hasOwn(parsed, 'plugins'), false);
  assert.equal(Object.hasOwn(parsed, 'token'), false);
  assert.equal(parsed.appearanceDarkCodeThemeId, 'tokyo-night');
  assert.equal(parsed.appearanceLightCodeThemeId, 'github-light');

  assert.equal(parsed.appearanceDarkChromeTheme.surface, '#11161C');
  assert.equal(parsed.appearanceDarkChromeTheme.ink, '#F8FAFC');
  assert.equal(parsed.appearanceDarkChromeTheme.accent, undefined);
  assert.equal(parsed.appearanceDarkChromeTheme.contrast, 75);
  assert.equal(parsed.appearanceDarkChromeTheme.opaqueWindows, true);
  assert.equal(parsed.appearanceDarkChromeTheme.fonts.ui, 'Inter body');
  assert.equal(parsed.appearanceDarkChromeTheme.fonts.code, 'JetBrains Mono, monospace');
  assert.equal(parsed.appearanceDarkChromeTheme.semanticColors.diffAdded, '#40C977');
  assert.equal(parsed.appearanceDarkChromeTheme.semanticColors.bad, undefined);

  assert.equal(parsed.appearanceLightChromeTheme.surface, '#FAF8F5');
  assert.equal(parsed.appearanceLightChromeTheme.ink, '#111827');
  assert.equal(parsed.appearanceLightChromeTheme.accent, '#10B981');
  assert.equal(parsed.appearanceLightChromeTheme.contrast, 50);
  assert.equal(parsed.appearanceLightChromeTheme.opaqueWindows, false);
  assert.equal(parsed.appearanceLightChromeTheme.fonts.ui, 'SF Pro Text');
  assert.equal(parsed.appearanceLightChromeTheme.fonts.code, 'Fira Code');

  const noAppearance = parseCodexDesktopToml('[auth]\ntoken = "secret"\n[desktop]\nfollowUpQueueMode = "steer"\n');
  assert.equal(noAppearance.appearanceDarkChromeTheme, null);
  assert.equal(noAppearance.appearanceLightChromeTheme, null);
  assert.equal(noAppearance.appearanceDarkCodeThemeId, '');
  assert.equal(noAppearance.appearanceLightCodeThemeId, '');

  // Prototype-pollution hardening on inline tables
  const protoProbe = parseCodexDesktopToml(`
    [desktop.appearanceDarkChromeTheme]
    fonts = { __proto__ = { polluted = "yes" }, constructor = { bad = "x" }, ui = "Inter" }
  `);
  assert.equal(({}).polluted, undefined);
  assert.equal(protoProbe.appearanceDarkChromeTheme.fonts.ui, 'Inter');
});

test('readCodexSqliteAppearance reads latest valid snapshot and handles missing or corrupt databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-codex-sqlite-'));
  try {
    assert.equal(readCodexSqliteAppearance(join(dir, 'missing.sqlite')), null);

    const validDbPath = join(dir, 'valid.sqlite');
    const db = new DatabaseSync(validDbPath);
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    const snapshots = [
      {
        accountId: 'a1',
        fingerprint: JSON.stringify({
          configuredMode: 'CODEX_APP_APPEARANCE_MODE_DARK',
          uiFontSizePx: 13,
          codeFontSizePx: 11,
          fontSmoothing: true,
          pagesFullWidth: false,
          darkTheme: { contrast: 55 },
          lightTheme: { contrast: 40 }
        })
      },
      {
        accountId: 'a2',
        fingerprint: JSON.stringify({
          configuredMode: 'CODEX_APP_APPEARANCE_MODE_SYSTEM',
          uiFontSizePx: 15,
          codeFontSizePx: 13,
          fontSmoothing: false,
          pagesFullWidth: true,
          darkTheme: { contrast: 72 },
          lightTheme: { contrast: 52 }
        })
      },
      {
        accountId: 'bad-later-entry',
        fingerprint: '{not valid json'
      }
    ];
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'appearance-analytics-snapshots-v1',
      JSON.stringify(snapshots)
    );
    db.close();

    assert.deepEqual(readCodexSqliteAppearance(validDbPath), {
      configuredMode: 'CODEX_APP_APPEARANCE_MODE_SYSTEM',
      uiFontSizePx: 15,
      codeFontSizePx: 13,
      fontSmoothing: false,
      pagesFullWidth: true,
      darkContrast: 72,
      lightContrast: 52
    });

    const invalidDbPath = join(dir, 'invalid-json.sqlite');
    const invalidDb = new DatabaseSync(invalidDbPath);
    invalidDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    invalidDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'appearance-analytics-snapshots-v1',
      '{broken-json'
    );
    invalidDb.close();
    assert.equal(readCodexSqliteAppearance(invalidDbPath), null);

    const outOfRangeDbPath = join(dir, 'range.sqlite');
    const rangeDb = new DatabaseSync(outOfRangeDbPath);
    rangeDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    rangeDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'appearance-analytics-snapshots-v1',
      JSON.stringify([{
        fingerprint: JSON.stringify({
          configuredMode: 'CODEX_APP_APPEARANCE_MODE_LIGHT',
          uiFontSizePx: 99,
          codeFontSizePx: 4,
          fontSmoothing: true,
          pagesFullWidth: false
        })
      }])
    );
    rangeDb.close();
    assert.deepEqual(readCodexSqliteAppearance(outOfRangeDbPath), {
      configuredMode: 'CODEX_APP_APPEARANCE_MODE_LIGHT',
      uiFontSizePx: null,
      codeFontSizePx: null,
      fontSmoothing: true,
      pagesFullWidth: false,
      darkContrast: null,
      lightContrast: null
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveCodexPalette preserves preset tuned values on exact match and adapts custom dark/light themes', () => {
  const preset = defaultCodexStylePreset();
  assert.equal(preset.dark.accent, '#3A83F7');
  assert.equal(preset.dark.border, '#383838');
  assert.equal(preset.dark.fileLinkColor, '#63A8F8');
  assert.equal(preset.dark.userBubbleBg, '#173E76');
  assert.equal(preset.light.accent, '#3A83F7');
  assert.equal(preset.light.border, '#DCDEE0');
  assert.equal(preset.light.fileLinkColor, '#1F4E94');
  assert.equal(preset.light.userBubbleBg, '#E8F3FE');
  assert.equal(preset.typography.uiFontSizePx, 14);
  assert.equal(preset.typography.codeFontSizePx, 12);

  const matchedDark = deriveCodexPalette({
    surface: '#181818',
    ink: '#ffffff',
    accent: '#3a83f7',
    contrast: 60,
    opaqueWindows: true,
    fonts: { ui: 'Inter', code: 'JetBrains Mono' }
  }, true, preset.dark);
  assert.equal(matchedDark.inlineCodeBg, preset.dark.inlineCodeBg);
  assert.equal(matchedDark.inlineCodeFg, 'inherit');
  assert.equal(matchedDark.fileLinkColor, '#63A8F8');
  assert.equal(matchedDark.fileLinkHoverColor, '#80B9FA');
  assert.equal(matchedDark.userBubbleBg, '#173E76');
  assert.equal(matchedDark.userBubbleBorder, 'transparent');
  assert.equal(matchedDark.userBubbleFg, '#F6FAFE');
  assert.equal(matchedDark.tableHeadBorderAlpha, 16);
  assert.equal(matchedDark.opaqueWindows, true);
  assert.deepEqual(matchedDark.fonts, { ui: 'Inter', code: 'JetBrains Mono' });

  const legacyBlueDark = deriveCodexPalette({
    surface: '#181818',
    ink: '#ffffff',
    accent: '#339cff',
    contrast: 60
  }, true, preset.dark);
  assert.equal(legacyBlueDark.fileLinkColor, '#339CFF');
  assert.equal(legacyBlueDark.fileLinkHoverColor, '#0285FF');
  assert.equal(legacyBlueDark.userBubbleBg, 'rgba(255, 255, 255, 0.07)');
  assert.equal(legacyBlueDark.userBubbleFg, '#FFFFFF');

  const legacyBlueLight = deriveCodexPalette({
    surface: '#FFFFFF',
    ink: '#1A1C1F',
    accent: '#339CFF',
    contrast: 45
  }, false, preset.light);
  assert.equal(legacyBlueLight.fileLinkColor, '#0169CC');
  assert.equal(legacyBlueLight.fileLinkHoverColor, '#013566');
  assert.equal(legacyBlueLight.userBubbleBg, 'rgba(26, 28, 31, 0.05)');
  assert.equal(legacyBlueLight.userBubbleFg, '#1A1C1F');

  const chatgptBlueDark = deriveCodexPalette({
    surface: '#181818',
    ink: '#ffffff',
    accent: '#3a83f7',
    contrast: 70
  }, true, preset.dark);
  assert.equal(chatgptBlueDark.userBubbleBg, '#173E76');
  assert.equal(chatgptBlueDark.userBubbleBorder, 'transparent');
  assert.equal(chatgptBlueDark.userBubbleFg, '#F6FAFE');
  assert.equal(chatgptBlueDark.fileLinkColor, '#63A8F8');

  const chatgptBlueLight = deriveCodexPalette({
    surface: '#FFFFFF',
    ink: '#1A1C1F',
    accent: '#3A83F7',
    contrast: 45
  }, false, preset.light);
  assert.equal(chatgptBlueLight.userBubbleBg, '#E8F3FE');
  assert.equal(chatgptBlueLight.userBubbleBorder, 'transparent');
  assert.equal(chatgptBlueLight.userBubbleFg, '#0C274A');
  assert.equal(chatgptBlueLight.fileLinkColor, '#1F4E94');

  const customDark = deriveCodexPalette({
    surface: '#11161C',
    ink: '#F3F4F6',
    accent: '#10B981',
    contrast: 75,
    fonts: { ui: 'Inter; } body {', code: '' }
  }, true, preset.dark);
  assert.equal(customDark.surface, '#11161C');
  assert.equal(customDark.accent, '#10B981');
  assert.equal(customDark.contrast, 75);
  assert.notEqual(customDark.inlineCodeBg, preset.dark.inlineCodeBg);
  assert.equal(customDark.inlineCodeFg, 'inherit');
  assert.notEqual(customDark.userBubbleBg, preset.dark.userBubbleBg);
  assert.equal(customDark.userBubbleBorder, 'transparent');
  assert.equal(customDark.tableHeadBorderAlpha, 20);
  assert.equal(customDark.tableRowBorderAlpha, 5);
  assert.equal(customDark.hrAlpha, 20);
  assert.equal(customDark.blockquoteBarAlpha, 20);
  assert.equal(customDark.fonts.ui, 'Inter body');

  const customLight = deriveCodexPalette({
    surface: '#FAF8F5',
    ink: '#1A1A1A',
    accent: '#10B981',
    contrast: 65
  }, false, preset.light);
  assert.equal(customLight.surface, '#FAF8F5');
  assert.equal(customLight.userBubbleFg, '#111827');
  assert.equal(customLight.userBubbleBorder, 'transparent');
  assert.notEqual(customLight.fileLinkColor, '#10B981');
  assert.equal(customLight.tableHeadBorderAlpha, 17);
  assert.equal(customLight.tableRowBorderAlpha, 7);
  assert.equal(pickContrastFg('#0F172A'), '#FFFFFF');
  assert.equal(pickContrastFg('#F8FAFC'), '#111827');
  assert.equal(mixHexColors('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(sanitizeHexColor('#123;color:red', '#181818'), '#181818');
  assert.equal(sanitizeFontFamily('  "SF Pro"\n;{}<>\\\'  '), 'SF Pro');
  assert.equal(
    formatCssFontStack('"JetBrains Mono", monospace', 'var(--font-mono, monospace)'),
    '"JetBrains Mono", monospace, var(--font-mono, monospace)'
  );
  assert.equal(
    formatCssFontStack('system-ui, SF Pro Text', 'var(--font-sans, sans-serif)'),
    'system-ui, "SF Pro Text", var(--font-sans, sans-serif)'
  );
  const brightAccentDark = deriveCodexPalette({ surface: '#181818', ink: '#FFFFFF', accent: '#FBBF24', contrast: 60 }, true, preset.dark);
  assert.equal(brightAccentDark.primaryFg, '#111827');
  assert.equal(brightAccentDark.card, '#212121');
  assert.equal(brightAccentDark.secondary, '#2A2A2A');
  assert.ok(sanitizeHexColor(brightAccentDark.border));
  assert.ok(sanitizeHexColor(brightAccentDark.mutedFg));
  assert.deepEqual(codexStyleSources(), ['preset', 'local']);
});

test('buildCodexCssVars emits per-mode typography/theme CSS vars and respects applyTheme and optional font overrides', () => {
  const preset = defaultCodexStylePreset();
  const full = buildCodexCssVars({
    dark: {
      ...preset.dark,
      fonts: { ui: 'Inter', code: '"JetBrains Mono", monospace' }
    },
    light: {
      ...preset.light,
      fonts: { ui: 'system-ui, PingFang SC', code: '' }
    },
    typography: {
      ...preset.typography,
      pagesFullWidth: true,
      maxWidth: '64rem',
      fontSmoothing: false,
      uiFontSizePx: 15,
      codeFontSizePx: 13
    }
  }, { applyTheme: true });

  assert.equal(full.vars['--agy-codex-max-width'], '64rem');
  assert.equal(full.vars['--agy-codex-font-smoothing'], 'antialiased');
  assert.equal(full.vars['--agy-codex-line-height'], '1.625');
  assert.equal(full.vars['--agy-codex-block-gap'], '14px');
  assert.equal(full.vars['--agy-codex-font-size'], '15px');
  assert.equal(full.vars['--agy-codex-code-font-size'], '13px');
  assert.equal(full.vars['--agy-codex-dark-font-sans'], '"Inter", var(--font-sans, system-ui, -apple-system, sans-serif)');
  assert.equal(full.vars['--agy-codex-light-font-sans'], 'system-ui, "PingFang SC", var(--font-sans, system-ui, -apple-system, sans-serif)');
  assert.equal(full.vars['--agy-codex-dark-font-mono'], '"JetBrains Mono", monospace, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)');
  assert.equal(Object.hasOwn(full.vars, '--agy-codex-light-font-mono'), false);
  assert.equal(full.vars['--agy-codex-dark-surface'], '#181818');
  assert.equal(full.vars['--agy-codex-dark-primary-fg'], '#FFFFFF');
  assert.equal(full.vars['--agy-codex-dark-card'], '#212121');
  assert.equal(full.vars['--agy-codex-dark-secondary'], '#2A2A2A');
  assert.equal(full.vars['--agy-codex-dark-border'], '#383838');
  assert.equal(full.vars['--agy-codex-dark-muted-fg'], '#A5A5A5');
  assert.equal(full.vars['--agy-codex-light-bubble-bg'], '#E8F3FE');
  assert.equal(full.vars['--agy-codex-dark-bubble-border'], 'transparent');
  assert.equal(full.vars['--agy-codex-dark-code-bg'], 'rgba(255, 255, 255, 0.11)');
  assert.equal(full.vars['--agy-codex-light-link'], '#1F4E94');
  assert.equal(full.vars['--agy-codex-light-link-hover'], '#163B70');
  assert.deepEqual(full.flags, {
    customFontSize: true,
    customCodeFontSize: true,
    customFontSans: true,
    customFontMono: true
  });

  const typographyOnly = buildCodexCssVars(preset, { applyTheme: false });
  assert.equal(typographyOnly.vars['--agy-codex-max-width'], '48rem');
  assert.equal(typographyOnly.vars['--agy-codex-font-smoothing'], 'subpixel-antialiased');
  assert.equal(typographyOnly.vars['--agy-codex-font-size'], '14px');
  assert.equal(typographyOnly.vars['--agy-codex-code-font-size'], '12px');
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-dark-font-sans'), false);
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-dark-font-mono'), false);
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-dark-surface'), false);
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-dark-primary-fg'), false);
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-dark-card'), false);
  assert.equal(Object.hasOwn(typographyOnly.vars, '--agy-codex-light-bubble-bg'), false);
  assert.equal(typographyOnly.vars['--agy-codex-dark-code-bg'], 'rgba(255, 255, 255, 0.11)');
  assert.equal(typographyOnly.vars['--agy-codex-dark-table-head-alpha'], '16%');
  assert.deepEqual(typographyOnly.flags, {
    customFontSize: true,
    customCodeFontSize: true,
    customFontSans: false,
    customFontMono: false
  });
});

test('resolveCodexStyleProfile and resolveActiveCodexConfig handle populated and missing Codex homes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-codex-home-'));
  try {
    const missingHome = join(dir, 'missing-home');
    assert.equal(resolveCodexHome({ home: missingHome, env: {} }), join(missingHome, '.codex'));
    assert.equal(resolveCodexHome({ codexHome: '~/my-codex', home: missingHome, env: {} }), join(missingHome, 'my-codex'));
    assert.equal(resolveCodexHome({ codexHome: `"${join(dir, 'quoted-codex', 'config.toml')}"`, home: missingHome, env: {} }), join(dir, 'quoted-codex'));

    const missingProfile = resolveCodexStyleProfile({ home: missingHome, env: {} });
    assert.equal(missingProfile.detected, false);
    assert.equal(missingProfile.local, null);
    assert.equal(missingProfile.sources.customPath, false);
    assert.equal(missingProfile.sources.configToml.exists, false);
    assert.equal(missingProfile.sources.configToml.parsed, false);
    assert.equal(missingProfile.sources.sqliteState.exists, false);
    assert.equal(missingProfile.sources.sqliteState.parsed, false);

    const fallback = resolveActiveCodexConfig(missingProfile, 'local');
    assert.equal(fallback.activeSource, 'preset');
    assert.equal(fallback.fellBack, true);
    assert.equal(fallback.dark.surface, '#181818');

    const codexHome = join(dir, 'custom-codex');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), `
[auth]
apiKey = "secret-value"

["desktop"]
appearanceDarkCodeThemeId = "codex"

["desktop".appearanceDarkChromeTheme]
surface = "#11161C"
ink = "#FFFFFF"
accent = "#10B981"
contrast = 75
opaqueWindows = false

["desktop".appearanceDarkChromeTheme.fonts]
ui = "Inter"
`, 'utf8');

    const db = new DatabaseSync(join(codexHome, '.codex-global-state.sqlite'));
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'appearance-analytics-snapshots-v1',
      JSON.stringify([{
        fingerprint: JSON.stringify({
          configuredMode: 'CODEX_APP_APPEARANCE_MODE_DARK',
          uiFontSizePx: 14,
          codeFontSizePx: 12,
          fontSmoothing: false,
          pagesFullWidth: true,
          darkTheme: { contrast: 60 },
          lightTheme: { contrast: 55 }
        })
      }])
    );
    db.close();

    const populatedProfile = resolveCodexStyleProfile({ codexHome });
    assert.equal(populatedProfile.detected, true);
    assert.equal(populatedProfile.sources.codexHome, codexHome);
    assert.equal(populatedProfile.sources.customPath, true);
    assert.equal(populatedProfile.sources.configToml.exists, true);
    assert.equal(populatedProfile.sources.configToml.parsed, true);
    assert.equal(populatedProfile.sources.sqliteState.exists, true);
    assert.equal(populatedProfile.sources.sqliteState.parsed, true);
    assert.equal(populatedProfile.local.id, 'local');
    assert.equal(populatedProfile.local.dark.surface, '#11161C');
    assert.equal(populatedProfile.local.dark.accent, '#10B981');
    assert.equal(populatedProfile.local.dark.contrast, 75);
    assert.equal(populatedProfile.local.light.contrast, 55);
    assert.equal(populatedProfile.local.typography.pagesFullWidth, true);
    assert.equal(populatedProfile.local.typography.maxWidth, '48rem');
    assert.equal(populatedProfile.local.typography.fontSmoothing, false);
    assert.equal(populatedProfile.local.typography.uiFontSizePx, 14);
    assert.equal(populatedProfile.local.typography.codeFontSizePx, 12);
    assert.deepEqual(populatedProfile.local.raw, {
      darkCodeThemeId: 'codex',
      lightCodeThemeId: '',
      configuredMode: 'CODEX_APP_APPEARANCE_MODE_DARK'
    });

    const activeLocal = resolveActiveCodexConfig(populatedProfile, 'local');
    assert.equal(activeLocal.activeSource, 'local');
    assert.equal(activeLocal.fellBack, false);
    assert.equal(activeLocal.dark.surface, '#11161C');

    const skipped = inspectLocalCodexConfig({ codexHome, skipLocal: true });
    assert.equal(skipped.configToml.exists, false);
    assert.equal(skipped.configToml.parsed, false);
    assert.equal(skipped.sqliteState.exists, false);
    assert.equal(skipped.sqliteState.parsed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nativeSource compiles cleanly with vm.Script and attaches Codex style globals without export leakage', () => {
  const source = nativeSource('https://localhost', []);
  assert.doesNotThrow(() => new vm.Script(source));
  const styleIdx = source.indexOf('globalThis.__agyCodexStyle=');
  assert.ok(styleIdx > 0);
  const iifeEnd = source.indexOf('})();', styleIdx);
  assert.ok(iifeEnd > styleIdx);
  const helperSection = `${source.slice(0, iifeEnd + 5)}\n}`;
  assert.equal(/\bexport\s+(?:function|const|let|var|default)\b/.test(helperSection), false);

  const sandbox = vm.createContext({
    location: { origin: 'https://localhost' }
  });
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.runInContext(helperSection, sandbox);

  assert.equal(typeof sandbox.__agyCodexStyleProfile, 'object');
  assert.equal(typeof sandbox.__agyCodexStyle?.defaultCodexStylePreset, 'function');
  assert.equal(typeof sandbox.__agyCodexStyle?.buildCodexCssVars, 'function');
  assert.equal(typeof sandbox.__agyCodexStyle?.deriveCodexPalette, 'function');
  assert.equal(typeof sandbox.__agyCodexStyle?.resolveActiveCodexConfig, 'function');
  assert.deepEqual([...sandbox.__agyCodexStyle.codexStyleSources()], ['preset', 'local']);
  assert.equal(
    sandbox.__agyCodexStyle.buildCodexCssVars(sandbox.__agyCodexStyle.defaultCodexStylePreset()).vars['--agy-codex-dark-surface'],
    '#181818'
  );
});
