import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import vm from'node:vm';
import{toZhTw}from'../lib/zh-tw.mjs';
import{renderAuxPaneHtml}from'../lib/sidecar-ui.mjs';
import{formatRelativeTime,formatResetCountdown}from'../lib/account-helpers.mjs';
import{createSettingsStore}from'../lib/settings.mjs';
test('native settings translations preserve product names and English input terminology',()=>{
 const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
 const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}}});
 vm.runInContext(readFileSync('lib/native-i18n.js','utf8'),context);const t=context.__agyI18n.t;
 assert.equal(t('Interface Layout','zh-CN'),'界面布局');assert.equal(t('Queued Messages','zh-CN'),'后续消息');assert.equal(t('输入','en'),'Input');
 assert.equal(t('Google AI Ultra','zh-CN'),'Google AI Ultra');assert.equal(t('Google Sans','zh-CN'),'Google Sans');assert.equal(t('Ctrl','zh-CN'),'Ctrl');
 assert.equal(t('Your Plan: Google AI Ultra','zh-CN'),'当前套餐：Google AI Ultra');
 assert.equal(t('You have used some of your weekly limit, it will fully refresh in 3 days, 11 hours.','zh-CN'),'周额度将在 3 天 11 小时后重置。');
 assert.equal(t('Quote','zh-CN'),'引用');assert.equal(t('Ask /btw','zh-CN'),'顺便问 /btw');
 assert.equal(t('Local Permissions','zh-CN'),'本地权限');assert.equal(t('Every command requires approval.','zh-CN'),'每条命令均需批准。');
 assert.equal(t('Ask before sensitive operations.','zh-CN'),'执行敏感操作前询问。');assert.equal(t('Run all commands without restrictions.','zh-CN'),'无限制运行所有命令。');
 assert.equal(t('Background Tasks','zh-CN'),'后台任务');assert.equal(t('See all (6)','zh-CN'),'查看全部 (6)');
 assert.equal(t('See all','zh-CN'),'查看全部');assert.equal(t('Conversation Name','zh-CN'),'会话名称');assert.equal(t('Conversation ID','zh-CN'),'会话 ID');assert.equal(t('Project Name','zh-CN'),'项目名称');
 assert.equal(t('Split Right','zh-CN'),'向右拆分');assert.equal(t('Split Down','zh-CN'),'向下拆分');assert.equal(t('Replace with New','zh-CN'),'替换为新会话');
 assert.equal(t('Search or enter a URL','zh-CN'),'搜索或输入网址');assert.equal(t('Open File','zh-CN'),'打开文件');
 assert.equal(t('Side Question','zh-CN'),'侧边对话');assert.equal(t('New Side Question','zh-CN'),'新建侧边对话');
 assert.equal(t('Ask a side question without interrupting the main conversation','zh-CN'),'发起侧边对话，不打断主对话');
 assert.equal(t('12 files changed','zh-CN'),'12 个文件已更改');assert.equal(t('1 file changed','zh-CN'),'1 个文件已更改');
 assert.equal(t('5h limit','zh-CN'),'5 小时限额');assert.equal(t('55% left','zh-CN'),'剩余 55%');assert.equal(t('100% left','zh-CN'),'剩余 100%');
 assert.equal(t('Resets in 5d 1h','zh-CN'),'5 天 1 小时后重置');assert.equal(t('Resets in 3h 33m','zh-CN'),'3 小时 33 分钟后重置');
 assert.equal(t('Pull Requests','zh-CN'),'Pull Requests');assert.equal(t('14m ago','zh-CN'),'14m ago');
 assert.equal(t('Turbo','zh-CN'),'Turbo');assert.equal(t('当前会话','en'),'Current conversation');
});

test('Traditional Chinese (zh-TW) uses Taiwan IT terminology, converts UI strings cleanly, and persists in settings',()=>{
  const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
  const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}},__agyToZhTw:toZhTw});
  vm.runInContext(readFileSync('lib/native-i18n.js','utf8'),context);
  const t=context.__agyI18n.t;
  assert.equal(t('Settings','zh-TW'),'設定');
  assert.equal(t('Context window','zh-TW'),'上下文視窗');
  assert.equal(t('Cache hit','zh-TW'),'快取命中');
  assert.equal(t('Open File','zh-TW'),'開啟檔案');
  assert.equal(t('Restore defaults','zh-TW'),'恢復預設設定');
  assert.equal(t('Every command requires approval.','zh-TW'),'每條命令均需批准。');
  assert.equal(t('Background Tasks','zh-TW'),'背景任務');
  assert.equal(t('Your Plan: Google AI Ultra','zh-TW'),'目前方案：Google AI Ultra');
  assert.equal(t('Resets in 3h 33m','zh-TW'),'3 小時 33 分鐘後重置');
  assert.equal(t('Thinking effort','zh-CN'),'思考深度');
  assert.equal(t('Thinking effort','zh-TW'),'思考深度');
  assert.equal(t('View Usage','zh-CN'),'查看用量');
  assert.equal(t('Promote to Conversation','zh-CN'),'提升为正式会话');
  assert.equal(t('Promote to Conversation','zh-TW'),'提升為正式會話');
  assert.equal(t('Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.','zh-TW'),'負責執行計畫，包括檢索、編輯、構建與測試，建議選擇更快、更省的模型。');
  assert.equal(t('Delete Conversation','zh-CN'),'删除会话');
  assert.equal(t('Delete Conversation','zh-TW'),'刪除會話');
  assert.equal(t('Are you sure you want to delete this conversation? This action cannot be undone.','zh-TW'),'確定要刪除此會話嗎？此操作無法撤銷。');
  assert.equal(t('Minimize','zh-TW'),'最小化');
  assert.equal(t('Maximize','zh-TW'),'最大化');
  assert.equal(t('Create Project','zh-TW'),'建立專案');
  assert.equal(t('Command Palette','zh-TW'),'命令面板');
  assert.equal(t('This computer','zh-TW'),'本機');
  assert.equal(t('Input Box','zh-TW'),'輸入框');
  assert.equal(t('Queued messages','zh-TW'),'後續訊息');
  assert.equal(t('Choose which key sends a message in the chat composer.','zh-TW'),'選擇在聊天輸入框中傳送訊息的按鍵。');
  assert.equal(t('Controls how much time and quota the model spends reasoning before responding. Higher effort improves accuracy on hard problems, at the cost of slower responses and higher quota use.','zh-CN'),'控制模型在回复前投入多少时间与额度进行推理。更高的思考深度可提升复杂问题的准确度，但会增加响应耗时与额度消耗。');
  assert.equal(toZhTw('复制文件并恢复默认设置，助手回复缓存异常'), '複製檔案並恢復預設設定，助手回覆快取異常');
  assert.equal(toZhTw('按实际规划 / 执行模型计价'), '按實際規劃 / 執行模型計價');
  assert.equal(formatRelativeTime(0, 30000, 'zh-TW'), '剛剛');
  assert.equal(formatRelativeTime(0, 120000, 'zh-TW'), '2 分鐘前');
  assert.equal(formatResetCountdown(7200000, 0, 'zh-TW'), '2 小時後重置');
  const html=renderAuxPaneHtml({version:'2.13.1',language:'zh-TW'});
  assert.match(html,/<html lang="zh-TW">/);
  assert.ok(html.includes('需要重啟 Antigravity 以啟用 Powertools 外掛'));
  assert.ok(html.includes('檢查外掛更新'));
  // Ensure settings store accepts zh-TW
  const dir=mkdtempSync(join(tmpdir(),'agy-lang-tw-'));
  try{
    const store=createSettingsStore(dir);
    assert.equal(store.set({language:'zh-TW'}).language,'zh-TW');
    assert.equal(store.get().language,'zh-TW');
  }finally{rmSync(dir,{recursive:true,force:true});}
  // Ensure no common simplified-only glyphs remain across UI source files after toZhTw
  const simplifiedOnly=/[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻齐画荐纯盖气叠缀纲]/;
  for(const file of ['lib/native-i18n.js','lib/native-panels.js','lib/native-ui.js','lib/sidecar-ui.mjs']){
    const converted=toZhTw(readFileSync(file,'utf8')).replace(/简体中文|批准/g,'');
    const leftover=converted.match(simplifiedOnly);
    assert.equal(leftover,null,`Unexpected simplified glyph ${leftover?.[0]} in ${file}`);
  }
  assert.equal(
    toZhTw('内置默认（推荐）对齐画布底色与纯实色气泡并覆盖原设置'),
    '內建預設（推薦）對齊畫布底色與純實色氣泡並覆蓋原設定'
  );
  assert.equal(
    toZhTw('无损直传、虚线链接、收拢折叠与改气泡颜色'),
    '無損直傳、虛線連結、收攏折疊與改氣泡顏色'
  );
  assert.equal(toZhTw('精简排版输出与工具摘要汉化'), '精簡排版輸出與工具摘要漢化');
  assert.equal(toZhTw('本地化'), '本地化');
});

test('Swarm UI strings translate cleanly in zh-CN and zh-TW without middle dots and protect post bodies', () => {
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;
  assert.equal(t('Board', 'zh-CN'), '讨论板');
  assert.equal(t('Board', 'zh-TW'), '討論板');
  assert.equal(t('Members', 'zh-CN'), '成员');
  assert.equal(t('Members', 'zh-TW'), '成員');
  assert.equal(t('Graph', 'zh-CN'), '关系图');
  assert.equal(t('Graph', 'zh-TW'), '關係圖');
  assert.equal(t('From anyone', 'zh-CN'), '来自任意成员');
  assert.equal(t('To anyone', 'zh-TW'), '提及任意成員');
  assert.equal(t('Hide inactive', 'zh-CN'), '隐藏非活跃');
  assert.equal(t('Export GIF', 'zh-TW'), '匯出 GIF'.replace('匯', '導'));
  assert.equal(t('No swarm in this conversation', 'zh-CN'), '当前会话暂无蜂群');
  assert.equal(t('Copy to clipboard', 'zh-TW'), '複製到剪貼簿');
  assert.equal(t('Attach to chat', 'zh-CN'), '引用到输入框');
  assert.equal(t('Attach to chat', 'zh-TW'), '引用到輸入框');
  assert.equal(t('Pinned Conversations', 'zh-CN'), '置顶会话');
  assert.equal(t('Pinned Conversations', 'zh-TW'), '置頂會話');
  assert.equal(t('Copy Image', 'zh-CN'), '复制图片');
  assert.equal(t('Save Image', 'zh-CN'), '保存图片');
  assert.equal(t('Save Image', 'zh-TW'), '儲存圖片');
  const ovLabel = t(`overview \u00b7 from the narrator\u2019s notes`, 'zh-CN');
  assert.equal(ovLabel, '概览 - 来自旁白笔记');
  assert.equal(ovLabel.includes('\u00b7'), false);
  assert.equal(t(`overview \u00b7 from the narrator's notes`, 'zh-TW'), '概覽 - 來自旁白筆記');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-CN'), '适用于深度推理与复杂问题');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-TW'), '適用於深度推理與複雜問題');
  assert.equal(t('Notice', 'zh-CN'), '提示');
  assert.equal(t('Offloads routine steps to a faster executor. Same quality, fewer tokens used.', 'zh-CN'), '将常规步骤分流给更快的执行模型，保持同等质量同时减少 Token 消耗。');
  assert.equal(t('Copy Project Name', 'zh-CN'), '复制项目名称');
  assert.equal(t('Project Settings', 'zh-TW'), '專案設定');
  assert.equal(t('Reveal in Finder', 'zh-CN'), '在访达中显示');
  assert.equal(t('Reveal in Finder', 'zh-TW'), '在Finder中顯示');
  assert.equal(t('Show in File Explorer', 'zh-TW'), '在檔案總管中顯示');
  assert.equal(t('Delete Project', 'zh-CN'), '删除项目');
  assert.equal(t('Yes, allow this time', 'zh-CN'), '是，仅本次允许');
  assert.equal(t('Yes, and always allow in this conversation', 'zh-TW'), '是，並在本會話中始終允許');
  assert.equal(t('Yes, save rule globally', 'zh-CN'), '是，全局保存此规则');
  assert.equal(t('(tell the agent what to do instead)', 'zh-CN'), '（告诉智能体改用什么方式处理）');
  assert.equal(t('Yes, always allow downloads from github.com', 'zh-CN'), '是，始终允许从 github.com 下载');
  assert.equal(t('Yes, and always allow \'npm test\' in this conversation', 'zh-CN'), '是，并在本会话中始终允许 \'npm test\'');
  assert.equal(t('Thought for 14s', 'zh-CN'), '思考了 14 秒');
  assert.equal(t('Thought for 14s', 'zh-TW'), '思考了 14 秒');
  assert.equal(t('Step 2 of 5', 'zh-CN'), '第 2 / 5 步');
  assert.equal(t('Chat Layout', 'zh-TW'), '聊天佈局'.replace('佈', '布'));
  assert.equal(t('Tool Permissions', 'zh-TW'), '工具權限');
  assert.equal(t('Confirm Undo', 'zh-CN'), '确认撤回');
  assert.equal(t('Available AI Credits: 250', 'zh-CN'), '可用 AI 积分：250');
  assert.equal(t('12 tools', 'zh-TW'), '12 個工具');
  assert.equal(t('Show more (4)', 'zh-CN'), '显示更多 (4)');
  assert.equal(t('Swarm', 'zh-CN'), 'Swarm');
  assert.equal(t('Hook Json PreInvocation', 'zh-CN'), '调用前钩子');
  assert.equal(t('Hook Json PreInvocation', 'zh-TW'), '調用前鉤子');
  assert.equal(t('Hook Json SessionStart', 'zh-CN'), '会话启动钩子');
  assert.equal(t('Hook Json SessionStart', 'zh-TW'), '會話啟動鉤子');
  assert.equal(t('Open this pane from a conversation to see its swarm. Swarms started there appear here automatically; start one with', 'zh-CN'), '请在具体会话中打开此面板以查看蜂群。该会话中启动的蜂群会自动显示在这里；输入');
  assert.equal(t('12 posts', 'zh-CN'), '12 条动态');
  assert.equal(t('4 members', 'zh-TW'), '4 名成員');
  assert.equal(t('3 of 5 tasks done', 'zh-CN'), '已完成 3 / 5 项任务');
  assert.equal(t('Waiting on @coordinator', 'zh-CN'), '等待 @coordinator');
  assert.equal(t('Working for @lead', 'zh-CN'), '正为 @lead 处理');
  assert.equal(t('@worker-1 ran out of quota', 'zh-CN'), '@worker-1 额度已耗尽');
  assert.equal(t('@worker-2 looks stuck', 'zh-TW'), '@worker-2 疑似卡住');
  assert.equal(t('Go to #14 on the Board', 'zh-CN'), '在讨论板查看 #14');
  assert.equal(t('Exporting 45%', 'zh-CN'), '正在导出 45%');
  const coordSummary = t(`Coordinator \u00b7 3 of 5 done \u00b7 Needs you`, 'zh-CN');
  assert.equal(coordSummary, '协调者 3 / 5 已完成 需要你处理');
  assert.equal(coordSummary.includes('\u00b7'), false);
  const readSummary = t(`read #12 \u00b7 updated 2m ago`, 'zh-CN');
  assert.equal(readSummary, '已读至 #12 更新于 2m ago');
  assert.equal(readSummary.includes('\u00b7'), false);
  assert.equal(t('Load older messages', 'zh-CN'), '加载更早的消息');
  assert.equal(t('Prevent sleep', 'zh-CN'), '防止休眠');
  assert.equal(t('Context and quota indicator', 'zh-TW'), '上下文與額度指示器');
  assert.equal(t('Delete Permanently', 'zh-TW'), '永久刪除');
  const workedSingle = t('Worked for 5m', 'zh-CN');
  assert.equal(workedSingle, '用时 5分');
  const workedUpdates = t(`Worked for 8m 28s \u00b7 4 updates`, 'zh-CN');
  assert.equal(workedUpdates, '用时 8分28秒 4 条进度');
  assert.equal(workedUpdates.includes('\u00b7'), false);
  assert.equal(t(`Worked for 8m 28s \u00b7 4 updates`, 'zh-TW'), '用時 8分28秒 4 條進度');
  assert.equal(t(`\u00b7 3 updates`, 'zh-CN'), '3 条进度');
  assert.equal(t('Running command', 'zh-CN'), '正在运行命令');
  assert.equal(t('Running command', 'zh-TW'), '正在執行命令');
  assert.equal(t('Waiting for your approval', 'zh-TW'), '等待你的確認');
  assert.equal(t('Ran command', 'zh-CN'), '运行了命令');
  assert.equal(t('Explored files, ran command', 'zh-CN'), '已探索文件，运行了命令');
  assert.equal(t('Explored files, ran command', 'zh-TW'), '已探索檔案，執行了命令');
  assert.equal(t('Explored 3 files, ran commands, edited 2 files', 'zh-CN'), '已探索 3 个文件，运行了命令，编辑了 2 个文件');
  assert.equal(t('Edited artifact', 'zh-TW'), '編輯了產物');
  assert.equal(t('6/6 steps', 'zh-CN'), '6/6 步');
  const planChipMixed = t(`2/6 steps \u00b7 1 failed \u00b7 1 skipped`, 'zh-CN');
  assert.equal(planChipMixed, '2/6 步 1 失败 1 已跳过');
  assert.equal(planChipMixed.includes('\u00b7'), false);
  assert.equal(t('Analyzed', 'zh-CN'), '已分析');
  assert.equal(t('Analyzing', 'zh-CN'), '正在分析');
  assert.equal(t('Editing', 'zh-CN'), '正在编辑');
  assert.equal(t('Editing', 'zh-TW'), '正在編輯');
  assert.equal(t('Reading', 'zh-CN'), '正在读取');
  assert.equal(t('Reading', 'zh-TW'), '正在讀取');
  assert.equal(t('Executed', 'zh-CN'), '已执行');
  assert.equal(t('Executed', 'zh-TW'), '已執行');
  assert.equal(t('Created outline', 'zh-CN'), '已生成大纲');
  assert.equal(t('Created outline', 'zh-TW'), '已生成大綱');
  assert.equal(t('Rejected', 'zh-CN'), '已拒绝');
  assert.equal(t('Rejected', 'zh-TW'), '已拒絕');
  assert.equal(t('Syntax check and full test run finished', 'zh-CN'), '已完成：Syntax check and full test run');
  assert.equal(t('Goal Verification', 'zh-CN'), '目标核验');
  assert.equal(t('Goal Verification', 'zh-TW'), '目標核驗');
  assert.equal(t('Fork Environment Notice', 'zh-CN'), '分支环境提示');
  assert.equal(t('Fork Environment Notice', 'zh-TW'), '分支環境提示');
  assert.equal(t('System Message', 'zh-CN'), '系统消息');
  assert.equal(t('System Message', 'zh-TW'), '系統訊息');
  assert.equal(t('just now', 'zh-CN'), '刚刚');
  assert.equal(t('just now', 'zh-TW'), '剛剛');
  assert.equal(t('Compacting', 'zh-CN'), '正在压缩上下文');
  assert.equal(t('Compacting', 'zh-TW'), '正在壓縮上下文');
  assert.equal(t('Reading native-ui.js', 'zh-CN'), '正在读取 native-ui.js');
  assert.equal(t('Reading native-ui.js', 'zh-TW'), '正在讀取 native-ui.js');
  assert.equal(t('Editing settings.mjs', 'zh-CN'), '正在编辑 settings.mjs');
  assert.equal(t('Editing settings.mjs', 'zh-TW'), '正在編輯 settings.mjs');
  assert.equal(t('Listing lib', 'zh-CN'), '正在列出 lib');
  assert.equal(t('Searching codexProgress', 'zh-CN'), '正在搜索 codexProgress');
  assert.equal(t('Running npm test', 'zh-CN'), '正在运行 npm test');
  assert.equal(t('Running npm test', 'zh-TW'), '正在執行 npm test');
  assert.equal(t('Waiting for approval to grant administrator access', 'zh-CN'), '等待授权管理员权限');
  assert.equal(t('Waiting for approval to grant administrator access', 'zh-TW'), '等待授權管理員權限');
  assert.equal(t('Waiting for approval to read: /etc/hosts', 'zh-CN'), '等待授权读取：/etc/hosts');
  assert.equal(t('Opened URL in Browser', 'zh-CN'), '已在浏览器中打开网址');
  assert.equal(t('Opened URL in Browser', 'zh-TW'), '已在瀏覽器中開啟網址');
  assert.equal(t('Took Screenshot', 'zh-CN'), '已截图');
  assert.equal(t('Took Screenshot', 'zh-TW'), '已截圖');
  assert.equal(t('Inspected commit', 'zh-CN'), '已查看提交');
  assert.equal(t('Running command', 'zh-CN'), '正在运行命令');
  assert.equal(t('Editing files', 'zh-CN'), '正在编辑文件');
  assert.equal(t('Thinking for 2s', 'zh-CN'), '正在思考 2 秒');
  assert.equal(t('Thinking for 2s', 'zh-TW'), '正在思考 2 秒');
  assert.equal(t('Started 2 subagents', 'zh-CN'), '已启动 2 个子智能体');
  assert.equal(t('Starting 2 subagents', 'zh-TW'), '正在啟動 2 個子智慧體'.replace('智慧', '智能'));
  assert.equal(t('Message from 插件覆盖优先级审计员 (research)', 'zh-CN'), '来自 插件覆盖优先级审计员 (research) 的消息');
  assert.equal(t('Listing tasks', 'zh-CN'), '正在列出任务');
  assert.equal(t('Reading terminal:', 'zh-CN'), '正在读取终端：');
  assert.equal(t('Worked for 1d 2h 3m', 'zh-CN'), '用时 1天2小时3分');
  assert.equal(t('Waiting for subagent', 'zh-CN'), '正在等待子智能体');
  const browserThink = t(`Using browser \u00b7 Thinking (5s)\u2026`, 'zh-CN');
  assert.equal(browserThink, '正在使用浏览器 正在思考 (5 秒)…');
  assert.equal(browserThink.includes('\u00b7'), false);
  const subStatus = t(`2 subagents running, 1 blocked \u00b7 1m 30s left`, 'zh-CN');
  assert.equal(subStatus, '2 个子智能体运行中，1 项已阻塞 剩余 1分30秒');
  assert.equal(subStatus.includes('\u00b7'), false);
  assert.equal(t('Task Notification', 'zh-CN'), '任务通知');
  assert.equal(t('Agent Message', 'zh-TW'), '智能體訊息');
  assert.equal(t('Pinned Conversations', 'zh-CN'), '置顶会话');
  assert.equal(t('Pinned Conversations', 'zh-TW'), '置頂會話');
  assert.equal(t('Save Image', 'zh-CN'), '保存图片');
  assert.equal(t('Save Image', 'zh-TW'), '儲存圖片');
  assert.equal(t('Save Image As…', 'zh-CN'), '图片另存为…');
  assert.equal(t('Save Image As…', 'zh-TW'), '圖片另存為…');
  assert.equal(t('Attach to current chat', 'zh-CN'), '引用到当前对话');
  assert.equal(t('Attach to current chat', 'zh-TW'), '引用到目前對話');
  assert.equal(t('Ask in Side Question', 'zh-CN'), '引用到侧边对话');
  assert.equal(t('Ask in Side Question', 'zh-TW'), '引用到側邊對話');
  assert.equal(t('Failed to attach to Side Question', 'zh-CN'), '引用到侧边对话失败');
  assert.equal(t('Failed to attach to Side Question', 'zh-TW'), '引用到側邊對話失敗');
  assert.equal(t('Image copied', 'zh-CN'), '已复制图片');
  assert.equal(t('Image copied', 'zh-TW'), '已複製圖片');
  assert.equal(t('Failed to copy image', 'zh-CN'), '复制图片失败');
  assert.equal(t('Failed to copy image', 'zh-TW'), '複製圖片失敗');
  assert.equal(toZhTw('撑高输入框贴图匹配缩略图'), '撐高輸入框貼圖匹配縮略圖');
  // React split text node ("2" + " subagents") translates cleanly
  const splitNum = { nodeType: 3, nodeValue: '2' };
  const splitSuffix = {
    nodeType: 3,
    nodeValue: ' subagents',
    previousSibling: splitNum,
    isConnected: true,
    parentElement: { closest: () => null }
  };
  let nextIdx = 0;
  const splitDoc = {
    nodeType: 9,
    createTreeWalker: () => ({ nextNode: () => nextIdx++ === 0 ? splitSuffix : null }),
    querySelectorAll: () => []
  };
  const splitCtx = vm.createContext({
    document: splitDoc,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyInitialSettings: { enabled: true, language: 'zh-CN' }
  });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), splitCtx);
  assert.equal(splitSuffix.nodeValue, ' 个子智能体');

  // Selection pill buttons translate to Codex labels ("添加到对话" / "在侧边聊天中提问") only when codexStyle is active, without changing global "Side Question"
  let codexActive = true;
  const attrs = { hasAttribute: name => name === 'data-agy-codex-style' && codexActive };
  const quoteText = { nodeType: 3, nodeValue: 'Quote', isConnected: true, previousSibling: null, parentElement: { closest: sel => sel.includes('selection-quote-button') ? { getAttribute: () => 'selection-quote-button', closest: () => null } : null } };
  const sideBtnText = { nodeType: 3, nodeValue: 'Side Question', isConnected: true, previousSibling: null, parentElement: { closest: sel => sel.includes('selection-btw-button') ? { getAttribute: () => 'selection-btw-button', closest: () => null } : null } };
  const headerSideText = { nodeType: 3, nodeValue: 'Side Question', isConnected: true, previousSibling: null, parentElement: { closest: () => null } };
  const selNodes = [quoteText, sideBtnText, headerSideText];
  let scanIdx = 0;
  const selDoc = {
    nodeType: 9,
    documentElement: attrs,
    createTreeWalker: () => ({ nextNode: () => scanIdx < selNodes.length ? selNodes[scanIdx++] : null }),
    querySelectorAll: sel => sel === '.selection-popup' ? [{ nodeType: 1, closest: () => null, getAttribute: () => null, hasAttribute: () => false }] : []
  };
  const selCtx = vm.createContext({
    document: selDoc,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw,
    __agyInitialSettings: { enabled: true, language: 'zh-CN' }
  });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), selCtx);
  assert.equal(quoteText.nodeValue, '添加到对话');
  assert.equal(sideBtnText.nodeValue, '在侧边聊天中提问');
  assert.equal(headerSideText.nodeValue, '侧边对话');

  // Turning off codexStyle + rescan restores standard non-Codex labels cleanly
  codexActive = false;
  scanIdx = 0;
  selCtx.__agyLocalization.apply('zh-CN', false);
  selCtx.__agyLocalization.apply('en', false);
  assert.equal(quoteText.nodeValue, 'Quote');
  assert.equal(sideBtnText.nodeValue, 'Side Question');

  const i18nSrc = readFileSync('lib/native-i18n.js', 'utf8');
  assert.ok(i18nSrc.includes('.post-body') && i18nSrc.includes('#ov-frame'));
});

test('localizer skips English text inside code editors, diff viewers, and monospace code surfaces (Issue #55)', () => {
  const makeNode = (value, matchedSelectors = []) => ({
    nodeValue: value,
    parentElement: {
      closest: sel => matchedSelectors.some(m => sel.includes(m)) ? {} : null
    }
  });
  const nodes = [
    makeNode('Settings', ['.monaco-editor']),
    makeNode('Delete', ['.monaco-diff-editor']),
    makeNode('Copy', ['[data-testid*="diff"]']),
    makeNode('Review', ['.code-block']),
    makeNode('Open File', ['.view-lines']),
    makeNode('Settings', [])
  ];
  let idx = 0;
  const document = {
    nodeType: 9,
    body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] },
    createTreeWalker: () => {
      let i = 0;
      return { nextNode: () => nodes[i++] || null };
    },
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const loc = context.__agyI18n.localizer();
  loc.apply('zh-CN', true);
  assert.equal(nodes[0].nodeValue, 'Settings');
  assert.equal(nodes[1].nodeValue, 'Delete');
  assert.equal(nodes[2].nodeValue, 'Copy');
  assert.equal(nodes[3].nodeValue, 'Review');
  assert.equal(nodes[4].nodeValue, 'Open File');
  assert.equal(nodes[5].nodeValue, '设置');
  loc.dispose();
});

test('Skills and Customizations UI strings translate accurately in zh-CN and zh-TW (Issue #60)', () => {
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;
  assert.equal(t('Skills & Rules', 'zh-CN'), '技能与规则');
  assert.equal(t('Skills & Rules', 'zh-TW'), '技能與規則');
  assert.equal(t('Active Skills', 'zh-CN'), '已启用技能');
  assert.equal(t('Enable Recommended Skills', 'zh-TW'), '啟用推薦技能');
  assert.equal(t('Browse the Marketplace', 'zh-CN'), '浏览插件市场');
  assert.equal(t('No skills or rules yet.', 'zh-TW'), '暫無技能或規則。');
  assert.equal(t('Delete Skill', 'zh-CN'), '删除技能');
  assert.equal(t('Copy Config File Path', 'zh-TW'), '複製設定檔路徑');
});
