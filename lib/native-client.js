(() => {
  const version='1.1.0';
  const hookNames=globalThis.__agyNativeBindings?.names||{resolve:'sjc',segment:'Yyc',menu:'lHc'};
  if(globalThis.__agyNativeAdapter?.version===version&&globalThis.__agyNativeAdapter.active)return;
  globalThis.__agyNativeAdapter?.dispose?.();
  let disposed=false;
  const fiber = element => element?.[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
  function providers(element) {
    const result = [];
    for (let node = fiber(element); node; node = node.return) {
      if (node.tag === 10 && node.memoizedProps?.value !== undefined) result.push({ type: node.type, value: node.memoizedProps.value });
    }
    return result;
  }
  function service(source) {
    const entry = providers(source || pageSource()).find(p => typeof p.value?.forkConversation === 'function');
    if (!entry) throw new Error('Antigravity conversation service is unavailable');
    return entry.value;
  }
  function wrap(child, element) {
    return providers(element).reduce((tree, p) => B.createElement(p.type, { value: p.value }, tree), child);
  }
  const pageSource = () => document.querySelector('[aria-label="Message input"],[data-agy-original-aria-label="Message input"]') || document.querySelector('a[href="/customizations"]') || document.querySelector('#root')?.firstElementChild || document.body?.firstElementChild;
  const store = () => providers(pageSource()).map(p=>p.value?.store).find(s=>s?.getState&&s?.dispatch);
  const router = () => providers(pageSource()).map(p=>p.value).find(v=>typeof v?.navigate==='function'&&typeof v?.buildRouteTree==='function');
  const overview = () => providers(pageSource()).map(p=>p.value).find(v=>v?.cascadeId&&typeof v.togglePanel==='function'&&typeof v.setOverlayOpen==='function');
  const authService = () => providers(pageSource()).find(p=>p.value?.core?.authService)?.value?.core?.authService || null;
  function capabilities() {
    const p=providers(pageSource()),s=store()?.getState(),context=p.find(p=>p.value?.cascadeContext)?.value;
    const model=context?.cascadeContext?.state?.selectedModel;
    return {email:s?.userStatus?.email||'',name:s?.userStatus?.name||'',avatarUrl:s?.userStatus?.profilePictureUrl||'',subscription:globalThis.__agyDashboard?.subscriptionIdentity(s?.userStatus?.userTier),plan:s?.userStatus?.userTier?.name||'',planId:s?.userStatus?.userTier?.id||'',models:s?.userStatus?.cascadeModelConfigData?.clientModelConfigs?.map(m=>({label:m.label,modelId:m.modelId}))||[],model:model?.label||'',contextOptions:model?.contextWindowOptions||[],
      contextSelectionEnabled:!!p.find(p=>p.value?.getCache&&p.value?.featureNames)?.value.get('contextWindowSelector')?.enabled};
  }
  async function startAccountLogin() {
    const auth=authService();
    if(!auth||typeof auth.loginWithRedirect!=='function')throw new Error('当前客户端不支持发起登录');
    await auth.loginWithRedirect({});
    await auth.refreshUserStatus?.().catch(()=>{});
    await auth.checkCurrentAuthStatus?.().catch(()=>{});
    const cap=capabilities();
    return {ok:true,email:cap.email,name:cap.name};
  }
  function executionState(conversationId) {
    if(!conversationId)return null;
    const inputs=typeof document?.querySelectorAll==='function'?[...document.querySelectorAll('[aria-label="Message input"],[data-agy-original-aria-label="Message input"]')]:[];
    let state=null;
    for(const el of inputs){
      const candidate=providers(el).find(p=>p.value?.cascadeContext)?.value?.cascadeContext?.state?.agentStateProvider?.getState?.();
      if(candidate?.conversationId===conversationId){state=candidate;break;}
    }
    if(!state){
      const fallback=providers(pageSource()).find(p=>p.value?.cascadeContext)?.value?.cascadeContext?.state?.agentStateProvider?.getState?.();
      if(fallback?.conversationId===conversationId)state=fallback;
    }
    const turnStartStepIndex=state?.turns?.at(-1)?.startStepIndex;
    if(!state||!Number.isInteger(turnStartStepIndex))return null;
    let live=null,isSystemTurn=false,userTurnStartStepIndex=null;
    try{
      const slice=state?.trajectorySlice;
      const steps=Array.isArray(slice?.stepsInSlice)?slice.stepsInSlice:null;
      if(steps&&steps.length){
        const baseIdx=Number(slice?.stepsSlice?.startIndex||0);
        const startStep=steps[turnStartStepIndex-baseIdx]||null;
        const startCase=String(startStep?.step?.case||'');
        if(startCase&&startCase!=='userInput')isSystemTurn=true;
        if(startCase==='userInput'){
          userTurnStartStepIndex=turnStartStepIndex;
        }else if(Array.isArray(state?.turns)){
          for(let i=state.turns.length-1;i>=0;i--){
            const idx=state.turns[i]?.startStepIndex;
            if(!Number.isInteger(idx))continue;
            const st=steps[idx-baseIdx];
            if(!st)break;
            if(st?.step?.case==='userInput'){userTurnStartStepIndex=idx;break;}
          }
        }
        const turnTail=steps.filter((_,idx)=>baseIdx+idx>=turnStartStepIndex);
        const last=turnTail.at(-1)||null;
        if(last){
          const waiting=turnTail.some(s=>s?.status===9);
          const lastCase=String(last?.step?.case||'');
          const lastStatus=Number(last?.status||0);
          const val=last?.step?.value||{};
          const toolCalls=Array.isArray(val.toolCalls)?val.toolCalls:[];
          const toolName=String(last?.metadata?.toolCall?.name||toolCalls.at(-1)?.name||'').trim();
          const errObj=lastCase==='errorMessage'?(val.error||val):null;
          const errorText=errObj?String(errObj.userErrorMessage||errObj.shortError||errObj.message||'').trim().slice(0,180):'';
          const gens=Array.isArray(slice?.generatorMetadatasInSlice)?slice.generatorMetadatasInSlice:[];
          const lastGen=gens.at(-1);
          const genError=lastGen?.error?String(lastGen.error).trim().slice(0,180):'';
          live={
            waiting,
            lastCase,
            lastStatus,
            hasThinking:Boolean(typeof val.thinking==='string'&&val.thinking.trim()),
            hasResponse:Boolean(typeof val.response==='string'&&val.response.trim()),
            toolCallCount:toolCalls.length,
            toolName,
            errorText,
            genError
          };
        }
      }
    }catch{}
    const summary=store()?.getState?.()?.trajectorySummaries?.summaries?.[conversationId];
    const notFullyIdle=Boolean(summary?.notFullyIdle);
    const activeSubagents=subagents(conversationId)
      .filter(s=>s.status==='running'||s.status==='stopping')
      .map(s=>({title:s.title,status:s.status}));
    return {
      conversationId,status:state.status,turnStartStepIndex,terminationReason:state.executorMetadata?.terminationReason,
      ...(isSystemTurn?{isSystemTurn:true}:{}),
      ...(Number.isInteger(userTurnStartStepIndex)&&userTurnStartStepIndex!==turnStartStepIndex?{userTurnStartStepIndex}:{}),
      ...(notFullyIdle?{notFullyIdle:true}:{}),
      ...(activeSubagents.length?{activeSubagents}:{}),
      ...(live?{live}:{})
    };
  }
  function runningConversationIds() {
    const ids = new Set();
    const isTerminalReason = reason => reason === 2 || [1, 3, 6, 11].includes(reason);
    const isActiveSummary = summary => {
      if (!summary || summary.killed) return false;
      const st = summary.status;
      if (st === 2 || st === 4) return true;
      if (st === 1 && !isTerminalReason(summary.terminationReason) && Boolean(summary.notFullyIdle)) return true;
      return false;
    };
    const isActiveExec = exec => {
      if (!exec) return false;
      if (exec.status === 2 || exec.status === 4) return true;
      if (exec.status === 1 && !isTerminalReason(exec.terminationReason) && Boolean(exec.notFullyIdle || exec.activeSubagents?.length)) return true;
      return false;
    };
    try {
      const summaries = store()?.getState?.()?.trajectorySummaries?.summaries;
      if (summaries && typeof summaries === 'object') {
        for (const [cid, summary] of Object.entries(summaries)) {
          if (isActiveSummary(summary)) ids.add(cid);
        }
      }
    } catch {}
    try {
      const activeCid = location.pathname.match(/^\/c\/([^/]+)/)?.[1] || '';
      if (activeCid) {
        const exec = executionState(activeCid);
        if (isActiveExec(exec)) ids.add(activeCid);
      }
    } catch {}
    return [...ids];
  }
  function unreadCount(activeId='',focused=true) {
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return 0;
    const localViewed=s?.conversation?.localLastViewedTimes||{};
    let count=0;
    for(const [id,summary] of Object.entries(summaries)){
      if(!summary||summary.annotations?.archived||summary.notFullyIdle)continue;
      if(summary.parentConversationId||Number(summary.nestingDepth||0)>0)continue;
      if(summary.annotations?.markedAsUnread){count++;continue;}
      if(id===activeId&&focused)continue;
      const modified=Number(summary.lastModifiedTime?.seconds||0);
      const viewed=Math.max(Number(summary.annotations?.lastUserViewTime?.seconds||0),Number(localViewed[id]||0));
      if(modified>0&&viewed>0&&modified>viewed)count++;
    }
    return count;
  }
  function extractWorkspaceUriFromSummary(summary) {
    const meta=summary?.trajectoryMetadata||summary||{};
    const ws=Array.isArray(meta.workspaces)?meta.workspaces[0]:null;
    const candidates=[
      ws?.workspaceFolderAbsoluteUri,
      ws?.gitRootAbsoluteUri,
      ws?.absoluteUri,
      meta.workspaceFolderAbsoluteUri,
      meta.cwdUri,
      meta.workingDirectoryUri,
      summary?.workspaceFolderAbsoluteUri
    ];
    for(const item of candidates){
      if(typeof item==='string'&&item.trim().startsWith('file://'))return item.trim();
    }
    return '';
  }
  function workspaceNameFromUri(uri) {
    if(!uri)return '';
    try{
      const clean=decodeURIComponent(String(uri).split('#')[0].split('?')[0]).replace(/[\\/]+$/,'');
      return clean.split(/[\\/]/).filter(Boolean).pop()||'';
    }catch{return '';}
  }
  function conversationDirectory() {
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return {projects:[],byId:{},subagentIds:[]};
    const storeProjects=s?.projects?.projects||s?.workspaces?.workspaces||{};
    const byId={},subagentIds=[];
    const projectBuckets=new Map();
    for(const [id,summary] of Object.entries(summaries)){
      if(!summary)continue;
      const meta=summary.trajectoryMetadata||{};
      const isSubagent=Boolean(summary.parentConversationId||meta.parentConversationId||Number(summary.nestingDepth||meta.nestingDepth||0)>0);
      if(isSubagent){subagentIds.push(id);continue;}
      const archived=Boolean(summary.annotations?.archived);
      const title=String(summary.annotations?.title||summary.summary||'').trim();
      const wsUri=extractWorkspaceUriFromSummary(summary);
      const projectId=String(meta.projectId||summary.projectId||'').trim();
      const rawProj=projectId?storeProjects?.[projectId]:null;
      const projectName=String(rawProj?.name||rawProj?.title||workspaceNameFromUri(wsUri)||'').trim();
      const modifiedSec=Number(summary.lastModifiedTime?.seconds||meta.createdAt?.seconds||summary.createdTime?.seconds||0);
      const updatedAtMs=modifiedSec>0?modifiedSec*1000:0;
      byId[id]={id,title,projectId,projectName,archived,updatedAtMs};
      const pKey=projectId||(projectName?`name:${projectName}`:'');
      if(pKey&&projectName){
        let bucket=projectBuckets.get(pKey);
        if(!bucket){bucket={id:pKey,projectId,label:projectName,conversationIds:[],updatedAtMs:0};projectBuckets.set(pKey,bucket);}
        bucket.conversationIds.push(id);
        if(updatedAtMs>bucket.updatedAtMs)bucket.updatedAtMs=updatedAtMs;
      }
    }
    const projects=[...projectBuckets.values()].sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||a.label.localeCompare(b.label));
    return {projects,byId,subagentIds};
  }
  function subagents(conversationId='') {
    if(!conversationId)return [];
    const summaries=store()?.getState?.()?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return [];
    const byId=new Map(Object.entries(summaries));
    const belongs=id=>{
      let cur=id;
      for(let depth=0;depth<8&&cur;depth++){
        const item=byId.get(cur);
        const meta=item?.trajectoryMetadata;
        const parent=meta?.parentConversationId||item?.parentConversationId||'';
        const root=meta?.rootConversationId||'';
        if(parent===conversationId||root===conversationId)return true;
        if(!parent||parent===cur)break;
        cur=parent;
      }
      return false;
    };
    const out=[];
    for(const [id,entry] of byId){
      if(!entry||id===conversationId||!belongs(id))continue;
      const meta=entry.trajectoryMetadata||{};
      const spec=meta.subagentSpec||{};
      const createdSec=Number(meta.createdAt?.seconds||entry.createdTime?.seconds||0);
      const modifiedSec=Number(entry.lastModifiedTime?.seconds||0);
      const status=entry.killed?'killed':(entry.status===2||entry.status===4)?'running':entry.status===3?'stopping':'done';
      out.push({
        id,
        parentId:meta.parentConversationId||entry.parentConversationId||'',
        depth:Number(meta.nestingDepth||entry.nestingDepth||1),
        typeName:String(spec.typeName||'').trim(),
        role:String(spec.role||'').trim(),
        title:String(spec.role||entry.summary||spec.typeName||'Subagent').trim(),
        status,
        stepCount:Number(entry.stepCount||0),
        createdAtMs:createdSec>0?createdSec*1000:null,
        lastModifiedAtMs:modifiedSec>0?modifiedSec*1000:null
      });
    }
    return out.sort((a,b)=>(a.depth-b.depth)||((a.createdAtMs||0)-(b.createdAtMs||0))||a.id.localeCompare(b.id));
  }
  function openSubagent(id='') {
    if(!id||typeof document==='undefined')return false;
    for(const node of document.querySelectorAll('[data-testid="subagent-node"][data-cascade-id]')){
      if(node.dataset?.cascadeId===id){node.click();return true;}
    }
    const r=router();
    if(r?.navigate){void r.navigate({to:`/c/${id}`});return true;}
    return false;
  }
  function composerCascadeId(element) {
    for(let n=fiber(element);n;n=n.return){
      const p=n.memoizedProps;
      const id=p?.conversationId||p?.effectiveCascadeId||p?.cascadeId||p?.value?.cascadeId||p?.value?.cascadeContext?.cascadeId||p?.value?.cascadeContext?.state?.conversationId;
      if(typeof id==='string'&&id)return id;
    }
    return '';
  }
  function fileTreeEntry(element) {
    const row=element?.closest?.('[role="treeitem"]');
    if(!row)return null;
    for(let node=fiber(row),depth=0;node&&depth<6;node=node.return,depth++){
      const entry=node.memoizedProps?.entry;
      if(entry&&typeof entry.uri==='string'&&entry.uri.startsWith('file://')){
        return {uri:entry.uri,isDirectory:entry.fileType===2};
      }
    }
    const iconEl=row.querySelector?.('[data-testid="file-tree-node-icon"]');
    if(iconEl){
      for(let node=fiber(iconEl)?.child,depth=0;node&&depth<6;node=node.child,depth++){
        const p=node.memoizedProps;
        if(p&&typeof p.uri==='string'&&p.uri.startsWith('file://')){
          return {uri:p.uri,isDirectory:Boolean(p.isDirectory)};
        }
      }
    }
    return null;
  }
  function escAttr(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function resolveMainCascadeId(sourceEl) {
    const viewCid = sourceEl?.closest?.('[data-testid="conversation-view"]')?.getAttribute?.('data-cascade-id');
    if (viewCid && viewCid !== 'conversation') return viewCid;
    const fbCid = sourceEl?.closest?.('[data-quotable-fallback-cascade-id]')?.getAttribute?.('data-quotable-fallback-cascade-id');
    if (fbCid) return fbCid;
    if (typeof location !== 'undefined' && typeof location.pathname === 'string') {
      const m = location.pathname.match(/\/c\/([^/?#]+)/);
      if (m?.[1]) {
        try { return decodeURIComponent(m[1]); } catch { return m[1]; }
      }
    }
    const docCid = typeof document !== 'undefined' ? document.querySelector?.('[data-testid="conversation-view"]')?.getAttribute?.('data-cascade-id') : '';
    if (docCid && docCid !== 'conversation') return docCid;
    return '';
  }
  function composerFromAnchor(anchor) {
    if (!anchor) return null;
    const list = providers(anchor);
    const ibCtx = list.find(p => p.value?.inputBoxRef && typeof p.value?.getLexicalEditor === 'function')?.value;
    const chatCtx = list.find(p => p.value?.inputBoxRef?.current)?.value;
    const box = ibCtx?.inputBoxRef?.current || chatCtx?.inputBoxRef?.current;
    const editor = box?.lexicalRef?.current || ibCtx?.getLexicalEditor?.();
    if (box || editor) return { box, editor };
    return null;
  }
  function findComposer(sourceEl, target = 'auto') {
    if (target === 'side') {
      const cid = resolveMainCascadeId(sourceEl);
      const sqRoot = (typeof document !== 'undefined' && cid ? document.querySelector?.(`[data-testid="side-question-tab-content"][data-quotable-fallback-cascade-id="${escAttr(cid)}"]`) : null)
        || sourceEl?.closest?.('[data-testid="side-question-tab-content"]')
        || (typeof document !== 'undefined' ? document.querySelector?.('[data-testid="side-question-tab-content"]') : null);
      const sqInput = sqRoot?.querySelector?.('[data-testid="side-question-tab-composer"] [data-testid="agent-input-box"]')
        || sqRoot?.querySelector?.('[data-testid="agent-input-box"]');
      return sqInput ? composerFromAnchor(sqInput) : null;
    }
    if (target === 'main') {
      const cid = resolveMainCascadeId(sourceEl);
      const mainView = sourceEl?.closest?.('[data-testid="conversation-view"]')
        || (typeof document !== 'undefined' && cid ? document.querySelector?.(`[data-testid="conversation-view"][data-cascade-id="${escAttr(cid)}"]`) : null)
        || (typeof document !== 'undefined' ? document.querySelector?.('[data-testid="conversation-view"]') : null);
      const anchors = [];
      const mainInput = mainView?.querySelector?.('[data-testid="agent-input-box"],[aria-label="Message input"],[data-agy-original-aria-label="Message input"]');
      if (mainInput && !mainInput.closest?.('[data-testid="side-question-tab-content"]')) anchors.push(mainInput);
      if (sourceEl && !sourceEl.closest?.('[data-testid="side-question-tab-content"]')) anchors.push(sourceEl);
      const ps = typeof document !== 'undefined' ? pageSource() : null;
      if (ps && !ps.closest?.('[data-testid="side-question-tab-content"]')) anchors.push(ps);
      for (const anchor of anchors) {
        const found = composerFromAnchor(anchor);
        if (found) return found;
      }
      return null;
    }
    const anchors = [];
    const scopedView = sourceEl?.closest?.('[data-testid="conversation-view"]');
    const scopedInput = scopedView?.querySelector?.('[data-testid="agent-input-box"],[aria-label="Message input"],[data-agy-original-aria-label="Message input"]');
    if (scopedInput) anchors.push(scopedInput);
    if (sourceEl) anchors.push(sourceEl);
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const activeInput = activeEl?.closest?.('[data-testid="agent-input-box"]');
    if (activeInput) anchors.push(activeInput);
    const mainInput = typeof document !== 'undefined'
      ? (document.querySelector('[data-testid="conversation-view"] [data-testid="agent-input-box"]')
        || document.querySelector('[data-testid="agent-input-box"]')
        || pageSource())
      : null;
    if (mainInput) anchors.push(mainInput);
    for (const anchor of anchors) {
      const found = composerFromAnchor(anchor);
      if (found) return found;
    }
    return null;
  }
  async function ensureSideQuestionComposer(sourceEl, timeoutMs = 2200) {
    const existing = findComposer(sourceEl, 'side');
    if (existing?.box && existing?.editor) return existing;
    const mainCascadeId = resolveMainCascadeId(sourceEl);
    if (!mainCascadeId) throw new Error('未找到当前主对话');
    const s = store();
    const st = s?.getState?.();
    const summary = st?.trajectorySummaries?.summaries?.[mainCascadeId];
    const hasSteps = Number(summary?.stepCount || 0) > 0
      || Boolean(typeof document !== 'undefined' && document.querySelector?.('[data-testid="conversation-view"] [data-testid="user-input-step"]'));
    if (!hasSteps) throw new Error('请先在主对话发送一条消息后再发起侧边对话');
    const r = router();
    if (r?.state?.location?.search?.tab && typeof r.navigate === 'function') {
      try {
        await r.navigate({
          search: prev => { const next = { ...prev }; delete next.tab; return next; },
          replace: true
        });
      } catch {}
    }
    if (!s?.dispatch) throw new Error('侧边对话不可用');
    s.dispatch({
      type: 'sidePanelV2/setContent',
      payload: {
        panelScope: { kind: 'cascadeId', cascadeId: mainCascadeId },
        content: { type: 'sideQuestionView', sideQuestionView: {} },
        tabId: 'side_question__draft'
      }
    });
    s.dispatch({
      type: 'sidePanel/setSidePanelOpen',
      payload: {
        panelScope: { kind: 'cascadeId', cascadeId: mainCascadeId },
        isOpen: true
      }
    });
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const ready = findComposer(sourceEl, 'side');
      if (ready?.box && ready?.editor) return ready;
      if (Date.now() >= deadline) break;
      if (typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 35));
      else break;
    }
    throw new Error('侧边对话输入框未就绪');
  }
  function extractMediaBytes(raw) {
    if (!raw) return null;
    const tag = Object.prototype.toString.call(raw);
    if (tag === '[object Uint8Array]') return raw;
    if (tag === '[object ArrayBuffer]') return new Uint8Array(raw);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView?.(raw)) {
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }
    if (Array.isArray(raw) || typeof raw.length === 'number') return new Uint8Array(raw);
    return null;
  }
  async function attachFileToComposer(fileInfo, sourceEl, options = {}) {
    if (!fileInfo || typeof fileInfo !== 'object') throw new Error('文件信息无效');
    const modeTarget = options?.target === 'side' ? 'side' : options?.target === 'main' ? 'main' : 'auto';
    const target = modeTarget === 'side' ? await ensureSideQuestionComposer(sourceEl) : findComposer(sourceEl, modeTarget);
    if (!target || (!target.box && !target.editor)) throw new Error('未找到可用的会话输入框');
    const { box, editor } = target;
    if (fileInfo.mode === 'media' && typeof box?.attachFiles === 'function') {
      let file = fileInfo.file && typeof fileInfo.file === 'object' && typeof fileInfo.file.size === 'number' ? fileInfo.file : null;
      if (!file) {
        let bytes = extractMediaBytes(fileInfo.bytes);
        if (!bytes && fileInfo.base64) {
          const raw = atob(fileInfo.base64);
          bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        }
        if (bytes) {
          const mime = fileInfo.mimeType || 'application/octet-stream';
          const fileName = fileInfo.name || 'attachment';
          file = typeof File === 'function'
            ? new File([bytes], fileName, { type: mime })
            : (typeof Blob === 'function'
              ? Object.assign(new Blob([bytes], { type: mime }), { name: fileName })
              : { name: fileName, type: mime, size: bytes.byteLength, bytes });
        }
      }
      if (file) {
        await box.attachFiles([file]);
        editor?.focus?.();
        box.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, mode: 'media', name: fileInfo.name || file.name || '' };
      }
    }
    const uri = String(fileInfo.uri || '').trim();
    const isDir = Boolean(fileInfo.isDirectory || fileInfo.kind === 'directory');
    if (editor && uri) {
      if (isDir && typeof Gy === 'function' && typeof Shd === 'function') {
        Gy(editor, Shd('directory', uri));
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, mode: 'mention', kind: 'directory', name: fileInfo.name || '' };
      }
      if (!isDir && typeof MUa === 'function') {
        MUa(editor, uri);
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, mode: 'mention', kind: 'file', name: fileInfo.name || '' };
      }
      if (typeof Gy === 'function' && typeof Shd === 'function') {
        Gy(editor, Shd(isDir ? 'directory' : 'file', uri));
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, mode: 'mention', kind: isDir ? 'directory' : 'file', name: fileInfo.name || '' };
      }
    }
    throw new Error('当前输入框暂不支持直接引用该文件');
  }
  function toLocalFileUri(rawPathOrUri, artifactsDir = '') {
    const raw = typeof rawPathOrUri === 'string' ? rawPathOrUri.trim() : '';
    if (!raw) return '';
    if (/^file:\/\//i.test(raw)) return raw;
    const toUri = p => {
      const s = String(p || '').trim();
      if (!s) return '';
      if (/^file:\/\//i.test(s)) return s;
      if (/^[A-Za-z]:[\\/]/.test(s)) return encodeURI(`file:///${s.replace(/\\/g, '/')}`);
      if (s.startsWith('/')) return encodeURI(`file://${s}`);
      return '';
    };
    if (raw.startsWith('/static/')) {
      const m = raw.match(/^\/static\/artifacts\/[^/]+\/(.+)$/);
      if (!m || !artifactsDir) return '';
      const base = String(artifactsDir).trim().replace(/[\\/]+$/, '');
      let rel = m[1].replace(/^[\\/]+/, '');
      try { rel = decodeURIComponent(rel); } catch {}
      return toUri(`${base}/${rel}`);
    }
    if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
      return toUri(raw);
    }
    if (artifactsDir && !/^(?:data|blob|https?):/i.test(raw)) {
      const base = String(artifactsDir).trim().replace(/[\\/]+$/, '');
      const rel = raw.replace(/^(?:\.\/|\\\/|\/)+/, '').replace(/\\/g, '/');
      if (!rel) return '';
      return toUri(`${base}/${rel}`);
    }
    return '';
  }
  function guessMimeFromExt(pathOrUri) {
    const clean = String(pathOrUri || '').split('#')[0].split('?')[0].toLowerCase();
    const ext = clean.match(/\.([a-z0-9]+)$/)?.[1] || '';
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
      avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
      pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', json: 'application/json'
    };
    return map[ext] || '';
  }
  function pathBasename(raw, fallback = 'image.png') {
    const s = String(raw || '').split('#')[0].split('?')[0].replace(/[\\/]+$/, '');
    if (!s) return fallback;
    try {
      const decoded = decodeURIComponent(s);
      return decoded.split(/[\\/]/).filter(Boolean).pop() || fallback;
    } catch {
      return s.split(/[\\/]/).filter(Boolean).pop() || fallback;
    }
  }
  function resolveContextTarget(targetEl) {
    if (!targetEl || typeof targetEl.closest !== 'function') return null;
    if (targetEl.closest('[data-agy-powertools-root],[contenteditable="true"],input,textarea,[data-testid="input-attachment-remove"]')) return null;
    const inChat = targetEl.closest('[data-testid="user-input-step"],[data-testid="agent-response"],[data-testid="side-question-tab-content"]');
    if (inChat && !targetEl.closest('[data-testid="media-overflow-menu"]')) {
      const docChip = targetEl.closest('[data-testid="user-message-document-chip"]');
      const imgEl = docChip
        ? null
        : (targetEl.tagName === 'IMG'
          ? targetEl
          : targetEl.closest('[data-testid="user-message-media-scroll"] button, [data-testid="image-strip-tile"], .group\\/media button')?.querySelector?.('img'));
      const mediaAnchor = docChip || imgEl;
      if (mediaAnchor) {
        let mediaItem = null, resolveUrl = null, originalFilePath = '', rawPropSrc = '', artifactsDir = '';
        for (let node = fiber(mediaAnchor), depth = 0; node && depth < 20; node = node.return, depth++) {
          const p = node.memoizedProps;
          if (!p || typeof p !== 'object') continue;
          if (!mediaItem) mediaItem = p.mediaItem || p.step?.generatedMedia || null;
          if (!resolveUrl && typeof p.resolveUrl === 'function') resolveUrl = p.resolveUrl;
          if (!originalFilePath) {
            const cand = p.originalFilePath || p.image?.resolution?.originalFilePath || p.image?.itemSrc;
            if (typeof cand === 'string' && cand) originalFilePath = cand;
          }
          if (!rawPropSrc && typeof p.src === 'string' && p.src) rawPropSrc = p.src;
          if (!artifactsDir && typeof p.artifactsDir === 'string' && p.artifactsDir) artifactsDir = p.artifactsDir;
        }
        const descPath = typeof mediaItem?.description === 'string' && /^(?:file:\/\/|\/|[A-Za-z]:[\\/])/.test(mediaItem.description)
          ? mediaItem.description
          : '';
        const imgSrc = (typeof imgEl?.getAttribute === 'function' ? imgEl.getAttribute('src') : '') || imgEl?.src || rawPropSrc || '';
        const uri = toLocalFileUri(mediaItem?.uri || originalFilePath || descPath || rawPropSrc || imgSrc, artifactsDir);
        const name = pathBasename(mediaItem?.description || originalFilePath || uri || 'image.png');
        const mimeType = mediaItem?.mimeType || guessMimeFromExt(uri || imgSrc) || 'image/png';
        const inlineTarget = { mediaItem, resolveUrl, imgSrc, name, mimeType };
        if (uri) return { kind: 'file', uri, isDirectory: false, isMedia: Boolean(imgEl || mediaItem), inlineTarget, source: mediaAnchor };
        if (mediaItem || imgEl) return { kind: 'inline-media', uri: '', isDirectory: false, isMedia: true, inlineTarget, source: mediaAnchor };
      }
      const pill = targetEl.closest('[data-uri], a[href^="file://"], .context-scope-mention');
      if (pill) {
        const btn = targetEl.closest('button,[role="button"]');
        if (!btn || btn === pill || btn.contains?.(pill) || pill.contains?.(btn)) {
          let rawUri = pill.getAttribute?.('data-uri') || pill.getAttribute?.('href') || '';
          let isDirectory = false;
          for (let node = fiber(pill), depth = 0; node && depth < 12; node = node.return, depth++) {
            const p = node.memoizedProps;
            if (!p || typeof p !== 'object') continue;
            if (!rawUri) {
              const cand = p.fileUri || p.uri || p.item?.scopeItem?.value?.absoluteUri || p.scopeItem?.scopeItem?.value?.absoluteUri;
              if (typeof cand === 'string' && cand) rawUri = cand;
            }
            if (p.isDirectory || p.scopeItem?.scopeItem?.case === 'directory' || p.item?.scopeItem?.case === 'directory') {
              isDirectory = true;
            }
            if (rawUri && isDirectory) break;
          }
          const uri = toLocalFileUri(rawUri);
          if (uri) return { kind: 'file', uri, isDirectory, source: pill };
        }
      }
    }
    const card = targetEl.closest('[data-testid="artifact-card"], [data-testid="bubble-artifact-card"]');
    if (card) {
      const btn = targetEl.closest('button');
      if (!btn || card.tagName === 'BUTTON' || btn === card) {
        let rawUri = card.getAttribute?.('data-uri') || card.querySelector?.('[data-uri]')?.getAttribute?.('data-uri') || '';
        if (!rawUri) {
          for (let node = fiber(card), depth = 0; node && depth < 10; node = node.return, depth++) {
            const p = node.memoizedProps;
            if (p && typeof p === 'object') {
              const cand = p.uri || p.fileUri;
              if (typeof cand === 'string' && cand) { rawUri = cand; break; }
            }
          }
        }
        const uri = toLocalFileUri(rawUri);
        if (uri) return { kind: 'file', uri, isDirectory: false, source: card };
      }
    }
    const stepRow = targetEl.closest('[data-testid="agent-response"] [data-step-index]');
    if (stepRow && !targetEl.closest('button:not([aria-expanded]), pre, code, [data-markdown-root]')) {
      const uriEls = stepRow.querySelectorAll?.('[data-uri]');
      if (uriEls?.length === 1) {
        const uEl = uriEls[0];
        const rawUri = uEl.getAttribute?.('data-uri') || '';
        let isDirectory = false;
        for (let node = fiber(uEl), depth = 0; node && depth < 8; node = node.return, depth++) {
          const p = node.memoizedProps;
          if (p?.isDirectory || p?.scopeItem?.scopeItem?.case === 'directory' || p?.item?.scopeItem?.case === 'directory') {
            isDirectory = true;
            break;
          }
        }
        const uri = toLocalFileUri(rawUri);
        if (uri) return { kind: 'file', uri, isDirectory, source: stepRow };
      }
      let rawUri = '', isDirectory = false;
      for (let node = fiber(stepRow), depth = 0; node && depth < 8; node = node.return, depth++) {
        const s = node.memoizedProps?.step?.step;
        if (!s || typeof s !== 'object') continue;
        if (s.case === 'viewFile' && s.value?.absolutePathUri) { rawUri = s.value.absolutePathUri; break; }
        if (s.case === 'listDirectory' && s.value?.directoryPathUri) { rawUri = s.value.directoryPathUri; isDirectory = true; break; }
        if (s.case === 'codeAction' && s.value?.actionSpec?.spec?.value?.path?.absoluteUri) { rawUri = s.value.actionSpec.spec.value.path.absoluteUri; break; }
      }
      const uri = toLocalFileUri(rawUri);
      if (uri) return { kind: 'file', uri, isDirectory, source: stepRow };
    }
    const tree = fileTreeEntry(targetEl);
    if (tree?.uri) return { kind: 'file', uri: tree.uri, isDirectory: Boolean(tree.isDirectory), source: targetEl };
    return null;
  }
  async function resolveInlineMediaPayload(inlineTarget, sourceEl) {
    if (!inlineTarget || typeof inlineTarget !== 'object') return null;
    const name = inlineTarget.name || 'image.png';
    const mimeType = inlineTarget.mimeType || 'image/png';
    const mediaItem = inlineTarget.mediaItem;
    if (mediaItem?.payload?.case === 'inlineData' && mediaItem.payload.value?.byteLength > 0) {
      const bytes = extractMediaBytes(mediaItem.payload.value);
      if (bytes?.byteLength > 0) return { mode: 'media', bytes, mimeType: mediaItem.mimeType || mimeType, name };
    }
    if (mediaItem?.uri) {
      const resolver = typeof inlineTarget.resolveUrl === 'function'
        ? inlineTarget.resolveUrl
        : providers(sourceEl || pageSource()).find(p => typeof p.value?.stepHandler?.resolveArtifactUrl === 'function')?.value?.stepHandler?.resolveArtifactUrl;
      const url = typeof resolver === 'function' ? resolver(mediaItem.uri) : '';
      if (url && typeof fetch === 'function') {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.byteLength > 0) return { mode: 'media', bytes, mimeType: mediaItem.mimeType || mimeType, name };
          }
        } catch {}
      }
    }
    const imgSrc = typeof inlineTarget.imgSrc === 'string' ? inlineTarget.imgSrc.trim() : '';
    if (imgSrc) {
      if (imgSrc.startsWith('data:')) {
        const comma = imgSrc.indexOf(',');
        if (comma > 5) {
          const header = imgSrc.slice(5, comma);
          const dataMime = (header.split(';')[0] || '').trim().toLowerCase() || mimeType;
          const body = imgSrc.slice(comma + 1);
          let bytes = null;
          if (/;base64$/i.test(header)) {
            const raw = atob(body);
            bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          } else {
            const decoded = decodeURIComponent(body);
            if (typeof TextEncoder === 'function') bytes = new TextEncoder().encode(decoded);
            else {
              bytes = new Uint8Array(decoded.length);
              for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
            }
          }
          if (bytes?.byteLength > 0) return { mode: 'media', bytes, mimeType: dataMime, name };
        }
      } else if (typeof fetch === 'function') {
        try {
          const res = await fetch(imgSrc);
          if (res.ok) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            const resMime = res.headers?.get?.('content-type')?.split(';')[0]?.trim() || mimeType;
            if (bytes.byteLength > 0) return { mode: 'media', bytes, mimeType: resMime, name };
          }
        } catch {}
      }
    }
    return null;
  }
  function extractQuotableSelection(targetEl) {
    if (typeof globalThis.getSelection !== 'function') return null;
    if (targetEl?.closest?.('[contenteditable="true"],input,textarea,[data-agy-powertools-root]')) return null;
    const sel = globalThis.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const ancNode = range.commonAncestorContainer;
    const ancEl = ancNode?.nodeType === 1 ? ancNode : ancNode?.parentElement;
    const root = targetEl?.closest?.('[data-quotable-root]')
      || ancEl?.closest?.('[data-quotable-root]')
      || targetEl?.closest?.('[data-testid="conversation-view"],[data-testid="side-question-tab-content"]')
      || ancEl?.closest?.('[data-testid="conversation-view"],[data-testid="side-question-tab-content"]');
    if (!root) return null;
    if (targetEl && typeof root.contains === 'function' && !root.contains(targetEl)) return null;

    let text = '';
    try {
      const hasRangeProto = typeof Range === 'function' && typeof range.cloneRange === 'function' && typeof range.intersectsNode === 'function';
      const hasWalker = typeof document?.createTreeWalker === 'function' && typeof NodeFilter === 'object';
      if (hasRangeProto && hasWalker && typeof root.querySelectorAll === 'function') {
        const quotables = [...root.querySelectorAll('[data-quotable]')].filter(el => {
          for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
            if (p.hasAttribute?.('data-quotable')) return false;
          }
          return range.intersectsNode(el);
        });
        if (quotables.length) {
          const isIgnored = (node, scope) => {
            for (let el = node.parentElement; el && el !== scope; el = el.parentElement) {
              if (el.classList?.contains?.('katex-mathml') || el.classList?.contains?.('sr-only') || el.hasAttribute?.('data-find-ignore')) return true;
              if (typeof getComputedStyle === 'function') {
                const cs = getComputedStyle(el);
                if ((cs?.userSelect || cs?.webkitUserSelect) === 'none') return true;
              }
            }
            return false;
          };
          const blockAncestor = (node, scope) => {
            let inlineRoot = node.parentElement?.closest?.('[data-quotable-inline], .katex-html');
            if (inlineRoot && inlineRoot !== scope && scope.contains(inlineRoot)) {
              for (let c = inlineRoot.parentElement; c && c !== scope; c = c.parentElement) {
                if (c.matches?.('[data-quotable-inline], .katex-html')) inlineRoot = c;
              }
            }
            let cur = inlineRoot?.parentElement || node.parentElement;
            for (; cur && cur !== scope; cur = cur.parentElement) {
              if (typeof getComputedStyle === 'function') {
                const disp = getComputedStyle(cur)?.display || '';
                if (disp && !disp.startsWith('inline') && disp !== 'contents') return cur;
              }
            }
            return scope;
          };
          const parts = [];
          for (const el of quotables) {
            const clamped = range.cloneRange();
            const bounds = document.createRange();
            bounds.selectNodeContents(el);
            if (clamped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clamped.setStart(bounds.startContainer, bounds.startOffset);
            if (clamped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clamped.setEnd(bounds.endContainer, bounds.endOffset);
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
              acceptNode: n => (!clamped.intersectsNode(n) || isIgnored(n, el)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            });
            let buf = '', lastBlock = null, pendingWs = '';
            for (let n; (n = walker.nextNode()); ) {
              const full = n.textContent || '';
              const start = n === clamped.startContainer ? clamped.startOffset : 0;
              const end = n === clamped.endContainer ? clamped.endOffset : full.length;
              if (start >= end) continue;
              const slice = full.slice(start, end);
              if (!slice.trim()) { pendingWs += slice; continue; }
              const blk = blockAncestor(n, el);
              if (buf && lastBlock && blk !== lastBlock) buf += '\n';
              else if (pendingWs) buf += pendingWs;
              pendingWs = '';
              buf += slice;
              lastBlock = blk;
            }
            if (buf.trim()) parts.push(buf.trim());
          }
          text = parts.join('\n\n');
        }
      }
    } catch {}
    if (!text) text = String(sel.toString?.() || '').trim();
    if (!text) return null;

    const startEl = range.startContainer?.nodeType === 1 ? range.startContainer : range.startContainer?.parentElement;
    const endEl = range.endContainer?.nodeType === 1 ? range.endContainer : range.endContainer?.parentElement;
    const startPre = startEl?.closest?.('pre');
    const endPre = endEl?.closest?.('pre');
    const isCodeBlock = Boolean(startPre && startPre === endPre && (typeof root.contains !== 'function' || root.contains(startPre)));
    const inSideQuestion = Boolean(root.closest?.('[data-testid="side-question-tab-content"]') || targetEl?.closest?.('[data-testid="side-question-tab-content"]'));

    let anchorRect = null;
    try {
      const clientRects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : [];
      const rawRect = clientRects.find(r => r && r.width > 0 && r.height > 0)
        || (typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null);
      if (rawRect && Number.isFinite(rawRect.top) && Number.isFinite(rawRect.left)) {
        anchorRect = {
          top: rawRect.top,
          bottom: Number.isFinite(rawRect.bottom) ? rawRect.bottom : rawRect.top + (rawRect.height || 0),
          left: rawRect.left,
          right: Number.isFinite(rawRect.right) ? rawRect.right : rawRect.left + (rawRect.width || 0),
          width: rawRect.width || 0,
          height: rawRect.height || 0
        };
      }
    } catch {}
    return { text, root, source: targetEl || root, isCodeBlock, inSideQuestion, anchorRect };
  }
  function clearSelectionAndNotify() {
    try { globalThis.getSelection?.()?.removeAllRanges?.(); } catch {}
    try {
      if (typeof MouseEvent === 'function' && typeof document?.dispatchEvent === 'function') {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }
    } catch {}
  }
  function buildTextScopeItem(text, isCodeBlock = false) {
    const payload = {
      scopeItem: {
        case: 'textBlock',
        value: {
          content: text,
          identifier: { case: 'label', value: isCodeBlock ? 'code_block' : 'Quote' }
        }
      }
    };
    return (typeof Wb === 'function' && I?.ContextScopeItemSchema)
      ? Wb(I.ContextScopeItemSchema, payload)
      : payload;
  }
  async function attachSelectionToComposer(selectionSnap, options = {}) {
    const text = String(selectionSnap?.text || '').trim();
    if (!text) throw new Error('未选中可引用的文本');
    const sourceEl = selectionSnap.source || selectionSnap.root;
    const isCodeBlock = Boolean(selectionSnap.isCodeBlock);
    const modeTarget = options?.target === 'side' ? 'side' : (selectionSnap.inSideQuestion ? 'side' : 'main');
    if (modeTarget === 'side' && !selectionSnap.inSideQuestion) {
      const mainCascadeId = resolveMainCascadeId(sourceEl);
      if (!mainCascadeId) throw new Error('未找到当前主对话');
      const s = store();
      const st = s?.getState?.();
      const summary = st?.trajectorySummaries?.summaries?.[mainCascadeId];
      const hasSteps = Number(summary?.stepCount || 0) > 0
        || Boolean(typeof document !== 'undefined' && document.querySelector?.('[data-testid="conversation-view"] [data-testid="user-input-step"]'));
      if (!hasSteps) throw new Error('请先在主对话发送一条消息后再发起侧边对话');
      const r = router();
      if (r?.state?.location?.search?.tab && typeof r.navigate === 'function') {
        try {
          await r.navigate({
            search: prev => { const next = { ...prev }; delete next.tab; return next; },
            replace: true
          });
        } catch {}
      }
      if (s?.dispatch && st && typeof st === 'object' && 'sideQuestion' in st) {
        const panelScope = { kind: 'cascadeId', cascadeId: mainCascadeId };
        s.dispatch({
          type: 'sidePanelV2/setContent',
          payload: { panelScope, content: { type: 'sideQuestionView', sideQuestionView: {} }, tabId: 'side_question__draft' }
        });
        s.dispatch({
          type: 'sidePanel/setSidePanelOpen',
          payload: { panelScope, isOpen: true }
        });
        s.dispatch({
          type: 'sideQuestion/enqueueDraftSideQuestionQuote',
          payload: isCodeBlock
            ? { parentCascadeId: mainCascadeId, scopeItem: buildTextScopeItem(text, true) }
            : { parentCascadeId: mainCascadeId, text }
        });
        clearSelectionAndNotify();
        if (typeof setTimeout === 'function') {
          setTimeout(() => { try { findComposer(sourceEl, 'side')?.editor?.focus?.(); } catch {} }, 60);
        }
        return { ok: true, mode: 'quote', target: 'side' };
      }
      const sideComp = await ensureSideQuestionComposer(sourceEl);
      if (!sideComp?.editor || typeof Gy !== 'function') throw new Error('侧边对话输入框暂不支持引用');
      Gy(sideComp.editor, buildTextScopeItem(text, isCodeBlock));
      sideComp.editor.focus?.();
      sideComp.box?.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      clearSelectionAndNotify();
      return { ok: true, mode: 'quote', target: 'side' };
    }
    const comp = findComposer(sourceEl, modeTarget) || findComposer(sourceEl, 'auto');
    if (!comp?.editor || typeof Gy !== 'function') throw new Error('当前输入框暂不支持直接引用所选文本');
    Gy(comp.editor, buildTextScopeItem(text, isCodeBlock));
    comp.editor.focus?.();
    try {
      const rootEl = comp.editor.getRootElement?.();
      if (rootEl && typeof document !== 'undefined' && !rootEl.contains?.(document.activeElement)) {
        rootEl.focus?.({ preventScroll: true });
      }
    } catch {}
    comp.box?.getInputCardElement?.()?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    clearSelectionAndNotify();
    return { ok: true, mode: 'quote', target: modeTarget };
  }
  let originalSend,wrappedSend,sendService,originalResolve,originalSegmentRender,stageSegmentRender,originalSplitSegments,wrappedSplitSegments,originalSidebarItems,wrappedSidebarItems,originalImageCompress,wrappedImageCompress;
  let contextLimit=0,stageUpdatesEnabled=false,codexProgressEnabled=false,uiLanguage='zh-CN',efficientIOEnabled=false,hdImagesEnabled=false,codexComposerMediaEnabled=false,runtimeEnabled=true,sidebarProjectLimit=0;
  let pendingEdit=null;
  const editListeners=new Set(),notifyEdit=()=>{for(const listener of editListeners)listener(pendingEdit);};
  function onEditChange(listener){editListeners.add(listener);return()=>editListeners.delete(listener);}
  const stageUpdateRule='During this task, communicate brief visible progress updates in the user-facing response alongside tool calls. Before the first substantial tool action, write one concise sentence explaining the immediate next action and its purpose. After a meaningful finding, change of direction, or a few execution steps, write one or two concise sentences stating the result and next action. These are intermediate updates, not final answers: continue executing the task after each update. Do not narrate every command. Do not put updates only in private thinking, tool summaries, task artifacts, or notify_user. Use the user language. Never invent progress or expose private reasoning.';
  const efficientIORule='Reduce unnecessary model round trips while respecting the task and platform permissions. Locate relevant files and symbols with available purpose-built search tools first; otherwise prefer rg when available, respect ignore rules, and use commands appropriate to the operating system. Batch already-known, independent searches and file reads in the same tool round when supported. Keep dependent operations sequential and honor any user-requested sequence. Read sufficient surrounding code once; read small relevant files whole and bounded regions of large files. Reuse unchanged information. Prefer focused edits that preserve unrelated work. Run the checks appropriate to the change and avoid redundant checks after they pass. Report meaningful milestones rather than narrating every command. Lead the final response with the result; keep detail proportional to the task and honor explicit requests for detailed explanations. Do not assume any fixed command allowlist or promised performance gain.';
  function buildCodexAgentRule(lang){
    const summaryDirective=lang==='zh-TW'
      ?'Write all UI-facing summary parameters (run_command and MCP toolSummary, update_focus focus, update_steps step title, and subagent Role) as concise Traditional Chinese phrases (2-10 characters, e.g., "檢查外掛與版本", "執行全量單測"), keeping only essential command, file, or symbol names in ASCII instead of copying English schema examples.'
      :lang==='en'
        ?'Write all UI-facing summary parameters (run_command and MCP toolSummary, update_focus focus, update_steps step title, and subagent Role) as concise 2-6 word phrases matching the user language.'
        :'Write all UI-facing summary parameters (run_command and MCP toolSummary, update_focus focus, update_steps step title, and subagent Role) as concise Simplified Chinese phrases (2-10 characters, e.g., "检查插件与版本", "运行全量单测"), keeping only essential command, file, or symbol names in ASCII instead of copying English schema examples.';
    return [
      'Progress updates: Answer pure conceptual questions or casual chat directly when no tools are needed. Before the first substantial tool call (reading files, searching, running commands, or editing), write 1-2 concise visible sentences stating the target and immediate plan. At semantic phase transitions, key findings, or plan adjustments, write 1-2 visible sentences stating verified facts and the next action, then continue executing immediately without stopping early unless blocked or awaiting user input. Do not narrate individual commands or place updates only in private thinking or tool parameters. Use the user language, and never invent progress or expose private reasoning.',
      `Tool summaries: ${summaryDirective}`,
      'Output style and brevity: Lead with the core conclusion or result first, followed only by essential supporting evidence, and keep routine answers within roughly 10 lines unless task complexity or the user requires detail. Make the final answer self-contained (explicitly noting any assumptions or uninstructed trade-offs) rather than recounting a chronological worklog, and scale structure to task size (short plain sentences for simple actions; flat lists of 3-6 items or brief per-file summaries for larger changes, avoiding nested lists). Omit filler headings on short replies, introductory or summary cliches, unrequested comparisons of what stayed unchanged, speculative disclaimers, excessive apologies, and middle-dot separators.',
      'Formatting and code references: Write numbers, counts, versions, common abbreviations (SSH, IPv6, Token), and natural-language phrases or UI labels as plain text without backticks; reserve inline backticks strictly for exact commands, config keys, process/program names, code or file identifiers, and single keys. Keep prose natural and place clickable file:// markdown links with short descriptive labels at the end of the sentence, paragraph, or list item rather than mid-sentence. Reference file paths, line ranges, and symbol names instead of pasting before/after blocks or full functions, including at most 1-2 short snippets only when essential.'
    ].join('\n\n');
  }
  const HD_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
  const HD_IMAGE_MAX_SIDE = 16384;
  const HD_DIRECT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  function parseDataUrlInfo(dataUrl, fallbackMime) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(5, comma);
    const mime = (header.split(';')[0] || fallbackMime || 'image/png').trim().toLowerCase();
    const isBase64 = /;base64$/i.test(header);
    let bytes = 0;
    if (isBase64) {
      const b64Len = dataUrl.length - comma - 1;
      const pad = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
      bytes = Math.max(0, Math.floor((b64Len * 3) / 4) - pad);
    } else {
      try {
        const decoded = decodeURIComponent(dataUrl.slice(comma + 1));
        bytes = typeof Blob === 'function' ? new Blob([decoded]).size : decoded.length;
      } catch {
        return null;
      }
    }
    return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, bytes, isBase64 };
  }
  function encodeCanvasJpeg(canvas, quality) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const info = parseDataUrlInfo(dataUrl, 'image/jpeg');
    return { dataUrl, mimeType: 'image/jpeg', bytes: info ? info.bytes : Infinity };
  }
  function compressToByteBudget(canvas, limitBytes) {
    const r95 = encodeCanvasJpeg(canvas, 0.95);
    if (r95.bytes <= limitBytes) {
      const r98 = encodeCanvasJpeg(canvas, 0.98);
      return { best: r98.bytes <= limitBytes ? r98 : r95, fitted: true };
    }
    let lo = 0.85, hi = 0.95, best = null;
    const r85 = encodeCanvasJpeg(canvas, 0.85);
    if (r85.bytes <= limitBytes) {
      best = r85;
    } else {
      hi = 0.85;
      const r60 = encodeCanvasJpeg(canvas, 0.60);
      if (r60.bytes <= limitBytes) { lo = 0.60; best = r60; }
      else {
        lo = 0.05; hi = 0.60;
        const rMin = encodeCanvasJpeg(canvas, lo);
        if (rMin.bytes <= limitBytes) best = rMin;
        else return { best: rMin, fitted: false };
      }
    }
    const tol = hi > 0.85 ? 0.015 : 0.02;
    while (hi - lo > tol) {
      const mid = (lo + hi) / 2;
      const probe = encodeCanvasJpeg(canvas, mid);
      if (probe.bytes <= limitBytes) { best = probe; lo = mid; }
      else hi = mid;
    }
    return { best, fitted: true };
  }
  async function compressHdImage(dataUrl, mimeType, limitBytes = HD_IMAGE_MAX_BYTES) {
    const info = parseDataUrlInfo(dataUrl, mimeType);
    if (info && info.isBase64 && info.bytes > 0 && info.bytes <= limitBytes && HD_DIRECT_MIMES.has(info.mime)) {
      return { dataUrl, mimeType: info.mime };
    }
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = dataUrl;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Invalid image dimensions');
    if (w > HD_IMAGE_MAX_SIDE || h > HD_IMAGE_MAX_SIDE) {
      if (w >= h) { h = Math.max(1, Math.round((h * HD_IMAGE_MAX_SIDE) / w)); w = HD_IMAGE_MAX_SIDE; }
      else { w = Math.max(1, Math.round((w * HD_IMAGE_MAX_SIDE) / h)); h = HD_IMAGE_MAX_SIDE; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    if (info?.mime === 'image/svg+xml') {
      const pngUrl = canvas.toDataURL('image/png');
      const pngInfo = parseDataUrlInfo(pngUrl, 'image/png');
      if (pngInfo && pngInfo.isBase64 && pngInfo.bytes <= limitBytes) return { dataUrl: pngUrl, mimeType: 'image/png' };
    }
    let result = compressToByteBudget(canvas, limitBytes);
    if (!result.fitted) {
      const ratio = Math.sqrt(limitBytes / result.best.bytes) * 0.92;
      const sw = Math.max(1, Math.round(w * ratio));
      const sh = Math.max(1, Math.round(h * ratio));
      const scaled = document.createElement('canvas');
      scaled.width = sw;
      scaled.height = sh;
      const sctx = scaled.getContext('2d');
      if (sctx) {
        sctx.drawImage(canvas, 0, 0, sw, sh);
        result = compressToByteBudget(scaled, limitBytes);
      }
    }
    if (!result.fitted) throw new Error(`Failed to compress image to fit within ${(limitBytes / 1048576).toFixed(1)}MB`);
    return { dataUrl: result.best.dataUrl, mimeType: result.best.mimeType };
  }
  function configureRequest(base) {
    const config=tc(I.CascadeConfigSchema,base);
    if(contextLimit>0)config.checkpointConfig=Wb(I.CheckpointConfigSchema,{...config.checkpointConfig,maxTokenLimit:contextLimit,tokenThreshold:contextLimit});
    const activeStagePrompt=codexProgressEnabled?buildCodexAgentRule(uiLanguage):(stageUpdatesEnabled?stageUpdateRule:'');
    if(activeStagePrompt){
      config.plannerConfig ||= Wb(I.CascadePlannerConfigSchema,{});
      config.plannerConfig.noToolExplanation=false;
      config.plannerConfig.noToolSummary=false;
    }
    if(activeStagePrompt||efficientIOEnabled){
      config.plannerConfig ||= Wb(I.CascadePlannerConfigSchema,{});
      const prompts=config.plannerConfig.promptSectionCustomizationConfig||Wb(I.PromptSectionCustomizationConfigSchema,{});
      const names=['powertools_stage_updates','powertools_efficient_io'];
      prompts.appendPromptSections=[...(prompts.appendPromptSections||[]).filter(p=>!names.includes(p.title)),
        ...(activeStagePrompt?[Wb(I.PromptSectionSchema,{title:names[0],content:activeStagePrompt})]:[]),
        ...(efficientIOEnabled?[Wb(I.PromptSectionSchema,{title:names[1],content:efficientIORule})]:[])];
      config.plannerConfig.promptSectionCustomizationConfig=prompts;
    }
    if(hdImagesEnabled&&I?.MediaCompressionConfigSchema){
      config.mediaCompressionConfig=Wb(I.MediaCompressionConfigSchema,{...config.mediaCompressionConfig,maxSide:HD_IMAGE_MAX_SIDE,maxBytes:HD_IMAGE_MAX_BYTES,jpegQuality:92,transcodeMinBytes:HD_IMAGE_MAX_BYTES});
    }
    return config;
  }
  function installRequestOverrides(source){
    if (!sendService) {
      try { sendService=service(source); originalSend=sendService.sendUserCascadeMessage; } catch {}
    }
    const hasConfigOverride=contextLimit>0||stageUpdatesEnabled||codexProgressEnabled||efficientIOEnabled||hdImagesEnabled;
    if(typeof globalThis[hookNames.resolve]==='function'){
      originalResolve ||= globalThis[hookNames.resolve];
      globalThis[hookNames.resolve]=runtimeEnabled&&hasConfigOverride?function(...args){return configureRequest(originalResolve(...args));}:originalResolve;
    }
    if(originalSend){
      wrappedSend ||= async function(payload,...args){
        const edit=runtimeEnabled&&pendingEdit&&payload?.cascadeId===pendingEdit.cascadeId?pendingEdit:null;
        const activeConfigOverride=runtimeEnabled&&(contextLimit>0||stageUpdatesEnabled||codexProgressEnabled||efficientIOEnabled||hdImagesEnabled);
        if(edit){
          pendingEdit=null;suspendedEdits.delete(edit.cascadeId);restoreComposerHome(edit);installRequestOverrides();notifyEdit();
          const optimisticRevert=edit.optimistic?.applyOptimisticRevert?.(edit.cascadeId,edit.stepIndex-1);
          try{
            await (sendService||service()).cancelCascadeInvocation?.({cascadeId:edit.cascadeId}).catch(()=>{});
            await edit.stepHandler.revertToIndex(edit.cascadeId,edit.stepIndex-1,{conversationOnly:true});
            const nextPayload={
              ...payload,
              ...(payload.artifactComments?.length?{}:{artifactComments:edit.comments.artifactComments}),
              ...(payload.fileDiffComments?.length?{}:{fileDiffComments:edit.comments.fileDiffComments}),
              ...(payload.fileComments?.length?{}:{fileComments:edit.comments.fileComments}),
              cascadeConfig:activeConfigOverride?configureRequest(Wb(I.CascadeConfigSchema,payload.cascadeConfig||{})):payload.cascadeConfig
            };
            delete nextPayload.deliveryStrategy;
            return await originalSend.call(this,nextPayload,...args);
          }catch(error){
            throw error;
          }finally{optimisticRevert?.dispose?.();}
        }
        const configured=activeConfigOverride?{...payload,cascadeConfig:configureRequest(Wb(I.CascadeConfigSchema,payload.cascadeConfig||{}))}:payload;
        return originalSend.call(this,configured,...args);
      };
      sendService.sendUserCascadeMessage=runtimeEnabled?wrappedSend:originalSend;
    }
  }
  function ensureRequestHook(source){
    if(!runtimeEnabled)return;
    try{installRequestOverrides(source);}catch{}
  }
  function setContextLimit(limit) {
    if (![0,256000,500000,1000000].includes(limit)) throw new Error('不支持的上下文上限');
    contextLimit=limit;installRequestOverrides();
  }
  function setEfficientIO(enabled){efficientIOEnabled=enabled===true;installRequestOverrides();}
  function refreshSidebarList(){
    try{
      const nav=document.querySelector('[role="navigation"][aria-label="Sidebar"]');
      if(!nav)return;
      const root=fiber(nav);
      if(!root)return;
      const seen=new Set(),stack=[root];
      while(stack.length){
        const node=stack.pop();
        if(!node||seen.has(node))continue;
        seen.add(node);
        for(let h=node.memoizedState;h&&typeof h==='object';h=h.next){
          if(h.memoizedState&&typeof h.memoizedState==='object'&&'onlyShowFirstFewConvos' in h.memoizedState&&typeof h.queue?.dispatch==='function'){
            h.queue.dispatch(prev=>prev?{...prev}:{onlyShowFirstFewConvos:{}});
            return;
          }
        }
        if(node.child)stack.push(node.child);
        if(node.sibling)stack.push(node.sibling);
      }
    }catch{/* Best effort refresh. */}
  }
  function setSidebarProjectLimit(limit){
    const next=[0,1,2,3,4,5,10,-1].includes(limit)?limit:0;
    const changed=sidebarProjectLimit!==next;
    sidebarProjectLimit=next;
    const name=hookNames.sidebarItems;
    if(name&&typeof globalThis[name]==='function'){
      originalSidebarItems ||= globalThis[name];
      wrappedSidebarItems ||= function(args){
        if(!runtimeEnabled||sidebarProjectLimit===0||!args||args.groupBy==='none'||!Array.isArray(args.groups))return originalSidebarItems(args);
        const origFlags=args.onlyShowFirstFewConvos||{};
        const allExpanded={...origFlags};
        for(const g of args.groups)if(g?.id&&g.id!=='standalone')allExpanded[g.id]=false;
        const full=originalSidebarItems({...args,onlyShowFirstFewConvos:allExpanded});
        const totals=new Map();
        for(const g of args.groups)if(g?.id&&g.id!=='standalone')totals.set(g.id,Array.isArray(g.items)?g.items.length:0);
        if(!Array.isArray(full))return full;
        if(sidebarProjectLimit===-1)return full.filter(item=>!(item?.type==='show-more'&&totals.has(item.groupId)));
        const out=[],seen=new Map();
        for(let i=0;i<full.length;i++){
          const item=full[i];
          if(item?.type==='show-more'&&totals.has(item.groupId))continue;
          if(item?.type==='row'&&item.isIndented&&totals.has(item.groupId)){
            const gid=item.groupId,total=totals.get(gid),collapsed=origFlags[gid]??true;
            const idx=seen.get(gid)||0;seen.set(gid,idx+1);
            if(!collapsed||idx<sidebarProjectLimit)out.push(item);
            const nextItem=full[i+1];
            const isLastOfGroup=!nextItem||nextItem.type!=='row'||!nextItem.isIndented||nextItem.groupId!==gid;
            if(isLastOfGroup&&total>sidebarProjectLimit){
              out.push({type:'show-more',id:`show-more-${gid}`,label:collapsed?`See all (${total})`:'See less',groupId:gid,isIndented:true});
            }
            continue;
          }
          out.push(item);
        }
        return out;
      };
      globalThis[name]=runtimeEnabled&&sidebarProjectLimit!==0?wrappedSidebarItems:originalSidebarItems;
    }
    if(changed)refreshSidebarList();
  }
  function syncImageCompressHook(){
    const name=hookNames.imageCompress;
    if(!name||typeof globalThis[name]!=='function')return;
    if(runtimeEnabled&&(hdImagesEnabled||codexComposerMediaEnabled)){
      originalImageCompress ||= globalThis[name];
      wrappedImageCompress ||= async function(dataUrl,mimeType,maxBytes,maxSide){
        if(runtimeEnabled&&hdImagesEnabled&&maxBytes===1048576&&maxSide===1024){
          return compressHdImage(dataUrl,mimeType,HD_IMAGE_MAX_BYTES);
        }
        if(runtimeEnabled&&(hdImagesEnabled||codexComposerMediaEnabled)&&maxBytes===10240&&maxSide===320){
          return originalImageCompress(dataUrl,mimeType,163840,640);
        }
        return originalImageCompress(dataUrl,mimeType,maxBytes,maxSide);
      };
      globalThis[name]=wrappedImageCompress;
    }else if(originalImageCompress&&globalThis[name]===wrappedImageCompress){
      globalThis[name]=originalImageCompress;
    }
  }
  function setCodexComposerMedia(enabled){
    codexComposerMediaEnabled=enabled===true;
    syncImageCompressHook();
  }
  function setHdImages(enabled){
    hdImagesEnabled=enabled===true;
    if(sendService||originalResolve||contextLimit>0||stageUpdatesEnabled||codexProgressEnabled||efficientIOEnabled||hdImagesEnabled){
      try{installRequestOverrides();}catch{}
    }
    syncImageCompressHook();
  }
  function setEnabled(enabled){const prev=runtimeEnabled;runtimeEnabled=enabled!==false;if(!runtimeEnabled){cancelEdit();suspendedEdits.clear();}if(sendService||originalResolve||contextLimit>0||stageUpdatesEnabled||codexProgressEnabled||efficientIOEnabled||hdImagesEnabled){try{installRequestOverrides();}catch{}}syncSegmentHook();syncImageCompressHook();setSidebarProjectLimit(sidebarProjectLimit);if(prev!==runtimeEnabled)refreshSidebarList();}
  const TERMINAL_STEP_CASES = new Set(['runCommand', 'commandStatus', 'sendCommandInput', 'readTerminal']);
  const isTerminalStep = step => {
    const c = step?.step?.case;
    if (c && TERMINAL_STEP_CASES.has(c)) return true;
    return c === 'generic' && (step?.metadata?.toolCall?.name === 'run_command' || step?.step?.value?.name === 'run_command');
  };
  const isStepWaiting = step => step?.status === 9;
  const isStepRunning = step => [1, 2, 8, 11].includes(step?.status);
  const isSubagentStep = step => step?.step?.case === 'invokeSubagent' || (step?.step?.case === 'generic' && step?.metadata?.toolCall?.name === 'invoke_subagent');
  const isSafeSystemStep = step => step?.step?.case === 'systemMessage' && step?.metadata?.auto_proceed_uri === undefined;
  const isPlannerTextStep = step => step?.step?.case === 'plannerResponse' && Boolean(step.step.value?.response?.trim());
  const isStepActuallyRendered = (step, getStepRendererConfig, debugMode, verboseAgentChat) => {
    if (!step) return false;
    if (typeof getStepRendererConfig === 'function') {
      try {
        const cfg = getStepRendererConfig(step);
        if (typeof cfg?.isRendered === 'function') {
          return Boolean(cfg.isRendered(step, Boolean(debugMode), Boolean(verboseAgentChat)));
        }
      } catch {}
    }
    if (step?.step?.case === 'systemMessage') {
      if (debugMode) return true;
      const v = step.step.value;
      return Boolean(
        v?.message?.trim?.()
        || v?.metadata?.auto_proceed_uri
        || v?.metadata?.user_markdown
        || v?.renderInfo?.title
        || v?.renderInfo?.titleParts?.length
        || v?.agentMessage
      );
    }
    return true;
  };
  const isFoldableWorkItem = item => Boolean(item && (
    item.type === 'lastTextResponse'
    || item.type === 'subagentGroupCollapsible'
    || item.type === 'toolGroupCollapsible'
    || item.type === 'thinkingIndicator'
    || item.type === 'stepPlan'
    || item.type === 'progressUpdatesCollapsible'
    || (item.type === 'step' && (isPlannerTextStep(item.step) || isSafeSystemStep(item.step) || isSubagentStep(item.step) || isTerminalStep(item.step)))
  ));
  const toGroupItem = (item, debugMode) => (
    item?.type === 'lastTextResponse'
      ? { type: 'step', key: item.key, step: item.step, debugMode: Boolean(debugMode) }
      : item
  );
  const hasActiveDirectSubagent = () => {
    try {
      const m = typeof location !== 'undefined' && typeof location.pathname === 'string'
        ? location.pathname.match(/\/c\/([^/?#]+)/)
        : null;
      const cid = m ? decodeURIComponent(m[1]) : '';
      return cid ? subagents(cid).some(s => s.status === 'running' || s.status === 'stopping') : false;
    } catch { return false; }
  };
  const stepTsMs = v => {
    if (v == null) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string') { const p = Date.parse(v); return Number.isFinite(p) ? p : NaN; }
    const sec = Number(v.seconds ?? v.sec);
    const nano = Number(v.nanos ?? v.nanoseconds ?? 0);
    return Number.isFinite(sec) ? sec * 1000 + nano / 1e6 : NaN;
  };
  const formatFallbackWorkedHeader = steps => {
    let minMs = Infinity, maxMs = -Infinity;
    for (const s of steps || []) {
      const a = stepTsMs(s?.metadata?.createdAt);
      const b = stepTsMs(s?.metadata?.completedAt);
      if (Number.isFinite(a)) { if (a < minMs) minMs = a; if (a > maxMs) maxMs = a; }
      if (Number.isFinite(b)) { if (b < minMs) minMs = b; if (b > maxMs) maxMs = b; }
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs < minMs) return 'Worked';
    const sec = Math.floor((maxMs - minMs) / 1000);
    if (sec < 1) return 'Worked for <1s';
    if (sec < 60) return `Worked for ${sec}s`;
    const mins = Math.floor(sec / 60), remSec = sec % 60;
    if (mins < 60) return remSec ? `Worked for ${mins}m ${remSec}s` : `Worked for ${mins}m`;
    const hrs = Math.floor(mins / 60), remMin = mins % 60;
    return remMin ? `Worked for ${hrs}h ${remMin}m` : `Worked for ${hrs}h`;
  };
  const compactProgressGroups = groups => {
    let changed = false;
    const mapped = groups.map((g, idx) => {
      if (g?.type === 'step' && isTerminalStep(g.step) && !isStepWaiting(g.step)) {
        changed = true;
        return {
          type: 'toolGroupCollapsible',
          key: g.key ? `codex-tools-${g.key}` : `codex-tools-${idx}`,
          steps: [g.step],
          debugMode: Boolean(g.debugMode),
          isActive: false,
          isRunning: isStepRunning(g.step),
          focus: undefined
        };
      }
      return g;
    });
    return changed ? mapped : groups;
  };
  function syncSegmentHook(){
    const splitName=hookNames.splitSegments;
    if(splitName&&typeof globalThis[splitName]==='function'){
      originalSplitSegments ||= globalThis[splitName];
      wrappedSplitSegments ||= function(steps,isLatest=false,opts){
        if(!runtimeEnabled||!codexProgressEnabled||!Array.isArray(steps)||steps.length===0){
          return originalSplitSegments(steps,isLatest,opts);
        }
        return [{executionId:steps[0]?.metadata?.executionId??'',steps,isLatest:Boolean(isLatest)}];
      };
      globalThis[splitName]=runtimeEnabled&&codexProgressEnabled?wrappedSplitSegments:originalSplitSegments;
    }
    if(typeof globalThis[hookNames.segment]!=='function')return;
    originalSegmentRender ||= globalThis[hookNames.segment];
    stageSegmentRender ||= function(...args){
      const callArgs=runtimeEnabled&&codexProgressEnabled&&args[0]&&typeof args[0]==='object'
        ?[{...args[0],ephemeralToolCalls:false,ephemeralProgressTextMode:'none'},...args.slice(1)]
        :args;
      const result=originalSegmentRender(...callArgs);
      if(!runtimeEnabled||(!stageUpdatesEnabled&&!codexProgressEnabled)||!result||typeof result!=='object')return result;
      const debugMode=Boolean(args[0]?.debugMode);
      const getCfg=args[0]?.getStepRendererConfig;
      const verbose=Boolean(args[0]?.verboseAgentChat);
      const isVisibleItem=it=>!it?false:(it.type==='step'||it.type==='lastTextResponse')?isStepActuallyRendered(it.step,getCfg,debugMode,verbose):(Array.isArray(it.steps)?it.steps.length===0||it.steps.some(s=>isStepActuallyRendered(s,getCfg,debugMode,verbose)):true);
      const isLatestTurnSegment=Boolean(args[0]?.isLastTurn&&args[0]?.segment?.isLatest);
      const segSteps=Array.isArray(args[0]?.segment?.steps)?args[0].segment.steps:[];
      const rawGroups=Array.isArray(result.body?.content?.groups)?result.body.content.groups:null;
      const nextGroups=codexProgressEnabled&&rawGroups?compactProgressGroups(rawGroups):rawGroups;
      const groups=nextGroups||[];
      const leading=Array.isArray(result.leadingSteps)?result.leadingSteps:[];
      const tail=Array.isArray(result.tailSteps)?result.tailSteps:[];
      const hasWaiting=Boolean(args[0]?.hasWaitingUserMessage)
        ||groups.some(g=>isStepWaiting(g?.step)||(Array.isArray(g?.steps)&&g.steps.some(isStepWaiting)))
        ||leading.some(g=>isStepWaiting(g?.step))
        ||tail.some(g=>isStepWaiting(g?.step))
        ||segSteps.some(isStepWaiting);
      const hasRunningStep=codexProgressEnabled&&isLatestTurnSegment&&(
        groups.some(g=>isStepRunning(g?.step)||(Array.isArray(g?.steps)&&g.steps.some(isStepRunning)))||
        segSteps.some(isStepRunning)
      );
      const hasRunningPlan=codexProgressEnabled&&isLatestTurnSegment&&(
        (Array.isArray(result.planCard?.items)&&result.planCard.items.some(it=>it?.status==='in_progress'))||
        (Array.isArray(args[0]?.planSteps)&&args[0].planSteps.some(it=>it?.status==='in_progress'))
      );
      const hasRunningSubagent=Boolean(codexProgressEnabled&&isLatestTurnSegment&&segSteps.some(isSubagentStep)&&hasActiveDirectSubagent());
      const active=Boolean(hasWaiting||result.body?.isActive||(args[0]?.isRunning&&isLatestTurnSegment)||hasRunningStep||hasRunningPlan||hasRunningSubagent);
      const isFinalText=item=>item?.type==='lastTextResponse'||(item?.type==='step'&&isPlannerTextStep(item.step));
      if(result.body?.type!=='collapsible'){
        if(!codexProgressEnabled)return result;
        if(!active){
          const allItems=[...leading,...groups,...tail];
          let lastFinalIdx=-1;
          for(let i=allItems.length-1;i>=0;i--)if(isFinalText(allItems[i])){lastFinalIdx=i;break;}
          if(lastFinalIdx>0){
            const prefix=allItems.slice(0,lastFinalIdx);
            const hasWork=prefix.some(it=>isVisibleItem(it)&&(it?.type==='subagentGroupCollapsible'||isSubagentStep(it?.step)||isSafeSystemStep(it?.step)||it?.type==='toolGroupCollapsible'||isTerminalStep(it?.step)||isPlannerTextStep(it?.step)||it?.type==='lastTextResponse'));
            if(hasWork){
              const foldedGroups=[],keptLeading=[];
              for(const it of prefix){
                if(!isVisibleItem(it))keptLeading.push(it);
                else if(isFoldableWorkItem(it))foldedGroups.push(toGroupItem(it,debugMode));
                else keptLeading.push(it);
              }
              if(foldedGroups.length){
                const finalTail=allItems.slice(lastFinalIdx).map((it,idx)=>idx===0&&it?.type==='step'&&isPlannerTextStep(it.step)?{type:'lastTextResponse',key:it.key,step:it.step}:it);
                return{...result,leadingSteps:keptLeading,body:{type:'collapsible',headerText:formatFallbackWorkedHeader(segSteps),defaultExpanded:false,isActive:false,triggerVisible:true,content:{...(result.body?.content||{}),groups:foldedGroups}},tailSteps:finalTail};
              }
            }
          }
        }
        if(!rawGroups||nextGroups===rawGroups)return result;
        return{...result,body:{...result.body,content:{...result.body.content,groups:nextGroups}}};
      }
      const isUpdate=g=>g?.type==='step'&&isPlannerTextStep(g.step);
      const updates=leading.filter(isUpdate);
      if(!codexProgressEnabled&&!updates.length&&!groups.some(isUpdate))return result;
      const content=nextGroups?{...result.body.content,groups}:result.body.content;
      if(active)return{...result,body:{type:'inline',content}};
      if(codexProgressEnabled){
        let lastFinalIdx=-1;
        for(let i=tail.length-1;i>=0;i--)if(isFinalText(tail[i])){lastFinalIdx=i;break;}
        const foldedLeading=[],keptLeading=[];
        for(const it of leading){
          if(isVisibleItem(it)&&isFoldableWorkItem(it))foldedLeading.push(toGroupItem(it,debugMode));
          else keptLeading.push(it);
        }
        const foldedTail=[],keptTailBefore=[];
        if(lastFinalIdx>0){
          for(let i=0;i<lastFinalIdx;i++){
            const it=tail[i];
            if(isVisibleItem(it)&&isFoldableWorkItem(it))foldedTail.push(toGroupItem(it,debugMode));
            else keptTailBefore.push(it);
          }
        }
        const nextTail=lastFinalIdx>0?[...keptTailBefore,...tail.slice(lastFinalIdx)]:tail;
        const combinedGroups=[...foldedLeading,...groups,...foldedTail];
        if(!combinedGroups.some(isVisibleItem)){
          return{...result,leadingSteps:keptLeading,body:{type:'inline',content:{...content,groups:[]}},tailSteps:nextTail};
        }
        return{...result,leadingSteps:keptLeading,body:{...result.body,
          defaultExpanded:false,isActive:false,triggerVisible:true,
          content:{...content,groups:combinedGroups}},tailSteps:nextTail};
      }
      if(!updates.length)return result;
      return{...result,leadingSteps:leading.filter(g=>!isUpdate(g)),body:{...result.body,
        defaultExpanded:false,isActive:false,triggerVisible:true,
        content:{...content,groups:[...updates,...groups]}}};
    };
    globalThis[hookNames.segment]=runtimeEnabled&&(stageUpdatesEnabled||codexProgressEnabled)?stageSegmentRender:originalSegmentRender;
  }
  function setStageUpdates(enabled){
    stageUpdatesEnabled=enabled===true;installRequestOverrides();
    syncSegmentHook();
  }
  function setCodexProgress(enabled){
    codexProgressEnabled=enabled===true;
    try{installRequestOverrides();}catch{}
    syncSegmentHook();
  }
  function setUiLanguage(lang){
    uiLanguage=lang==='zh-TW'||lang==='en'?lang:'zh-CN';
  }
  function installPage(component) {
    const r=router(); if (!r || typeof VD!=='function') return false;
    const existing=r.routesById?.['/manager-layout/manager-landing-layout/powertools'];
    if (existing) {
      existing.update({component});
      if(location.pathname==='/powertools')void r.navigate({to:'/customizations',replace:true}).then(()=>r.navigate({to:'/powertools',replace:true}));
      return true;
    }
    const parent=r.routesById?.['/manager-layout/manager-landing-layout'];
    if (!parent) return false;
    const pending=parent.children.find(route=>route.options.path==='/powertools');
    if(pending)pending.update({component});else parent.addChildren([...parent.children,VD({getParentRoute:()=>parent,path:'/powertools',component})]);
    r.routeTree = null;
    r.update({routeTree:r.options.routeTree});
    if(location.pathname==='/powertools')void r.load();
    return true;
  }
  function extractFinalResponseFromSteps(steps) {
    if (!Array.isArray(steps) || !steps.length) return { finalText: '', hasIntermediate: false };
    let trailing = [];
    let lastPlannerText = '';
    let hasIntermediate = false;
    let seenAnswerCount = 0;
    for (const item of steps) {
      const c = item?.step?.case;
      const v = item?.step?.value;
      if (!c || c === 'userInput' || c === 'systemMessage' || c === 'checkpoint' || c === 'ephemeralMessage') continue;
      if (c === 'plannerResponse') {
        const text = String(v?.modifiedResponse || v?.response || '').trim();
        const hasTools = Array.isArray(v?.toolCalls) && v.toolCalls.length > 0;
        if (text) {
          lastPlannerText = text;
          seenAnswerCount++;
        }
        if (hasTools) {
          hasIntermediate = true;
          trailing = [];
        } else if (text) {
          if (seenAnswerCount > 1) hasIntermediate = true;
          trailing.push(text);
        }
      } else if (c === 'notifyUser') {
        const text = String(v?.message || '').trim();
        if (text) {
          lastPlannerText = text;
          seenAnswerCount++;
          trailing.push(text);
        }
      } else {
        hasIntermediate = true;
        trailing = [];
      }
    }
    const finalText = (trailing.length ? trailing.join('\n\n') : lastPlannerText).trim();
    return { finalText, hasIntermediate };
  }
  function finalResponseText(element) {
    for (let node = fiber(element); node; node = node.return) {
      const steps = node.memoizedProps?.steps;
      if (Array.isArray(steps) && steps.length) {
        return extractFinalResponseFromSteps(steps);
      }
    }
    return { finalText: '', hasIntermediate: false };
  }
  function userMessage(element) {
    for (let node = fiber(element); node; node = node.return) {
      const props = node.memoizedProps;
      if (props?.step?.items && props.metadata && props.cascadeId) return props;
    }
    return null;
  }
  function navigateTurn(turn) {
    const source=document.querySelector('[data-testid="user-input-step"],[data-testid="agent-response"]');
    const nav=providers(source).find(p=>typeof p.value?.jumpTo==='function'&&Array.isArray(p.value.turns))?.value;
    const index=nav?.turns.findIndex(item=>item.startStepIndex===turn.stepIndexStart)??-1;
    if(index>=0){nav.jumpTo(index);return true;}
    for(const element of document.querySelectorAll('[data-testid="user-input-step"]')){
      const message=userMessage(element);
      if(message&&HU(message.metadata)===turn.stepIndexStart){element.scrollIntoView({behavior:'smooth',block:'start'});return true;}
    }
    return false;
  }
  function replaceText(items, text) {
    let inserted = false;
    const result = items.flatMap(item => {
      if (item.chunk?.case !== 'text') return [item];
      if (inserted) return [];
      inserted = true;
      return [{ ...item, chunk: { case: 'text', value: text } }];
    });
    if (!inserted) result.unshift({ chunk: { case: 'text', value: text } });
    return result;
  }
  async function editAndResend(element, text) {
    if (!text.trim()) throw new Error('请输入消息');
    const message = userMessage(element);
    const context = providers(element).find(p => typeof p.value?.sendMessage === 'function' && p.value?.stepHandler)?.value;
    if (!message || !context?.stepHandler?.revertToIndex) throw new Error('当前消息不支持编辑');
    const stepIndex = HU(message.metadata);
    const items = replaceText(message.step.items, text);
    let reverted = false;
    try {
      // This option explicitly preserves workspace files.
      await context.stepHandler.revertToIndex(message.cascadeId, stepIndex - 1, { conversationOnly: true });
      reverted = true;
      await context.sendMessage({ type: 1, cascadeId: message.cascadeId, items, media: message.step.media || [], resend: 'edit',
        commentOverrides: { artifactComments: message.step.artifactComments || [], fileDiffComments: message.step.fileDiffComments || [], fileComments: message.step.fileComments || [] } });
      return { conversationId: message.cascadeId, replacedStepIndex: stepIndex };
    } catch (error) {
      if (reverted) {
        const box = context.inputBoxRef?.current;
        const editor = box?.lexicalRef?.current;
        if (editor && typeof IJ === 'function' && typeof LN === 'function') {
          editor.setEditorState(IJ(editor, LN(items)));
          box.setMediaAttachments?.(message.step.media || []);
        }
      }
      throw error;
    }
  }
  async function forkPoint(conversationId, stepIndex) {
    if (stepIndex === -1) return -1;
    const data = await service().getCascadeTrajectory({ cascadeId: conversationId });
    const steps = data.trajectory.steps;
    const next = steps.find(step => HU(step.metadata) > stepIndex && step.step?.case === 'userInput');
    return next ? HU(next.metadata) - 1 : -1;
  }
  function nextBranchTitle(sourceTitle, existingTitles = []) {
    const base = String(sourceTitle || '').trim().replace(/\s*\(\d+\)$/, '').trim() || '分支会话';
    const taken = new Set((existingTitles || []).map(item => String(item || '').trim()).filter(Boolean));
    let index = 1;
    while (taken.has(`${base} (${index})`)) index++;
    return `${base} (${index})`;
  }
  async function renameForkedConversation(sourceId, newId, fallbackTitle = '') {
    if (!sourceId || !newId || sourceId === newId) return null;
    const svc = service();
    if (typeof svc.updateConversationAnnotations !== 'function') return null;
    const map = store()?.getState()?.trajectorySummaries?.summaries || {};
    const sourceEntry = map[sourceId];
    const domSourceTitle = typeof document !== 'undefined'
      ? document.querySelector?.(`a[href="/c/${sourceId}"],a[href^="/c/${sourceId}?"]`)?.textContent?.trim()
      : '';
    const sourceTitle = (sourceEntry?.annotations?.title || sourceEntry?.summary || domSourceTitle || fallbackTitle || '').trim();
    const summaryTitles = Object.values(map).map(entry => (entry?.annotations?.title || entry?.summary || '').trim());
    const domTitles = typeof document !== 'undefined'
      ? [...(document.querySelectorAll?.('a[href^="/c/"]') || [])].map(el => el.textContent?.trim())
      : [];
    const title = nextBranchTitle(sourceTitle, [...summaryTitles, ...domTitles]);
    const annotations = typeof YF === 'object' && YF?.ConversationAnnotationsSchema && typeof Wb === 'function'
      ? Wb(YF.ConversationAnnotationsSchema, { title })
      : { title };
    const apply = () => svc.updateConversationAnnotations([newId], annotations, true);
    try { await apply(); } catch {}
    if (typeof setTimeout === 'function') setTimeout(() => { void Promise.resolve(apply()).catch(() => {}); }, 450);
    return title;
  }
  function isSubagentForkError(error) {
    return /invoked subagents/i.test(String(error?.message || error || ''));
  }
  async function forkViaSideQuestion(conversationId, targetStepIndex = -1) {
    const svc = service();
    if (typeof svc.startCascade !== 'function' || typeof svc.forkConversation !== 'function') {
      throw new Error('Side question fork promotion is unavailable');
    }
    const sqId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    const baseTrajectoryIdentifier = typeof I === 'object' && I?.BaseTrajectoryIdentifierSchema && typeof Wb === 'function'
      ? Wb(I.BaseTrajectoryIdentifierSchema, { identifier: { case: 'cascadeId', value: conversationId } })
      : { identifier: { case: 'cascadeId', value: conversationId } };
    let started = false;
    try {
      await svc.startCascade({
        cascadeId: sqId,
        trajectoryType: 22,
        source: 1,
        baseTrajectoryIdentifier
      });
      started = true;
      return await svc.forkConversation({
        sourceCascadeId: sqId,
        forkAtStepIndex: targetStepIndex,
        targetForkWorkspace: 1
      });
    } finally {
      if (started && typeof svc.deleteCascadeTrajectory === 'function') {
        try { await svc.deleteCascadeTrajectory(sqId); } catch {}
      }
    }
  }
  async function fork(conversationId, stepIndex = -1, { exact = false, autoRename = true, allowSideQuestionFallback = true } = {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(conversationId || '') || !Number.isInteger(stepIndex) || stepIndex < -1) throw new Error('Invalid fork point');
    if (!exact) stepIndex = await forkPoint(conversationId, stepIndex);
    const svc = service();
    let response, promotedViaSideQuestion = false;
    try {
      response = await svc.forkConversation({ sourceCascadeId: conversationId, forkAtStepIndex: stepIndex, targetForkWorkspace: 1 });
    } catch (error) {
      if (!allowSideQuestionFallback || !isSubagentForkError(error) || typeof svc.startCascade !== 'function') throw error;
      response = await forkViaSideQuestion(conversationId, stepIndex);
      promotedViaSideQuestion = true;
    }
    if (!response?.newCascadeId) throw new Error('Antigravity returned no forked conversation');
    if (autoRename) await renameForkedConversation(conversationId, response.newCascadeId);
    return { conversationId: response.newCascadeId, projectId: response.newProjectId || '', forkedAtStepIndex: response.forkedAtStepIndex, warnings: response.warnings || [], promotedViaSideQuestion };
  }
  async function hydrateMedia(media,stepHandler){
    return (await Promise.all((media||[]).map(async item=>{
      if(item?.uri&&!(item.payload?.case==='inlineData'&&item.payload.value?.length>0)){
        const url=stepHandler?.resolveArtifactUrl?.(item.uri);
        if(url&&typeof fetch==='function'){
          try{const res=await fetch(url);if(res.ok){const bytes=new Uint8Array(await res.arrayBuffer());return{...item,uri:'',payload:{case:'inlineData',value:bytes}};}}catch{}
        }
      }
      return item;
    }))).filter(Boolean);
  }
  const suspendedEdits=new Map();
  function snapshotEditorState(editor){
    const state=editor?.getEditorState?.();
    let json=null;
    try{const raw=state?.toJSON?.();if(raw&&typeof raw==='object')json=JSON.stringify(raw);}catch{}
    return{state,json};
  }
  function applyEditorSnapshot(editor,snapshot){
    if(!editor?.setEditorState||!snapshot)return;
    try{
      if(snapshot.json&&typeof IJ==='function'){editor.setEditorState(IJ(editor,snapshot.json));return;}
    }catch{}
    try{if(snapshot.state)editor.setEditorState(snapshot.state);}catch{}
  }
  function restoreComposerHome(record){
    if(!record)return;
    try{
      if(record.inputBox&&record.homeParent&&record.homeParent.isConnected!==false){
        const refNode=record.homeNext?.parentNode===record.homeParent?record.homeNext:null;
        if(record.inputBox.parentNode!==record.homeParent||record.inputBox.nextSibling!==refNode){
          record.homeParent.insertBefore(record.inputBox,refNode);
        }
      }
      record.inlineHost?.remove?.();
      record.element?.removeAttribute?.('data-agy-editing-target');
    }catch{}
  }
  function mountInlineEdit({element,cascadeId,stepIndex,chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,savedSnapshot,savedMedia,comments,label,cancelLabel}){
    let inlineHost=null;
    if(inputBox&&homeParent&&typeof document.createElement==='function'){
      inlineHost=document.createElement('div');
      inlineHost.dataset.agyEditorSlot='';
      inlineHost.dataset.testid='agy-inline-edit-host';
      inlineHost.className='w-full flex flex-col gap-1.5';
      const header=document.createElement('div');
      header.dataset.testid='agy-edit-banner';
      header.className='flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground select-none';
      const title=document.createElement('span');
      title.className='truncate';
      title.textContent=label;
      const cancelButton=document.createElement('button');
      cancelButton.type='button';
      cancelButton.dataset.testid='agy-edit-cancel';
      cancelButton.className='shrink-0 px-2 py-0.5 rounded-md border border-border bg-card text-foreground hover:bg-secondary transition-colors cursor-pointer';
      cancelButton.textContent=cancelLabel;
      cancelButton.addEventListener('click',event=>{event.stopPropagation();cancelEdit();});
      header.append(title,cancelButton);
      inlineHost.append(header);
      inlineHost.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector?.('[role="listbox"],[role="menu"],[data-select-popup],[data-testid="agy-context-popup"],[data-testid="agy-stats-popup"]')){
          event.preventDefault();event.stopPropagation();cancelEdit();
        }
      });
      element.setAttribute?.('data-agy-editing-target','');
      if(element.prepend)element.prepend(inlineHost);else element.insertBefore?.(inlineHost,element.firstChild||null);
      inlineHost.append(inputBox);
    }
    pendingEdit={cascadeId,stepIndex,element,box,editor,inputBox,homeParent,homeNext,inlineHost,stepHandler:chatCtx.stepHandler,optimistic:optCtx,savedEditorState:savedSnapshot?.state,savedSnapshot,savedMedia,comments,label,cancelLabel};
    installRequestOverrides(element);notifyEdit();
    editor.focus?.();(inlineHost||box.getInputCardElement?.())?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
    return pendingEdit;
  }
  function suspendEdit(){
    if(!pendingEdit)return null;
    const current=pendingEdit;pendingEdit=null;
    const editSnapshot=snapshotEditorState(current.editor);
    const editMedia=[...(current.box?.getMediaAttachments?.()||[])];
    const record={
      cascadeId:current.cascadeId,
      stepIndex:current.stepIndex,
      editSnapshot,
      editMedia,
      savedSnapshot:current.savedSnapshot,
      savedMedia:current.savedMedia,
      comments:current.comments,
      label:current.label,
      cancelLabel:current.cancelLabel
    };
    suspendedEdits.set(current.cascadeId,record);
    restoreComposerHome(current);
    applyEditorSnapshot(current.editor,current.savedSnapshot);
    try{current.box?.setMediaAttachments?.(current.savedMedia||[]);}catch{}
    installRequestOverrides();notifyEdit();
    return record;
  }
  function getSuspendedEdit(cascadeId){return cascadeId?suspendedEdits.get(cascadeId)||null:null;}
  function clearSuspendedEdits(cascadeId){if(cascadeId)suspendedEdits.delete(cascadeId);else suspendedEdits.clear();}
  function cancelEdit({restoreDraft=true}={}){
    if(!pendingEdit)return false;
    const current=pendingEdit;pendingEdit=null;suspendedEdits.delete(current.cascadeId);restoreComposerHome(current);installRequestOverrides();
    if(restoreDraft){
      applyEditorSnapshot(current.editor,current.savedSnapshot);
      try{current.box?.setMediaAttachments?.(current.savedMedia||[]);}catch{}
    }
    notifyEdit();return true;
  }
  async function beginEdit(element,{label='正在编辑此条消息（发送后将从此处重新生成）',cancelLabel='取消'}={}){
    const message=userMessage(element);
    const list=providers(element);
    const chatCtx=list.find(p=>p.value?.stepHandler?.revertToIndex)?.value;
    const ibCtx=list.find(p=>p.value?.inputBoxRef&&typeof p.value?.getLexicalEditor==='function')?.value;
    const optCtx=list.find(p=>typeof p.value?.applyOptimisticRevert==='function')?.value;
    const box=ibCtx?.inputBoxRef?.current||chatCtx?.inputBoxRef?.current;
    const editor=box?.lexicalRef?.current||ibCtx?.getLexicalEditor?.();
    if(!message||!chatCtx?.stepHandler?.revertToIndex||!box||!editor||typeof IJ!=='function'||typeof LN!=='function')throw new Error('当前消息不支持编辑');
    const stepIndex=HU(message.metadata);
    const view=element.closest?.('[data-testid="conversation-view"]');
    const inputBox=view?.querySelector?.('[data-testid="agent-input-box"]')||box.getInputCardElement?.()?.closest?.('[data-testid="agent-input-box"]')||null;
    const sameConvo=pendingEdit?.cascadeId===message.cascadeId;
    const priorSuspended=!sameConvo?suspendedEdits.get(message.cascadeId):null;
    suspendedEdits.delete(message.cascadeId);
    const savedSnapshot=sameConvo?pendingEdit.savedSnapshot:priorSuspended?priorSuspended.savedSnapshot:snapshotEditorState(editor);
    const savedMedia=sameConvo?pendingEdit.savedMedia:priorSuspended?priorSuspended.savedMedia:[...(box.getMediaAttachments?.()||[])];
    const homeParent=sameConvo&&pendingEdit.homeParent?pendingEdit.homeParent:inputBox?.parentElement||null;
    const homeNext=sameConvo&&pendingEdit.homeParent?pendingEdit.homeNext:inputBox?.nextSibling||null;
    if(pendingEdit){
      if(pendingEdit.cascadeId!==message.cascadeId)suspendEdit();
      else{pendingEdit.inlineHost?.remove?.();pendingEdit.element?.removeAttribute?.('data-agy-editing-target');}
    }
    editor.setEditorState(IJ(editor,LN(message.step.items||[])));
    const media=await hydrateMedia(message.step.media,chatCtx.stepHandler);
    box.setMediaAttachments?.(media);
    chatCtx.restoreReviewComments?.({cascadeId:message.cascadeId,comments:message.step});
    return mountInlineEdit({
      element,cascadeId:message.cascadeId,stepIndex,chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,savedSnapshot,savedMedia,
      comments:{artifactComments:message.step.artifactComments||[],fileDiffComments:message.step.fileDiffComments||[],fileComments:message.step.fileComments||[]},
      label,cancelLabel
    });
  }
  function resumeEdit(element){
    if(pendingEdit||!element)return null;
    const message=userMessage(element);
    if(!message)return null;
    const suspended=suspendedEdits.get(message.cascadeId);
    if(!suspended||HU(message.metadata)!==suspended.stepIndex)return null;
    const list=providers(element);
    const chatCtx=list.find(p=>p.value?.stepHandler?.revertToIndex)?.value;
    const ibCtx=list.find(p=>p.value?.inputBoxRef&&typeof p.value?.getLexicalEditor==='function')?.value;
    const optCtx=list.find(p=>typeof p.value?.applyOptimisticRevert==='function')?.value;
    const box=ibCtx?.inputBoxRef?.current||chatCtx?.inputBoxRef?.current;
    const editor=box?.lexicalRef?.current||ibCtx?.getLexicalEditor?.();
    const view=element.closest?.('[data-testid="conversation-view"]');
    const inputBox=view?.querySelector?.('[data-testid="agent-input-box"]')||box?.getInputCardElement?.()?.closest?.('[data-testid="agent-input-box"]')||null;
    const homeParent=inputBox?.parentElement||null;
    const homeNext=inputBox?.nextSibling||null;
    if(!chatCtx?.stepHandler?.revertToIndex||!box||!editor||!inputBox||!homeParent)return null;
    suspendedEdits.delete(message.cascadeId);
    applyEditorSnapshot(editor,suspended.editSnapshot);
    try{box.setMediaAttachments?.(suspended.editMedia||[]);}catch{}
    return mountInlineEdit({
      element,cascadeId:suspended.cascadeId,stepIndex:suspended.stepIndex,chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,
      savedSnapshot:suspended.savedSnapshot,savedMedia:suspended.savedMedia,comments:suspended.comments,
      label:suspended.label,cancelLabel:suspended.cancelLabel
    });
  }
  globalThis.__agyNativeAdapter = { version,get active(){return !disposed;},get stageUpdates(){return runtimeEnabled&&stageUpdatesEnabled;},get codexProgress(){return runtimeEnabled&&codexProgressEnabled;},get uiLanguage(){return uiLanguage;},get hdImages(){return runtimeEnabled&&hdImagesEnabled;},get codexComposerMedia(){return runtimeEnabled&&codexComposerMediaEnabled;},get pendingEdit(){return pendingEdit;},onEditChange,beginEdit,suspendEdit,resumeEdit,getSuspendedEdit,clearSuspendedEdits,cancelEdit,ensureRequestHook,fiber, providers, service, authService, startAccountLogin, wrap, store, router, overview, capabilities, executionState, runningConversationIds, unreadCount, conversationDirectory, subagents, openSubagent, composerCascadeId, fileTreeEntry, resolveContextTarget, resolveInlineMediaPayload, extractQuotableSelection, attachSelectionToComposer, findComposer, attachFileToComposer, setEnabled, setContextLimit, setStageUpdates, setCodexProgress, setUiLanguage, setEfficientIO, setHdImages, setCodexComposerMedia, setSidebarProjectLimit, installPage, fork, forkViaSideQuestion, forkPoint, nextBranchTitle, renameForkedConversation, userMessage, extractFinalResponseFromSteps, finalResponseText, navigateTurn, replaceText, editAndResend,
    dispose(){disposed=true;codexProgressEnabled=false;stageUpdatesEnabled=false;uiLanguage='zh-CN';hdImagesEnabled=false;codexComposerMediaEnabled=false;suspendedEdits.clear();cancelEdit({restoreDraft:false});editListeners.clear();if(sendService&&originalSend)sendService.sendUserCascadeMessage=originalSend;if(originalResolve)globalThis[hookNames.resolve]=originalResolve;if(originalSegmentRender&&globalThis[hookNames.segment]===stageSegmentRender)globalThis[hookNames.segment]=originalSegmentRender;if(originalSplitSegments&&hookNames.splitSegments&&globalThis[hookNames.splitSegments]===wrappedSplitSegments)globalThis[hookNames.splitSegments]=originalSplitSegments;if(originalImageCompress&&hookNames.imageCompress&&globalThis[hookNames.imageCompress]===wrappedImageCompress)globalThis[hookNames.imageCompress]=originalImageCompress;if(originalSidebarItems&&hookNames.sidebarItems&&globalThis[hookNames.sidebarItems]===wrappedSidebarItems){globalThis[hookNames.sidebarItems]=originalSidebarItems;refreshSidebarList();}} };
})();
