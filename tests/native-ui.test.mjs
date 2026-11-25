import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function page(ready = false) {
  const callbacks = new Map();
  const nodes = [];
  const node = () => ({
    dataset: {}, isConnected: false,
    append(child) { child.isConnected = true; },
    setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; }
  });
  const attrs = new Set();
  const document = {
    readyState: ready ? 'complete' : 'loading',
    head: ready ? node() : null, body: ready ? node() : null,
    documentElement: { toggleAttribute(name, force) { if (force === undefined ? !attrs.has(name) : force) attrs.add(name); else attrs.delete(name); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); } },
    createElement() { const element = node(); nodes.push(element); return element; },
    addEventListener(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = vm.createContext({
    document, location: { pathname: '/' }, AbortController,
    React: { createElement() { return {}; } }, ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } }, HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  return { context, document, nodes, callbacks, node };
}

test('new-document injection waits for head and body and initializes exactly once', () => {
  const p = page();
  vm.runInContext(source, p.context);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 0);
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.callbacks.get('DOMContentLoaded').length, 1);
  p.document.head = p.node(); p.document.body = p.node();
  p.callbacks.get('DOMContentLoaded')[0]();
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.context.__agyPowertoolsPending, undefined);
  assert.equal(p.nodes.length, 1);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 1);
});

test('already-loaded injection initializes without waiting and disposes cleanly', () => {
  const p = page(true);
  vm.runInContext(source, p.context);
  assert.equal(p.callbacks.has('DOMContentLoaded'), false);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), false);
  assert.ok(p.nodes.every(n => !n.isConnected));
});

test('multi-pane conversations with multiple composers stay healthy without triggering reload loops', () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-1';
  const renderedRings = [];
  p.context.ReactDOM = { createRoot(mount) { renderedRings.push(mount); return { render() {}, unmount() {} }; } };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = () => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    return { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  };
  const twoTriggers = [makeComposerTrigger(), makeComposerTrigger()];
  let ringNodes = [{}, {}];
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return twoTriggers;
    if (sel === '[data-testid="agy-context-ring-trigger"]') return ringNodes;
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true };
  vm.runInContext(source, p.context);
  assert.equal(renderedRings.length, 2);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('side-question and split-pane composers fetch and render independent context and telemetry per cascadeId', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/main-conv';
  const renderedByMount = new Map();
  const mountOrder = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      mountOrder.push(mount);
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = cid => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    const card = { cid };
    return { cid, isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  };
  const mainTrigger = makeComposerTrigger('main-conv');
  const btwTrigger = makeComposerTrigger('btw-conv');
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  const stateRequests = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true }));
      return;
    }
    if (req.method === 'state') {
      stateRequests.push(req.conversationId);
      const reply = req.conversationId === 'btw-conv'
        ? { conversationId: 'btw-conv', contextWindow: { usedPercent: 80.4, usedTokens: 632000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 60.4 }, turns: [], requests: [] }
        : { conversationId: 'main-conv', contextWindow: { usedPercent: 78.2, usedTokens: 615000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 51.7 }, turns: [], requests: [] };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, reply));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [mainTrigger, btwTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}, {}];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(stateRequests.includes('main-conv'));
  assert.ok(stateRequests.includes('btw-conv'));
  assert.equal(mountOrder.length, 2);
  const mainData = renderedByMount.get(mountOrder[0])?.props?.data;
  const btwData = renderedByMount.get(mountOrder[1])?.props?.data;
  assert.equal(mainData?.conversationId, 'main-conv');
  assert.equal(mainData?.contextWindow?.usedPercent, 78.2);
  assert.equal(btwData?.conversationId, 'btw-conv');
  assert.equal(btwData?.contextWindow?.usedPercent, 80.4);
  assert.equal(btwData?.telemetry?.latestTps, 60.4);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('accountSwitcher respects multiAccount master switch, toggles native settings hide attr, and cleans up on dispose', () => {
  const pOff = page(true);
  const offMounts = [];
  const offSettingsBtn = { isConnected: true, parentElement: { insertBefore(node) { node.isConnected = true; offMounts.push(node); } } };
  pOff.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  pOff.context.__agyNativeAdapter.installPage = () => true;
  pOff.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  pOff.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? offSettingsBtn : null;
  pOff.context.__agyInitialSettings = { enabled: true, multiAccount: false, accountSwitcher: true };
  vm.runInContext(source, pOff.context);
  assert.equal(offMounts.length, 0);
  assert.equal(pOff.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  pOff.context.__agyPowertools.dispose();

  const p = page(true);
  const mountedNodes = [];
  const settingsBtn = {
    isConnected: true,
    parentElement: {
      children: [],
      insertBefore(node, before) {
        node.isConnected = true;
        mountedNodes.push({ node, before });
      }
    }
  };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({
    Page: () => null,
    Sidebar: () => null,
    AccountSwitcher: () => null,
    dispose() {}
  });
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  assert.equal(mountedNodes.length, 1);
  assert.equal(mountedNodes[0].node.dataset.agyPowertoolsRoot, 'account-switcher');
  assert.equal(mountedNodes[0].before, settingsBtn);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(mountedNodes[0].node.isConnected, false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
});

test('renderRoot does not repeatedly call insertBefore when before equals existing mount', () => {
  const p = page(true);
  let insertCount = 0;
  const link = { isConnected: true, nextSibling: null };
  const parent = {
    insertBefore(node) {
      insertCount++;
      node.isConnected = true;
      link.nextSibling = node;
    }
  };
  link.parentElement = parent;
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduled = null;
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? link : null;
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(insertCount, 1);
  // Trigger a second mount cycle after link.nextSibling points to entry.mount
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, 1);
  p.context.__agyPowertools.dispose();
});

test('Powertools sidebar entry repositions after /customizations once /customizations mounts later', () => {
  const p = page(true);
  const children = [];
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  let insertCount = 0;
  const navContainer = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const existingIdx = children.indexOf(node);
      if (existingIdx >= 0) children.splice(existingIdx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  const newChat = { id: 'new-chat', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(newChat);
  let custLink = null;
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => {
    if (sel === 'a[href="/customizations"]') return custLink;
    if (sel === '[data-testid="sidebar-navigation-items"]') return navContainer;
    return null;
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(children.length, 2);
  assert.equal(children[1].dataset.agyPowertoolsRoot, 'management');

  // Now native React mounts Automations and Customizations after Powertools
  const automations = { id: 'auto', isConnected: true, parentElement: navContainer, nextSibling: null };
  custLink = { id: 'cust', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(automations, custLink);
  syncSiblings();
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.deepEqual(children.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['new-chat', 'auto', 'cust', 'management']);
  const countAfterMove = insertCount;

  // Next mount tick must be a no-op (no flicker loop)
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, countAfterMove);

  p.context.__agyPowertools.dispose();
  assert.equal(children.find(c => c.dataset?.agyPowertoolsRoot === 'management')?.isConnected, false);
});

test('cold-start proxy prompt banner appears on mismatch, handles unreachable port, dismisses, and cleans up on dispose', async () => {
  const p = page(true);
  const bodyChildren = [];
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      dataset: {},
      children: [],
      isConnected: false,
      textContent: '',
      append(...items) {
        for (const item of items) {
          item.isConnected = true;
          this.children.push(item);
        }
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); },
      remove() {
        this.isConnected = false;
        const idx = bodyChildren.indexOf(this);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      }
    };
    return el;
  };
  p.document.createElement = () => makeEl();
  p.document.body = {
    append(el) { el.isConnected = true; bodyChildren.push(el); }
  };

  const sent = [];
  p.context.__agyPowertoolsHost = payload => {
    const req = JSON.parse(payload);
    sent.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
      } else if (req.method === 'proxy.status') {
        p.context.__agyPowertoolsReceive(req.id, {
          configured: true,
          configuredUrl: 'http://127.0.0.1:7897',
          configuredDisplayUrl: 'http://127.0.0.1:7897',
          configuredForceHttp1: false,
          active: false,
          mismatch: true,
          reason: 'not-applied',
          canRelaunch: true
        });
      } else if (req.method === 'proxy.relaunch') {
        p.context.__agyPowertoolsReceive(req.id, req.force
          ? { ok: true, relaunching: true, proxyActive: true }
          : { ok: false, portUnreachable: true, message: '代理端口 127.0.0.1:7897 无法连接' });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setTimeout(resolve, 20));

  const findBanner = () => bodyChildren.find(el => el.dataset.testid === 'agy-proxy-prompt-banner');
  const findBtn = (banner, testId) => banner?.children?.flatMap(c => c.children || []).find(b => b.dataset?.testid === testId);

  let banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('http://127.0.0.1:7897'));
  assert.equal(banner.children[0].textContent.includes('\u00b7'), false);

  // Clicking relaunch when port is closed warns instead of restarting immediately
  findBtn(banner, 'agy-proxy-banner-relaunch').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('无法连接'));
  assert.ok(findBtn(banner, 'agy-proxy-banner-force'));

  // Dismiss removes banner cleanly
  findBtn(banner, 'agy-proxy-banner-dismiss').click();
  assert.equal(findBanner(), undefined);

  p.context.__agyPowertools.dispose();
  assert.equal(bodyChildren.some(el => el.dataset.testid === 'agy-proxy-prompt-banner'), false);
});

test('native-bindings resolves 2.34.0 notification hook without type:"add" and stays optional when absent', () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const makeEnv = (toastHook, jcImpl = null) => {
    const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
    const ctx = vm.createContext({
      React: {},
      createFileRoute: () => opts => opts,
      HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
      IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
      JC: jcImpl || (() => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 })),
      KC: () => ({ asChild: 1, isMobile: 1, setIsOpen: 1 }),
      GC: () => ({ tooltipPlace: 1, secondaryAction: 1, tag: 'main-row-trigger' }),
      Uy: () => ({ paddingClassName: 1, computedAriaLabel: 1, asChild: 1 }),
      XP: () => ({ onCheckedChange: 1, desc: 'aria-describedby', role:"switch" }),
      UP: ({label: a}) => ({ rightElement: a, extraContent: 1, descriptionId: 1 }),
      TP: () => 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border',
      VP: () => ({ headerRight: 1, defaultCollapsed: 1, forceExpanded: 1 }),
      dq: ({name: a}) => ({ cls: 'google-symbols', kind: 'Icon', a }),
      k0: ({trigger: a}) => ({ triggerVisible: a, onCollapseComplete: 1, defaultExpanded: 1 }),
      Sy,
      kT: () => ({ ownsHighlight: 1, onHighlightExit: 1, onSearchQueryChange: 1 }),
      lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr: "data-no-drag" }),
      mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
      nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
      HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
      Kc: x => x,
      resolveFn: () => { const c = Kc(Proto.CascadeConfigSchema, { lookupCustomModelInfo: 1, customModelInfoOverride: 1, checkpointConfig: void 0 }); return c; },
      segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
      menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
      Proto: { CascadeConfigSchema: {} },
      Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
      IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
      LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
      ...(toastHook ? { kn: toastHook } : {})
    });
    // Ensure resolveFn contains exact matcher literal checkpointConfig=void 0
    vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, ctx);
    vm.runInContext(bindingsSource, ctx);
    return ctx.__agyResolveNativeBindings([]);
  };

  // 2.34.0 style (action creator Mqa instead of inline type:"add")
  const toast234 = function () { return ({ autoDismissMs: m, plainTextFallback: p, primaryActionLabel: l }) => b.showNotification({ primaryActionLabel: l, autoDismissMs: m, plainTextFallback: p }); };
  const resolved234 = makeEnv(toast234);
  assert.equal(resolved234.names.um, 'kn');
  assert.equal(resolved234.bindings.um, toast234);

  // Absent toast hook degrades gracefully without throwing
  const resolvedNoToast = makeEnv(null);
  assert.equal(resolvedNoToast.bindings.um, undefined);

  // 2.35.0 style JC (scrollContainerClassName removed, keeps arrowNavigable + matchTriggerWidth + collisionAvoidance / contentRef.current=)
  const jc235 = function LQ({ arrowNavigable: l, matchTriggerWidth: k, collisionAvoidance: n }) { const y = { contentRef: {} }; y.contentRef.current = l || k || n; return y; };
  const resolved235 = makeEnv(toast234, jc235);
  assert.equal(resolved235.names.JC, 'JC');
  assert.equal(resolved235.bindings.JC, jc235);
});

test('overview mounts both progress and overviewQuota in stable order without insertBefore ping-pong', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ov';
  const children = [];
  let insertCount = 0;
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  const overview = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, Progress: () => null, OverviewQuota: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, progress: true, overviewQuota: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-ov', turns: [], requests: [], progress: { status: 'complete', tasks: [] } }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelector = sel => sel === '[data-testid="overview-panel"]' ? overview : null;
  p.context.__agyInitialSettings = { enabled: true, progress: true, overviewQuota: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(children.map(c => c.dataset.agyPowertoolsRoot).join(','), 'progress,overview-quota');
  const stableCount = insertCount;
  // Re-trigger mount cycles multiple times -> zero extra insertBefore mutations
  for (let i = 0; i < 4; i++) {
    observerCb?.([{ target: { closest: () => null } }]);
    scheduled?.();
  }
  assert.equal(insertCount, stableCount);
  p.context.__agyPowertools.dispose();
});

test('startAddAccount awaits active sync and calls accounts.completeAdd, and refreshAccount skips quota.observe on credentialMismatch', async () => {
  const p = page(true);
  let capturedEnv = null;
  let currentEmail = 'alpha@example.com';
  const calls = [];
  let mismatchNextSync = false;
  let quotaRemaining = 0.9;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: currentEmail,
    name: currentEmail.split('@')[0],
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: quotaRemaining }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyNativeAdapter.startAccountLogin = async () => {
    currentEmail = 'beta@example.com';
    return { ok: true, email: currentEmail };
  };
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.autoSwitchCandidate') {
        p.context.__agyPowertoolsReceive(req.id, { candidate: { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha' }, cooldownRemainingMs: 0 });
      } else if (req.method === 'accounts.prepareAdd') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, backedUpId: 'acct-a', prevCredHash: 'HASH_A', activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }] });
      } else if (req.method === 'accounts.syncActive') {
        if (mismatchNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [{ id: 'acct-b', email: 'beta@example.com', hasCredential: true }],
            credentialMismatch: { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' }
          });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ]
          });
        }
      } else if (req.method === 'accounts.completeAdd') {
        p.context.__agyPowertoolsReceive(req.id, {
          ok: true,
          relaunching: false,
          manualRestartRequired: true,
          account: { id: 'acct-b', email: 'beta@example.com', name: 'beta' },
          activeId: 'acct-b',
          accounts: [
            { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
            { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
          ]
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // Even when the newly signed-in account has a depleted bucket and autoSwitchAccount is enabled,
  // startAddAccount suppresses auto-switch so it never races with completeAdd / relaunch.
  quotaRemaining = 0;
  const addRes = await capturedEnv.startAddAccount('Backup');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.manualRestartRequired, true);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  assert.equal(p.context.document.querySelector('[data-testid="agy-autoswitch-banner"]'), null);
  quotaRemaining = 0.9;
  const methods = calls.map(c => c.method);
  const prepIdx = methods.indexOf('accounts.prepareAdd');
  const syncIdx = methods.lastIndexOf('accounts.syncActive');
  const completeIdx = methods.indexOf('accounts.completeAdd');
  assert.ok(prepIdx >= 0 && syncIdx > prepIdx && completeIdx > syncIdx, `Expected prepareAdd -> syncActive -> completeAdd, got ${methods.join(',')}`);
  const completeCall = calls[completeIdx];
  assert.equal(completeCall.email, 'beta@example.com');
  assert.equal(completeCall.prevEmail, 'alpha@example.com');
  assert.equal(completeCall.prevCredHash, 'HASH_A');
  assert.equal(completeCall.relaunch, true);

  // When syncActive reports credentialMismatch, refreshAccount MUST NOT call quota.observe
  const beforeObserve = calls.filter(c => c.method === 'quota.observe').length;
  mismatchNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  const afterObserve = calls.filter(c => c.method === 'quota.observe').length;
  assert.equal(afterObserve, beforeObserve);

  p.context.__agyPowertools.dispose();
});

test('refreshAccount handles out-of-order concurrency, failure retry without 60s lockout, missing buckets, vaultReason preservation, and loadDashboard(true) override', async () => {
  const p = page(true);
  let capturedEnv = null;
  const calls = [];
  const quotaCalls = [];
  let pendingFirstQuota = null;
  let quotaMode = 'stall-first';
  let failSyncActive = false;
  let pendingDashboard = null;
  let stallFirstDashboard = true;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: 'alice@example.com',
    name: 'Alice',
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      if (quotaMode === 'stall-first') {
        quotaMode = 'fresh-second';
        return new Promise(resolve => { pendingFirstQuota = resolve; });
      }
      if (quotaMode === 'fresh-second') {
        quotaMode = 'normal';
        return Promise.resolve({
          response: {
            groups: [
              { displayName: 'Missing Buckets Group' },
              {
                displayName: 'Gemini Models',
                buckets: [
                  { bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.42 }, resetTime: { seconds: 1800000000n } },
                  { bucketId: 'g-untouched', window: 'weekly', remaining: { case: 'remainingFraction', value: 1 }, resetTime: { seconds: 1800600000n }, description: '' },
                  { bucketId: 'g-off', window: '5h', remaining: { case: 'remainingFraction', value: 0 }, disabled: true }
                ]
              }
            ]
          }
        });
      }
      if (quotaMode === 'fail-once') {
        quotaMode = 'normal';
        return Promise.reject(new Error('network blip'));
      }
      return Promise.resolve({
        response: {
          groups: [{
            displayName: 'Gemini Models',
            buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.66 }, resetTime: null }]
          }]
        }
      });
    }
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  const baseAccounts = {
    activeId: 'acct-1',
    vaultSupported: false,
    vaultReason: 'Keyring unavailable in sandbox',
    lastAutoSwitchAtMs: 0,
    accounts: [
      { id: 'acct-1', email: 'alice@example.com', name: 'Alice', hasCredential: true },
      { id: 'acct-2', email: 'bob@example.com', name: 'Bob', hasCredential: true }
    ]
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    if (req.method === 'dashboard' && stallFirstDashboard && !req.force) {
      stallFirstDashboard = false;
      pendingDashboard = () => p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'stale-dash' }] });
      return;
    }
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.list' || req.method === 'accounts.rename' || req.method === 'accounts.refreshLocalQuotas') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, ...baseAccounts });
      } else if (req.method === 'accounts.syncActive') {
        if (failSyncActive) {
          p.context.__agyPowertoolsReceive(req.id, { error: 'syncActive timeout' });
        } else {
          p.context.__agyPowertoolsReceive(req.id, { ...baseAccounts });
        }
      } else if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: req.force ? 'fresh-dash' : 'normal-dash' }] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, estimates: [] });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);
  assert.ok(pendingFirstQuota, 'Initial passive refreshAccount should be in-flight');

  // 1. Trigger forced refreshAccountQuotas('acct-1') while passive refresh is still pending
  const refreshPromise = capturedEnv.refreshAccountQuotas('acct-1');
  await refreshPromise;
  // Fresh forced value (0.42) applied; groups sanitized (missing buckets survived, disabled filtered, untouched 100% description:'' stripped)
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);
  const lastSync = calls.filter(c => c.method === 'accounts.syncActive').at(-1);
  assert.equal(lastSync.snapshot.groups.length, 2);
  assert.deepEqual(lastSync.snapshot.groups[0].buckets, []);
  assert.equal(lastSync.snapshot.groups[1].buckets.length, 2);
  assert.equal(lastSync.snapshot.groups[1].buckets[1].resetTimeMs, null);
  // Active-target refresh MUST pass accountId: '' to accounts.refreshLocalQuotas so inactive windows update too
  const lastLocal = calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1);
  assert.equal(lastLocal.accountId, '');

  // Now resolve the stale first passive request with 0.99 -> MUST NOT overwrite 0.42!
  pendingFirstQuota({
    response: {
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.99 }, resetTime: null }] }]
    }
  });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);

  // 2. 'live-current' also resolves as active refresh and passes accountId: '' to refreshLocalQuotas
  await capturedEnv.refreshAccountQuotas('live-current');
  assert.equal(calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1).accountId, '');

  // 3. vaultReason is preserved across renameAccount and refreshAccountQuotas
  await capturedEnv.renameAccount('acct-1', 'Work');
  assert.equal(p.context.__agyPowertools.accounts.vaultReason, 'Keyring unavailable in sandbox');

  // 4. Failed retrieveUserQuotaSummary propagates error without locking out immediate retry, and syncActive error rejects refreshAccountQuotas
  quotaMode = 'fail-once';
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /network blip/);
  await capturedEnv.refreshAccountQuotas('acct-1');
  assert.equal(p.context.__agyPowertools.account.groups[0].buckets[0].remaining.value, 0.66);

  failSyncActive = true;
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /syncActive timeout/);
  failSyncActive = false;

  // 5. loadDashboard(true) while loadDashboard(false) is in-flight MUST NOT be swallowed, and stale dashboard(false) MUST NOT overwrite dashboard(true)
  const passiveDash = capturedEnv.loadDashboard(false);
  const forcedDash = capturedEnv.loadDashboard(true);
  await forcedDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  pendingDashboard();
  await passiveDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  assert.ok(quotaCalls.some(c => c.forceRefresh === true));

  p.context.__agyPowertools.dispose();
});

test('refresh loop triggers forced quota refresh when a conversation turn finishes', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-turn';
  const intervalCbs = [];
  p.context.setInterval = cb => { intervalCbs.push(cb); return intervalCbs.length; };
  let execState = { conversationId: 'conv-turn', status: 2 };
  const quotaCalls = [];
  let fakeNow = 1_795_600_000_000;
  p.context.Date = class extends Date {
    static now() { return fakeNow; }
  };
  p.context.__agyNativeAdapter.executionState = () => execState;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'alice@example.com', name: 'Alice' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      return Promise.resolve({ response: { groups: [] } });
    }
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true });
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-turn', turns: [], requests: [] });
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 1);
  assert.equal(Boolean(quotaCalls[0].forceRefresh), false);

  // Advance > 15s and finish the running turn -> triggers forced refresh
  fakeNow += 20_000;
  execState = { conversationId: 'conv-turn', status: 1, terminationReason: 0, notFullyIdle: false };
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 2);
  assert.equal(quotaCalls[1].forceRefresh, true);

  // Advance 3 minutes while foreground visible -> periodic poll upgrades to forceRefresh: true
  fakeNow += 180_000;
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 3);
  assert.equal(quotaCalls[2].forceRefresh, true);

  p.context.__agyPowertools.dispose();
});

test('userBubbleStrength updates CSS variables and readable foreground contrast, and worked-for merges split/sibling triggers without duplicates or middle dots', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  const renderedCompletions = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.HU = m => m?.index;
  p.context.ReactDOM = {
    createRoot: mount => ({
      render(el) {
        if (mount.dataset?.agyPowertoolsRoot === 'completion') renderedCompletions.push(el);
      },
      unmount() {}
    })
  };
  p.context.location.pathname = '/c/conv-worked';

  // Build a turn where native worked-for button lives in the enclosing turn scope (not inside agent-response)
  // and has split spans: "Worked for 8m 28s" + "<dot> 4 updates"
  const mainSpan = { isConnected: true, textContent: 'Worked for 8m 28s', contains: () => false };
  const updSpan = { isConnected: true, textContent: '\u00b7 4 updates', contains: () => false };
  const attrs = new Map();
  const workedBtn = {
    isConnected: true,
    get textContent() { return `${mainSpan.textContent} ${updSpan.textContent}`; },
    closest: () => null,
    querySelectorAll: sel => sel === 'span' ? [mainSpan, updSpan] : [],
    getAttribute: k => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k)
  };
  const response = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; this.children.unshift(child); },
    closest: sel => sel === '[data-turn-content]' ? turnScopeEl : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const turnScopeEl = {
    querySelector: () => null,
    querySelectorAll: sel => sel === 'button,[role="button"]' ? [workedBtn] : []
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="agent-response"]' ? [response] : [];
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.onEditChange = () => () => {};
  p.context.__agyNativeAdapter.fiber = () => ({ memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, {
          enabled: true, timing: true, codexStyle: false, userBubbleTint: true,
          userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
        });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, {
          conversationId: 'conv-worked',
          turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 5, status: 'complete', completedAtIso: '2026-11-24T00:00:00Z', durationMs: 508000, toolCalls: [] }],
          requests: []
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = {
    enabled: true, timing: true, codexStyle: false, userBubbleTint: true,
    userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  // Verify Issue #27 solid tint + readable contrast foreground
  assert.equal(styleProps.get('--agy-bubble-tint'), '#173E76');
  assert.equal(styleProps.get('--agy-bubble-bg'), '100%');
  assert.equal(styleProps.get('--agy-bubble-border'), '100%');
  assert.equal(styleProps.get('--agy-bubble-fg'), '#ffffff');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-bubble-fg'), true);

  // Verify Issue #29 in-place merge without duplicate row or middle dots
  assert.equal(mainSpan.textContent, '用时 8分28秒 4 条进度');
  assert.equal(mainSpan.textContent.includes('\u00b7'), false);
  assert.equal(updSpan.textContent, '');
  assert.equal(attrs.get('data-tooltip-id'), 'agy-completed-conv-worked-1');
  assert.ok(renderedCompletions.length >= 1);
  const findTooltipOnly = node => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props && 'tooltipOnly' in node.props) return node.props.tooltipOnly;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTooltipOnly(c);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  assert.equal(findTooltipOnly(renderedCompletions.at(-1)), true);

  // Verify Issue #25 CSS prevents OverviewQuota wrapping
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  assert.ok(panelsSrc.includes('grid-auto-columns:72px'));
  assert.ok(panelsSrc.includes('width:72px;height:21px;padding:0 6px;border-radius:6px;font-size:11px;white-space:nowrap'));

  // Dispose restores both split worked-for spans and clears bubble CSS vars
  p.context.__agyPowertools.dispose();
  assert.equal(mainSpan.textContent, 'Worked for 8m 28s');
  assert.equal(updSpan.textContent, '\u00b7 4 updates');
  assert.equal(attrs.has('data-tooltip-id'), false);
  assert.equal(styleProps.has('--agy-bubble-bg'), false);
  assert.equal(styleProps.has('--agy-bubble-fg'), false);
});

test('titlebarQuickPanel mounts left of titlebar-more-actions, falls back to overview/aux toggles, and unmounts when disabled', async () => {
  const makeTitlebarEnv = (selectors) => {
    const p = page(true);
    const mounts = [];
    let unmounted = 0;
    const parent = {
      children: [],
      insertBefore(node, before) {
        const idx = this.children.indexOf(node);
        if (idx >= 0) this.children.splice(idx, 1);
        node.isConnected = true;
        if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
        else this.children.push(node);
        for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
        mounts.push({ node, before });
      }
    };
    const anchors = {};
    for (const key of ['more', 'overview', 'aux']) {
      anchors[key] = { id: key, isConnected: true, parentElement: parent, nextSibling: null };
      if (selectors[key]) parent.children.push(anchors[key]);
    }
    for (let i = 0; i < parent.children.length; i++) parent.children[i].nextSibling = parent.children[i + 1] || null;
    p.context.ReactDOM = { createRoot() { return { render() {}, unmount() { unmounted++; } }; } };
    p.context.__agyNativeAdapter.installPage = () => true;
    let capturedEnv = null;
    p.context.__agyPanels = env => {
      capturedEnv = env;
      return { Page: () => null, Sidebar: () => null, QuickPopover: () => null, dispose() {} };
    };
    p.document.querySelector = sel => {
      if (sel === '[data-testid="titlebar-more-actions"]' && selectors.more) return anchors.more;
      if (sel === '[data-testid="toggle-overview-panel"]' && selectors.overview) return anchors.overview;
      if (sel === '[data-testid="toggle-aux-sidebar"]' && selectors.aux) return anchors.aux;
      return null;
    };
    return { p, mounts, anchors, parent, getUnmounted: () => unmounted, getEnv: () => capturedEnv };
  };

  const primary = makeTitlebarEnv({ more: true, overview: true, aux: true });
  let currentSettings = { enabled: true, titlebarQuickPanel: true };
  primary.p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        primary.p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  primary.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, primary.p.context);
  assert.equal(primary.mounts.length, 1);
  assert.equal(primary.mounts[0].node.dataset.agyPowertoolsRoot, 'titlebar-quick');
  assert.equal(primary.mounts[0].before, primary.anchors.more);

  await primary.getEnv().change({ titlebarQuickPanel: false });
  assert.equal(primary.getUnmounted(), 1);
  primary.p.context.__agyPowertools.dispose();

  const fallback = makeTitlebarEnv({ more: false, overview: false, aux: true });
  fallback.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, fallback.p.context);
  assert.equal(fallback.mounts.length, 1);
  assert.equal(fallback.mounts[0].before, fallback.anchors.aux);
  fallback.p.context.__agyPowertools.dispose();
});

test('composerWorkingBeam cross-fades with ComposerQuotaHalo when active and stays idle/unmounted cleanly', async () => {
  const p = page(true);
  const renderedTrees = [];
  let unmounted = 0;
  const card = {
    children: [],
    isConnected: true,
    firstChild: null,
    getBoundingClientRect() { return { width: 640, height: 104 }; },
    insertBefore(node, before) {
      const idx = this.children.indexOf(node);
      if (idx >= 0) this.children.splice(idx, 1);
      node.isConnected = true;
      if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
      else this.children.push(node);
      this.firstChild = this.children[0] || null;
      for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
    }
  };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Neon',
    parentElement: { children: [], insertBefore() {} },
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  p.context.getComputedStyle = el => el === card ? { borderRadius: '20px', display: 'flex' } : { display: 'flex', color: 'rgb(66, 133, 244)' };
  p.context.React.createElement = (type, props, ...children) => ({ type, props: props || {}, children });
  p.context.React.Fragment = 'fragment';
  p.context.React.useRef = init => ({ current: init });
  p.context.React.useId = () => ':r1:';
  p.context.React.useState = init => [typeof init === 'function' ? init() : init, () => {}];
  p.context.React.useEffect = fn => { fn(); };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') renderedTrees.push(tree);
        },
        unmount() { if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') unmounted++; }
      };
    }
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [model] : [];
  let execStatus = 1;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-beam-1';
  p.context.__agyNativeAdapter.executionState = cid => cid === 'conv-beam-1' ? { conversationId: cid, status: execStatus, notFullyIdle: false } : null;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: { groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.72 }] }] }
    })
  });
  let currentSettings = { enabled: true, composerQuotaHalo: true, composerWorkingBeam: true, composerWorkingBeamPalette: 'aurora' };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  let capturedPanelsEnv = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedPanelsEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { ...currentSettings };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  const renderNode = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(renderNode);
    if (typeof node.type === 'function') {
      const states = [];
      let idx = 0;
      const prevState = p.context.React.useState;
      const prevEffect = p.context.React.useEffect;
      p.context.React.useState = init => {
        const i = idx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
      };
      p.context.React.useEffect = fn => { fn(); };
      try {
        let out = node.type({ ...node.props, children: node.children });
        idx = 0;
        p.context.React.useEffect = () => {};
        out = node.type({ ...node.props, children: node.children });
        return renderNode(out);
      } finally {
        p.context.React.useState = prevState;
        p.context.React.useEffect = prevEffect;
      }
    }
    return { ...node, children: (Array.isArray(node.children) ? node.children : [node.children]).map(renderNode) };
  };
  const findById = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const x of node) { const r = findById(x, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    return findById(node.children, id);
  };

  assert.ok(renderedTrees.length >= 1);
  // 1. Idle state: quota halo full brightness (not dimmed), working beam inactive
  const idleTree = renderNode(renderedTrees.at(-1));
  const idleQuota = findById(idleTree, 'agy-composer-quota-halo');
  const idleBeam = findById(idleTree, 'agy-composer-working-beam');
  assert.ok(idleQuota);
  assert.equal(idleQuota.props['data-dimmed'], undefined);
  assert.ok(idleBeam);
  assert.equal(idleBeam.props['data-active'], 'false');
  assert.equal(idleBeam.props['data-palette'], 'aurora');

  // 2. Preview toggle forces beam active and completely hides quota halo even while idle
  assert.equal(source.includes('.agy-quota-halo-svg[data-dimmed=true]{opacity:0}'), true);
  capturedPanelsEnv.setBeamPreview(true);
  const previewTree = renderNode(renderedTrees.at(-1));
  assert.equal(findById(previewTree, 'agy-composer-quota-halo').props['data-dimmed'], 'true');
  assert.equal(findById(previewTree, 'agy-composer-working-beam').props['data-active'], 'true');
  capturedPanelsEnv.setBeamPreview(false);
  assert.equal(findById(renderNode(renderedTrees.at(-1)), 'agy-composer-working-beam').props['data-active'], 'false');

  // 3. Running state: Plan A cross-fade hides quota halo and activates beam
  execStatus = 2;
  const activeTree = renderNode(renderedTrees.at(-1));
  const activeQuota = findById(activeTree, 'agy-composer-quota-halo');
  const activeBeam = findById(activeTree, 'agy-composer-working-beam');
  assert.equal(activeQuota.props['data-dimmed'], 'true');
  assert.equal(activeBeam.props['data-active'], 'true');

  p.context.__agyPowertools.dispose();
  assert.ok(unmounted >= 1);
});

test('SSH command paste observes setting changes without reinstalling its listener', async () => {
  const p = page(true);
  const settings = { enabled: true };
  p.context.__agyInitialSettings = settings;
  let change, enabled, installs = 0;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => { change = env.change; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.installSshCommandPaste = (_document, options) => { enabled = options.enabled; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, settings: patch } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, patch);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enabled(), true);
  await change({ sshCommandPaste: false });
  assert.equal(enabled(), false);
  await change({ sshCommandPaste: true });
  assert.equal(enabled(), true);
  assert.equal(installs, 1);
  p.context.__agyPowertools.dispose();
});

test('long-conversation mount skips redundant document style writes, skips unchanged root renders, and defers during IME/touch', async () => {
  const p = page(true);
  let styleWrites = 0;
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty(k, v) { styleWrites++; styleProps.set(k, v); },
    removeProperty(k) { styleProps.delete(k); }
  };
  let renderCount = 0;
  const userActions = { children: [], isConnected: true, insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const userStep = { isConnected: true, querySelector: sel => sel === '[data-testid="user-message-actions"]' ? userActions : null };
  p.document.querySelectorAll = sel => sel === '[data-testid="user-input-step"]' ? [userStep] : [];
  p.context.location.pathname = '/c/conv-perf-1';
  p.context.ReactDOM = { createRoot() { return { render() { renderCount++; }, unmount() {} }; } };
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  const timers = [];
  p.context.setTimeout = (fn, delay) => { const entry = { fn, delay, cleared: false }; timers.push(entry); return entry; };
  p.context.clearTimeout = entry => { if (entry) entry.cleared = true; };
  p.context.__agyInitialSettings = { enabled: true, userBubbleTint: true, userBubblePreset: 'ocean', userBubbleStrength: 40, messageEdit: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, p.context.__agyInitialSettings);
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-perf-1', turns: [{ turnNumber: 1, status: 'complete' }], contextWindow: {} });
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const writesAfterBoot = styleWrites;
  const rendersAfterBoot = renderCount;
  assert.ok(writesAfterBoot > 0);
  assert.ok(rendersAfterBoot >= 1);

  // Mutations inside [contenteditable] or [data-markdown-root] should be ignored completely
  const timersBefore = timers.length;
  observerCb([{ target: { closest: sel => sel.includes('[contenteditable]') ? {} : null } }]);
  observerCb([{ target: { closest: sel => sel.includes('[data-markdown-root]') ? {} : null } }]);
  assert.equal(timers.length, timersBefore);

  // During active IME composition, non-ignored mutations defer mount until compositionend
  const compStart = p.callbacks.get('compositionstart')?.[0];
  const compEnd = p.callbacks.get('compositionend')?.[0];
  assert.ok(compStart && compEnd);
  compStart();
  observerCb([{ target: { closest: () => null } }]);
  assert.equal(timers.length, timersBefore);
  compEnd();
  assert.ok(timers.length > timersBefore);
  // Running the deferred mount should do ZERO redundant style writes and ZERO redundant MessageEdit renders
  const lastTimer = timers.at(-1);
  lastTimer.fn();
  assert.equal(styleWrites, writesAfterBoot);
  assert.equal(renderCount, rendersAfterBoot);
  p.context.__agyPowertools.dispose();
});

test('loadDashboard returns local dashboard immediately without blocking on slow remote quota RPC', async () => {
  const p = page(true);
  let capturedEnv = null;
  let resolveQuota = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: () => new Promise(resolve => { resolveQuota = resolve; })
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { enabled: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'local-fast-1' }], errors: [] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true } : {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const data = await capturedEnv.loadDashboard(true);
  assert.equal(data.requests[0].id, 'local-fast-1');
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'local-fast-1');
  resolveQuota?.({ response: { groups: [] } });
  p.context.__agyPowertools.dispose();
});

test('codexStyle defaults inject ordered CSS rules, apply DOM attrs/vars, respect toggles, and clean up on dispose', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  let capturedEnv = null;
  let currentSettings = { enabled: true, compact: true, codexStyle: true };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { ...currentSettings };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  assert.equal(p.nodes.length, 1);
  const css = p.nodes[0].textContent;
  const compactUnlayeredIdx = css.indexOf('html[data-agy-compact] [data-agy-powertools-root="completion"]');
  const codexUnlayeredIdx = css.indexOf('html[data-agy-codex-style] [data-testid="conversation-view"]');
  const compactThemeIdx = css.indexOf('html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :last-child');
  const codexThemeIdx = css.indexOf('html[data-agy-codex-style] [data-testid="agent-response"] [data-markdown-root] h1');
  const codexHarmonyIdx = css.indexOf('html[data-agy-codex-style][data-agy-codex-theme]{');
  assert.ok(compactUnlayeredIdx > 0 && codexUnlayeredIdx > compactUnlayeredIdx);
  assert.ok(compactThemeIdx > 0 && codexThemeIdx > compactThemeIdx);
  assert.ok(codexHarmonyIdx > codexThemeIdx);
  assert.ok(!css.includes('html[data-agy-codex-style] [data-testid="conversation-view"]{' + '--conversation-nav-reserve'));

  assert.equal(p.document.documentElement.hasAttribute('data-agy-compact'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-style'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-theme'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-size'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-code-font-size'), true);
  assert.equal(styleProps.get('--agy-codex-max-width'), '48rem');
  assert.equal(styleProps.get('--agy-codex-line-height'), '1.625');
  assert.equal(styleProps.get('--agy-codex-font-size'), '14px');
  assert.equal(styleProps.get('--agy-codex-code-font-size'), '12px');
  assert.equal(styleProps.get('--agy-codex-dark-surface'), '#181818');
  assert.equal(styleProps.get('--agy-codex-dark-accent'), '#3A83F7');
  assert.equal(styleProps.get('--agy-codex-dark-border'), '#383838');
  assert.equal(styleProps.get('--agy-codex-dark-primary-fg'), '#FFFFFF');
  assert.equal(styleProps.get('--agy-codex-dark-card'), '#212121');
  assert.equal(styleProps.get('--agy-codex-dark-bubble-bg'), '#173E76');
  assert.equal(styleProps.get('--agy-codex-light-bubble-bg'), '#E8F3FE');
  assert.equal(styleProps.get('--agy-codex-dark-bubble-border'), 'transparent');
  assert.ok(css.includes('--primary-foreground:var(--agy-codex-dark-primary-fg,#FFFFFF)'));
  assert.ok(css.includes(':is(html.dark[data-agy-codex-style][data-agy-codex-font-sans],html[data-agy-codex-style][data-agy-codex-font-sans] .dark)'));
  assert.ok(css.includes(':is(html.dark[data-agy-codex-style][data-agy-codex-font-mono],html[data-agy-codex-style][data-agy-codex-font-mono] .dark)'));
  assert.ok(css.includes('html[data-agy-codex-style] [data-agy-powertools-root="completion"]{margin-block:0}'));
  assert.ok(css.includes('text-decoration:underline dashed .5px currentColor!important'));
  assert.ok(css.includes('html[data-agy-codex-style][data-agy-codex-theme]:not([data-agy-user-bubble]) [data-testid="user-input-step"] [data-testid="user-message-bubble"]'));
  assert.ok(css.includes(':is(html.dark[data-agy-codex-style][data-agy-codex-theme]:not([data-agy-user-bubble]),html[data-agy-codex-style][data-agy-codex-theme]:not([data-agy-user-bubble]) .dark)'));
  assert.ok(css.includes('--sidebar:color-mix(in srgb,var(--agy-codex-light-surface,#FFFFFF) 97%,var(--agy-codex-light-ink,#1A1C1F))'));
  assert.ok(css.includes('html[data-agy-codex-style][data-agy-codex-theme] body{--background:var(--agy-codex-light-surface,#FFFFFF)'));
  assert.ok(css.includes('--sidebar:color-mix(in srgb,var(--agy-codex-dark-card,#212121) 88%,var(--agy-codex-dark-surface,#181818));--shell-canvas:var(--sidebar);--shell:var(--sidebar);--sidebar-secondary:color-mix(in srgb,var(--agy-codex-dark-ink,#FFFFFF) 8%,var(--sidebar));--sidebar-muted:color-mix(in srgb,var(--agy-codex-dark-ink,#FFFFFF) 5.5%,var(--sidebar));--onyx-selected:var(--sidebar-secondary);--secondary-foreground:color-mix(in srgb,var(--agy-codex-dark-ink,#FFFFFF) 80%,var(--sidebar))'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar{-webkit-font-smoothing:var(--agy-codex-font-smoothing,subpixel-antialiased);--agy-codex-sidebar-ink:color-mix(in srgb,var(--foreground) 80%,var(--sidebar));--agy-codex-sidebar-section:color-mix(in srgb,var(--foreground) 50%,var(--sidebar))}'));
  assert.ok(css.includes('html[data-agy-codex-style] [data-testid="new-conversation-button"],html[data-agy-codex-style] [data-testid="sidebar-navigation-items"] .agy-sidebar-raised{background-color:transparent!important;color:var(--agy-codex-sidebar-ink)!important;box-shadow:none!important;--tw-ring-shadow:0 0 #0000!important;border:0!important'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar [data-testid="project-header"]{background-color:transparent!important;color:var(--agy-codex-sidebar-ink)}'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar [class*="group/section-header"] > :first-child{font-size:14px;line-height:20px;font-weight:400;color:var(--agy-codex-sidebar-section);opacity:1'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar .agy-sidebar-row{--row-bg:var(--sidebar);border-radius:10px;min-height:30px;padding-block:5px;font-size:14px;line-height:20px'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar :is(.agy-sidebar-row,[data-testid="conversation-row-sidebar"]):is(.bg-sidebar-secondary,[data-selected="true"],.bg-background.ring-1,.ring-border,[aria-current="page"],:has(a[aria-current="page"])){background-color:var(--sidebar-secondary)!important;--row-bg:var(--sidebar-secondary)!important;box-shadow:none!important;--tw-ring-shadow:0 0 #0000!important;border-color:transparent!important;color:var(--foreground)!important}'));
  assert.ok(css.includes('html[data-agy-codex-style] .bg-sidebar :is(.agy-sidebar-row,[data-testid="conversation-row-sidebar"]):is(.bg-sidebar-secondary,[data-selected="true"],.bg-background.ring-1,.ring-border,[aria-current="page"],:has(a[aria-current="page"])) span.text-left.truncate{font-weight:500}'));
  assert.equal(css.includes('html[data-agy-codex-style][data-agy-codex-code-font-size] [data-testid="agent-response"] [data-markdown-root] code:not(pre *)'), false);

  // Turn off codexStyle -> removes all codex attrs/vars while preserving data-agy-compact
  await capturedEnv.change({ codexStyle: false });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-style'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-theme'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-compact'), true);
  assert.equal([...styleProps.keys()].some(k => k.startsWith('--agy-codex-')), false);

  // Re-enable then dispose -> removes all codex attrs and CSS vars cleanly
  await capturedEnv.change({ codexStyle: true });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-style'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-theme'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-style'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-theme'), false);
  assert.equal([...styleProps.keys()].some(k => k.startsWith('--agy-codex-')), false);
});

test('silent local Codex profile auto-detection applies custom profile when found and cleans up on disable/dispose', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  const codexHelpers = await import('../lib/codex-style-helpers.mjs');
  const inspectCalls = [];
  let capturedEnv = null;
  const presetConfig = codexHelpers.defaultCodexStylePreset();
  const localConfig = {
    id: 'local',
    dark: {
      ...codexHelpers.deriveCodexPalette({ surface: '#121212', ink: '#F5F5F5', accent: '#60A5FA', contrast: 75, fonts: { ui: 'Inter', code: '"JetBrains Mono", monospace' } }, true, presetConfig.dark)
    },
    light: {
      ...codexHelpers.deriveCodexPalette({ surface: '#FAFAFA', ink: '#111111', accent: '#2563EB', contrast: 50 }, false, presetConfig.light)
    },
    typography: { maxWidth: '64rem', pagesFullWidth: true, fontSmoothing: false, lineHeight: 1.65, blockGapPx: 14, uiFontSizePx: 15, codeFontSizePx: 13 }
  };
  const profile = { detected: true, sources: { configToml: { path: '/Users/test/.codex/config.toml', exists: true, parsed: true } }, preset: presetConfig, local: localConfig, inspectedAt: 1700000000000 };
  p.context.__agyCodexStyle = codexHelpers;
  let currentSettings = { enabled: true, codexStyle: true };
  p.context.__agyInitialSettings = { ...currentSettings };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else if (req.method === 'codexStyle.inspect') {
        inspectCalls.push(req.force);
        p.context.__agyPowertoolsReceive(req.id, profile);
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(inspectCalls.length, 1);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-size'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-code-font-size'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-sans'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-mono'), true);
  assert.equal(styleProps.get('--agy-codex-max-width'), '64rem');
  assert.equal(styleProps.get('--agy-codex-font-size'), '15px');
  assert.equal(styleProps.get('--agy-codex-code-font-size'), '13px');
  assert.equal(styleProps.get('--agy-codex-dark-font-sans'), '"Inter", var(--font-sans, system-ui, -apple-system, sans-serif)');
  assert.equal(styleProps.get('--agy-codex-dark-font-mono'), '"JetBrains Mono", monospace, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)');
  assert.equal(styleProps.has('--agy-codex-light-font-sans'), false);
  assert.equal(styleProps.get('--agy-codex-dark-surface'), '#121212');
  assert.equal(styleProps.get('--agy-codex-dark-primary-fg'), '#111827');
  assert.equal(capturedEnv.codexStyleProfile().detected, true);

  // Disabling codexStyle clears stale local attrs & CSS vars cleanly; re-enabling restores them without extra inspect call
  await capturedEnv.change({ codexStyle: false });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-sans'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-mono'), false);
  assert.equal([...styleProps.keys()].some(k => k.startsWith('--agy-codex-')), false);

  await capturedEnv.change({ codexStyle: true });
  assert.deepEqual(inspectCalls, [false]);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), true);

  p.context.__agyPowertools.dispose();
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-sans'), false);
  assert.equal([...styleProps.keys()].some(k => k.startsWith('--agy-codex-')), false);
});

test('Settings panel collapses Codex Extensions to one single switch and places hdImages under Conversation enhancements', async () => {
  const panelsSource = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  let opts = { enabled: true, language: 'en', codexStyle: true, hdImages: true, compact: true, userBubbleTint: false, fileContextMenu: true };
  const changes = [];
  const states = [];
  let idx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useState: init => { const n = idx++; if (!(n in states)) states[n] = typeof init === 'function' ? init() : init; return [states[n], v => { states[n] = v; }]; },
    useSyncExternalStore: (_sub, getSnap) => getSnap(),
    useEffect: () => {},
    useId: () => 'id-1'
  };
  const ctx = vm.createContext({
    React,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} }, documentElement: { classList: { contains: () => true } } },
    location: { pathname: '/powertools' },
    UP: 'row', TP: 'card', VP: 'section', Uy: 'button', XP: 'switch',
    kT: 'menu', lT: 'menu-trigger', mT: 'menu-list', nT: 'menu-item', dq: 'icon', Sy: 'tooltip'
  });
  vm.runInContext(panelsSource, ctx);
  const panels = ctx.__agyPanels({
    t: v => v,
    options: () => opts,
    settingsError: () => '',
    state: () => ({ contextWindow: { maxTokens: 0 } }),
    change: async patch => { changes.push(patch); opts = { ...opts, ...patch }; },
    subscribe: () => () => {},
    revision: () => 0
  });
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function' && node.type.name === 'CodexExtensionsSection') {
      return expand(node.type(node.props));
    }
    return {
      ...node,
      ...(node.props ? {
        props: {
          ...node.props,
          ...(node.props.rightElement !== undefined ? { rightElement: expand(node.props.rightElement) } : {}),
          ...(node.props.description !== undefined ? { description: expand(node.props.description) } : {})
        }
      } : {}),
      children: Array.isArray(node.children) ? node.children.map(expand) : expand(node.children)
    };
  };
  const childrenOf = node => [...(Array.isArray(node.children) ? node.children : [node.children]), node.props?.label, node.props?.description, node.props?.rightElement];
  const find = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = find(item, id); if (hit) return hit; }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    for (const val of childrenOf(node)) {
      const hit = find(val, id);
      if (hit) return hit;
    }
    return null;
  };
  const findSection = (node, title) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = findSection(item, title); if (hit) return hit; }
      return null;
    }
    if (node.type === 'section' && node.props?.title === title) return node;
    for (const val of childrenOf(node)) {
      const hit = findSection(val, title);
      if (hit) return hit;
    }
    return null;
  };
  const textOf = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (typeof node === 'object') return textOf(node.children);
    return '';
  };
  const render = () => { idx = 0; return expand(panels.Settings()); };

  let tree = render();
  const codexSection = findSection(tree, 'Codex Extensions');
  const interfaceSection = findSection(tree, 'Interface & display');
  const convSection = findSection(tree, 'Conversation enhancements');
  assert.ok(codexSection);
  assert.ok(interfaceSection);
  assert.ok(convSection);

  // Codex Extensions isolates codexStyle and hdImages cleanly together without clutter sub-panels
  assert.ok(find(codexSection, 'agy-setting-codexStyle'));
  assert.ok(find(codexSection, 'agy-setting-hdImages'));
  assert.equal(find(codexSection, 'agy-setting-hdImages').props.checked, true);
  assert.equal(find(codexSection, 'agy-setting-row-codexStylePanel'), null);
  assert.equal(find(codexSection, 'agy-setting-codexProgress'), null);
  assert.equal(find(codexSection, 'agy-setting-codexComposerMedia'), null);
  assert.equal(find(codexSection, 'agy-codex-source-preset'), null);
  assert.equal(find(codexSection, 'agy-codex-source-local'), null);
  assert.equal(find(codexSection, 'agy-setting-codexStyleApplyTheme'), null);
  assert.equal(find(codexSection, 'agy-codex-path-input'), null);

  // Author sections remain completely free of our extension controls
  assert.equal(find(interfaceSection, 'agy-setting-codexStyle'), null);
  assert.equal(find(interfaceSection, 'agy-setting-hdImages'), null);
  assert.equal(find(convSection, 'agy-setting-codexStyle'), null);
  assert.equal(find(convSection, 'agy-setting-hdImages'), null);
  assert.ok(textOf(find(interfaceSection, 'agy-setting-row-compact').props.description).includes('Currently overridden by Codex-style experience'));
  assert.ok(textOf(find(interfaceSection, 'agy-setting-row-userBubbleTint').props.description).includes('Using Codex borderless bubble by default'));
  assert.ok(textOf(find(convSection, 'agy-setting-row-stageUpdates').props.description).includes('Currently upgraded by Codex-style experience with concise output & localized tool summaries'));

  // Enabling userBubbleTint overrides Codex default bubble color while keeping Codex theme active
  find(interfaceSection, 'agy-setting-userBubbleTint').props.onCheckedChange(true);
  await new Promise(r => setImmediate(r));
  tree = render();
  assert.ok(textOf(find(tree, 'agy-setting-row-userBubbleTint').props.description).includes('Overriding Codex default bubble while keeping Codex theme'));
  find(tree, 'agy-setting-userBubbleTint').props.onCheckedChange(false);
  await new Promise(r => setImmediate(r));
  tree = render();
  assert.ok(textOf(find(tree, 'agy-setting-row-userBubbleTint').props.description).includes('Using Codex borderless bubble by default'));

  // Toggle hdImages from Codex Extensions section
  find(codexSection, 'agy-setting-hdImages').props.onCheckedChange(false);
  await new Promise(r => setImmediate(r));
  assert.equal(changes.at(-1)?.hdImages, false);

  // Turning off codexStyle removes override notices cleanly
  find(tree, 'agy-setting-codexStyle').props.onCheckedChange(false);
  await new Promise(r => setImmediate(r));
  assert.equal(changes.at(-1)?.codexStyle, false);
  tree = render();
  assert.equal(textOf(find(tree, 'agy-setting-row-compact').props.description).includes('Currently overridden'), false);
  assert.equal(textOf(find(tree, 'agy-setting-row-userBubbleTint').props.description).includes('Using Codex borderless bubble by default'), false);
  assert.equal(textOf(find(tree, 'agy-setting-row-stageUpdates').props.description).includes('Currently upgraded by Codex-style experience'), false);
  panels.dispose();
});

test('codexStyle works without __agyCodexStyle helper using inline fallback and dedupes concurrent inspect calls', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  let capturedEnv = null;
  let resolveInspect = null;
  let inspectCount = 0;
  p.context.__agyInitialSettings = { enabled: true, codexStyle: true };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'codexStyle.inspect') {
      inspectCount++;
      resolveInspect = payload => p.context.__agyPowertoolsReceive(req.id, payload);
      return;
    }
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, p.context.__agyInitialSettings);
      else if (req.method === 'settings.set') {
        p.context.__agyInitialSettings = { ...p.context.__agyInitialSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...p.context.__agyInitialSettings });
      } else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  // Concurrent non-forced inspect deduplicates onto the in-flight request
  const p1 = capturedEnv.loadCodexStyle(false);
  const p2 = capturedEnv.loadCodexStyle(false);
  assert.equal(p1, p2);
  assert.equal(inspectCount, 1);
  assert.equal(capturedEnv.codexStyleLoading(), true);

  resolveInspect({
    detected: true,
    sources: { configToml: { path: '/Users/test/.codex/config.toml', exists: true, parsed: true } },
    local: {
      typography: { maxWidth: '64rem', uiFontSizePx: 16, codeFontSizePx: 13, lineHeight: 1.65, blockGapPx: 14, fontSmoothing: true },
      dark: { fonts: { ui: 'Inter', code: 'Fira Code' } }
    }
  });
  await p1;
  assert.equal(capturedEnv.codexStyleLoading(), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-size'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-code-font-size'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-mono'), true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-font-sans'), true);
  assert.equal(styleProps.get('--agy-codex-max-width'), '64rem');
  assert.equal(styleProps.get('--agy-codex-font-size'), '16px');
  assert.equal(styleProps.get('--agy-codex-code-font-size'), '13px');
  assert.equal(styleProps.get('--agy-codex-dark-font-sans'), '"Inter", var(--font-sans, system-ui, -apple-system, sans-serif)');
  assert.equal(styleProps.get('--agy-codex-dark-font-mono'), '"Fira Code", var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)');
  assert.equal(styleProps.has('--agy-codex-light-font-sans'), false);
  assert.equal(styleProps.get('--agy-codex-dark-surface'), '#181818');
  assert.equal(styleProps.get('--agy-codex-dark-primary-fg'), '#FFFFFF');
  assert.equal(styleProps.get('--agy-codex-dark-card'), '#212121');

  // Disabling codexStyle clears data-agy-codex-local cleanly
  await capturedEnv.change({ codexStyle: false });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-local'), false);

  p.context.__agyPowertools.dispose();
});

test('codexStyle drives codexProgress DOM attribute, adapter sync, worked label cleanup, forwards language, and dispose restoration', async () => {
  const p = page(true);
  const progressCalls = [];
  const languageCalls = [];
  const mainSpan = { isConnected: true, textContent: 'Worked for 5m 40s', contains: () => false };
  const updSpan = { isConnected: true, textContent: '\u00b7 4 updates', contains: () => false };
  const attrs = new Map();
  const progressTrigger = {
    isConnected: true,
    get textContent() { return `${mainSpan.textContent} ${updSpan.textContent}`; },
    closest: () => null,
    querySelectorAll: sel => sel === 'span' ? [mainSpan, updSpan] : [],
    getAttribute: k => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k)
  };
  const response = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; this.children.unshift(child); },
    closest: () => null,
    querySelector: sel => sel === '[data-testid="progress-updates-collapsible"]' ? progressTrigger : null,
    querySelectorAll: () => []
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="agent-response"]' ? [response] : [];
  p.context.HU = m => m?.index;
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  p.context.location.pathname = '/c/conv-progress';
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.fiber = () => ({ memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null });
  p.context.__agyNativeAdapter.setCodexProgress = val => { progressCalls.push(val); };
  p.context.__agyNativeAdapter.setUiLanguage = lang => { languageCalls.push(lang); };
  let currentSettings = { enabled: true, timing: true, codexStyle: true, language: 'zh-CN' };
  p.context.__agyInitialSettings = { ...currentSettings };
  let capturedEnv = null;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, {
          conversationId: 'conv-progress',
          turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 4, status: 'complete', completedAtIso: '2026-11-24T00:00:00Z', durationMs: 340000, toolCalls: [] }],
          requests: []
        });
      } else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), true);
  assert.ok(progressCalls.includes(true));
  assert.ok(languageCalls.includes('zh-CN'));
  assert.ok(p.nodes[0].textContent.includes('html[data-agy-codex-progress] [data-testid="progress-updates-timeline"]'));
  assert.ok(p.nodes[0].textContent.includes('margin-inline-start:-.5rem;margin-inline-end:0'));
  assert.ok(p.nodes[0].textContent.includes(':not([data-testid="step-plan-chip"])'));
  assert.ok(p.nodes[0].textContent.includes('[data-testid="step-plan-chip"]{margin-left:4px!important'));
  assert.ok(p.nodes[0].textContent.includes(':is([data-step-index],[data-step-index] > .min-w-0) > :is(.relative,.w-full > .relative) > button[aria-expanded]:not([data-testid="step-plan-chip"])'));
  assert.equal(mainSpan.textContent, '用时 5分40秒');
  assert.equal(updSpan.textContent, '');

  await capturedEnv.change({ language: 'zh-TW' });
  assert.equal(languageCalls.at(-1), 'zh-TW');
  await capturedEnv.change({ language: 'zh-CN' });
  assert.equal(languageCalls.at(-1), 'zh-CN');

  await capturedEnv.change({ codexStyle: false });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), false);
  assert.equal(progressCalls.at(-1), false);
  assert.equal(mainSpan.textContent, '用时 5分40秒 4 条进度');

  await capturedEnv.change({ codexStyle: true });
  assert.equal(mainSpan.textContent, '用时 5分40秒');

  p.context.__agyPowertools.dispose();
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-progress'), false);
  assert.equal(mainSpan.textContent, 'Worked for 5m 40s');
  assert.equal(updSpan.textContent, '\u00b7 4 updates');
});

test('hdImages forwards option to adapter.setHdImages on mount and change', async () => {
  const p = page(true);
  const hdCalls = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  p.context.location.pathname = '/c/conv-hd';
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.setHdImages = val => { hdCalls.push(val); };
  let currentSettings = { enabled: true, hdImages: true, language: 'zh-CN' };
  p.context.__agyInitialSettings = { ...currentSettings };
  let capturedEnv = null;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  assert.ok(hdCalls.includes(true));
  await capturedEnv.change({ hdImages: false });
  assert.equal(hdCalls.at(-1), false);
  await capturedEnv.change({ hdImages: true });
  assert.equal(hdCalls.at(-1), true);
  p.context.__agyPowertools.dispose();
});

test('codexStyle suppresses premature ResponseActions and Completion while idle-status-text is active and mounts once subagents complete', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-idle-bar';
  let idleVisible = true;
  const idleBadge = { isConnected: true };
  const feedbackParent = {
    isConnected: true,
    children: [],
    insertBefore(node) { node.isConnected = true; this.children.push(node); }
  };
  const feedbackBtn = { parentElement: feedbackParent };
  const scope = {
    querySelector: sel => {
      if (sel === '[data-testid="idle-status-text"]') return idleVisible ? idleBadge : null;
      if (sel === '[aria-label="Bad response"]' || sel === '[aria-label="Good response"]') return feedbackBtn;
      return null;
    },
    querySelectorAll: () => []
  };
  const response = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; this.children.unshift(child); },
    closest: sel => sel === '[data-turn-content]' ? scope : null,
    querySelector: sel => {
      if (sel === '[data-testid="idle-status-text"]') return idleVisible ? idleBadge : null;
      return null;
    },
    querySelectorAll: () => []
  };
  p.document.querySelector = sel => (sel === '[data-testid="idle-status-text"]' && idleVisible) ? idleBadge : null;
  p.document.querySelectorAll = sel => sel === '[data-testid="agent-response"]' ? [response] : [];
  p.context.HU = m => m?.index;
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render() {},
        unmount() { mount.isConnected = false; }
      };
    }
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.fiber = () => ({ memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null });
  let capturedEnv = null;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  const turnState = {
    conversationId: 'conv-idle-bar',
    turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 4, status: 'complete', completedAtIso: '2026-11-25T04:00:00Z', durationMs: 42000, toolCalls: [] }],
    requests: []
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, timing: true, responseBranch: true, codexStyle: true, language: 'zh-CN' });
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, turnState);
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  p.context.__agyInitialSettings = { enabled: true, timing: true, responseBranch: true, codexStyle: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  const css = p.nodes[0].textContent;
  assert.ok(css.includes('[data-testid="cascade-system-message-toolbar"]:has([data-testid="idle-status-text"]) > [data-testid="idle-status-text"] ~ div'));
  assert.ok(css.includes('[data-turn-content="latest"]:has([data-testid="agent-loading"]) > fieldset:has([data-testid="cascade-system-message-toolbar"])'));
  // While idle-status-text is present, neither ResponseActions nor Completion mounts prematurely
  assert.equal(feedbackParent.children.length, 0);
  assert.equal(response.children.length, 0);

  // Once subagents finish and idle-status-text is removed, next refresh mounts both cleanly
  idleVisible = false;
  await capturedEnv.change({ timing: true });
  assert.equal(feedbackParent.children.some(c => c.dataset?.agyPowertoolsRoot === 'response-actions'), true);
  assert.equal(response.children.some(c => c.dataset?.agyPowertoolsRoot === 'completion'), true);
  p.context.__agyPowertools.dispose();
});

test('codexStyle injects Codex 122x122 attachment CSS, toggles DOM attribute, and forwards option to adapter', async () => {
  const p = page(true);
  const mediaCalls = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  p.context.location.pathname = '/c/conv-media';
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.setCodexComposerMedia = val => { mediaCalls.push(val); };
  let currentSettings = { enabled: true, codexStyle: true, language: 'zh-CN' };
  p.context.__agyInitialSettings = { ...currentSettings };
  let capturedEnv = null;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  const css = p.nodes[0].textContent;
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), true);
  assert.ok(mediaCalls.includes(true));
  assert.ok(css.includes('html[data-agy-codex-composer-media] .surface-composer-card [data-testid="input-attachment"]:has(img) [data-testid="input-attachment-open"]{display:block;width:122px;height:122px;border-radius:12px'));
  assert.ok(css.includes('[data-testid="side-question-tab-composer"] .surface-composer-card [data-testid="input-attachment"]:has(img) [data-testid="input-attachment-open"]{width:88px;height:88px;border-radius:10px}'));
  assert.ok(css.includes('[data-testid="input-attachment-remove"]::before{content:\'\';position:absolute;inset:-6px}'));

  await capturedEnv.change({ codexStyle: false });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), false);
  assert.equal(mediaCalls.at(-1), false);

  await capturedEnv.change({ codexStyle: true });
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.document.documentElement.hasAttribute('data-agy-codex-composer-media'), false);
});

test('contextmenu unifies selection, images, and files to CodexActionPill when codexStyle is on, and falls back to FileContextMenu when off', async () => {
  const p = page(true);
  p.document.body.appendChild = child => { child.isConnected = true; };
  const renderedMenus = [];
  const rpcCalls = [];
  const attachCalls = [];
  const selectionCalls = [];
  let capturedEnv = null;
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: fn => { fn(); },
    useLayoutEffect: fn => { fn(); },
    useRef: init => ({ current: init })
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) { if (mount.dataset?.agyPowertoolsRoot === 'file-menu') renderedMenus.push(tree); },
        unmount() { mount.isConnected = false; }
      };
    }
  };
  p.context.HC = ({ children }) => ({ type: 'HC', props: {}, children });
  p.context.IC = ({ children }) => ({ type: 'IC', props: {}, children });
  p.context.JC = ({ children, ...props }) => ({ type: 'JC', props, children });
  p.context.KC = ({ children }) => ({ type: 'KC', props: {}, children });
  p.context.GC = ({ children, ...props }) => ({ type: 'GC', props, children });
  p.context.dq = props => ({ type: 'dq', props, children: [] });
  p.context.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 };
  let currentSettings = { enabled: true, codexStyle: true, fileContextMenu: true, language: 'zh-CN' };
  p.context.__agyInitialSettings = { ...currentSettings };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => { capturedEnv = env; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  let currentSelection = null;
  let currentResolved = null;
  const fakeInlineMedia = { mode: 'media', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', name: 'paste.png' };
  p.context.__agyNativeAdapter.extractQuotableSelection = () => currentSelection;
  p.context.__agyNativeAdapter.attachSelectionToComposer = async (snap, opts) => {
    selectionCalls.push({ snap, opts });
    return { ok: true };
  };
  p.context.__agyNativeAdapter.resolveContextTarget = () => currentResolved;
  p.context.__agyNativeAdapter.resolveInlineMediaPayload = async () => fakeInlineMedia;
  p.context.__agyNativeAdapter.attachFileToComposer = async (payload, src, opts) => {
    attachCalls.push({ payload, src, opts });
    return { ok: true };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    rpcCalls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      else if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...currentSettings });
      } else if (req.method === 'file.openWithList') p.context.__agyPowertoolsReceive(req.id, { ok: true, apps: [] });
      else if (req.method === 'file.attach') p.context.__agyPowertoolsReceive(req.id, { ok: true, mode: 'mention', uri: req.uri, isDirectory: req.isDirectory });
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));

  const expandTree = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expandTree);
    if (typeof node.type === 'function') return expandTree(node.type({ ...node.props, children: node.children }));
    return { ...node, children: (Array.isArray(node.children) ? node.children : [node.children]).map(expandTree) };
  };
  const findById = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const x of node) { const r = findById(x, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    return findById(node.children, id);
  };
  const css = p.nodes[0].textContent;
  assert.ok(css.includes('html[data-agy-codex-style] .selection-popup > .agy-selection-pill'));
  assert.ok(css.includes('html[data-agy-context-pill-open] .selection-popup{opacity:0!important;pointer-events:none!important}'));
  assert.ok(css.includes('.agy-codex-action-pill{'));

  const ctxListener = p.callbacks.get('contextmenu').at(-1);
  assert.ok(ctxListener);

  // 1. Selected text right-click -> shows CodexActionPill ("添加到对话 | 在侧边聊天中提问") and marks data-agy-context-pill-open
  const textTarget = { closest: () => null };
  currentSelection = { text: '333.3335 m', source: textTarget, isCodeBlock: false, inSideQuestion: false, anchorRect: { top: 200, bottom: 220 } };
  let prevented = false, stopped = false;
  ctxListener({ clientX: 250, clientY: 210, target: textTarget, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-context-pill-open'), true);
  const selMenu = expandTree(renderedMenus.at(-1));
  const selPill = findById(selMenu, 'agy-codex-context-pill');
  assert.ok(selPill);
  assert.equal(selPill.props['data-pill-mode'], 'selection');
  assert.equal(findById(selMenu, 'agy-file-attach-chat').children[0], '添加到对话');
  assert.equal(findById(selMenu, 'agy-file-attach-side-question').children[0], '在侧边聊天中提问');
  await findById(selMenu, 'agy-file-attach-side-question').props.onClick();
  assert.equal(selectionCalls.at(-1).opts.target, 'side');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-context-pill-open'), false);

  // 2. Inline image right-click when codexStyle is on -> shows CodexActionPill (overrides FileContextMenu)
  currentSelection = null;
  const imgSource = { closest: () => null };
  currentResolved = { kind: 'inline-media', uri: '', isDirectory: false, isMedia: true, inlineTarget: { name: 'paste.png' }, source: imgSource };
  ctxListener({ clientX: 120, clientY: 160, target: imgSource, preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(rpcCalls.some(r => r.method === 'file.openWithList'), false);
  const imgPillTree = expandTree(renderedMenus.at(-1));
  assert.equal(findById(imgPillTree, 'agy-codex-context-pill').props['data-pill-mode'], 'file');
  await findById(imgPillTree, 'agy-file-attach-side-question').props.onClick();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(attachCalls.at(-1).opts.target, 'side');
  assert.equal(attachCalls.at(-1).payload.mode, 'media');

  // 3. Directory pill inside Side Question -> hides second button to match Codex
  const dirInSideSource = { closest: sel => sel === '[data-testid="side-question-tab-content"]' ? {} : null };
  currentResolved = { kind: 'file', uri: 'file:///Users/test/repo', isDirectory: true, source: dirInSideSource };
  ctxListener({ clientX: 200, clientY: 220, target: dirInSideSource, preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  const sidePillTree = expandTree(renderedMenus.at(-1));
  assert.ok(findById(sidePillTree, 'agy-file-attach-chat'));
  assert.equal(findById(sidePillTree, 'agy-file-attach-side-question'), null);
  await findById(sidePillTree, 'agy-file-attach-chat').props.onClick();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(attachCalls.at(-1).opts.target, 'side');

  // 4. Disabling codexStyle falls back to vertical FileContextMenu with fixed chat_bubble icon
  await capturedEnv.change({ codexStyle: false });
  const dirMainSource = { closest: () => null };
  currentResolved = { kind: 'file', uri: 'file:///Users/test/repo', isDirectory: true, source: dirMainSource };
  ctxListener({ clientX: 200, clientY: 220, target: dirMainSource, preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  const fallbackMenu = expandTree(renderedMenus.at(-1));
  assert.ok(findById(fallbackMenu, 'agy-file-context-menu'));
  assert.ok(findById(fallbackMenu, 'agy-file-open-with'));
  assert.equal(findById(fallbackMenu, 'agy-file-attach-side-question').props.icon.props.name, 'chat_bubble');

  // 5. Disabling codexStyle on inline chat image falls back cleanly to upstream MediaContextMenu
  const rawImg = { tagName: 'IMG', currentSrc: 'data:image/png;base64,AA==', closest: () => null };
  currentResolved = { kind: 'inline-media', uri: '', isMedia: true, source: rawImg };
  ctxListener({ clientX: 210, clientY: 230, target: rawImg, preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  const mediaMenu = expandTree(renderedMenus.at(-1));
  assert.ok(findById(mediaMenu, 'agy-media-context-menu'));

  await new Promise(r => setTimeout(r, 20));
  p.context.__agyPowertools.dispose();
  await new Promise(r => setTimeout(r, 10));
});

test('theme-adaptive delegated tooltip lazily mounts, adapts to light/dark CSS, clamps viewport, and cleans up on dispose', () => {
  const listeners = new Map();
  const timers = [];
  const created = [];
  const makeEl = tag => {
    const attrs = new Map();
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      children: [],
      isConnected: false,
      offsetWidth: 260,
      offsetHeight: 64,
      append(...items) { for (const c of items) { c.isConnected = true; this.children.push(c); } },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight }; },
      remove() { this.isConnected = false; }
    };
    return el;
  };
  const body = makeEl('body'); body.isConnected = true;
  const head = makeEl('head'); head.isConnected = true;
  const docAttrs = new Set();
  const doc = {
    readyState: 'complete',
    head,
    body,
    documentElement: {
      clientWidth: 1000,
      clientHeight: 700,
      toggleAttribute(name, force) { if (force === undefined ? !docAttrs.has(name) : force) docAttrs.add(name); else docAttrs.delete(name); },
      removeAttribute(name) { docAttrs.delete(name); },
      hasAttribute(name) { return docAttrs.has(name); }
    },
    createElement(tag) { const el = makeEl(tag); created.push(el); return el; },
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      opts?.signal?.addEventListener?.('abort', () => {
        const list = listeners.get(type) || [];
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }, { once: true });
    },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const fire = (type, evt) => { for (const fn of [...(listeners.get(type) || [])]) fn(evt); };
  let nextTid = 1;
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: '/' },
    innerWidth: 1000,
    innerHeight: 700,
    AbortController,
    React: { createElement() { return {}; } },
    ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } },
    HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (fn, ms) => { const entry = { id: nextTid++, fn, ms, cleared: false }; timers.push(entry); return entry.id; },
    clearTimeout: id => { const found = timers.find(t => t.id === id); if (found) found.cleared = true; }
  });
  vm.runInContext(source, ctx);

  // Lazy creation: only densityStyle exists at boot, with both light and .dark rules
  assert.equal(created.length, 1);
  assert.match(created[0].textContent, /\.pt-tip-pop\{[^}]*background:var\(--card\)[^}]*color:var\(--foreground\)/);
  assert.match(created[0].textContent, /\.dark \.pt-tip-pop\{/);
  assert.match(created[0].textContent, /\.pt-tip-pop\[data-mono=true\]\{/);

  const makeHost = (attrsMap, rect) => {
    const attrs = new Map(Object.entries(attrsMap));
    const host = {
      isConnected: true,
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: k => attrs.delete(k),
      closest: sel => (sel === '[data-pt-tip]' ? host : null),
      getBoundingClientRect: () => rect
    };
    return host;
  };
  const trailNode = makeHost(
    { 'data-pt-tip': 'npm test && node scripts/build-release.mjs', 'data-pt-tip-mono': 'true', 'data-pt-tip-place': 'left' },
    { left: 760, right: 980, top: 320, bottom: 344, width: 220, height: 24 }
  );
  const cellNode = makeHost(
    { 'data-pt-tip': '2026-11-25: 1.2M', 'aria-describedby': 'existing-desc' },
    { left: 20, right: 32, top: 12, bottom: 24, width: 12, height: 12 }
  );

  // Cold hover waits for 180ms intent delay before creating/opening the portal
  fire('pointerover', { target: trailNode });
  assert.equal(created.length, 1);
  const tipTimer = timers.find(t => !t.cleared && t.ms === 180);
  assert.ok(tipTimer);
  tipTimer.fn();

  const pop = body.children.find(c => c.className === 'pt-tip-pop');
  assert.ok(pop);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.dataset.mono, 'true');
  assert.equal(pop.getAttribute('role'), 'tooltip');
  assert.equal(pop.children[0].textContent, 'npm test && node scripts/build-release.mjs');
  assert.equal(trailNode.getAttribute('aria-describedby'), 'agy-pt-tip-pop');
  // Left placement from x=760 with width=260 and gap=8 -> x=492, cleanly within [10, 730]
  assert.equal(pop.style.left, '492px');

  // Moving directly to another tooltip host transitions immediately without waiting, clears mono, clamps top->bottom, preserves existing aria-describedby
  fire('pointerout', { target: trailNode, relatedTarget: cellNode });
  assert.equal(trailNode.getAttribute('aria-describedby'), null);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.dataset.mono, undefined);
  assert.equal(pop.children[0].textContent, '2026-11-25: 1.2M');
  assert.equal(cellNode.getAttribute('aria-describedby'), 'existing-desc');
  assert.equal(pop.style.top, '32px');
  assert.equal(pop.style.left, '10px');

  // Escape and pointerdown hide immediately; dispose removes portal
  fire('keydown', { key: 'Escape' });
  assert.equal(pop.dataset.open, 'false');
  fire('focusin', { target: trailNode });
  assert.equal(pop.dataset.open, 'true');
  fire('pointerdown', { target: trailNode });
  assert.equal(pop.dataset.open, 'false');

  ctx.__agyPowertools.dispose();
  assert.equal(pop.isConnected, false);
});

test('native-panels and native-ui replace raw HTML/SVG title tooltips with theme-adaptive data-pt-tip attributes', () => {
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const uiSrc = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  assert.equal(panelsSrc.includes("h('title'"), false);
  assert.match(panelsSrc, /pt-trail-node'[^\n]*'data-pt-tip':call\.detail\|\|call\.label,'data-pt-tip-mono':call\.detail\?'true':undefined,'data-pt-tip-place':'left'/);
  assert.match(panelsSrc, /pt-donut-segment[^\n]*'data-pt-tip':segTip,'aria-label':segTip/);
  assert.match(uiSrc, /'data-testid': 'agy-context-ring-trigger',\s*'data-pt-tip':/);
  assert.match(uiSrc, /'data-testid': 'agy-subagent-badge',\s*'data-subagent-id': subId,\s*'data-pt-tip':/);
});


test('chat image right-click opens MediaContextMenu with attach, copy, and save actions while ignoring file icons', async () => {
  const listeners = new Map();
  let renderedTree = null;
  const attached = [];
  const makeEl = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    isConnected: true,
    children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    remove() { this.isConnected = false; },
    click() { this.clicked = true; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const doc = {
    readyState: 'complete',
    head: makeEl('head'),
    body: makeEl('body'),
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: tag => makeEl(tag),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const wrapTag = tag => ({ children, ...p }) => h(tag, p, ...(Array.isArray(children) ? children : [children]));
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
    location: { pathname: '/c/conv-img', href: 'http://127.0.0.1/' },
    AbortController,
    Blob,
    File: class MockFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type || ''; this.size = 4; } },
    atob,
    btoa,
    TextEncoder,
    React: { createElement: h, Fragment: 'fragment', useState: v => [typeof v === 'function' ? v() : v, () => {}], useLayoutEffect: () => {}, useEffect: () => {} },
    ReactDOM: { createRoot: () => ({ render(tree) { renderedTree = tree; }, unmount() {} }) },
    HC: wrapTag('HC'), IC: wrapTag('IC'), JC: wrapTag('JC'), KC: wrapTag('KC'), GC: wrapTag('GC'), dq: wrapTag('dq'),
    __agyNativeAdapter: {
      wrap: el => el,
      attachFileToComposer: async info => { attached.push(info); return { ok: true }; },
      fileTreeEntry: () => null,
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyInitialSettings: { enabled: true, fileContextMenu: true, codexStyle: false },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(source, ctx);

  const fireContextMenu = target => {
    let prevented = false, stopped = false;
    for (const fn of listeners.get('contextmenu') || []) {
      fn({ target, clientX: 120, clientY: 160, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    }
    return { prevented, stopped };
  };

  // 1. File-type icon (/symbols-icons/...) must NOT trigger MediaContextMenu
  const iconImg = {
    getAttribute: k => (k === 'src' ? '/symbols-icons/icons/files/js.svg' : null),
    closest: sel => (sel.includes('file://') ? null : sel.includes('agent-response') ? {} : sel === 'img' ? iconImg : null)
  };
  assert.equal(fireContextMenu(iconImg).prevented, false);

  // 2. Real user-uploaded JPEG image (even with mislabeled data:image/png header) opens MediaContextMenu
  // Minimal JPEG magic bytes FF D8 FF E0 + 8 bytes -> base64 "/9j/4AAAAAAAAAAA"
  const chatImg = {
    alt: 'User uploaded media 1',
    getAttribute: k => (k === 'src' ? 'data:image/png;base64,/9j/4AAAAAAAAAAA' : null),
    closest: sel => {
      if (sel.includes('file://')) return null;
      if (sel.includes('user-input-step')) return { dataset: { testid: 'user-input-step' } };
      if (sel === 'img') return chatImg;
      return null;
    }
  };
  const res = fireContextMenu(chatImg);
  assert.equal(res.prevented, true);
  assert.equal(res.stopped, true);
  assert.ok(renderedTree);

  // Render MediaContextMenu node and trigger "引用到输入框"
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: (node.children || []).map(expand) };
  };
  const findTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['data-testid'] === id) return node;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTestId(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const menuTree = expand(renderedTree);
  assert.ok(findTestId(menuTree, 'agy-media-context-menu'));
  const attachBtn = findTestId(menuTree, 'agy-media-attach-chat');
  assert.ok(attachBtn);
  assert.ok(findTestId(menuTree, 'agy-media-copy-image'));
  assert.ok(findTestId(menuTree, 'agy-media-save-image'));
  await attachBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.equal(attached.length, 1);
  assert.equal(attached[0].mode, 'media');
  assert.equal(attached[0].mimeType, 'image/jpeg');
  assert.match(attached[0].name, /\.jpg$/);
  assert.equal(attached[0].base64, '/9j/4AAAAAAAAAAA');

  ctx.__agyPowertools.dispose();
});


test('response toolbar Copy button overrides clipboard with only the final response while preserving native check animation (Issue #50)', async () => {
  const listeners = new Map();
  const copiedValues = [];
  const makeEl = () => ({ dataset: {}, style: {}, className: '', isConnected: true, children: [], append() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const doc = {
    readyState: 'complete',
    head: makeEl(),
    body: makeEl(),
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: () => makeEl(),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const clipProto = { writeText: async text => { copiedValues.push(text); } };
  const clipboard = Object.create(clipProto);
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard },
    location: { pathname: '/c/conv-copy' },
    AbortController,
    React: { createElement: () => null },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyNativeAdapter: {
      wrap: el => el,
      finalResponseText: () => ({ finalText: 'Final clean answer only.', hasIntermediate: true }),
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyInitialSettings: { enabled: true, stageUpdates: true },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(source, ctx);

  const copyBtn = { closest: sel => (sel.includes('cascade-system-message-toolbar') ? copyBtn : null) };
  for (const fn of listeners.get('click') || []) fn({ target: copyBtn });
  // Simulate native onClick writing full turn (intermediate updates + tool logs + final answer)
  await clipboard.writeText('Intermediate update...\nRan npm test\nFinal clean answer only.');
  assert.deepEqual(copiedValues, ['Final clean answer only.']);

  // Normal unrelated clipboard copies are untouched
  await clipboard.writeText('Normal copy text');
  assert.deepEqual(copiedValues, ['Final clean answer only.', 'Normal copy text']);

  ctx.__agyPowertools.dispose();
  assert.equal(Object.prototype.hasOwnProperty.call(clipboard, 'writeText'), false);
});


test('auto-switch waits for background running tabs and interactive banner supports target override, pause/resume, and immediate switch', async () => {
  let runningIds = ['bg-conv-1'];
  const switchedCalls = [];
  const intervals = [];
  const makeEl = tag => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      value: '',
      children: [],
      listeners: new Map(),
      isConnected: true,
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); return item; },
      remove() { this.isConnected = false; },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    return el;
  };
  const body = makeEl('body');
  const doc = {
    readyState: 'complete',
    head: makeEl('head'),
    body,
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: tag => makeEl(tag),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const candA = { id: 'acct-b', email: 'b@example.com', alias: '备用号B' };
  const candB = { id: 'acct-c', email: 'c@example.com', alias: '备用号C' };
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/c/active-conv' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyInitialSettings: { enabled: true, multiAccount: true, autoSwitchAccount: true },
    __agyNativeAdapter: {
      wrap: el => el,
      executionState: () => ({ conversationId: 'active-conv', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({ email: 'a@example.com', model: 'Claude Opus 5.5', models: [{ modelId: 'Claude Opus 5.5' }] }),
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: { groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', remainingFraction: 0, resetTimeMs: Date.now() + 3600_000 }] }] }
        })
      }),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, multiAccount: true, autoSwitchAccount: true });
      else if (msg.method === 'accounts.list' || msg.method === 'accounts.syncActive') {
        ctx.__agyPowertoolsReceive(msg.id, { activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA, candB] });
      } else if (msg.method === 'accounts.autoSwitchCandidate') {
        assert.equal(msg.activeModel, 'Claude Opus 5.5');
        ctx.__agyPowertoolsReceive(msg.id, { candidate: candA, candidates: [candA, candB], cooldownRemainingMs: 0 });
      } else if (msg.method === 'accounts.switch') {
        switchedCalls.push(msg);
        ctx.__agyPowertoolsReceive(msg.id, { ok: true, relaunching: true });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // 1. Background tab 'bg-conv-1' is running -> banner must NOT appear yet
  assert.equal(body.children.some(c => c.dataset?.testid === 'agy-autoswitch-banner'), false);

  // 2. Once background tab finishes, next poll opens interactive banner with target dropdown & buttons
  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  assert.ok(mainPoll);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const banner = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner, 'expected interactive autoswitch banner');

  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  const select = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-select');
  const menu = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-menu');
  const optC = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-option-acct-c');
  const pauseBtn = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-pause');
  const nowBtn = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-now');
  assert.ok(select && menu && optC && pauseBtn && nowBtn);
  assert.equal(select.tagName, 'BUTTON', 'auto-switch banner must use custom Antigravity dropdown rather than native <select>');
  assert.equal(walk(banner, n => n.tagName === 'SELECT'), null);

  // Open custom picker, select candB (acct-c), and pause countdown
  for (const fn of select.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of optC.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of pauseBtn.listeners.get('click') || []) fn();
  const countdownTick = intervals.find(i => i.ms === 1000 && !i.cleared);
  for (let i = 0; i < 10; i++) countdownTick.fn();
  assert.equal(switchedCalls.length, 0, 'paused countdown must not switch');

  // Click Switch Now while another background tab starts running -> defers while preserving depletedGroupKey ('claude')
  runningIds = ['bg-conv-2'];
  for (const fn of nowBtn.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 0);

  // Once background tab finishes, deferred resume re-queries candidates with preserved group key and lets us switch
  runningIds = [];
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const banner2 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner2, 'deferred banner must reappear once background tasks finish');
  const optC2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-target-option-acct-c');
  const nowBtn2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of optC2.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of nowBtn2.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 1);
  assert.equal(switchedCalls[0].accountId, 'acct-c');

  ctx.__agyPowertools.dispose();
});

test('Codex UI hides disabled response toolbar during mid-turn follow-up and renders composer annotation pill cleanly', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const docListeners = new Map();
  const styles = [];
  let onQuotesChangeCb = null;
  let quotes = [{ id: 'q-1', text: '第一段引用文本', isCodeBlock: false }];
  const flushCalls = [];
  const removedIds = [];
  let clearCount = 0;

  const makeEl = (tag = 'div') => {
    const el = {
      tagName: tag.toUpperCase(),
      dataset: {},
      style: {},
      className: '',
      isConnected: true,
      children: [],
      parentElement: null,
      attributes: new Map(),
      classList: {
        contains: cls => String(el.className || '').split(/\s+/).includes(cls)
      },
      get firstChild() { return el.children[0] || null; },
      get firstElementChild() { return el.children[0] || null; },
      get nextSibling() {
        if (!el.parentElement) return null;
        const idx = el.parentElement.children.indexOf(el);
        return idx >= 0 ? el.parentElement.children[idx + 1] || null : null;
      },
      append(...nodes) {
        for (const n of nodes) {
          if (!n || typeof n === 'string') continue;
          n.parentElement = el;
          n.isConnected = true;
          el.children.push(n);
        }
      },
      appendChild(n) { el.append(n); return n; },
      insertBefore(n, before) {
        if (n.parentElement) {
          const oldIdx = n.parentElement.children.indexOf(n);
          if (oldIdx >= 0) n.parentElement.children.splice(oldIdx, 1);
        }
        n.parentElement = el;
        n.isConnected = true;
        const idx = before ? el.children.indexOf(before) : -1;
        if (idx >= 0) el.children.splice(idx, 0, n);
        else el.children.push(n);
        return n;
      },
      remove() {
        if (el.parentElement) {
          const idx = el.parentElement.children.indexOf(el);
          if (idx >= 0) el.parentElement.children.splice(idx, 1);
          el.parentElement = null;
        }
        el.isConnected = false;
      },
      setAttribute(k, v) { el.attributes.set(k, String(v)); },
      getAttribute(k) { return el.attributes.has(k) ? el.attributes.get(k) : (k === 'data-agy-powertools-root' ? el.dataset.agyPowertoolsRoot || null : null); },
      removeAttribute(k) { el.attributes.delete(k); },
      hasAttribute(k) { return el.attributes.has(k); },
      toggleAttribute(k, f) { const on = f == null ? !el.hasAttribute(k) : Boolean(f); if (on) el.setAttribute(k, ''); else el.removeAttribute(k); return on; },
      matches(sel) {
        return sel.split(',').some(part => {
          const s = part.trim();
          if (s === '.surface-composer-card') return el.classList.contains('surface-composer-card');
          if (s === '[contenteditable="true"]') return el.getAttribute('contenteditable') === 'true';
          if (s === '[data-testid="send-button"]') return el.dataset.testid === 'send-button';
          if (s === '[data-testid="input-attachment"]') return el.dataset.testid === 'input-attachment';
          if (s === '.relative.w-full') return el.classList.contains('relative') && el.classList.contains('w-full');
          return false;
        });
      },
      closest(sel) {
        for (let cur = el; cur; cur = cur.parentElement) if (cur.matches?.(sel)) return cur;
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const visit = n => {
          for (const c of n.children || []) {
            if (c.matches?.(sel)) out.push(c);
            visit(c);
          }
        };
        visit(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; }
    };
    return el;
  };

  const head = makeEl('head');
  const body = makeEl('body');
  const docEl = makeEl('html');
  docEl.style = { setProperty() {}, removeProperty() {} };

  const card = makeEl('div'); card.className = 'surface-composer-card';
  const inner = makeEl('div'); inner.className = 'relative w-full';
  const editorWrap = makeEl('div');
  const editable = makeEl('div'); editable.setAttribute('contenteditable', 'true');
  const sendBtn = makeEl('button'); sendBtn.dataset.testid = 'send-button'; sendBtn.disabled = true; sendBtn.setAttribute('disabled', '');
  editorWrap.append(editable, sendBtn);
  inner.append(editorWrap);
  card.append(inner);
  body.append(card);

  const renderedRoots = new Map();
  let curState = false;
  const expandVnode = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expandVnode(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: (node.children || []).map(expandVnode) };
  };
  const findTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['data-testid'] === id) return node;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTestId(c, id);
      if (hit) return hit;
    }
    return null;
  };

  const doc = {
    readyState: 'complete',
    head,
    body,
    documentElement: docEl,
    createElement(tag) {
      const n = makeEl(tag);
      if (tag === 'style') styles.push(n);
      return n;
    },
    addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
    removeEventListener() {},
    querySelectorAll: sel => body.querySelectorAll(sel),
    querySelector: sel => body.querySelector(sel)
  };

  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280 },
    navigator: {},
    location: { pathname: '/' },
    AbortController,
    React: {
      Fragment: Symbol('Fragment'),
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
      useState: init => [curState, val => { curState = typeof val === 'function' ? val(curState) : val; }],
      useRef: init => ({ current: init }),
      useEffect: () => {}
    },
    ReactDOM: {
      createRoot: mount => {
        const rec = {
          mount,
          vnode: null,
          render(tree) { rec.vnode = tree; },
          unmount() { rec.vnode = null; }
        };
        renderedRoots.set(mount, rec);
        return rec;
      }
    },
    HC: () => null,
    __agyNativeAdapter: {
      wrap: el => el,
      executionState: () => null,
      capabilities: () => ({}),
      getComposerQuotes: target => target === card ? [...quotes] : [],
      removeComposerQuote: (_target, id) => { removedIds.push(id); quotes = quotes.filter(q => q.id !== id); onQuotesChangeCb?.(); return true; },
      clearComposerQuotes: () => { clearCount++; quotes = []; onQuotesChangeCb?.(); return true; },
      flushComposerQuotesToEditor: target => { flushCalls.push(target); quotes = []; onQuotesChangeCb?.(); return 1; },
      onComposerQuotesChange: fn => { onQuotesChangeCb = fn; return () => { onQuotesChangeCb = null; }; },
      setEnabled() {}, setStageUpdates() {}, setCodexProgress() {}, setCodexComposerMedia() {}, setUiLanguage() {}, setHdImages() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, codexStyle: true });
      else ctx.__agyPowertoolsReceive(msg.id, {});
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // 1. Density style hides disabled response toolbar during mid-turn follow-up & removes composer media bottom border
  const css = styles.map(s => s.textContent || '').join('\n');
  assert.match(css, /fieldset\[disabled\]:has\(\[data-testid="cascade-system-message-toolbar"\]\)\{display:none!important\}/);
  assert.match(css, /border-bottom:0!important/);
  assert.match(css, /\[data-agy-powertools-root="composer-quotes"\]\{order:10/);
  assert.match(css, /div\.my-2\.rounded-xl\.bg-muted.*border-radius:12px/);
  assert.match(css, /\[data-testid="quote-scope-pill"\],\[data-testid="side-question-quote-pill"\]/);
  assert.match(css, /\[data-testid="cascade-system-message-toolbar"\]:not\(:has\(\[data-testid="idle-status-text"\]\)\) > div:has\(button\[aria-label="Copy"\]/);
  assert.match(css, /\.animate-shimmer-text > \.shimmer-text-mask/);
  assert.match(css, /:is\(\[data-step-index\],\[data-step-index\] > \.min-w-0\) > :is\(\.relative,\.w-full > \.relative\) > button\[aria-expanded\]/);

  // 2. Annotation pill mounts above editor with '1 条注释' and opens popover on click
  const quoteMount = inner.children.find(c => c.dataset?.agyPowertoolsRoot === 'composer-quotes');
  assert.ok(quoteMount);
  assert.equal(card.getAttribute('data-agy-has-quotes'), '1');
  let tree = expandVnode(renderedRoots.get(quoteMount).vnode);
  const pillBtn = findTestId(tree, 'agy-composer-annotations-pill');
  assert.ok(pillBtn);
  assert.match(JSON.stringify(pillBtn), /1 条注释/);
  pillBtn.props.onClick({ preventDefault() {}, stopPropagation() {} });
  tree = expandVnode(renderedRoots.get(quoteMount).vnode);
  assert.ok(findTestId(tree, 'agy-composer-annotations-popover'));

  // 3. Adding image attachment reparents annotation pill inside mediaRow (order: 10 keeps images on the left)
  const mediaRow = makeEl('div');
  const att = makeEl('div'); att.dataset.testid = 'input-attachment';
  mediaRow.append(att);
  inner.insertBefore(mediaRow, editorWrap);
  quotes = [
    { id: 'q-1', text: '第一段引用文本', isCodeBlock: false },
    { id: 'q-2', text: 'const y = 2;', isCodeBlock: true }
  ];
  onQuotesChangeCb();
  assert.equal(quoteMount.parentElement, mediaRow);
  tree = expandVnode(renderedRoots.get(quoteMount).vnode);
  assert.match(JSON.stringify(findTestId(tree, 'agy-composer-annotations-pill')), /2 条注释/);

  // 4. Removing item and clearing work
  findTestId(tree, 'agy-composer-annotation-remove').props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(removedIds, ['q-1']);
  assert.equal(quotes.length, 1);

  // 5. Pressing Enter on contenteditable or clicking Send flushes remaining quote and unlocks disabled button
  for (const fn of docListeners.get('keydown') || []) {
    fn({ key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, target: editable });
  }
  assert.equal(flushCalls.length, 1);
  assert.equal(flushCalls[0], card);

  quotes = [{ id: 'q-3', text: '发送前待插入', isCodeBlock: false }];
  onQuotesChangeCb();
  for (const fn of docListeners.get('pointerdown') || []) {
    fn({ type: 'pointerdown', button: 0, target: sendBtn });
  }
  assert.equal(flushCalls.length, 2);
  assert.equal(sendBtn.disabled, false);

  // Clean clear works too
  quotes = [{ id: 'q-4', text: '待清空', isCodeBlock: false }];
  onQuotesChangeCb();
  tree = expandVnode(renderedRoots.get(quoteMount).vnode);
  findTestId(tree, 'agy-composer-annotations-clear').props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(clearCount, 1);

  ctx.__agyPowertools.dispose();
});

test('Right-clicking model-selector-trigger opens Thinking effort picker for multi-tier models and is no-op otherwise', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const docListeners = new Map();
  const selectedEfforts = [];
  let activePicker = null;
  const renderedMenus = [];
  let lastMount = null;

  const triggerBtn = {
    dataset: { testid: 'model-selector-trigger' },
    getBoundingClientRect: () => ({ left: 120, top: 680, right: 280, bottom: 708, width: 160, height: 28 }),
    closest: sel => (sel === '[data-testid="model-selector-trigger"]' ? triggerBtn : null)
  };
  const labelChild = {
    closest: sel => (sel === '[data-testid="model-selector-trigger"]' ? triggerBtn : null)
  };

  const makeEl = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    isConnected: true,
    children: [],
    append() {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    hasAttribute: () => false,
    toggleAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const body = makeEl('body');
  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      head: makeEl('head'),
      body,
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: tag => makeEl(tag),
      addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
    navigator: {},
    location: { pathname: '/' },
    AbortController,
    React: {
      Fragment: Symbol('Fragment'),
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
      useState: init => [typeof init === 'function' ? init() : init, () => {}],
      useRef: init => ({ current: init }),
      useEffect: () => {}
    },
    ReactDOM: {
      createRoot: mount => ({
        render(vnode) { lastMount = mount; renderedMenus.push(vnode); },
        unmount() { lastMount = null; }
      })
    },
    HC: () => null,
    __agyNativeAdapter: {
      wrap: el => el,
      executionState: () => null,
      capabilities: () => ({}),
      modelEffortPicker: el => (el === triggerBtn ? activePicker : null),
      setEnabled() {}, setStageUpdates() {}, setCodexProgress() {}, setCodexComposerMedia() {}, setUiLanguage() {}, setHdImages() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, codexStyle: true });
      else ctx.__agyPowertoolsReceive(msg.id, {});
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const fireCtx = target => {
    let prevented = false, stopped = false;
    for (const fn of docListeners.get('contextmenu') || []) {
      fn({
        target,
        clientX: 150,
        clientY: 690,
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
      });
    }
    return { prevented, stopped };
  };

  // 1. Single-tier model (activePicker = null) -> completely no-op
  const noopRes = fireCtx(labelChild);
  assert.equal(noopRes.prevented, false);
  assert.equal(noopRes.stopped, false);
  assert.equal(renderedMenus.length, 0);

  // 2. Multi-tier model -> opens Thinking effort picker and selects tier
  activePicker = {
    baseLabel: 'Gemini 4 Hydrogen',
    currentEffort: 'medium',
    options: [
      { effort: 'low', label: 'Low', selected: false },
      { effort: 'medium', label: 'Medium', selected: true, quotaLow: true },
      { effort: 'high', label: 'High', selected: false, quotaExhausted: true },
      { effort: 'xhigh', label: 'Extra', selected: false }
    ],
    select: eff => { selectedEfforts.push(eff); return true; }
  };
  const openRes = fireCtx(labelChild);
  assert.equal(openRes.prevented, true);
  assert.equal(openRes.stopped, true);
  assert.equal(renderedMenus.length, 1);

  const expandVnode = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expandVnode(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: (node.children || []).map(expandVnode) };
  };
  const findAllTestId = (node, id, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (node.props?.['data-testid'] === id) out.push(node);
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) findAllTestId(c, id, out);
    return out;
  };
  const tree = expandVnode(renderedMenus[0]);
  const menuNode = findAllTestId(tree, 'agy-model-effort-menu')[0];
  assert.ok(menuNode);
  const optionNodes = findAllTestId(tree, 'agy-model-effort-option');
  assert.equal(optionNodes.length, 4);
  assert.equal(optionNodes[1].props['aria-checked'], 'true');
  assert.equal(optionNodes[1].props['data-effort'], 'medium');

  const xhighBtn = optionNodes.find(n => n.props['data-effort'] === 'xhigh');
  xhighBtn.props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(selectedEfforts, ['xhigh']);
  assert.equal(lastMount, null);

  ctx.__agyPowertools.dispose();
});

test('native-ui auto-switch resets switchingInProgress when relaunching is false without manualRestartRequired and preserves depletedGroupKey on deferral', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const intervals = [];
  const candidateGroupKeys = [];
  const switchedCalls = [];
  let runningIds = [];
  let switchReply = { ok: true, unchanged: true, relaunching: false, manualRestartRequired: false };
  const makeEl = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    children: [],
    listeners: new Map(),
    isConnected: true,
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    remove() { this.isConnected = false; },
    contains() { return false; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const body = makeEl('body');
  const candA = { id: 'acct-b', email: 'b@example.com', alias: '备用号B' };
  let capturedEnv = null;
  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      head: makeEl('head'),
      body,
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: tag => makeEl(tag),
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/c/active-conv' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyPanels: env => { capturedEnv = env; return { dispose() {} }; },
    __agyInitialSettings: { enabled: true, multiAccount: true, autoSwitchAccount: true },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'active-conv', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({ email: 'a@example.com', model: 'Claude Opus 5.5', models: [{ modelId: 'Claude Opus 5.5' }] }),
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: { groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', remainingFraction: 0, resetTimeMs: Date.now() + 3600_000 }] }] }
        })
      }),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, multiAccount: true, autoSwitchAccount: true });
      else if (msg.method === 'accounts.list' || msg.method === 'accounts.syncActive') {
        ctx.__agyPowertoolsReceive(msg.id, { activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA] });
      } else if (msg.method === 'accounts.autoSwitchCandidate') {
        candidateGroupKeys.push(msg.depletedGroupKey);
        ctx.__agyPowertoolsReceive(msg.id, { candidate: candA, candidates: [candA], cooldownRemainingMs: 0 });
      } else if (msg.method === 'accounts.switch') {
        switchedCalls.push(msg);
        ctx.__agyPowertoolsReceive(msg.id, switchReply);
      } else if (msg.method === 'accounts.refreshLocalQuotas') {
        ctx.__agyPowertoolsReceive(msg.id, { ok: true, activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA] });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.ok(capturedEnv);

  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  const banner1 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner1);
  assert.equal(candidateGroupKeys.at(-1), 'claude');

  // 1. Trigger Switch Now while runningIds becomes non-empty -> defers preserving 'claude'
  runningIds = ['bg-1'];
  const now1 = walk(banner1, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of now1.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 0);

  // 2. Resume after background task ends -> must pass 'claude' (NOT '') to accounts.autoSwitchCandidate!
  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(candidateGroupKeys.at(-1), 'claude', 'deferred auto-switch must preserve depletedGroupKey');

  // 3. Switch returns unchanged / relaunching: false without manualRestartRequired -> MUST NOT wedge switchingInProgress!
  const banner2 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner2);
  const now2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of now2.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 1);

  // Prove switchingInProgress was cleanly reset: refreshAccountQuotas succeeds instead of skipping!
  const postRefresh = await capturedEnv.refreshAccountQuotas();
  assert.equal(postRefresh.ok, true);
  assert.notEqual(postRefresh.skipped, true);
  ctx.__agyPowertools.dispose();
});

test('long-conversation polling skips ring re-renders, completed response fiber walks, and unchanged refresh mounts (Issue #51)', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-long-51';
  const intervals = [];
  let fakeNow = 1_795_700_000_000;
  p.context.Date = class extends Date { static now() { return fakeNow; } };
  p.context.setInterval = (fn, ms) => { const entry = { fn, ms }; intervals.push(entry); return intervals.length; };
  p.context.clearInterval = () => {};

  let ringRenders = 0;
  let fiberWalks = 0;
  const card = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const flexParent = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Carbon',
    parentElement: flexParent,
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  const actionRow = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const copyBtn = { parentElement: actionRow, closest: () => null };
  const scopeEl = { querySelector: sel => sel === '[aria-label="Bad response"]' ? copyBtn : null, querySelectorAll: () => [] };
  const responseEl = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(n) { n.isConnected = true; this.children.unshift(n); },
    closest: sel => sel === '[data-turn-content]' ? scopeEl : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [model];
    if (sel === '[data-testid="agent-response"]') return [responseEl];
    return [];
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.HU = m => m?.index;
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render() { if (mount.dataset?.agyPowertoolsRoot === 'ring') ringRenders++; },
        unmount() {}
      };
    }
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-long-51';
  p.context.__agyNativeAdapter.fiber = () => {
    fiberWalks++;
    return { memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null };
  };

  let stateVersion = 1;
  let stateRequests = 0;
  const makeStateReply = () => ({
    conversationId: 'conv-long-51',
    modelName: 'Gemini 4 Carbon',
    costUsd: 0.12,
    contextWindow: { usedTokens: 42000 * stateVersion, maxTokens: 1000000, usedPercent: 4.2 * stateVersion, inputTokens: 1000, cacheReadTokens: 41000, categories: [] },
    telemetry: { turnCount: 1, stepCount: 5, totalTokens: 45000 * stateVersion, requestCount: 2, errorCount: 0, toolCount: 1, tps: 88, latestTps: 88, cacheHitPercent: 97.6 },
    progress: { status: 'complete', phase: 'done', phaseDetail: '', toolCount: 1, recentActivity: [], tasks: [] },
    turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 4, status: 'complete', completedAtIso: '2026-11-25T00:00:00Z', durationMs: 4200, toolCalls: [] }],
    requests: [{ id: 'req-1', timestampMs: 1_795_699_995_000 }],
    errors: [],
    settings: { enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' }
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' });
      else if (req.method === 'state') { stateRequests++; p.context.__agyPowertoolsReceive(req.id, makeStateReply()); }
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  const initialRingRenders = ringRenders;
  const initialFiberWalks = fiberWalks;
  const initialStateReqs = stateRequests;
  assert.ok(initialRingRenders >= 1);
  assert.equal(initialFiberWalks, 1);

  const mainPoll = intervals.find(i => i.ms === 2000);
  assert.ok(mainPoll);

  // Idle poll within 6s skips state IPC completely
  fakeNow += 2000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 15));
  assert.equal(stateRequests, initialStateReqs);

  // Idle poll after 6s fetches a brand-new JSON object with identical values -> 0 new ring renders and 0 new fiber walks
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(stateRequests, initialStateReqs + 1);
  assert.equal(ringRenders, initialRingRenders);
  assert.equal(fiberWalks, initialFiberWalks);

  // When token usage actually changes, ring re-renders once while completed historical turn still skips fiber walk!
  stateVersion = 2;
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ringRenders, initialRingRenders + 1);
  assert.equal(fiberWalks, initialFiberWalks);

  p.context.__agyPowertools.dispose();
});

test('SSH remote window hides local AccountSwitcher, preserves native settings button, and skips accounts.syncActive (Issue #57)', async () => {
  const p = page(true);
  p.context.sshRemote = { kind: 'ssh', host: 'devbox' };
  const calls = [];
  let mountedSwitcher = 0;
  const settingsParent = { children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const settingsBtn = { isConnected: true, parentElement: settingsParent, nextSibling: null };
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render() { if (mount.dataset?.agyPowertoolsRoot === 'account-switcher') mountedSwitcher++; },
        unmount() {}
      };
    }
  };
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'remote@example.com', name: 'Remote User' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({ response: { groups: [] } })
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req.method);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, accountSwitcher: true });
      else p.context.__agyPowertoolsReceive(req.id, { ok: true, estimates: [] });
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  assert.equal(mountedSwitcher, 0);
  assert.equal(calls.includes('accounts.syncActive'), false);
  assert.equal(calls.includes('accounts.list'), false);
  p.context.__agyPowertools.dispose();
});

test('auto-check update banner shows one-click update/dismiss and optional autoInstallUpdates waits for idle same-major only (Issue #45)', async () => {
  const timeouts = [];
  const calls = [];
  let runningIds = ['busy-conv-1'];
  let remoteReply = {
    status: 'available',
    version: '1.2.0',
    releaseUrl: 'https://github.com/WhiteBr1ck/agy-powertools/releases/tag/v1.2.0',
    notes: '## 中文说明\n- **体验优化**：新增低频自动查更新与轻量提醒',
    canInstall: true,
    dismissedVersion: '',
    clientUpgraded: false
  };
  const makeEl = tag => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      children: [],
      listeners: new Map(),
      isConnected: true,
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); return item; },
      remove() { this.isConnected = false; },
      setAttribute() {},
      getAttribute: () => null,
      removeAttribute() {},
      addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    return el;
  };
  const body = makeEl('body');
  const intervals = [];
  const settings = { enabled: true, autoCheckUpdates: true, autoInstallUpdates: false, language: 'zh-CN' };
  let capturedEnv = null;
  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      head: makeEl('head'),
      body,
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: tag => makeEl(tag),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: 'Antigravity/2.36.0' },
    location: { pathname: '/c/conv-upd' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyPanels: env => { capturedEnv = env; return { dispose() {} }; },
    __agyInitialSettings: { ...settings },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'conv-upd', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      calls.push(msg);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { ...settings });
      else if (msg.method === 'settings.set') { Object.assign(settings, msg.settings); ctx.__agyPowertoolsReceive(msg.id, { ...settings }); }
      else if (msg.method === 'update.autoCheck') ctx.__agyPowertoolsReceive(msg.id, { ...remoteReply });
      else if (msg.method === 'update.dismiss') { remoteReply.dismissedVersion = msg.version; ctx.__agyPowertoolsReceive(msg.id, { ...remoteReply }); }
      else if (msg.method === 'update.install') ctx.__agyPowertoolsReceive(msg.id, { status: 'preparing', version: msg.version });
      else if (msg.method === 'update.status') ctx.__agyPowertoolsReceive(msg.id, { status: 'completed', version: '1.2.0' });
      else ctx.__agyPowertoolsReceive(msg.id, {});
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: (fn, ms) => { const item = { fn, ms, cleared: false }; timeouts.push(item); return timeouts.length; },
    clearTimeout: id => { if (timeouts[id - 1]) timeouts[id - 1].cleared = true; }
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));

  // Trigger startup 15s update check timer
  const startupCheck = timeouts.find(t => t.ms === 15000 && !t.cleared);
  assert.ok(startupCheck);
  startupCheck.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const autoReq = calls.find(c => c.method === 'update.autoCheck');
  assert.ok(autoReq);
  assert.equal(autoReq.clientVersion, '2.36.0');
  const banner = body.children.find(c => c.dataset?.testid === 'agy-update-prompt-banner' && c.isConnected);
  assert.ok(banner, 'expected bottom-right update reminder banner');
  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  assert.ok(walk(banner, n => n.dataset?.testid === 'agy-update-banner-install'));
  const dismissBtn = walk(banner, n => n.dataset?.testid === 'agy-update-banner-dismiss');
  assert.ok(dismissBtn);

  // Clicking dismiss persists update.dismiss and removes banner
  for (const fn of dismissBtn.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.some(c => c.method === 'update.dismiss' && c.version === '1.2.0'), true);
  assert.equal(banner.isConnected, false);

  // New version arrives + autoInstallUpdates enabled -> waits while runningIds non-empty, then auto-installs once idle
  remoteReply = { ...remoteReply, version: '1.3.0', dismissedVersion: '' };
  await capturedEnv.change({ autoInstallUpdates: true });
  await capturedEnv.checkForUpdateNotice({ force: true });
  assert.equal(calls.some(c => c.method === 'update.install'), false, 'must wait while a turn is running');

  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(calls.some(c => c.method === 'update.install' && c.version === '1.3.0'), true);

  ctx.__agyPowertools.dispose();
});
