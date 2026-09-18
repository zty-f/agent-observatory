let sessions = [], trash = [], selectedId = null, selectedIds = new Set(), view = 'overview', activeAgent = localStorage.getItem('codex-hub-agent') || 'all', agentCatalog = [];
let viewMode = localStorage.getItem('codex-hub-view') || 'list';
let filters = { project: 'all', status: 'all', time: 'all' };
let detailRequest = 0, busy = false, loading = false, liveRefreshTimer = null;
const API = '/api';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
const statusText = (s) => ({ completed: '已完成', archived: '已归档', trash: '废纸篓' }[s] || s);
const runtimeKey = (item) => item.runtime?.key || (item.status === 'archived' ? 'archived' : item.status === 'trash' ? 'trash' : 'completed');
const runtimeText = (item) => item.runtime?.label || statusText(item.status);
const runtimeTone = (item) => item.runtime?.tone || 'quiet';
const isRuntimeLive = (item) => runtimeKey(item) === 'responding';
const idleText = (seconds) => {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '暂无时间信号';
  if (n < 60) return `${Math.max(0, n)} 秒前`;
  if (n < 3600) return `${Math.floor(n / 60)} 分钟前`;
  if (n < 86400) return `${Math.floor(n / 3600)} 小时前`;
  return `${Math.floor(n / 86400)} 天前`;
};
const viewText = { overview: '全部会话', projects: '项目空间', archived: '已归档', trash: '系统废纸篓' };
const formatSize = (bytes) => { const n = Number(bytes) || 0; if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`; return `${Math.max(1, Math.round(n / 1024))} KB`; };
const savedTheme = localStorage.getItem('codex-hub-theme');
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('codex-hub-theme', next);
  const button = $('#theme-toggle');
  if (button) { button.textContent = next === 'light' ? '☾' : '☼'; button.title = next === 'light' ? '切换到暗色主题' : '切换到亮色主题'; button.setAttribute('aria-label', button.title); }
}
function projectTone(name) {
  let hash = 0;
  for (const char of String(name || '本机工作区')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `tone-${hash % 7}`;
}
const agentText = (agent) => ({ codex: 'Codex', claude: 'Claude Code', openclaw: 'OpenClaw', pi: 'Pi Agent' }[agent] || agent || 'Agent');
function renderAgentSwitcher() {
  const popover = $('#agent-popover');
  const toggle = $('#agent-toggle');
  if (!popover || !toggle) return;
  const total = agentCatalog.reduce((sum, x) => sum + (x.count || 0), 0);
  const options = [{ id: 'all', label: '全部 Agent', mark: '⌬', count: total }, ...agentCatalog];
  const current = options.find((item) => item.id === activeAgent) || options[0];
  toggle.querySelector('.agent-toggle-mark').textContent = current.mark || '⌬';
  $('#active-agent-label').textContent = current.label;
  $('#agent-readout').textContent = activeAgent === 'all' ? 'ALL AGENTS' : agentText(activeAgent).toUpperCase();
  popover.innerHTML = options.map((item) => `<button class="agent-option ${activeAgent === item.id ? 'active' : ''}" data-agent="${item.id}" role="menuitem"><span class="agent-option-mark">${esc(item.mark || '•')}</span><span><b>${esc(item.label)}</b><small>${item.id === 'all' ? '跨 Agent 聚合视图' : '只显示此 Agent 的会话'}</small></span><em>${item.count ?? '—'}</em></button>`).join('');
}

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), error ? 10000 : 2800);
}
async function api(url, options) {
  const isMutation = options?.method && options.method !== 'GET';
  const attempts = isMutation ? 1 : 2;
  let last;
  for (let i = 0; i < attempts; i += 1) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    } catch (error) {
      last = error;
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 450));
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 ${response.status}`);
    return data;
  }
  if (isMutation && (last?.name === 'TimeoutError' || last?.name === 'AbortError')) throw new Error('请求超时，请刷新页面核对操作结果后再重试');
  throw new Error(`本地服务不可用：${last?.message || last}`);
}
function allVisibleSource() { return view === 'trash' ? trash : sessions; }
function visible() {
  const query = ($('#search-input')?.value || '').trim().toLowerCase();
  const sort = $('#sort-select')?.value || 'recent';
  const list = allVisibleSource().filter((item) => {
    if (view === 'archived' && item.status !== 'archived') return false;
    if (view !== 'trash' && filters.project !== 'all' && item.project !== filters.project) return false;
    if (view !== 'trash' && filters.status !== 'all') {
      if (filters.status === 'archived' ? item.status !== 'archived' : runtimeKey(item) !== filters.status) return false;
    }
    const age = Date.now() - Date.parse(item.updated);
    if (filters.time === 'week' && age > 604800000) return false;
    if (filters.time === 'month' && age > 2592000000) return false;
    const haystack = `${item.title} ${item.project} ${item.module} ${item.path} ${item.summary} ${item.agentLabel}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  return list.sort((a, b) => sort === 'oldest' ? a.updated.localeCompare(b.updated) : sort === 'messages' ? b.messages - a.messages : b.updated.localeCompare(a.updated));
}
function updateStats() {
  const archived = sessions.filter((x) => x.status === 'archived').length;
  const running = sessions.filter((x) => runtimeKey(x) === 'responding').length;
  const justCompleted = sessions.filter((x) => runtimeKey(x) === 'just_completed').length;
  const attention = sessions.filter((x) => runtimeKey(x) === 'attention').length;
  const projects = new Set(sessions.map((x) => x.project)).size;
  $('#nav-count').textContent = sessions.length;
  $('#project-count').textContent = projects;
  $('#archive-count').textContent = archived;
  $('#trash-count').textContent = trash.length;
  $('#stat-total').textContent = sessions.length;
  $('#stat-projects').textContent = projects;
  $('#stat-messages').textContent = sessions.reduce((sum, x) => sum + x.messages, 0).toLocaleString();
  const archivedStat = $('#stat-archived'); if (archivedStat) archivedStat.textContent = archived;
  const activeStat = $('#stat-active'); if (activeStat) activeStat.textContent = running;
  $('#stat-running').textContent = running;
  $('#stat-just-completed').textContent = justCompleted;
  $('#stat-attention').textContent = attention;
  $('#week-count').textContent = sessions.filter((x) => Date.now() - Date.parse(x.updated) < 604800000).length;
  $('#selection-count').textContent = selectedIds.size ? `已选 ${selectedIds.size}` : '';
  $('#dock-count').textContent = selectedIds.size;
  $('#bulk-trash').textContent = view === 'trash' ? '↺ 恢复到原位置' : '⌫ 移到系统废纸篓';
  $('#selection-dock').classList.toggle('restore-mode', view === 'trash');
  $('#selection-dock').classList.toggle('visible', selectedIds.size > 0);
  $$('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === viewMode));
  const activeFilters = Object.values(filters).filter((value) => value !== 'all').length;
  const filterCount = $('#filter-count');
  if (filterCount) {
    filterCount.textContent = activeFilters ? ` ${activeFilters}` : '';
    filterCount.parentElement?.classList.toggle('has-count', activeFilters > 0);
  }
}
function dateBucket(item) {
  const age = Date.now() - Date.parse(item.updated);
  if (age < 86400000) return { key: 'today', label: '今天', note: '最近 24 小时' };
  if (age < 604800000) return { key: 'week', label: '最近 7 天', note: '过去一周的工作轨迹' };
  return { key: 'earlier', label: '更早', note: '需要时可继续找回' };
}
function sessionCard(item) {
  const checked = selectedIds.has(item.id);
  const isTrash = item.status === 'trash';
  const canSelect = isTrash || item.capabilities?.canTrash !== false;
  const rKey = runtimeKey(item);
  const rTone = runtimeTone(item);
  const live = isRuntimeLive(item);
  return `<article class="session-card ${projectTone(item.project)} agent-${esc(item.agent)} status-${esc(item.status)} runtime-${esc(rKey)} ${live ? 'is-live' : ''} ${selectedId === item.id ? 'selected' : ''}" data-id="${esc(item.id)}">
    <div class="session-card-rail"><span class="timeline-pin"></span><span class="rail-label">${live ? 'LIVE' : isTrash ? 'TRASH' : 'LOG'}</span></div>
    <div class="session-main">
      <div class="session-card-head"><div class="session-stamp"><span class="project-swatch ${projectTone(item.project)}"></span><span>${esc(item.time)}</span></div><div class="session-actions"><button class="session-check ${checked ? 'checked' : ''}" ${canSelect ? `data-check="${esc(item.id)}"` : `disabled title="${esc(item.trashBlockReason || '暂不能移动该会话')}"`} aria-label="选择会话：${esc(item.title)}" aria-pressed="${checked}">${checked ? '✓' : ''}</button></div></div>
      <h3 title="${esc(item.title)}">${esc(item.title)}</h3>
      <div class="session-context"><span class="agent-chip agent-${esc(item.agent)}">${esc(item.agentLabel)}</span><span class="project-chip ${projectTone(item.project)}" title="${esc(item.path)}">${esc(item.project)}${item.module ? ` / ${esc(item.module)}` : ''}</span></div>
      <div class="runtime-strip tone-${esc(rTone)}"><i></i><strong>${esc(runtimeText(item))}</strong><span>${esc(idleText(item.runtime?.idleSeconds))}</span></div>
      <p title="${esc(item.summary)}">${esc(item.summary)}</p>
      <div class="session-card-foot"><span class="status runtime-${esc(rKey)}">${esc(runtimeText(item))}</span><span>${item.messages} 条消息</span><span>${formatSize(item.size)}</span>${isTrash ? `<span class="trash-actions"><button class="restore-mini" data-restore="${esc(item.id)}">恢复</button><button class="delete-mini" data-delete-trash="${esc(item.id)}">彻底删除</button></span>` : ''}</div>
    </div>
    <aside class="session-aside">
      <span class="aside-label">LIVE MONITOR</span>
      <strong>${item.messages}<small> 条消息</small></strong>
      <span class="aside-size">${formatSize(item.size)}</span>
      <span class="status runtime-${esc(rKey)}">${esc(runtimeText(item))}</span>
      <span class="runtime-note">${esc(item.runtime?.note || '')}</span>
      ${isTrash ? `<div class="trash-actions"><button class="restore-mini" data-restore="${esc(item.id)}">恢复</button><button class="delete-mini" data-delete-trash="${esc(item.id)}">彻底删除</button></div>` : ''}
    </aside>
  </article>`;
}
function renderList() {
  const list = visible();
  $('#section-title').textContent = `${viewText[view]}${activeAgent === 'all' ? '' : ` · ${agentText(activeAgent)}`}`;
  $('#result-count').textContent = `${list.length} 个会话`;
  $('#session-list').classList.toggle('grid-mode', viewMode === 'grid');
  $('#session-list').classList.toggle('constellation-mode', view !== 'trash');
  $('#session-list').classList.toggle('quarantine-mode', view === 'trash');
  $('#section-head').classList.toggle('trash-head', view === 'trash');
  $('.section-actions').innerHTML = view === 'trash' ? `<span class="selection-count" id="selection-count">${selectedIds.size ? `已选 ${selectedIds.size}` : ''}</span><button class="clear-trash" id="empty-trash">清空废纸篓</button>` : `<span class="selection-count" id="selection-count">${selectedIds.size ? `已选 ${selectedIds.size}` : ''}</span><button class="select-all" id="select-all">选择当前结果</button>`;
  if (!list.length) {
    $('#session-list').innerHTML = `<div class="empty-state"><h3>${view === 'trash' ? '系统废纸篓中没有会话文件' : '没有匹配的会话'}</h3><p>${view === 'trash' ? '从 Finder 废纸篓恢复文件后，刷新本页面即可重新识别。' : '调整搜索词或清空筛选条件。'}</p></div>`;
  } else if (view === 'trash' || viewMode === 'grid') {
    $('#session-list').innerHTML = list.map(sessionCard).join('');
  } else {
    const groups = [];
    list.forEach((item) => {
      const bucket = dateBucket(item);
      let group = groups.find((entry) => entry.key === bucket.key);
      if (!group) { group = { ...bucket, items: [] }; groups.push(group); }
      group.items.push(item);
    });
    $('#session-list').innerHTML = groups.map((group) => `<div class="archive-group"><div class="archive-group-head"><div><span class="group-marker"></span><h3>${group.label}</h3><p>${group.note}</p></div><span>${group.items.length} 个会话</span></div><div class="archive-group-grid">${group.items.map(sessionCard).join('')}</div></div>`).join('');
  }
  updateStats();
}
function renderProjects() {
  const groups = {};
  visible().forEach((item) => (groups[item.project] ??= []).push(item));
  const scoreProject = (items) => {
    const active = items.filter((x) => isRuntimeLive(x)).length;
    const messages = items.reduce((n, x) => n + x.messages, 0);
    const recent = Date.parse(items[0]?.updated || 0) / 100000000;
    return active * 12000 + items.length * 420 + messages * 2 + recent;
  };
  const cards = Object.entries(groups).sort((a, b) => scoreProject(b[1]) - scoreProject(a[1]));
  $('#section-title').textContent = `项目空间${activeAgent === 'all' ? '' : ` · ${agentText(activeAgent)}`}`;
  $('#result-count').textContent = `${cards.length} 个项目`;
  $('#session-list').innerHTML = cards.length ? cards.map(([name, items], index) => {
    const first = items[0];
    const modules = [...new Set(items.map((x) => x.module).filter(Boolean))];
    const active = items.filter((x) => isRuntimeLive(x)).length;
    const archived = items.filter((x) => x.status === 'archived').length;
    const completed = items.length - active - archived;
    const messageTotal = items.reduce((n, x) => n + x.messages, 0);
    const sizeTotal = items.reduce((n, x) => n + (Number(x.size) || 0), 0);
    const activity = Math.min(100, Math.max(12, Math.round((active * 100 + completed * 42 + archived * 18) / Math.max(items.length, 1))));
    const recent = items.slice(0, 3);
    const signalText = active ? `${active} 个实时响应` : archived ? `${archived} 已归档` : `${completed} 已完成`;
    return `<article class="project-card project-card-${index % 4} ${index === 0 ? 'project-card-featured' : ''}" data-project="${esc(name)}">
      <div class="project-accent cover-${index % 4}"></div>
      <div class="project-card-top"><span class="project-index">${String(index + 1).padStart(2, '0')}</span><span class="project-signal"><i></i>${signalText}</span></div>
      <div class="project-title"><div><h3>${esc(name)}</h3><p title="${esc(first.projectRoot)}">${esc(first.projectRoot)}</p></div><strong>${items.length}<small> 会话</small></strong></div>
      <div class="project-metrics"><span><b>${messageTotal.toLocaleString()}</b> 消息</span><span><b>${formatSize(sizeTotal)}</b> 文件</span><span><b>${modules.length || 1}</b> 模块</span></div>
      <div class="project-activity"><div class="activity-label"><span>最近活动</span><b>${activity}%</b></div><div class="activity-track"><i style="width:${activity}%"></i></div></div>
      ${modules.length ? `<div class="module-row">${modules.slice(0, 4).map((m) => `<span>${esc(m)}</span>`).join('')}${modules.length > 4 ? `<em>+${modules.length - 4}</em>` : ''}</div>` : ''}
      <div class="project-session-peek">${recent.map((x) => `<span title="${esc(x.title)}"><i class="status-dot ${esc(runtimeKey(x))}"></i><b>${esc(x.time)}</b><em>${esc(runtimeText(x))} · ${esc(x.title)}</em></span>`).join('')}</div>
      <div class="project-footer"><span>最近 ${esc(first.time)}</span><b>${active} 实时 · ${completed} 已完成 · ${archived} 已归档</b></div>
    </article>`;
  }).join('') : '<div class="empty-state"><h3>暂无项目</h3></div>';
  updateStats();
}
function render() {
  $('#view-title').textContent = activeAgent === 'all' ? viewText[view] : `${agentText(activeAgent)} · ${viewText[view]}`;
  view === 'projects' ? renderProjects() : renderList();
}
function resetDetail() {
  selectedId = null;
  detailRequest += 1;
  const panel = $('#detail-panel');
  panel.classList.remove('show-mobile', 'busy');
  panel.innerHTML = '<div class="detail-empty"><div class="empty-mark">⌁</div><h3>选择一个会话</h3><p>从左侧打开会话，查看完整消息和可执行操作。</p></div>';
}
function updateDetailRuntime(item) {
  const runtime = $('.detail-runtime');
  if (!runtime || !item) return;
  runtime.className = `detail-runtime tone-${esc(runtimeTone(item))}`;
  const strong = runtime.querySelector('strong');
  const span = runtime.querySelector('span');
  if (strong) strong.textContent = runtimeText(item);
  if (span) span.textContent = `${item.runtime?.note || ''} · ${idleText(item.runtime?.idleSeconds)}`;
}
async function openDetail(id) {
  selectedId = id;
  render();
  const item = sessions.find((x) => x.id === id) || trash.find((x) => x.id === id);
  if (!item) return;
  const requestId = ++detailRequest;
  const panel = $('#detail-panel');
  panel.classList.add('show-mobile');
  panel.innerHTML = '<div class="detail-loading"><span></span><p>正在读取完整对话…</p></div>';
  if (item.status === 'trash') {
    const trashNote = item.agent === 'codex' ? '文件和会话历史已保存在 macOS 系统废纸篓，Codex 中的原记录已移除。恢复到原位置可以找回会话；彻底删除会清除废纸篓中的文件与历史备份。已打开的 Codex 窗口可能需要完全退出并重新打开才会刷新列表。' : '文件当前位于 macOS 系统废纸篓。恢复到原位置后，刷新页面即可重新使用。';
    panel.innerHTML = `<div class="detail-content tombstone"><div class="detail-top"><div><span class="detail-kicker">系统废纸篓 / READ ONLY</span><h3>${esc(item.title)}</h3><div class="detail-sub">${esc(item.time)} · ${esc(item.id)}</div></div><button class="close-detail" data-close-detail title="关闭详情">×</button></div><div class="tombstone-mark">⌫</div><h4>这个会话已被移除</h4><p>${trashNote}</p><div class="detail-actions"><button class="resume" data-restore="${esc(item.id)}">恢复到原位置</button><button class="danger" data-delete-trash="${esc(item.id)}">彻底删除</button></div></div>`;
    return;
  }
  try {
    const data = await api(`${API}/conversation/${encodeURIComponent(id)}`);
    if (requestId !== detailRequest || selectedId !== id) return;
    const messages = data.messages || [];
    panel.innerHTML = `<div class="detail-content"><div class="detail-top"><div><span class="detail-kicker">${item.status === 'trash' ? '系统废纸篓' : '会话详情'}</span><h3>${esc(item.title)}</h3><div class="detail-sub">${esc(item.time)} · ${esc(item.id)}</div></div><button class="close-detail" data-close-detail title="关闭详情">×</button></div>
      <div class="detail-runtime tone-${esc(runtimeTone(item))}"><i></i><div><strong>${esc(runtimeText(item))}</strong><span>${esc(item.runtime?.note || '')} · ${esc(idleText(item.runtime?.idleSeconds))}</span></div></div>
      <div class="detail-facts"><div><span>Agent</span><strong>${esc(item.agentLabel)}</strong></div><div><span>项目</span><strong>${esc(item.project)}</strong></div><div><span>模块</span><strong>${esc(item.module || '根目录')}</strong></div><div class="wide"><span>工作目录</span><strong title="${esc(item.path)}">${esc(item.path)}</strong></div></div>
      <div class="conversation-toolbar"><div><strong>对话记录</strong><span>${messages.length} 条消息</span></div><input id="conversation-search" placeholder="搜索当前会话" /></div>
      <div class="conversation-list" id="conversation-list">${messages.length ? messages.map((message, index) => `<article class="bubble ${message.role}" data-message-text="${esc(message.text.toLowerCase())}"><header><span>${message.role === 'user' ? '你' : esc(item.agentLabel)}</span><time>${message.timestamp ? esc(new Date(message.timestamp).toLocaleString('zh-CN')) : `#${index + 1}`}</time></header><div>${esc(message.text)}</div></article>`).join('') : '<div class="empty-state"><h3>没有可展示的消息</h3></div>'}</div>
      <div class="detail-actions">${item.status === 'trash' ? `<button class="resume" data-restore="${esc(item.id)}">恢复到原位置</button>` : `${item.capabilities?.canResume ? `<button class="resume" data-resume="${esc(item.id)}">复制恢复命令</button>` : ''}${item.agent === 'codex' ? `<button class="archive-action" data-session-action="${item.archived ? 'unarchive' : 'archive'}" data-id="${esc(item.id)}">${item.archived ? '取消归档' : '归档'}</button>` : ''}${item.capabilities?.canTrash === false ? '' : `<button class="danger" data-delete="${esc(item.id)}">移到系统废纸篓</button>`}`}</div>${item.trashBlockReason ? `<p class="detail-block-reason">${esc(item.trashBlockReason)}</p>` : ''}</div>`;
  } catch (error) {
    if (requestId !== detailRequest) return;
    panel.innerHTML = `<div class="empty-state"><h3>对话读取失败</h3><p>${esc(error.message)}</p></div>`;
    toast(error.message, true);
  }
}
async function load(showToast = true) {
  if (loading) return;
  loading = true;
  try {
    const data = await api(`${API}/sessions?agent=${encodeURIComponent(activeAgent)}`);
    activeAgent = data.agent || 'all';
    localStorage.setItem('codex-hub-agent', activeAgent);
    sessions = data.sessions || [];
    trash = data.trash || [];
    agentCatalog = data.agents || [];
    renderAgentSwitcher();
    if (selectedId) {
      const current = sessions.find((x) => x.id === selectedId) || trash.find((x) => x.id === selectedId);
      if (!current || current.status === 'trash') resetDetail();
    }
    const projects = [...new Set([...sessions, ...trash].map((x) => x.project).filter(Boolean))].sort();
    $('#project-filter').innerHTML = '<option value="all">全部项目</option>' + projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    $('#project-filter').value = filters.project;
    $('#last-sync').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    $('#sync-state').textContent = '实时监听中';
    render();
    if (selectedId && $('#detail-panel')?.classList.contains('show-mobile')) {
      const current = sessions.find((x) => x.id === selectedId) || trash.find((x) => x.id === selectedId);
      updateDetailRuntime(current);
    }
    if (showToast) toast(`已加载 ${sessions.length} 个本机会话`);
  } catch (error) {
    $('#sync-state').textContent = '读取失败';
    toast(error.message, true);
  } finally {
    loading = false;
  }
}
async function action(name, id) {
  if (busy) return;
  const item = sessions.find((x) => x.id === id) || trash.find((x) => x.id === id);
  busy = true;
  const panel = $('#detail-panel');
  panel.classList.add('busy');
  $('#refresh-btn').classList.add('is-loading');
  toast({ trash: '正在移到系统废纸篓…', restore: '正在恢复到原位置…', archive: '正在归档…', unarchive: '正在取消归档…' }[name] || '正在处理…');
  try {
    await api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name, id }) });
    resetDetail();
    await load(false);
    toast({ trash: item?.agent === 'codex' ? '已移到系统废纸篓；ChatGPT 侧栏若未刷新，请完全退出后重开' : '已移到系统废纸篓', restore: '会话已恢复到原位置', archive: '会话已归档', unarchive: '已取消归档' }[name] || '操作成功');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    panel.classList.remove('busy');
    $('#refresh-btn').classList.remove('is-loading');
  }
}
async function bulkAction() {
  if (busy || !selectedIds.size) return;
  const restoring = view === 'trash';
  if (!confirm(restoring ? `将选中的 ${selectedIds.size} 个会话恢复到原位置？` : `将选中的 ${selectedIds.size} 个会话移到 macOS 系统废纸篓？`)) return;
  busy = true;
  $('#selection-dock').classList.add('busy');
  $('#refresh-btn').classList.add('is-loading');
  toast(restoring ? `正在恢复 ${selectedIds.size} 个会话…` : `正在移动 ${selectedIds.size} 个会话…`);
  try {
    const ids = [...selectedIds];
    const hasCodex = ids.some((id) => sessions.some((item) => item.id === id && item.agent === 'codex'));
    const data = await api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: restoring ? 'bulk-restore' : 'bulk-trash', ids }) });
    selectedIds.clear();
    resetDetail();
    await load(false);
    toast(restoring ? `已恢复：${data.count} 个` : `已移入系统废纸篓：${data.count} 个${hasCodex ? '；ChatGPT 侧栏若未刷新，请完全退出后重开' : ''}`);
  } catch (error) {
    await load(false);
    toast(error.message, true);
  } finally {
    busy = false;
    $('#selection-dock').classList.remove('busy');
    $('#refresh-btn').classList.remove('is-loading');
  }
}
async function deleteTrash(id) {
  if (busy || !confirm('彻底删除这个会话文件？此操作无法撤销。')) return;
  busy = true;
  toast('正在彻底删除…');
  try {
    await api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete-trash', id }) });
    selectedIds.delete(id);
    resetDetail();
    await load(false);
    toast('已彻底删除');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
  }
}
async function emptyTrash() {
  if (busy || !trash.length || !confirm(`彻底删除废纸篓中的 ${trash.length} 个 Codex 会话？此操作无法撤销。`)) return;
  busy = true;
  toast('正在清空废纸篓…');
  try {
    const data = await api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'empty-trash' }) });
    selectedIds.clear();
    resetDetail();
    await load(false);
    toast(`已彻底删除 ${data.count} 个会话`);
  } catch (error) {
    await load(false);
    toast(error.message, true);
  } finally {
    busy = false;
  }
}
document.addEventListener('click', (event) => {
  const target = event.target;
  const detail = $('#detail-panel');
  if (detail?.classList.contains('show-mobile') && !target.closest('#detail-panel') && !target.closest('.session-card')) {
    resetDetail();
    render();
  }
  const agent = target.closest('[data-agent]');
  if (agent) {
    if (activeAgent === agent.dataset.agent) return;
    activeAgent = agent.dataset.agent;
    localStorage.setItem('codex-hub-agent', activeAgent);
    $('#agent-popover')?.classList.remove('open');
    $('#agent-toggle')?.setAttribute('aria-expanded', 'false');
    selectedIds.clear();
    resetDetail();
    sessions = [];
    trash = [];
    filters = { project: 'all', status: 'all', time: 'all' };
    const projectFilter = $('#project-filter'); if (projectFilter) projectFilter.value = 'all';
    renderAgentSwitcher();
    render();
    toast(`正在切换到 ${agentText(activeAgent)}…`);
    load();
    return;
  }
  if (target.closest('#agent-toggle')) {
    const toggle = $('#agent-toggle');
    const open = $('#agent-popover').classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    return;
  }
  if (!target.closest('#agent-menu')) {
    $('#agent-popover')?.classList.remove('open');
    $('#agent-toggle')?.setAttribute('aria-expanded', 'false');
  }
  const card = target.closest('.session-card');
  if (card && !target.closest('button')) return openDetail(card.dataset.id);
  const project = target.closest('[data-project]');
  if (project) { filters.project = project.dataset.project; view = 'overview'; resetDetail(); render(); toast(`已筛选项目：${project.dataset.project}`); return; }
  const check = target.closest('[data-check]');
  if (check) { selectedIds.has(check.dataset.check) ? selectedIds.delete(check.dataset.check) : selectedIds.add(check.dataset.check); render(); return; }
  if (target.closest('[data-close-detail]')) { resetDetail(); render(); return; }
  const del = target.closest('[data-delete]');
  if (del && confirm('直接移到 macOS 系统废纸篓？')) return action('trash', del.dataset.delete);
  const restore = target.closest('[data-restore]');
  if (restore && confirm('将文件恢复到原来的会话目录？')) return action('restore', restore.dataset.restore);
  const permanent = target.closest('[data-delete-trash]');
  if (permanent) return deleteTrash(permanent.dataset.deleteTrash);
  if (target.closest('#empty-trash')) return emptyTrash();
  if (target.closest('#select-all')) { const ids = visible().filter((x) => view === 'trash' || x.capabilities?.canTrash !== false).map((x) => x.id); const all = ids.length && ids.every((id) => selectedIds.has(id)); ids.forEach((id) => (all ? selectedIds.delete(id) : selectedIds.add(id))); render(); return; }
  const sessionAction = target.closest('[data-session-action]');
  if (sessionAction) return action(sessionAction.dataset.sessionAction, sessionAction.dataset.id);
  const resume = target.closest('[data-resume]');
  if (resume) {
    const item = sessions.find((x) => x.id === resume.dataset.resume);
    if (item) {
      api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume', id: item.id }) })
        .then((data) => data.command ? navigator.clipboard?.writeText(data.command).then(() => toast(`${item.agentLabel} 恢复命令已复制`)) : toast(`${item.agentLabel} 暂无可复制的恢复命令`, true))
        .catch((error) => toast(error.message, true));
    }
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'conversation-search') { const query = event.target.value.toLowerCase(); $$('#conversation-list .bubble').forEach((bubble) => { bubble.hidden = Boolean(query) && !bubble.dataset.messageText.includes(query); }); }
  if (event.target.id === 'search-input') render();
});
$$('.nav-item').forEach((button) => button.addEventListener('click', () => { view = button.dataset.view; filters = { project: 'all', status: 'all', time: 'all' }; selectedIds.clear(); resetDetail(); $('#project-filter').value = 'all'; $$('.nav-item').forEach((item) => item.classList.toggle('active', item === button)); render(); }));
$('#refresh-btn').addEventListener('click', () => load());
$('#stop-service-btn').addEventListener('click', async () => {
  if (!confirm('停止 Agent Observatory 服务？页面将无法继续刷新；可随时运行 start.sh 重新启动。')) return;
  try {
    await api(`${API}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop-service' }) });
    toast('服务已停止。运行 start.sh 后可重新打开此页面。');
    $('#stop-service-btn').disabled = true;
  } catch (error) {
    toast(error.message, true);
  }
});
$('#search-input').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.target.value = ''; render(); } });
$('#sort-select').addEventListener('change', render);
$('#filter-btn').addEventListener('click', () => {
  const panel = $('#filter-panel');
  const open = panel.classList.toggle('open');
  $('#filter-btn').setAttribute('aria-expanded', String(open));
});
['project', 'status', 'time'].forEach((key) => $(`#${key}-filter`).addEventListener('change', (event) => { filters[key] = event.target.value; render(); }));
$('#clear-filters').addEventListener('click', () => { filters = { project: 'all', status: 'all', time: 'all' }; ['project', 'status', 'time'].forEach((key) => { $(`#${key}-filter`).value = 'all'; }); render(); });
$$('.mode-button').forEach((button) => button.addEventListener('click', () => { viewMode = button.dataset.mode; localStorage.setItem('codex-hub-view', viewMode); render(); }));
$('#bulk-trash').addEventListener('click', bulkAction);
$('#clear-selection').addEventListener('click', () => { selectedIds.clear(); render(); });
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search-input').focus(); }
  if (event.key === 'Escape') {
    $('#agent-popover')?.classList.remove('open');
    $('#agent-toggle')?.setAttribute('aria-expanded', 'false');
    if ($('#filter-panel')?.classList.contains('open')) {
      $('#filter-panel').classList.remove('open');
      $('#filter-btn')?.setAttribute('aria-expanded', 'false');
    }
    if ($('#detail-panel')?.classList.contains('show-mobile')) { resetDetail(); render(); }
  }
});
function initParticles() {
  const canvas = $('#particle-canvas');
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let width = 0; let height = 0; let particles = [];
  const resize = () => { width = canvas.width = window.innerWidth * devicePixelRatio; height = canvas.height = window.innerHeight * devicePixelRatio; canvas.style.width = `${window.innerWidth}px`; canvas.style.height = `${window.innerHeight}px`; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); particles = Array.from({ length: Math.min(95, Math.round(window.innerWidth / 15)) }, () => ({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, r: Math.random() * 1.4 + .35, vx: (Math.random() - .5) * .16, vy: (Math.random() - .5) * .16, a: Math.random() * .5 + .12 })); };
  const draw = () => { ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); for (const p of particles) { p.x += p.vx; p.y += p.vy; if (p.x < -5) p.x = window.innerWidth + 5; if (p.x > window.innerWidth + 5) p.x = -5; if (p.y < -5) p.y = window.innerHeight + 5; if (p.y > window.innerHeight + 5) p.y = -5; ctx.beginPath(); ctx.fillStyle = `rgba(100,217,255,${p.a})`; ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); } requestAnimationFrame(draw); };
  resize(); window.addEventListener('resize', resize); draw();
}
applyTheme(savedTheme || document.documentElement.dataset.theme || 'dark');
initParticles();
load();
liveRefreshTimer = setInterval(() => {
  if (!busy && document.visibilityState !== 'hidden') load(false);
}, 8000);
$('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
