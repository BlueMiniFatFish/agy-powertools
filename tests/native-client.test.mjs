import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('execution snapshot reads native lifecycle only for the requested conversation',()=>{
  let snapshot={conversationId:'current',status:2,turns:[{startStepIndex:7}],executorMetadata:{terminationReason:0}};
  const value={cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('current'))),{conversationId:'current',status:2,turnStartStepIndex:7,terminationReason:0});
  assert.equal(context.__agyNativeAdapter.executionState('other'),null);
  snapshot={...snapshot,turns:[]};assert.equal(context.__agyNativeAdapter.executionState('current'),null);
});

test('executionState surfaces SYSTEM_MESSAGE wakeup origin, notFullyIdle, and active subagents',()=>{
  const summaries={
    main:{notFullyIdle:true},
    'sub-1':{parentConversationId:'main',status:2,trajectoryMetadata:{subagentSpec:{role:'UI Verification'}}},
    'sub-done':{parentConversationId:'main',status:1,trajectoryMetadata:{subagentSpec:{role:'Finished Check'}}}
  };
  const reduxStore={getState:()=>({trajectorySummaries:{summaries}}),dispatch(){}};
  const snapshot={
    conversationId:'main',status:1,
    turns:[{startStepIndex:10},{startStepIndex:12}],
    executorMetadata:{terminationReason:4},
    trajectorySlice:{
      stepsSlice:{startIndex:10},
      stepsInSlice:[
        {step:{case:'userInput',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Working'}}},
        {step:{case:'systemMessage',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Dispatched'}}}
      ]
    }
  };
  const element={
    '__reactFiber$fixture':{
      tag:10,type:{},memoizedProps:{value:{store:reduxStore}},
      return:{tag:10,type:{},memoizedProps:{value:{cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}}},return:null}
    }
  };
  const context=vm.createContext({document:{querySelector:()=>element,querySelectorAll:()=>[element]}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const ex=JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('main')));
  assert.equal(ex.status,1);
  assert.equal(ex.turnStartStepIndex,12);
  assert.equal(ex.userTurnStartStepIndex,10);
  assert.equal(ex.isSystemTurn,true);
  assert.equal(ex.notFullyIdle,true);
  assert.deepEqual(ex.activeSubagents,[{title:'UI Verification',status:'running'}]);
});

test('master switch restores renamed native hooks and reuses saved enhancements on enable',()=>{
  const original={checkpointConfig:{enabled:true},plannerConfig:{noToolExplanation:true}};
  const nativeResolve=()=>original,nativeSegment=()=>({body:{type:'collapsible'}}),send=payload=>payload;
  const service={forkConversation(){},sendUserCascadeMessage:send};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element},renamedResolve:nativeResolve,renamedSegment:nativeSegment,
    __agyNativeBindings:{names:{resolve:'renamedResolve',segment:'renamedSegment',menu:'renamedMenu'}},I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);adapter.setEfficientIO(true);
  assert.equal(context.renamedResolve().checkpointConfig.maxTokenLimit,1000000);
  adapter.setEnabled(false);
  assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);assert.equal(service.sendUserCascadeMessage,send);
  assert.equal(adapter.stageUpdates,false);assert.equal(context.sjc,undefined);assert.equal(context.Yyc,undefined);
  adapter.setEnabled(true);
  const config=context.renamedResolve();assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['powertools_stage_updates','powertools_efficient_io']);
  adapter.dispose();assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);
});

test('native fork inherits history via ForkConversation without sending a model prompt', async () => {
  const calls = [];
  const service = { async getCascadeTrajectory() { return { trajectory: { steps: [{metadata:{index:42},step:{case:'plannerResponse'}},{metadata:{index:43},step:{case:'systemMessage'}},{metadata:{index:44},step:{case:'userInput'}}] } }; }, async forkConversation(request) { calls.push(request); return { newCascadeId: 'new-id', newProjectId: 'project-id', forkedAtStepIndex: 183, warnings: [] }; } };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: metadata => metadata.index });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const result = await context.__agyNativeAdapter.fork('source-id');
  assert.equal(result.conversationId, 'new-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ sourceCascadeId: 'source-id', forkAtStepIndex: -1, targetForkWorkspace: 1 }]);
  await context.__agyNativeAdapter.fork('source-id', 42);
  assert.equal(calls[1].forkAtStepIndex, 43);
  assert.equal(await context.__agyNativeAdapter.forkPoint('source-id', 44), -1);
  await assert.rejects(context.__agyNativeAdapter.fork('../source', 4), /Invalid/);
  await assert.rejects(context.__agyNativeAdapter.fork('source', -2), /Invalid/);
  assert.equal(calls.length, 2);
  await context.__agyNativeAdapter.fork('source-id', 42, { exact: true });
  assert.equal(calls[2].forkAtStepIndex, 42);
});

test('fork automatically promotes via Side Question and cleans up temp trajectory when direct fork rejects subagents', async () => {
  const events = [];
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [{ metadata: { index: 10 }, step: { case: 'plannerResponse' } }, { metadata: { index: 11 }, step: { case: 'userInput' } }] } }; },
    async startCascade(req) { events.push({ op: 'startCascade', trajectoryType: req.trajectoryType, parent: req.baseTrajectoryIdentifier?.identifier?.value, cascadeId: req.cascadeId }); },
    async forkConversation(req) {
      events.push({ op: 'forkConversation', sourceCascadeId: req.sourceCascadeId, forkAtStepIndex: req.forkAtStepIndex });
      if (req.sourceCascadeId === 'sub-chat') throw new Error('failed to create forked conversation: forking is not supported for conversations that have invoked subagents');
      return { newCascadeId: 'promoted-id', newProjectId: 'proj-1', forkedAtStepIndex: req.forkAtStepIndex, warnings: [] };
    },
    async deleteCascadeTrajectory(id) { events.push({ op: 'delete', id }); }
  };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: m => m.index, crypto: { randomUUID: () => 'sq-temp-1' } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);

  const resEnd = await context.__agyNativeAdapter.fork('sub-chat', -1);
  assert.equal(resEnd.conversationId, 'promoted-id');
  assert.equal(resEnd.promotedViaSideQuestion, true);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    { op: 'forkConversation', sourceCascadeId: 'sub-chat', forkAtStepIndex: -1 },
    { op: 'startCascade', trajectoryType: 22, parent: 'sub-chat', cascadeId: 'sq-temp-1' },
    { op: 'forkConversation', sourceCascadeId: 'sq-temp-1', forkAtStepIndex: -1 },
    { op: 'delete', id: 'sq-temp-1' }
  ]);

  events.length = 0;
  const resHist = await context.__agyNativeAdapter.fork('sub-chat', 10, { exact: true });
  assert.equal(resHist.conversationId, 'promoted-id');
  assert.equal(events[2].forkAtStepIndex, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(events[3])), { op: 'delete', id: 'sq-temp-1' });
});

test('forked conversations automatically receive an incremented (N) title annotation', async () => {
  const annotationCalls = [];
  const summaries = {
    'source-1': { summary: '优化 README 文件指南' },
    'existing-1': { annotations: { title: '优化 README 文件指南 (1)' } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [] } }; },
    async forkConversation() { return { newCascadeId: 'forked-2', newProjectId: 'proj-1', forkedAtStepIndex: -1, warnings: [] }; },
    async updateConversationAnnotations(ids, ann, merge) { annotationCalls.push([ids, ann, merge]); }
  };
  const element = {
    '__reactFiber$fixture': {
      tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } },
      return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
    }
  };
  const context = vm.createContext({
    document: { querySelector: () => element, querySelectorAll: () => [] },
    HU: m => m.index,
    YF: { ConversationAnnotationsSchema: 'ann-schema' },
    Wb: (schema, value) => ({ schema, ...value })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.nextBranchTitle('测试会话', []), '测试会话 (1)');
  assert.equal(adapter.nextBranchTitle('测试会话 (1)', ['测试会话', '测试会话 (1)']), '测试会话 (2)');

  await adapter.fork('source-1');
  assert.equal(annotationCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(annotationCalls[0])), [['forked-2'], { schema: 'ann-schema', title: '优化 README 文件指南 (2)' }, true]);
});

test('unreadCount tracks idle completed background chats and unfocused active chat while excluding subagents and archived chats', () => {
  const summaries = {
    'active-chat': { lastModifiedTime: { seconds: 200 }, annotations: { lastUserViewTime: { seconds: 150 } }, notFullyIdle: false },
    'bg-done': { lastModifiedTime: { seconds: 300 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: false },
    'bg-running': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: true },
    'subagent-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, parentConversationId: 'active-chat', nestingDepth: 1 },
    'archived-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 }, archived: true } },
    'old-unviewed': { lastModifiedTime: { seconds: 400 }, annotations: {} },
    'manual-unread': { lastModifiedTime: { seconds: 50 }, annotations: { markedAsUnread: true } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries }, conversation: { localLastViewedTimes: { 'bg-done': 120 } } }), dispatch() {} };
  const element = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const context = vm.createContext({ document: { querySelector: () => element } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', true), 2); // bg-done + manual-unread
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', false), 3); // + active-chat when unfocused
});

test('message editing rewinds conversation only and preserves attachment and reference data', async () => {
  const calls = [];
  const scope = { chunk: { case: 'item', value: { file: 'reference.md' } } };
  const media = [{ uri: 'attachment.png' }];
  const message = { cascadeId: 'source', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'before' } }, scope, { chunk: { case: 'text', value: 'after' } }], media, artifactComments: [{ comment: 'keep' }] } };
  const value = { stepHandler: { async revertToIndex(...args) { calls.push(['revert', ...args]); } }, async sendMessage(payload) { calls.push(['send', payload]); } };
  const context = vm.createContext({ document: { querySelector() {} }, HU: metadata => metadata.index });
  const element = { '__reactFiber$fixture': { tag: 0, memoizedProps: message, return: { tag: 10, type: {}, memoizedProps: { value }, return: null } } };
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  await context.__agyNativeAdapter.editAndResend(element, 'replacement');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['revert', 'source', 3, { conversationOnly: true }]);
  assert.equal(calls[1][1].items[0].chunk.value, 'replacement');
  assert.equal(calls[1][1].items[1], scope); assert.equal(calls[1][1].items.length, 2);
  assert.equal(calls[1][1].media, media);
  assert.equal(calls[1][1].commentOverrides.artifactComments, message.step.artifactComments);
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, '  '), /请输入/);
  assert.equal(calls.length, 2);
  value.stepHandler.revertToIndex = async () => { throw new Error('failed'); };
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, 'retry'), /failed/);
  assert.equal(calls.length, 2);
});

test('composer-driven message editing loads rich quotes and media into Lexical, supports cancel draft restore, and rewinds before native send', async () => {
  const events = [];
  let editorState = 'draft-before', attachments = [{ uri: 'draft.png' }];
  const quoteItem = { chunk: { case: 'item', value: { scopeItem: { case: 'quote', value: { text: 'quoted snippet' } } } } };
  const message = {
    cascadeId: 'conv-1',
    metadata: { index: 6 },
    step: {
      items: [{ chunk: { case: 'text', value: 'hello ' } }, quoteItem],
      media: [{ uri: 'artifact://img1.png', mimeType: 'image/png' }],
      artifactComments: [{ comment: 'note' }]
    }
  };
  const editor = {
    getEditorState: () => editorState,
    setEditorState: next => { editorState = next; events.push(['editor', next]); },
    focus: () => events.push(['focus'])
  };
  const box = {
    lexicalRef: { current: editor },
    getMediaAttachments: () => attachments,
    setMediaAttachments: next => { attachments = next; events.push(['media', next]); },
    floatingContentRef: { current: {} }
  };
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation(req) { events.push(['cancelRun', req]); },
    async sendUserCascadeMessage(payload) { events.push(['rpcSend', payload]); return { ok: true }; }
  };
  const stepHandler = {
    resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`,
    async revertToIndex(...args) { events.push(['revert', ...args]); }
  };
  const optimistic = {
    applyOptimisticRevert(id, idx) { events.push(['optRevert', id, idx]); return { dispose: () => events.push(['optDispose']) }; }
  };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = {
    isConnected: true,
    children: [inputBox],
    insertBefore(node, before) {
      node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
      const idx = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
      node.parentNode = this;
      node.nextSibling = before || null;
    }
  };
  inputBox.parentNode = bottomDock;
  inputBox.parentElement = bottomDock;
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const element = {
    attrs: new Set(), children: [],
    setAttribute(k) { this.attrs.add(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    prepend(node) { node.parentNode = this; this.children.unshift(node); },
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler, restoreReviewComments: arg => events.push(['comments', arg.cascadeId]) } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: optimistic },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    }
  };
  const context = vm.createContext({
    document: { querySelector: sel => sel ? null : element, createElement: makeNode },
    HU: m => m.index,
    LN: items => ({ serialized: items }),
    IJ: (_, json) => ({ parsed: json }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(element);
  assert.equal(adapter.pendingEdit.stepIndex, 6);
  assert.equal(element.attrs.has('data-agy-editing-target'), true);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState)), { parsed: { serialized: message.step.items } });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].uri, '');
  assert.deepEqual(Array.from(attachments[0].payload.value), [1, 2, 3]);

  adapter.cancelEdit();
  assert.equal(adapter.pendingEdit, null);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(editorState, 'draft-before');
  assert.deepEqual(JSON.parse(JSON.stringify(attachments)), [{ uri: 'draft.png' }]);

  events.length = 0;
  await adapter.beginEdit(element);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  const editedItems = [{ chunk: { case: 'text', value: 'updated ' } }, quoteItem];
  const editedMedia = [...attachments, { uri: 'new-upload.png', mimeType: 'image/png' }];
  await service.sendUserCascadeMessage({ cascadeId: 'conv-1', items: editedItems, media: editedMedia, deliveryStrategy: 2 });
  assert.equal(adapter.pendingEdit, null);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  const revertIdx = events.findIndex(e => e[0] === 'revert');
  const sendIdx = events.findIndex(e => e[0] === 'rpcSend');
  assert.ok(revertIdx >= 0 && sendIdx > revertIdx);
  assert.deepEqual(JSON.parse(JSON.stringify(events[revertIdx])), ['revert', 'conv-1', 5, { conversationOnly: true }]);
  const sent = events[sendIdx][1];
  assert.equal(sent.items, editedItems);
  assert.equal(sent.media, editedMedia);
  assert.equal(sent.deliveryStrategy, undefined);
  assert.equal(sent.artifactComments, message.step.artifactComments);
  assert.ok(events.some(e => e[0] === 'optDispose'));
});

test('suspendEdit preserves edited text and media across session switch without leaking into bottom composer', async () => {
  const makeSerialized = text => ({ text, toJSON: () => ({ root: { text } }) });
  let editorState1 = makeSerialized('normal-draft'), attachments1 = [{ uri: 'normal.png' }];
  const message = {
    cascadeId: 'conv-a',
    metadata: { index: 4 },
    step: {
      items: [{ chunk: { case: 'text', value: 'original msg' } }],
      media: [{ uri: 'artifact://orig.png', mimeType: 'image/png' }],
      artifactComments: []
    }
  };
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const buildSessionDom = (getEd, setEd, getAtt, setAtt) => {
    const editor = { getEditorState: getEd, setEditorState: setEd, focus() {} };
    const box = { lexicalRef: { current: editor }, getMediaAttachments: getAtt, setMediaAttachments: setAtt, floatingContentRef: { current: {} } };
    const inputBox = { parentNode: null, nextSibling: null };
    const bottomDock = {
      isConnected: true, children: [inputBox],
      insertBefore(node, before) {
        node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
        const idx = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
        node.parentNode = this; node.nextSibling = before || null;
      }
    };
    inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
    const service = { forkConversation() {}, async cancelCascadeInvocation() {}, async sendUserCascadeMessage(p) { return p; } };
    const stepHandler = { resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`, async revertToIndex() {} };
    const element = {
      isConnected: true, attrs: new Set(), children: [],
      setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); },
      prepend(node) { node.parentNode = this; this.children.unshift(node); },
      closest: () => ({ querySelector: () => inputBox }),
      '__reactFiber$fixture': {
        tag: 0, memoizedProps: message,
        return: {
          tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    };
    return { element, inputBox, bottomDock };
  };

  const dom1 = buildSessionDom(() => editorState1, v => { editorState1 = v; }, () => attachments1, v => { attachments1 = v; });
  const context = vm.createContext({
    document: { querySelector: () => dom1.element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => ({ parsed: JSON.parse(json), toJSON: () => JSON.parse(json) }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(dom1.element);
  // User edits text and adds another image while editing turn #4
  editorState1 = makeSerialized('in-progress edit');
  attachments1 = [...attachments1, { uri: 'extra-paste.png', mimeType: 'image/png' }];

  // User switches to another session -> suspendEdit restores original normal draft to bottom composer
  const suspended = adapter.suspendEdit();
  assert.ok(suspended);
  assert.equal(adapter.pendingEdit, null);
  assert.equal(dom1.inputBox.parentNode, dom1.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState1.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments1)), [{ uri: 'normal.png' }]);
  assert.equal(adapter.getSuspendedEdit('conv-a').stepIndex, 4);

  // User switches back to conv-a with freshly mounted DOM & editor
  let editorState2 = makeSerialized('normal-draft'), attachments2 = [{ uri: 'normal.png' }];
  const dom2 = buildSessionDom(() => editorState2, v => { editorState2 = v; }, () => attachments2, v => { attachments2 = v; });
  const resumed = adapter.resumeEdit(dom2.element);
  assert.ok(resumed);
  assert.equal(adapter.getSuspendedEdit('conv-a'), null);
  assert.equal(dom2.inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'in-progress edit' } });
  assert.equal(attachments2.length, 2);
  assert.equal(attachments2[1].uri, 'extra-paste.png');

  // Canceling after resume still restores the original pre-edit bottom draft cleanly
  adapter.cancelEdit();
  assert.equal(dom2.inputBox.parentNode, dom2.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments2)), [{ uri: 'normal.png' }]);
});

test('context override reaches the native config resolver and restores the default without mutating base config', () => {
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const originalConfig={plannerConfig:{planModel:1417},checkpointConfig:{enabled:true}};
  const originalResolve=()=>originalConfig;
  const context=vm.createContext({document:{querySelector:()=>element},sjc:originalResolve,I:{CascadeConfigSchema:{},CheckpointConfigSchema:{}},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  context.__agyNativeAdapter.setContextLimit(256000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,256000);
  context.__agyNativeAdapter.setContextLimit(500000);
  const resolved=context.sjc({});
  assert.equal(resolved.checkpointConfig.maxTokenLimit,500000);assert.equal(resolved.checkpointConfig.tokenThreshold,500000);
  assert.equal(resolved.checkpointConfig.enabled,true);assert.equal(originalConfig.checkpointConfig.maxTokenLimit,undefined);
  context.__agyNativeAdapter.setContextLimit(1000000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  context.__agyNativeAdapter.setContextLimit(0);assert.equal(context.sjc,originalResolve);
  assert.throws(()=>context.__agyNativeAdapter.setContextLimit(42),/上下文/);
});

test('stage updates compose with context limits, show live updates and fold them before the final answer',()=>{
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const base={plannerConfig:{noToolExplanation:true,promptSectionCustomizationConfig:{appendPromptSections:[{title:'existing',content:'preserve'}]}},checkpointConfig:{enabled:true}};
  const resolve=()=>base;
  const modelText={type:'step',step:{step:{case:'plannerResponse',value:{response:'Reading the next file.'}}}};
  const final={type:'lastTextResponse',step:{step:{case:'plannerResponse',value:{response:'Final answer'}}}};
  const render=arg=>({leadingSteps:arg.leadingSteps||[],tailSteps:[final],body:{type:'collapsible',isActive:arg.running,content:{groups:arg.groups}}});
  const context=vm.createContext({document:{querySelector:()=>element},sjc:resolve,Yyc:render,I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);
  const patchedResolve=context.sjc;
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.equal(context.__agyNativeAdapter,adapter);
  assert.equal(context.sjc,patchedResolve);
  const config=context.sjc({});
  assert.equal(config.plannerConfig.noToolExplanation,false);
  assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['existing','powertools_stage_updates']);
  assert.equal(base.plannerConfig.noToolExplanation,true);
  assert.equal(base.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.length,1);
  const content=context.Yyc({groups:[modelText],running:true}).body;
  assert.equal(content.type,'inline');assert.equal(content.content.groups[0],modelText);
  const complete=context.Yyc({groups:[modelText],leadingSteps:[modelText],running:false});
  assert.equal(complete.body.type,'collapsible');assert.equal(complete.body.defaultExpanded,false);
  assert.equal(complete.leadingSteps.length,0);assert.equal(complete.body.content.groups.length,2);
  assert.equal(complete.tailSteps[0],final);assert.ok(!complete.body.content.groups.includes(final));
  const thinking={type:'thinkingIndicator',thinking:'not user-facing'};
  assert.equal(context.Yyc({groups:[thinking]}).body.type,'collapsible');
  adapter.setEfficientIO(true);
  let prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_stage_updates','powertools_efficient_io']);
  assert.match(prompts.at(-1).content,/prefer rg/);
  assert.match(prompts.at(-1).content,/operating system/);
  adapter.setStageUpdates(false);
  assert.equal(context.Yyc,render);
  assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  assert.equal(context.sjc({}).plannerConfig.noToolExplanation,true);
  prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_efficient_io']);
  adapter.setContextLimit(0);assert.notEqual(context.sjc,resolve);
  adapter.setEfficientIO(false);assert.equal(context.sjc,resolve);
  adapter.dispose();assert.equal(context.Yyc,render);
  assert.equal(adapter.active,false);
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.notEqual(context.__agyNativeAdapter,adapter);
  assert.equal(context.__agyNativeAdapter.active,true);
});

test('codexProgress unifies Knowledge Work progress timeline, compacts non-waiting terminal steps, folds on completion, and restores cleanly', () => {
  const base = { plannerConfig: { noToolExplanation: true }, checkpointConfig: { enabled: true } };
  const resolve = () => base;
  const capturedCallArgs = [];
  const cmdStepDone = { type: 'step', key: 'cmd-1', step: { status: 3, step: { case: 'runCommand', value: {} } } };
  const cmdStepWaiting = { type: 'step', key: 'cmd-wait', step: { status: 9, step: { case: 'runCommand', value: {} } } };
  const genericRunDone = { type: 'step', key: 'cmd-gen', step: { status: 2, metadata: { toolCall: { name: 'run_command' } }, step: { case: 'generic', value: {} } } };
  const stageText = { type: 'step', key: 'txt-1', step: { step: { case: 'plannerResponse', value: { response: 'Checking workspace files.' } } } };
  const finalStep = { type: 'lastTextResponse', step: { step: { case: 'plannerResponse', value: { response: 'Done.' } } } };

  const nativeSegment = arg => {
    capturedCallArgs.push(arg);
    if (arg.ephemeralToolCalls) {
      return {
        leadingSteps: [],
        body: { type: 'inline', content: { groups: [{ type: 'ephemeralToolStatus', key: 'status' }] } },
        tailSteps: []
      };
    }
    return {
      leadingSteps: arg.leadingSteps || [],
      tailSteps: [finalStep],
      body: {
        type: 'collapsible',
        isActive: arg.isRunning,
        triggerVisible: !arg.isRunning,
        defaultExpanded: arg.isRunning,
        content: { groups: arg.groups }
      }
    };
  };

  const context = vm.createContext({
    document: { querySelector: () => null },
    sjc: resolve,
    Yyc: nativeSegment,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.codexProgress, false);

  adapter.setCodexProgress(true);
  assert.equal(adapter.codexProgress, true);
  assert.equal(adapter.stageUpdates, false);
  // Upgrades resolve dynamically with Codex output & localized summary rules even when stageUpdates is off
  assert.notEqual(context.sjc, resolve);
  const codexResolved = context.sjc({});
  assert.equal(codexResolved.plannerConfig.noToolExplanation, false);
  assert.equal(codexResolved.plannerConfig.noToolSummary, false);
  assert.deepEqual(
    Array.from(codexResolved.plannerConfig.promptSectionCustomizationConfig.appendPromptSections, p => p.title),
    ['powertools_stage_updates']
  );
  assert.match(codexResolved.plannerConfig.promptSectionCustomizationConfig.appendPromptSections[0].content, /Output style and brevity/);

  // 1. Knowledge Work input overrides ephemeralToolCalls -> false without mutating caller object
  const callerArg = {
    ephemeralToolCalls: true,
    ephemeralProgressTextMode: 'disclosure',
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true },
    groups: [stageText, cmdStepDone, genericRunDone]
  };
  const runningResult = context.Yyc(callerArg);
  assert.equal(callerArg.ephemeralToolCalls, true);
  assert.equal(callerArg.ephemeralProgressTextMode, 'disclosure');
  assert.equal(capturedCallArgs[0].ephemeralToolCalls, false);
  assert.equal(capturedCallArgs[0].ephemeralProgressTextMode, 'none');

  // While running: inline streaming + single non-waiting terminal steps compacted to toolGroupCollapsible
  assert.equal(runningResult.body.type, 'inline');
  assert.equal(runningResult.body.content.groups[0], stageText);
  assert.equal(runningResult.body.content.groups[1].type, 'toolGroupCollapsible');
  assert.equal(runningResult.body.content.groups[1].steps.length, 1);
  assert.equal(runningResult.body.content.groups[1].steps[0], cmdStepDone.step);
  assert.equal(runningResult.body.content.groups[1].isRunning, false);
  assert.equal(runningResult.body.content.groups[2].type, 'toolGroupCollapsible');
  assert.equal(runningResult.body.content.groups[2].steps[0], genericRunDone.step);
  assert.equal(runningResult.body.content.groups[2].isRunning, true);

  // 2. Waiting approval step must remain unwrapped AND keep body inline so approval UI is never hidden
  const waitingResult = context.Yyc({
    ephemeralToolCalls: true,
    isRunning: false,
    groups: [stageText, cmdStepWaiting]
  });
  assert.equal(waitingResult.body.type, 'inline');
  assert.equal(waitingResult.body.content.groups[1], cmdStepWaiting);

  // 3. Completed turn moves leading commentary into collapsed fold above tailSteps
  const doneResult = context.Yyc({
    ephemeralToolCalls: true,
    isRunning: false,
    leadingSteps: [stageText],
    groups: [cmdStepDone]
  });
  assert.equal(doneResult.leadingSteps.length, 0);
  assert.equal(doneResult.body.type, 'collapsible');
  assert.equal(doneResult.body.defaultExpanded, false);
  assert.equal(doneResult.body.isActive, false);
  assert.equal(doneResult.body.triggerVisible, true);
  assert.equal(doneResult.body.content.groups[0], stageText);
  assert.equal(doneResult.body.content.groups[1].type, 'toolGroupCollapsible');
  assert.equal(doneResult.tailSteps[0], finalStep);

  // 4. Disabling codexProgress or master switch restores originalSegmentRender & resolve cleanly
  adapter.setCodexProgress(false);
  assert.equal(adapter.codexProgress, false);
  assert.equal(context.Yyc, nativeSegment);
  assert.equal(context.sjc, resolve);
  adapter.setCodexProgress(true);
  assert.notEqual(context.Yyc, nativeSegment);
  assert.notEqual(context.sjc, resolve);
  adapter.setEnabled(false);
  assert.equal(adapter.codexProgress, false);
  assert.equal(context.Yyc, nativeSegment);
  assert.equal(context.sjc, resolve);
  adapter.setEnabled(true);
  assert.equal(adapter.codexProgress, true);
  assert.notEqual(context.Yyc, nativeSegment);
  assert.notEqual(context.sjc, resolve);
  adapter.dispose();
  assert.equal(context.Yyc, nativeSegment);
  assert.equal(context.sjc, resolve);
});

test('codexProgress replaces stageUpdateRule without duplication, adapts tool-summary language, and restores upstream rule when disabled', () => {
  const existing = { title: 'existing', content: 'Keep me intact.' };
  const base = {
    plannerConfig: {
      noToolExplanation: true,
      noToolSummary: true,
      promptSectionCustomizationConfig: { appendPromptSections: [existing] }
    }
  };
  const resolve = () => base;
  const context = vm.createContext({
    document: { querySelector: () => null },
    sjc: resolve,
    I: {
      CascadeConfigSchema: {},
      CascadePlannerConfigSchema: {},
      PromptSectionCustomizationConfigSchema: {},
      PromptSectionSchema: {}
    },
    tc: (_, value) => structuredClone(value),
    Wb: (_, value) => value
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  adapter.setStageUpdates(true);
  adapter.setCodexProgress(true);

  let prompts = context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts, p => p.title), ['existing', 'powertools_stage_updates']);
  assert.match(prompts[1].content, /Output style and brevity/);
  assert.match(prompts[1].content, /file:\/\//);
  assert.match(prompts[1].content, /检查插件与版本/);
  assert.doesNotMatch(prompts[1].content, /皮皮喵|本喵|猫娘/);

  adapter.setUiLanguage('zh-TW');
  prompts = context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.match(prompts[1].content, /檢查外掛與版本/);

  adapter.setUiLanguage('en');
  prompts = context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.match(prompts[1].content, /2-6 word phrases/);

  adapter.setCodexProgress(false);
  prompts = context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts, p => p.title), ['existing', 'powertools_stage_updates']);
  assert.match(prompts[1].content, /communicate brief visible progress updates/);
  assert.doesNotMatch(prompts[1].content, /Output style and brevity/);

  adapter.dispose();
  assert.equal(context.sjc, resolve);
});

test('codexProgress keeps latest turn unfolded only on React-subscribed active signals and folds despite stale notFullyIdle', () => {
  const reduxStore = {
    getState: () => ({ trajectorySummaries: { summaries: { 'conv-bg': { notFullyIdle: true, killed: false } } } }),
    dispatch() {}
  };
  const element = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const stageText = { type: 'step', key: 'txt-1', step: { step: { case: 'plannerResponse', value: { response: 'Running background test.' } } } };
  const runningCmdStep = { status: 2, step: { case: 'runCommand', value: {} } };
  const finalStep = { type: 'lastTextResponse', step: { step: { case: 'plannerResponse', value: { response: 'All done.' } } } };
  const nativeSegment = arg => ({
    leadingSteps: arg.leadingSteps || [],
    tailSteps: [finalStep],
    body: {
      type: 'collapsible',
      isActive: false,
      triggerVisible: true,
      defaultExpanded: false,
      content: { groups: arg.groups || [] }
    }
  });
  const context = vm.createContext({
    document: { querySelector: () => element },
    location: { pathname: '/c/conv-bg' },
    sjc: () => ({}),
    Yyc: nativeSegment,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  adapter.setCodexProgress(true);

  // 1. in_progress plan step (subscribed by mVc) keeps latest turn inline even when isRunning is false
  const planActiveRes = context.Yyc({
    isRunning: false,
    isLastTurn: true,
    segment: { isLatest: true },
    planSteps: [{ key: 'p1', status: 'in_progress' }],
    groups: [stageText]
  });
  assert.equal(planActiveRes.body.type, 'inline');

  // 2. RUNNING step in segment.steps (subscribed by mVc) keeps latest turn inline even when isRunning is false
  const stepActiveRes = context.Yyc({
    isRunning: false,
    isLastTurn: true,
    segment: { isLatest: true, steps: [runningCmdStep] },
    planSteps: [{ key: 'p1', status: 'done' }],
    groups: [stageText]
  });
  assert.equal(stepActiveRes.body.type, 'inline');

  // 3. Stale unsubscribed Redux notFullyIdle: true must NOT prevent immediate fold when all reactive signals finish
  const doneRes = context.Yyc({
    isRunning: false,
    isLastTurn: true,
    segment: { isLatest: true, steps: [{ status: 3, step: { case: 'runCommand', value: {} } }] },
    planSteps: [{ key: 'p1', status: 'done' }],
    groups: [stageText]
  });
  assert.equal(doneRes.body.type, 'collapsible');
  assert.equal(doneRes.body.defaultExpanded, false);

  // 4. Older non-latest turn still folds normally
  const olderRes = context.Yyc({
    isRunning: false,
    isLastTurn: false,
    segment: { isLatest: false, steps: [runningCmdStep] },
    planSteps: [{ key: 'p1', status: 'in_progress' }],
    groups: [stageText]
  });
  assert.equal(olderRes.body.type, 'collapsible');
  adapter.dispose();
});

test('native-bindings resolves imageCompress and hdImages intercepts 1MB/1024px compression losslessly within 3 MiB, configures schema, and restores cleanly', async () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
  const imgCompFn = function imgComp(limitBytes) {
    return `Failed to compress image to fit within ${(limitBytes / 1048576).toFixed(1)}MB`;
  };
  const bCtx = vm.createContext({
    React: {},
    createFileRoute: () => opts => opts,
    HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
    IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
    JC: () => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 }),
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
    lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr:"data-no-drag" }),
    mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
    nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
    HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
    Kc: x => x,
    resolveFn: () => null,
    segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
    menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
    Proto: { CascadeConfigSchema: {} },
    Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
    IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
    LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
    imgCompFn
  });
  vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, bCtx);
  vm.runInContext(bindingsSource, bCtx);
  const resolved = bCtx.__agyResolveNativeBindings([]);
  assert.equal(resolved.names.imageCompress, 'imgCompFn');

  const nativeCalls = [];
  const origCompress = async (dataUrl, mimeType, maxBytes, maxSide) => {
    nativeCalls.push({ dataUrl, mimeType, maxBytes, maxSide });
    return { dataUrl: 'data:image/jpeg;base64,DOWNSCALED', mimeType: 'image/jpeg' };
  };
  const svc = { forkConversation() {}, sendUserCascadeMessage(p) { return p; } };
  const element = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: svc }, return: null } };
  const resolveBase = { checkpointConfig: { enabled: true } };
  const resolve = () => resolveBase;
  const context = vm.createContext({
    document: { querySelector: () => element },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', menu: 'lHc', imageCompress: 'imgCompressNative' } },
    sjc: resolve,
    Yyc: arg => arg,
    imgCompressNative: origCompress,
    I: { CascadeConfigSchema: 'cascade', MediaCompressionConfigSchema: 'mediaCompression' },
    tc: (_, v) => structuredClone(v),
    Wb: (schema, v) => ({ schema, ...v })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.hdImages, false);
  assert.equal(context.imgCompressNative, origCompress);

  adapter.setHdImages(true);
  assert.equal(adapter.hdImages, true);
  assert.notEqual(context.imgCompressNative, origCompress);

  // 1. <= 3 MiB PNG with default 1MB/1024 limits passes through losslessly without invoking native compressor
  const samplePng = `data:image/png;base64,${Buffer.from('hd-png-payload').toString('base64')}`;
  const hdRes = await context.imgCompressNative(samplePng, 'image/png', 1048576, 1024);
  assert.deepEqual(JSON.parse(JSON.stringify(hdRes)), { dataUrl: samplePng, mimeType: 'image/png' });
  assert.equal(nativeCalls.length, 0);

  // 2. Non-default limits bypass interceptor and call native compressor directly
  const passThrough = await context.imgCompressNative(samplePng, 'image/png', 512000, 512);
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].maxBytes, 512000);
  assert.equal(nativeCalls[0].maxSide, 512);
  assert.equal(passThrough.mimeType, 'image/jpeg');

  // 3. configureRequest injects MediaCompressionConfigSchema overrides when enabled
  const cfgEnabled = context.sjc({});
  assert.deepEqual(JSON.parse(JSON.stringify(cfgEnabled.mediaCompressionConfig)), {
    schema: 'mediaCompression',
    maxSide: 16384,
    maxBytes: 3145728,
    jpegQuality: 92,
    transcodeMinBytes: 3145728
  });

  // 4. Master toggle and setHdImages(false) + dispose restore original hooks cleanly
  adapter.setEnabled(false);
  assert.equal(adapter.hdImages, false);
  assert.equal(context.imgCompressNative, origCompress);
  assert.equal(context.sjc({}).mediaCompressionConfig, undefined);

  adapter.setEnabled(true);
  assert.equal(adapter.hdImages, true);
  assert.notEqual(context.imgCompressNative, origCompress);

  adapter.setHdImages(false);
  assert.equal(adapter.hdImages, false);
  assert.equal(context.imgCompressNative, origCompress);
  assert.equal(context.sjc({}).mediaCompressionConfig, undefined);

  adapter.setHdImages(true);
  assert.notEqual(context.imgCompressNative, origCompress);
  adapter.dispose();
  assert.equal(context.imgCompressNative, origCompress);

  // 5. Unmounted conversation (querySelector === null) never throws on setHdImages / setEnabled and still wraps imageCompress
  const unmountedCtx = vm.createContext({
    document: { querySelector: () => null },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', menu: 'lHc', imageCompress: 'imgCompressNative' } },
    sjc: resolve,
    Yyc: arg => arg,
    imgCompressNative: origCompress,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), unmountedCtx);
  const unmounted = unmountedCtx.__agyNativeAdapter;
  unmounted.setHdImages(true);
  assert.notEqual(unmountedCtx.imgCompressNative, origCompress);
  unmounted.setEnabled(false);
  assert.equal(unmountedCtx.imgCompressNative, origCompress);
  unmounted.setEnabled(true);
  assert.notEqual(unmountedCtx.imgCompressNative, origCompress);
  unmounted.dispose();
  assert.equal(unmountedCtx.imgCompressNative, origCompress);
});

test('setSidebarProjectLimit controls per-project visible rows, supports show-all, and restores cleanly',()=>{
  const nativeFlat=args=>{
    const out=[];
    for(const g of args.groups){
      out.push({type:'header',id:`header-${g.id}`,label:g.label});
      const collapsed=args.onlyShowFirstFewConvos?.[g.id]??true;
      const slice=collapsed?g.items.slice(0,6):g.items;
      for(const it of slice)out.push({type:'row',id:it.cascadeId,cascadeId:it.cascadeId,isIndented:true,groupId:g.id});
      if(g.items.length>6)out.push({type:'show-more',id:`show-more-${g.id}`,label:collapsed?`See all (${g.items.length})`:'See less',groupId:g.id,isIndented:true});
    }
    return out;
  };
  const context=vm.createContext({
    document:{querySelector:()=>null},
    __agyNativeBindings:{names:{resolve:'sjc',segment:'Yyc',menu:'lHc',sidebarItems:'VWc'}},
    VWc:nativeFlat
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const groups=[{id:'p1',label:'Proj1',items:Array.from({length:8},(_,i)=>({cascadeId:`c${i}`}))}];
  const call=flags=>context.VWc({groups,groupBy:'project',onlyShowFirstFewConvos:flags});

  adapter.setSidebarProjectLimit(2);
  let items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,2);
  assert.equal(items.at(-1).type,'show-more');assert.equal(items.at(-1).label,'See all (8)');

  items=call({p1:false});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.at(-1).label,'See less');

  adapter.setSidebarProjectLimit(-1);
  items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.some(x=>x.type==='show-more'),false);

  adapter.setSidebarProjectLimit(0);
  assert.equal(context.VWc,nativeFlat);
  adapter.setSidebarProjectLimit(3);
  adapter.dispose();
  assert.equal(context.VWc,nativeFlat);
});

test('composerCascadeId resolves nearest conversationId or effectiveCascadeId for side-question and split-pane composers',()=>{
  const context=vm.createContext({document:{querySelector:()=>null}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const sideQuestionEl={
    '__reactFiber$sq':{
      memoizedProps:{},
      return:{
        memoizedProps:{conversationId:'sq-123',parentCascadeId:'main-1',isSideQuestion:true},
        return:{memoizedProps:{cascadeId:'main-1'},return:null}
      }
    }
  };
  const effectiveEl={
    '__reactFiber$eff':{
      memoizedProps:{effectiveCascadeId:'sq-456',parentCascadeId:'main-1'},
      return:{memoizedProps:{cascadeId:'main-1'},return:null}
    }
  };
  assert.equal(adapter.composerCascadeId(sideQuestionEl),'sq-123');
  assert.equal(adapter.composerCascadeId(effectiveEl),'sq-456');
});

test('fileTreeEntry extracts file and folder URIs and attachFileToComposer routes media via attachFiles and files/dirs via native mention helpers', async () => {
  const attached = [];
  const fileMentions = [];
  const scopeMentions = [];
  let focused = 0;
  const editor = { focus() { focused++; } };
  const box = {
    lexicalRef: { current: editor },
    async attachFiles(files) { attached.push(...files); },
    getInputCardElement: () => ({ scrollIntoView() {} })
  };
  const inputBoxEl = {
    '__reactFiber$ib': {
      tag: 10,
      memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
      return: null
    }
  };
  const treeRowEl = {
    '__reactFiber$row': {
      memoizedProps: {},
      return: {
        memoizedProps: { entry: { uri: 'file:///workspace/assets/logo.png', fileType: 1 } },
        return: null
      }
    }
  };
  const dirRowEl = {
    '__reactFiber$dir': {
      memoizedProps: { entry: { uri: 'file:///workspace/docs', fileType: 2 } },
      return: null
    }
  };
  const context = vm.createContext({
    atob,
    Uint8Array,
    File,
    document: {
      activeElement: null,
      querySelector: sel => sel.includes('agent-input-box') ? inputBoxEl : null
    },
    MUa: (ed, uri) => fileMentions.push({ ed, uri }),
    Shd: (kind, uri) => ({ kind, uri }),
    Gy: (ed, item) => scopeMentions.push({ ed, item })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  const childInFileRow = { closest: sel => sel === '[role="treeitem"]' ? treeRowEl : null };
  const childInDirRow = { closest: sel => sel === '[role="treeitem"]' ? dirRowEl : null };
  assert.deepEqual({ ...adapter.fileTreeEntry(childInFileRow) }, { uri: 'file:///workspace/assets/logo.png', isDirectory: false });
  assert.deepEqual({ ...adapter.fileTreeEntry(childInDirRow) }, { uri: 'file:///workspace/docs', isDirectory: true });

  const mediaRes = await adapter.attachFileToComposer({
    mode: 'media',
    name: 'logo.png',
    mimeType: 'image/png',
    base64: Buffer.from('PNGDATA').toString('base64')
  });
  assert.equal(mediaRes.mode, 'media');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].name, 'logo.png');
  assert.equal(attached[0].type, 'image/png');
  assert.equal(attached[0].size, 7);

  const fileRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'file',
    uri: 'file:///workspace/src/app.js',
    name: 'app.js'
  });
  assert.equal(fileRes.mode, 'mention');
  assert.deepEqual(fileMentions, [{ ed: editor, uri: 'file:///workspace/src/app.js' }]);

  const dirRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'directory',
    isDirectory: true,
    uri: 'file:///workspace/docs',
    name: 'docs'
  });
  assert.equal(dirRes.kind, 'directory');
  assert.deepEqual(scopeMentions, [{ ed: editor, item: { kind: 'directory', uri: 'file:///workspace/docs' } }]);
  assert.equal(focused, 3);
});

test('stable sendUserCascadeMessage wrapper preserves edit revert even when composer destructured send while config overrides were off', async () => {
  const events = [];
  const editor = { getEditorState: () => ({ toJSON: () => ({ root: {} }) }), setEditorState() {}, focus() {} };
  const box = { lexicalRef: { current: editor }, getMediaAttachments: () => [], setMediaAttachments() {}, floatingContentRef: { current: {} } };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = { isConnected: true, children: [inputBox], insertBefore() {} };
  inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation() {},
    async sendUserCascadeMessage(payload) { events.push(['send', payload.cascadeId]); return payload; }
  };
  const stepHandler = {
    async revertToIndex(id, idx, opts) { events.push(['revert', id, idx, opts]); }
  };
  const message = { cascadeId: 'conv-stable', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'old' } }], media: [], artifactComments: [], fileDiffComments: [], fileComments: [] } };
  const element = {
    isConnected: true, attrs: new Set(), children: [],
    setAttribute() {}, removeAttribute() {}, prepend() {},
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
        }
      }
    }
  };
  const makeNode = () => ({ dataset: {}, className: '', textContent: '', append() {}, addEventListener() {}, remove() {} });
  const context = vm.createContext({
    document: { querySelector: () => element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => JSON.parse(json),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  // All config overrides OFF when conversation mounts and destructures sendUserCascadeMessage (just like native useMemo)
  adapter.setStageUpdates(false);
  adapter.setEfficientIO(false);
  adapter.setContextLimit(0);
  adapter.ensureRequestHook();
  const capturedSend = service.sendUserCascadeMessage;

  // Later user clicks Edit -> composer calls the previously captured send closure
  await adapter.beginEdit(element);
  await capturedSend({ cascadeId: 'conv-stable', items: [{ chunk: { case: 'text', value: 'edited' } }], media: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['revert', 'conv-stable', 3, { conversationOnly: true }],
    ['send', 'conv-stable']
  ]);
});

test('installRequestOverrides updates resolve hook cleanly on unmounted view and splitSegments/stageSegmentRender fold multi-wakeup subagent turns', () => {
  const nativeResolve = cfg => ({ ...cfg });
  const nativeSplitSegments = (steps, isLatest) => steps.map(s => ({ executionId: s.metadata?.executionId || '', steps: [s], isLatest }));
  let activeSubagentStatus = 2; // 2 = running, 1 = done
  const reduxStore = {
    getState: () => ({
      trajectorySummaries: {
        summaries: {
          'conv-sub': { notFullyIdle: false },
          'sub-1': { parentConversationId: 'conv-sub', status: activeSubagentStatus }
        }
      }
    }),
    dispatch() {}
  };
  const storeEl = { '__reactFiber$store': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const subStep = { status: 3, metadata: { executionId: 'e1', createdAt: { seconds: 100 } }, step: { case: 'invokeSubagent', value: {} } };
  const midReplyStep = { status: 3, metadata: { executionId: 'e2', createdAt: { seconds: 110 } }, step: { case: 'plannerResponse', value: { response: 'First subagent finished.' } } };
  const msgFromStep = { status: 3, metadata: { executionId: 'e2', createdAt: { seconds: 115 } }, step: { case: 'systemMessage', value: { message: 'Message from auditor' } } };
  const finalStep = { status: 3, metadata: { executionId: 'e3', createdAt: { seconds: 120 }, completedAt: { seconds: 132 } }, step: { case: 'plannerResponse', value: { response: 'Final summary ready.' } } };

  // Test Case 1: unmounted conversation view never throws when updating resolve config overrides
  const unmountedCtx = vm.createContext({
    document: { querySelector: () => null },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', splitSegments: 'T5b', menu: 'lHc' } },
    sjc: nativeResolve,
    Yyc: arg => arg,
    T5b: nativeSplitSegments,
    I: { CascadeConfigSchema: {}, CascadePlannerConfigSchema: {}, PromptSectionCustomizationConfigSchema: {}, PromptSectionSchema: {} },
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), unmountedCtx);
  const uAdapter = unmountedCtx.__agyNativeAdapter;
  assert.doesNotThrow(() => {
    uAdapter.setStageUpdates(true);
    uAdapter.setEfficientIO(true);
    uAdapter.setContextLimit(256000);
    uAdapter.setCodexProgress(true);
  });
  const uCfg = unmountedCtx.sjc({});
  assert.equal(uCfg.checkpointConfig.maxTokenLimit, 256000);
  // splitSegments merges multiple executionIds into a single segment while codexProgress is active
  const mergedSegs = unmountedCtx.T5b([subStep, midReplyStep, msgFromStep, finalStep], true, {});
  assert.equal(mergedSegs.length, 1);
  assert.equal(mergedSegs[0].executionId, 'e1');
  assert.equal(mergedSegs[0].steps.length, 4);
  assert.equal(mergedSegs[0].isLatest, true);
  uAdapter.dispose();
  assert.equal(unmountedCtx.T5b, nativeSplitSegments);

  // Test Case 2: multi-wakeup subagent turn (both inline subagent-only and collapsible body)
  let bodyMode = 'inline';
  const nativeSegment = arg => {
    if (bodyMode === 'inline') {
      return {
        leadingSteps: [],
        body: {
          type: 'inline',
          content: {
            groups: [
              { type: 'step', key: 'g1', step: subStep },
              { type: 'step', key: 'g2', step: midReplyStep },
              { type: 'step', key: 'g3', step: msgFromStep },
              { type: 'lastTextResponse', key: 'g4', step: finalStep }
            ]
          }
        },
        tailSteps: []
      };
    }
    return {
      leadingSteps: [],
      body: {
        type: 'collapsible',
        isActive: false,
        triggerVisible: true,
        defaultExpanded: false,
        content: { groups: [{ type: 'toolGroupCollapsible', key: 't1', steps: [] }] }
      },
      tailSteps: [
        { type: 'step', key: 'm1', step: msgFromStep },
        { type: 'lastTextResponse', key: 'm2', step: midReplyStep },
        { type: 'lastTextResponse', key: 'f1', step: finalStep }
      ]
    };
  };
  const ctx = vm.createContext({
    document: { querySelector: () => storeEl },
    location: { pathname: '/c/conv-sub' },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', splitSegments: 'T5b', menu: 'lHc' } },
    sjc: nativeResolve,
    Yyc: nativeSegment,
    T5b: nativeSplitSegments,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), ctx);
  const adapter = ctx.__agyNativeAdapter;
  adapter.setCodexProgress(true);

  const callArg = {
    isRunning: false,
    isLastTurn: true,
    segment: { isLatest: true, steps: [subStep, midReplyStep, msgFromStep, finalStep] }
  };

  // While direct subagent is still running, inline subagent turn stays unfolded
  const whileRunning = ctx.Yyc(callArg);
  assert.equal(whileRunning.body.type, 'inline');

  // Once direct subagent completes, inline subagent-only turn synthesizes collapsible fold above finalStep
  activeSubagentStatus = 1;
  const inlineFolded = ctx.Yyc(callArg);
  assert.equal(inlineFolded.body.type, 'collapsible');
  assert.equal(inlineFolded.body.defaultExpanded, false);
  assert.equal(inlineFolded.body.headerText, 'Worked for 32s');
  assert.equal(inlineFolded.body.content.groups.length, 3);
  assert.equal(inlineFolded.tailSteps.length, 1);
  assert.equal(inlineFolded.tailSteps[0].type, 'lastTextResponse');
  assert.equal(inlineFolded.tailSteps[0].step, finalStep);

  // When regular tools also ran (native collapsible body), tailSteps intermediate reply (converted from lastTextResponse -> step) and systemMessage fold into body.content.groups
  bodyMode = 'collapsible';
  const collapsibleFolded = ctx.Yyc(callArg);
  assert.equal(collapsibleFolded.body.type, 'collapsible');
  assert.equal(collapsibleFolded.body.defaultExpanded, false);
  assert.equal(collapsibleFolded.body.content.groups.length, 3);
  assert.equal(collapsibleFolded.body.content.groups[1].step, msgFromStep);
  assert.equal(collapsibleFolded.body.content.groups[2].type, 'step');
  assert.equal(collapsibleFolded.body.content.groups[2].step, midReplyStep);
  assert.equal(collapsibleFolded.tailSteps.length, 1);
  assert.equal(collapsibleFolded.tailSteps[0].step, finalStep);

  // Zero-tool turn preceded by an unrendered [Notice] systemMessage stays inline (no empty chevron)
  const hiddenNoticeStep = { status: 3, metadata: { executionId: 'e4' }, step: { case: 'systemMessage', value: { message: '' } } };
  const hiddenTurnSeg = vm.createContext({
    document: { querySelector: () => storeEl },
    location: { pathname: '/c/conv-sub' },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', splitSegments: 'T5b', menu: 'lHc' } },
    sjc: nativeResolve,
    Yyc: () => ({
      leadingSteps: [],
      body: {
        type: 'inline',
        content: {
          groups: [
            { type: 'step', key: 'h1', step: hiddenNoticeStep },
            { type: 'lastTextResponse', key: 'f2', step: finalStep }
          ]
        }
      },
      tailSteps: []
    }),
    T5b: nativeSplitSegments,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), hiddenTurnSeg);
  hiddenTurnSeg.__agyNativeAdapter.setCodexProgress(true);
  const noChevronResult = hiddenTurnSeg.Yyc({
    isRunning: false,
    isLastTurn: true,
    getStepRendererConfig: () => ({ isRendered: s => Boolean(s.step?.value?.message || s.step?.value?.response) }),
    segment: { isLatest: true, steps: [hiddenNoticeStep, finalStep] }
  });
  assert.equal(noChevronResult.body.type, 'inline');
  hiddenTurnSeg.__agyNativeAdapter.dispose();
  adapter.dispose();
});

test('codexComposerMedia intercepts 10KB/320px thumbnail compression to 160KB/640px and restores cleanly', async () => {
  const nativeCalls = [];
  const origCompress = async (dataUrl, mimeType, maxBytes, maxSide) => {
    nativeCalls.push({ dataUrl, mimeType, maxBytes, maxSide });
    return { dataUrl: 'data:image/jpeg;base64,THUMB', mimeType: 'image/jpeg' };
  };
  const context = vm.createContext({
    document: { querySelector: () => null },
    __agyNativeBindings: { names: { resolve: 'sjc', segment: 'Yyc', menu: 'lHc', imageCompress: 'imgCompressNative' } },
    sjc: () => ({}),
    Yyc: arg => arg,
    imgCompressNative: origCompress,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.codexComposerMedia, false);
  assert.equal(context.imgCompressNative, origCompress);

  adapter.setCodexComposerMedia(true);
  assert.equal(adapter.codexComposerMedia, true);
  assert.notEqual(context.imgCompressNative, origCompress);

  // 10KB / 320px thumbnail gets upgraded to 160KB / 640px
  await context.imgCompressNative('data:image/png;base64,AAA', 'image/png', 10240, 320);
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].maxBytes, 163840);
  assert.equal(nativeCalls[0].maxSide, 640);

  // 1MB / 1024px passes through to original when hdImages is off
  await context.imgCompressNative('data:image/png;base64,BBB', 'image/png', 1048576, 1024);
  assert.equal(nativeCalls.length, 2);
  assert.equal(nativeCalls[1].maxBytes, 1048576);
  assert.equal(nativeCalls[1].maxSide, 1024);

  // Master toggle off restores original
  adapter.setEnabled(false);
  assert.equal(adapter.codexComposerMedia, false);
  assert.equal(context.imgCompressNative, origCompress);

  adapter.setEnabled(true);
  assert.equal(adapter.codexComposerMedia, true);
  assert.notEqual(context.imgCompressNative, origCompress);

  adapter.setCodexComposerMedia(false);
  assert.equal(adapter.codexComposerMedia, false);
  assert.equal(context.imgCompressNative, origCompress);

  adapter.setCodexComposerMedia(true);
  adapter.dispose();
  assert.equal(context.imgCompressNative, origCompress);
});

test('resolveContextTarget and resolveInlineMediaPayload handle uploaded images, markdown images, @directory pills, artifact cards, and listDirectory step rows', async () => {
  const mkEl = ({ tagName = 'DIV', attrs = {}, closestMap = {}, qsMap = {}, qsaMap = {}, fiberNode = null, containsSet = null } = {}) => {
    const el = {
      tagName,
      src: attrs.src || '',
      getAttribute: k => (k in attrs ? attrs[k] : null),
      closest: sel => closestMap[sel] || null,
      querySelector: sel => qsMap[sel] || null,
      querySelectorAll: sel => qsaMap[sel] || [],
      contains: other => (containsSet ? containsSet.has(other) : other === el)
    };
    if (fiberNode) el['__reactFiber$test'] = fiberNode;
    return el;
  };
  const chatSelector = '[data-testid="user-input-step"],[data-testid="agent-response"],[data-testid="side-question-tab-content"]';
  const context = vm.createContext({
    atob,
    Uint8Array,
    TextEncoder,
    document: { querySelector: () => null },
    fetch: async url => ({
      ok: true,
      headers: { get: () => 'image/webp' },
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer
    })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  // 1. User uploaded inline image (no local path) -> inline-media + resolveInlineMediaPayload
  const inlineBytes = new Uint8Array([1, 2, 3, 4]);
  const userImg = mkEl({
    tagName: 'IMG',
    attrs: { src: 'blob:http://localhost/up-1' },
    closestMap: { [chatSelector]: {} },
    fiberNode: {
      memoizedProps: {
        mediaItem: {
          mimeType: 'image/png',
          description: 'paste-shot.png',
          payload: { case: 'inlineData', value: inlineBytes }
        }
      },
      return: null
    }
  });
  const userRes = adapter.resolveContextTarget(userImg);
  assert.equal(userRes.kind, 'inline-media');
  assert.equal(userRes.isMedia, true);
  assert.equal(userRes.inlineTarget.name, 'paste-shot.png');
  const payload = await adapter.resolveInlineMediaPayload(userRes.inlineTarget, userImg);
  assert.equal(payload.mode, 'media');
  assert.equal(payload.mimeType, 'image/png');
  assert.equal(payload.name, 'paste-shot.png');
  assert.deepEqual(Array.from(payload.bytes), [1, 2, 3, 4]);

  // 2. Markdown image with /static/artifacts/<cid>/... + artifactsDir -> file:// URI
  const mdImg = mkEl({
    tagName: 'IMG',
    attrs: { src: '/static/artifacts/cid-1/renders/chart%201.png' },
    closestMap: { [chatSelector]: {} },
    fiberNode: {
      memoizedProps: { src: '/static/artifacts/cid-1/renders/chart%201.png' },
      return: { memoizedProps: { artifactsDir: '/Users/dev/brain/cid-1' }, return: null }
    }
  });
  const mdRes = adapter.resolveContextTarget(mdImg);
  assert.equal(mdRes.kind, 'file');
  assert.equal(mdRes.uri, 'file:///Users/dev/brain/cid-1/renders/chart%201.png');
  assert.equal(mdRes.isMedia, true);

  // 3. @directory pill inside chat
  const dirPill = mkEl({
    tagName: 'SPAN',
    attrs: { 'data-uri': '/workspace/src/utils' },
    fiberNode: {
      memoizedProps: { item: { scopeItem: { case: 'directory', value: { absoluteUri: '/workspace/src/utils' } } } },
      return: null
    }
  });
  dirPill.closest = sel => {
    if (sel === chatSelector) return {};
    if (sel === '[data-uri], a[href^="file://"], .context-scope-mention') return dirPill;
    return null;
  };
  const pillRes = adapter.resolveContextTarget(dirPill);
  assert.equal(pillRes.kind, 'file');
  assert.equal(pillRes.uri, 'file:///workspace/src/utils');
  assert.equal(pillRes.isDirectory, true);

  // 4. Artifact card
  const card = mkEl({
    tagName: 'DIV',
    qsMap: { '[data-uri]': { getAttribute: k => k === 'data-uri' ? 'file:///Users/dev/plan.md' : null } }
  });
  const cardChild = mkEl({
    tagName: 'SPAN',
    closestMap: { '[data-testid="artifact-card"], [data-testid="bubble-artifact-card"]': card }
  });
  const cardRes = adapter.resolveContextTarget(cardChild);
  assert.equal(cardRes.kind, 'file');
  assert.equal(cardRes.uri, 'file:///Users/dev/plan.md');
  assert.equal(cardRes.isDirectory, false);

  // 5. listDirectory tool step row
  const stepRow = mkEl({
    tagName: 'DIV',
    fiberNode: {
      memoizedProps: { step: { step: { case: 'listDirectory', value: { directoryPathUri: 'file:///workspace/docs' } } } },
      return: null
    }
  });
  const stepChild = mkEl({
    tagName: 'SPAN',
    closestMap: { '[data-testid="agent-response"] [data-step-index]': stepRow }
  });
  const stepRes = adapter.resolveContextTarget(stepChild);
  assert.equal(stepRes.kind, 'file');
  assert.equal(stepRes.uri, 'file:///workspace/docs');
  assert.equal(stepRes.isDirectory, true);

  // 6. Data URL inline media fallback resolution
  const dataPayload = await adapter.resolveInlineMediaPayload({
    imgSrc: `data:image/jpeg;base64,${Buffer.from('JPEGDATA').toString('base64')}`,
    name: 'inline.jpg',
    mimeType: 'image/png'
  });
  assert.equal(dataPayload.mimeType, 'image/jpeg');
  assert.deepEqual(Array.from(dataPayload.bytes), Array.from(Buffer.from('JPEGDATA')));
});

test('attachFileToComposer with target side opens Side Question, clears URL tab param, and isolates from main composer', async () => {
  const dispatches = [];
  const mainAttached = [];
  const sideAttached = [];
  const mainMentions = [];
  const sideMentions = [];
  let sideMounted = false;
  let searchState = { tab: 'files', keep: '1' };

  const mainEditor = { focus() {} };
  const mainBox = {
    lexicalRef: { current: mainEditor },
    async attachFiles(files) { mainAttached.push(...files); },
    getInputCardElement: () => ({ scrollIntoView() {} })
  };
  const sideEditor = { focus() {} };
  const sideBox = {
    lexicalRef: { current: sideEditor },
    async attachFiles(files) { sideAttached.push(...files); },
    getInputCardElement: () => ({ scrollIntoView() {} })
  };

  const mainInputEl = {
    closest: () => null,
    '__reactFiber$mainIb': {
      tag: 10,
      memoizedProps: { value: { inputBoxRef: { current: mainBox }, getLexicalEditor: () => mainEditor } },
      return: null
    }
  };
  const sideInputEl = {
    '__reactFiber$sideIb': {
      tag: 10,
      memoizedProps: { value: { inputBoxRef: { current: sideBox }, getLexicalEditor: () => sideEditor } },
      return: null
    }
  };
  const sqRootEl = {
    querySelector: sel => sel.includes('agent-input-box') ? sideInputEl : null
  };
  const mainViewEl = {
    getAttribute: k => k === 'data-cascade-id' ? 'main-conv-1' : null,
    querySelector: sel => sel.includes('agent-input-box') ? mainInputEl : null
  };
  const sourceInMain = {
    closest: sel => sel === '[data-testid="conversation-view"]' ? mainViewEl : null
  };

  const reduxStore = {
    getState: () => ({
      trajectorySummaries: { summaries: { 'main-conv-1': { stepCount: 2 } } }
    }),
    dispatch(action) {
      dispatches.push(action);
      if (action.type === 'sidePanel/setSidePanelOpen' && action.payload?.isOpen) {
        sideMounted = true;
      }
    }
  };
  const routerObj = {
    state: { location: { search: searchState } },
    buildRouteTree() {},
    async navigate(opts) {
      if (typeof opts?.search === 'function') searchState = opts.search(searchState);
    }
  };
  const rootAnchor = {
    '__reactFiber$root': {
      tag: 10,
      memoizedProps: { value: { store: reduxStore } },
      return: {
        tag: 10,
        memoizedProps: { value: routerObj },
        return: null
      }
    }
  };

  const context = vm.createContext({
    Uint8Array,
    File,
    setTimeout,
    document: {
      activeElement: null,
      querySelector: sel => {
        if (sel.includes('side-question-tab-content')) return sideMounted ? sqRootEl : null;
        if (sel.includes('conversation-view')) return mainViewEl;
        if (sel === 'a[href="/customizations"]' || sel.includes('Message input')) return rootAnchor;
        return null;
      }
    },
    MUa: (ed, uri) => (ed === sideEditor ? sideMentions : mainMentions).push(uri),
    Shd: (kind, uri) => ({ kind, uri }),
    Gy: () => {}
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  // Target 'side' auto-opens side question, strips search.tab, and attaches bytes media only to side composer
  const sideRes = await adapter.attachFileToComposer(
    { mode: 'media', name: 'ref.png', mimeType: 'image/png', bytes: new Uint8Array([10, 20, 30]) },
    sourceInMain,
    { target: 'side' }
  );
  assert.equal(sideRes.ok, true);
  assert.equal(searchState.tab, undefined);
  assert.equal(searchState.keep, '1');
  assert.deepEqual(JSON.parse(JSON.stringify(dispatches)), [
    {
      type: 'sidePanelV2/setContent',
      payload: {
        panelScope: { kind: 'cascadeId', cascadeId: 'main-conv-1' },
        content: { type: 'sideQuestionView', sideQuestionView: {} },
        tabId: 'side_question__draft'
      }
    },
    {
      type: 'sidePanel/setSidePanelOpen',
      payload: {
        panelScope: { kind: 'cascadeId', cascadeId: 'main-conv-1' },
        isOpen: true
      }
    }
  ]);
  assert.equal(sideAttached.length, 1);
  assert.equal(sideAttached[0].name, 'ref.png');
  assert.equal(mainAttached.length, 0);

  // Target 'main' attaches to main composer even when sourceEl is inside side question
  const sourceInSide = {
    closest: sel => {
      if (sel === '[data-testid="side-question-tab-content"]') return sqRootEl;
      if (sel === '[data-quotable-fallback-cascade-id]') return { getAttribute: () => 'main-conv-1' };
      return null;
    }
  };
  await adapter.attachFileToComposer(
    { mode: 'mention', kind: 'file', uri: 'file:///workspace/index.js', name: 'index.js' },
    sourceInSide,
    { target: 'main' }
  );
  assert.deepEqual(mainMentions, ['file:///workspace/index.js']);
  assert.deepEqual(sideMentions, []);
});

test('extractQuotableSelection and attachSelectionToComposer quote main and Side Question cleanly', async () => {
  const insertedNodes = [];
  const dispatches = [];
  const clearedSelections = [];
  const events = [];
  const mainEditor = { focused: false, focus() { this.focused = true; }, getRootElement: () => null };
  const sideEditor = { focused: false, focus() { this.focused = true; }, getRootElement: () => null };
  const mainBox = { getInputCardElement: () => ({ scrollIntoView() {} }) };
  const sideBox = { getInputCardElement: () => ({ scrollIntoView() {} }) };

  const preEl = { closest: sel => sel === 'pre' ? preEl : null };
  const msgContainer = {
    contains: () => true,
    closest: sel => sel === '[data-quotable-root]' ? msgContainer : sel === '[data-testid="conversation-view"]' ? mainViewEl : null
  };
  const targetSpan = {
    closest: sel => {
      if (sel.includes('[contenteditable="true"]')) return null;
      if (sel === '[data-quotable-root]') return msgContainer;
      if (sel === '[data-testid="conversation-view"]') return mainViewEl;
      return null;
    }
  };
  const preText = { nodeType: 3, parentElement: { closest: sel => sel === 'pre' ? preEl : null } };
  const sqInputEl = {
    '__reactFiber$sq': { tag: 10, memoizedProps: { value: { inputBoxRef: { current: sideBox }, getLexicalEditor: () => sideEditor } }, return: null }
  };
  const sqRootEl = { querySelector: sel => sel.includes('agent-input-box') ? sqInputEl : null };
  const mainInputEl = {
    closest: () => null,
    '__reactFiber$main': { tag: 10, memoizedProps: { value: { inputBoxRef: { current: mainBox }, getLexicalEditor: () => mainEditor } }, return: null }
  };
  const mainViewEl = {
    getAttribute: k => k === 'data-cascade-id' ? 'conv-quote-1' : null,
    querySelector: sel => sel.includes('agent-input-box') ? mainInputEl : null
  };
  const reduxStore = {
    getState: () => ({
      sideQuestion: { pendingDraftQuotes: {} },
      trajectorySummaries: { summaries: { 'conv-quote-1': { stepCount: 3 } } }
    }),
    dispatch: action => dispatches.push(action)
  };
  const rootAnchor = {
    '__reactFiber$root': { tag: 10, memoizedProps: { value: { store: reduxStore } }, return: null }
  };

  let curSelection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'const x = 333.3335;',
    removeAllRanges: () => clearedSelections.push(true),
    getRangeAt: () => ({
      commonAncestorContainer: { nodeType: 1, closest: () => msgContainer },
      startContainer: preText,
      endContainer: preText,
      getClientRects: () => [{ top: 100, bottom: 120, left: 200, right: 320, width: 120, height: 20 }]
    })
  };

  const context = vm.createContext({
    getSelection: () => curSelection,
    MouseEvent: class { constructor(type, init) { this.type = type; this.bubbles = init?.bubbles; } },
    document: {
      dispatchEvent: ev => events.push(ev.type),
      querySelector: sel => {
        if (sel.includes('side-question-tab-content')) return sqRootEl;
        if (sel.includes('conversation-view')) return mainViewEl;
        if (sel === 'a[href="/customizations"]' || sel.includes('Message input')) return rootAnchor;
        return null;
      }
    },
    I: { ContextScopeItemSchema: { schema: 'ContextScopeItem' } },
    Wb: (_schema, payload) => payload,
    Gy: (editor, item) => insertedNodes.push({ editor, item })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  const snap = adapter.extractQuotableSelection(targetSpan);
  assert.equal(snap.text, 'const x = 333.3335;');
  assert.equal(snap.isCodeBlock, true);
  assert.equal(snap.inSideQuestion, false);
  assert.equal(snap.anchorRect.top, 100);

  // 1. Add selection to main chat
  const mainRes = await adapter.attachSelectionToComposer(snap, { target: 'main' });
  assert.equal(mainRes.ok, true);
  assert.equal(insertedNodes.length, 1);
  assert.equal(insertedNodes[0].editor, mainEditor);
  assert.equal(insertedNodes[0].item.scopeItem.case, 'textBlock');
  assert.equal(insertedNodes[0].item.scopeItem.value.identifier.value, 'code_block');
  assert.equal(mainEditor.focused, true);
  assert.equal(clearedSelections.length, 1);
  assert.deepEqual(events, ['mouseup']);

  // 2. Ask selection in Side Question (uses native Redux sidePanel + enqueueDraftSideQuestionQuote)
  const sideRes = await adapter.attachSelectionToComposer({ ...snap, isCodeBlock: false }, { target: 'side' });
  assert.equal(sideRes.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(dispatches)), [
    {
      type: 'sidePanelV2/setContent',
      payload: { panelScope: { kind: 'cascadeId', cascadeId: 'conv-quote-1' }, content: { type: 'sideQuestionView', sideQuestionView: {} }, tabId: 'side_question__draft' }
    },
    {
      type: 'sidePanel/setSidePanelOpen',
      payload: { panelScope: { kind: 'cascadeId', cascadeId: 'conv-quote-1' }, isOpen: true }
    },
    {
      type: 'sideQuestion/enqueueDraftSideQuestionQuote',
      payload: { parentCascadeId: 'conv-quote-1', text: 'const x = 333.3335;' }
    }
  ]);
  assert.equal(clearedSelections.length, 2);
});

test('codexProgress folds completed work immediately when final response starts streaming and unfolds back if another tool starts', () => {
  const toolDone = { type: 'step', key: 'cmd-1', step: { status: 3, metadata: { createdAt: { seconds: 100 }, completedAt: { seconds: 112 } }, step: { case: 'runCommand', value: {} } } };
  const toolRunning = { type: 'step', key: 'cmd-2', step: { status: 2, step: { case: 'runCommand', value: {} } } };
  const thinkingOnly = { type: 'step', key: 'think-1', step: { status: 2, step: { case: 'plannerResponse', value: { thought: 'thinking...', response: '' } } } };
  const streamingReply = { type: 'lastTextResponse', key: 'reply-1', step: { status: 2, step: { case: 'plannerResponse', value: { response: '这是正在流式输出的最终正文。', toolCalls: [] } } } };
  const inlineReplyStep = { type: 'step', key: 'reply-inline', step: streamingReply.step };

  const nativeSegment = arg => arg.mockResult;
  const context = vm.createContext({
    document: { querySelector: () => null },
    sjc: () => ({}),
    Yyc: nativeSegment,
    I: {},
    tc: (_, v) => structuredClone(v),
    Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  adapter.setCodexProgress(true);

  // 1. Running tool step stays unfolded (inline)
  const toolRunRes = context.Yyc({
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true, steps: [toolRunning.step] },
    mockResult: {
      leadingSteps: [],
      tailSteps: [],
      body: { type: 'collapsible', isActive: true, triggerVisible: false, defaultExpanded: true, content: { groups: [toolRunning] } }
    }
  });
  assert.equal(toolRunRes.body.type, 'inline');

  // 2. Thinking-only plannerResponse with empty response must NOT fold early
  const thinkingRes = context.Yyc({
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true, steps: [toolDone.step, thinkingOnly.step] },
    mockResult: {
      leadingSteps: [],
      tailSteps: [thinkingOnly],
      body: { type: 'collapsible', isActive: true, triggerVisible: false, defaultExpanded: true, content: { groups: [toolDone] } }
    }
  });
  assert.equal(thinkingRes.body.type, 'inline');

  // 3. Completed tool + streaming plain-text final reply folds work immediately while streaming reply
  const earlyFoldCollapsible = context.Yyc({
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true, steps: [toolDone.step, streamingReply.step] },
    mockResult: {
      leadingSteps: [],
      tailSteps: [streamingReply],
      body: { type: 'collapsible', headerText: 'Worked for 12s', isActive: true, triggerVisible: false, defaultExpanded: true, content: { groups: [toolDone] } }
    }
  });
  assert.equal(earlyFoldCollapsible.body.type, 'collapsible');
  assert.equal(earlyFoldCollapsible.body.defaultExpanded, false);
  assert.equal(earlyFoldCollapsible.body.isActive, false);
  assert.equal(earlyFoldCollapsible.body.triggerVisible, true);
  assert.equal(earlyFoldCollapsible.body.headerText, 'Worked for 12s');
  assert.equal(earlyFoldCollapsible.tailSteps[0].step.step.value.response, '这是正在流式输出的最终正文。');

  // 4. Inline segment shape without native collapsible also folds prefix work and preserves streaming final reply
  const earlyFoldInline = context.Yyc({
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true, steps: [toolDone.step, inlineReplyStep.step] },
    mockResult: {
      leadingSteps: [],
      tailSteps: [],
      body: { type: 'inline', content: { groups: [toolDone, inlineReplyStep] } }
    }
  });
  assert.equal(earlyFoldInline.body.type, 'collapsible');
  assert.equal(earlyFoldInline.body.defaultExpanded, false);
  assert.equal(earlyFoldInline.body.headerText, 'Worked for 12s');
  assert.equal(earlyFoldInline.tailSteps[0].type, 'lastTextResponse');
  assert.equal(earlyFoldInline.tailSteps[0].step, inlineReplyStep.step);

  // 5. If a new running tool starts mid-turn, dynamically unfold back to inline
  const reUnfolded = context.Yyc({
    isRunning: true,
    isLastTurn: true,
    segment: { isLatest: true, steps: [toolDone.step, streamingReply.step, toolRunning.step] },
    mockResult: {
      leadingSteps: [],
      tailSteps: [toolRunning],
      body: { type: 'collapsible', isActive: true, content: { groups: [toolDone, inlineReplyStep] } }
    }
  });
  assert.equal(reUnfolded.body.type, 'inline');
  adapter.dispose();
});

test('codexComposerMedia intercepts quotes into annotation store, keeps @file passthrough, prepends on flush/send, and restores cleanly', async () => {
  const nativeInserted = [];
  const sentPayloads = [];
  const changeEvents = [];
  let editorJson = {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: '那这个呢？' }] }]
    }
  };
  const editor = {
    focused: false,
    focus() { this.focused = true; },
    getRootElement: () => null,
    getEditorState: () => ({ toJSON: () => structuredClone(editorJson) }),
    setEditorState: next => {
      editorJson = typeof next === 'string' ? JSON.parse(next) : next;
    }
  };
  const originalGy = (ed, item) => {
    nativeInserted.push({ ed, item });
    const textLabel = item?.scopeItem?.value?.content || 'mention';
    editorJson = {
      root: {
        ...editorJson.root,
        children: [...editorJson.root.children, { type: 'paragraph', children: [{ type: 'quote-node', content: textLabel }] }]
      }
    };
  };
  const box = { getInputCardElement: () => ({ scrollIntoView() {} }) };
  const inputBoxEl = {
    '__reactFiber$box': { tag: 10, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } }, return: null }
  };
  const msgView = {
    getAttribute: k => k === 'data-cascade-id' ? 'conv-pill-1' : null,
    querySelector: () => inputBoxEl
  };
  const svcAnchor = {
    '__reactFiber$svc': {
      tag: 10,
      memoizedProps: {
        value: {
          forkConversation: async () => ({}),
          sendUserCascadeMessage: async payload => { sentPayloads.push(payload); }
        }
      },
      return: null
    }
  };
  const context = vm.createContext({
    document: {
      dispatchEvent() {},
      querySelector: sel => {
        if (sel.includes('conversation-view')) return msgView;
        if (sel.includes('customizations') || sel.includes('Message input')) return svcAnchor;
        return null;
      }
    },
    CG: { ContextScopeItemSchema: { name: 'ContextScope' }, TextOrScopeItemSchema: { name: 'TextOrScope' } },
    I: { CascadeConfigSchema: { name: 'CascadeConfig' } },
    tc: (_, v) => structuredClone(v),
    Wb: (_schema, v) => v,
    IJ: (_ed, str) => JSON.parse(str),
    LN: items => JSON.stringify({ root: { type: 'root', children: items.length ? [{ type: 'paragraph', children: items }] : [] } }),
    Gy: originalGy
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  const unsub = adapter.onComposerQuotesChange(() => changeEvents.push(true));

  adapter.setCodexComposerMedia(true);
  assert.notEqual(context.Gy, originalGy);

  // 1. Direct Gy quote call and attachSelectionToComposer are intercepted instead of inserted into editor immediately
  const res = await adapter.attachSelectionToComposer({ text: '第一条引用内容', source: msgView, root: msgView, isCodeBlock: false }, { target: 'main' });
  assert.equal(res.pill, true);
  context.Gy(editor, {
    scopeItem: { case: 'textBlock', value: { content: 'console.log(42)', identifier: { case: 'label', value: 'code_block' } } }
  });
  assert.equal(nativeInserted.length, 0);
  assert.equal(adapter.getComposerQuotes(editor).length, 2);
  assert.equal(changeEvents.length, 2);

  // 2. Non-quote @file scope item still passes directly through to originalGy
  const fileScope = { scopeItem: { case: 'file', value: { absoluteUri: 'file:///repo/app.js' } } };
  context.Gy(editor, fileScope);
  assert.equal(nativeInserted.length, 1);
  assert.equal(nativeInserted[0].item, fileScope);

  // 3. Removing one quote keeps remaining quote and fires change listener
  const firstId = adapter.getComposerQuotes(editor)[0].id;
  assert.equal(adapter.removeComposerQuote(editor, firstId), true);
  assert.equal(adapter.getComposerQuotes(editor).length, 1);

  // Reset user-only text before flush check
  editorJson = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '那这个呢？' }] }] } };
  const flushed = adapter.flushComposerQuotesToEditor(editor);
  assert.equal(flushed, 1);
  assert.equal(adapter.getComposerQuotes(editor).length, 0);
  // Quoted node must be prepended BEFORE existing user text in root.children
  assert.equal(editorJson.root.children[0].children[0].type, 'quote-node');
  assert.equal(editorJson.root.children[0].children[0].content, 'console.log(42)');
  assert.equal(editorJson.root.children[1].children[0].text, '那这个呢？');

  // 4. sendService fallback attaches quotes when sendUserCascadeMessage is called before DOM flush
  context.Gy(editor, {
    scopeItem: { case: 'textBlock', value: { content: '延迟发送的引用', identifier: { case: 'label', value: 'Quote' } } }
  });
  adapter.ensureRequestHook(svcAnchor);
  await svcAnchor['__reactFiber$svc'].memoizedProps.value.sendUserCascadeMessage({
    cascadeId: 'conv-pill-1',
    items: [{ chunk: { case: 'text', value: '正文' } }]
  });
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].items[0].chunk.case, 'item');
  assert.equal(sentPayloads[0].items[0].chunk.value.scopeItem.value.content, '延迟发送的引用');
  assert.equal(sentPayloads[0].items[1].chunk.value, '\n');
  assert.equal(sentPayloads[0].items[2].chunk.value, '正文');

  // 5. Turning codexComposerMedia off restores original Gy cleanly
  adapter.setCodexComposerMedia(false);
  assert.equal(context.Gy, originalGy);
  unsub();
  adapter.dispose();
});
