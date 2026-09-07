// 智慧通訊佈告欄前端邏輯 (支援個人 / 全團隊雙模式 + 本地持久化快取)

const STORAGE_KEY = 'bulletin_local_messages_v1';
const CONFIG_STORAGE_KEY = 'bulletin_local_config_v1';

let allMessages = [];
let ws = null;
let currentConfig = null;
let currentMentionTab = 'ME'; // 'ME' 或 'TEAM'

// DOM 元素快取
const listMentions = document.getElementById('list-mentions');
const listAnnouncements = document.getElementById('list-announcements');
const countMentions = document.getElementById('count-mentions');
const countAnnouncements = document.getElementById('count-announcements');
const countTabMe = document.getElementById('count-tab-me');
const countTabTeam = document.getElementById('count-tab-team');
const badgeMentions = document.getElementById('badge-mentions');
const badgeTeam = document.getElementById('badge-team');
const badgeAnnouncements = document.getElementById('badge-announcements');
const wsIndicator = document.getElementById('ws-indicator');
const wsStatusText = document.getElementById('ws-status-text');

const tabMyMentions = document.getElementById('tab-my-mentions');
const tabTeamMentions = document.getElementById('tab-team-mentions');

const searchInput = document.getElementById('search-input');
const timeFilter = document.getElementById('time-filter');
const platformFilter = document.getElementById('platform-filter');
const unresolvedOnly = document.getElementById('unresolved-only');
const btnRefresh = document.getElementById('btn-refresh');

// 彈窗元素
const simulateModal = document.getElementById('simulate-modal');
const btnOpenSimulate = document.getElementById('btn-open-simulate');
const btnCloseSimulate = document.getElementById('btn-close-simulate');
const btnCancelSimulate = document.getElementById('btn-cancel-simulate');
const btnSendSimulate = document.getElementById('btn-send-simulate');

const settingsModal = document.getElementById('settings-modal');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

// 本地快取操作 (訊息)
function saveToLocalStorage(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch (e) {
    console.warn("Save local storage failed:", e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// 本地快取操作 (系統與身分設定)
function saveConfigToLocalStorage(cfg) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn("Save local config failed:", e);
  }
}

function loadConfigFromLocalStorage() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// 時間解析與格式化
function parseMessageDate(dateStr) {
  if (!dateStr) return new Date();
  if (typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T')) {
    const parsed = new Date(dateStr.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) return parsed;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatMessageTime(dateStr) {
  if (!dateStr) return '';
  if (typeof dateStr === 'string' && dateStr.length >= 16) {
    return dateStr.slice(5, 16);
  }
  try {
    const d = parseMessageDate(dateStr);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  } catch (e) {
    return dateStr;
  }
}

// 音效播放 (Web Audio API)
function playNotificationSound(isUrgent = false) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isUrgent ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isUrgent ? 660 : 520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(isUrgent ? 880 : 780, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn("Audio play blocked:", e);
  }
}

// WebSocket 連線初始化
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsIndicator.className = 'ws-indicator online';
    wsStatusText.textContent = '即時連線中';
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleWebSocketMessage(payload);
    } catch (err) {
      console.error("WS Parse Error:", err);
    }
  };

  ws.onclose = () => {
    wsIndicator.className = 'ws-indicator offline';
    wsStatusText.textContent = '連線中斷，重試中...';
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleWebSocketMessage(payload) {
  const { type, data } = payload;
  if (type === 'NEW_MESSAGE') {
    // 檢查是否已存在
    if (!allMessages.some(m => m.id === data.id)) {
      allMessages.unshift(data);
      saveToLocalStorage(allMessages);
      renderMessages();
      playNotificationSound(data.priority === 'URGENT');
    }
  } else if (type === 'UPDATE_MESSAGE') {
    const idx = allMessages.findIndex(m => m.id === data.id);
    if (idx !== -1) {
      if (data.is_read !== null && data.is_read !== undefined) allMessages[idx].is_read = data.is_read;
      if (data.is_resolved !== null && data.is_resolved !== undefined) allMessages[idx].is_resolved = data.is_resolved;
      if (data.is_pinned !== null && data.is_pinned !== undefined) allMessages[idx].is_pinned = data.is_pinned;
      saveToLocalStorage(allMessages);
      renderMessages();
    }
  } else if (type === 'DELETE_MESSAGE') {
    allMessages = allMessages.filter(m => m.id !== data.id);
    saveToLocalStorage(allMessages);
    renderMessages();
  } else if (type === 'CLEAR_MESSAGES') {
    allMessages = [];
    saveToLocalStorage(allMessages);
    renderMessages();
  } else if (type === 'CONFIG_UPDATED') {
    fetchMessages();
  }
}

// 載入訊息 (含伺服器與本地雙向同步)
async function fetchMessages() {
  const selectedDays = timeFilter ? parseInt(timeFilter.value, 10) : 3;
  const daysParam = selectedDays > 0 ? `?days=${selectedDays}` : '';

  try {
    const res = await fetch(`/api/messages${daysParam}`);
    const serverMessages = await res.json();

    // 合併伺服器資料與本地快取
    const localMsgs = loadFromLocalStorage();
    const msgMap = new Map();

    // 先存入本地快取
    localMsgs.forEach(m => msgMap.set(m.id, m));
    // 用伺服器最新資料覆蓋或新增
    serverMessages.forEach(m => msgMap.set(m.id, m));

    allMessages = Array.from(msgMap.values());
    allMessages.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1;
      return parseMessageDate(b.created_at) - parseMessageDate(a.created_at);
    });

    saveToLocalStorage(allMessages);
    renderMessages();

    // 若伺服器剛重啟為空，自動將本地有效資料同步回伺服器
    if (serverMessages.length === 0 && localMsgs.length > 0) {
      fetch('/api/messages/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localMsgs)
      });
    }
  } catch (err) {
    console.warn("Fetch from server failed, using local storage:", err);
    allMessages = loadFromLocalStorage();
    renderMessages();
  }
}

// 切換交辦頁籤
function switchMentionTab(tab) {
  currentMentionTab = tab;
  if (tab === 'ME') {
    tabMyMentions.classList.add('active');
    tabTeamMentions.classList.remove('active');
  } else {
    tabTeamMentions.classList.add('active');
    tabMyMentions.classList.remove('active');
  }
  renderMessages();
}

// 渲染訊息列表
function renderMessages() {
  const query = searchInput.value.toLowerCase().trim();
  const platform = platformFilter.value;
  const hideResolved = unresolvedOnly.checked;
  const selectedDays = timeFilter ? parseInt(timeFilter.value, 10) : 3;

  const now = new Date();

  const filtered = allMessages.filter(m => {
    // 時間過濾 (非置頂訊息且選擇特定天數時)
    if (selectedDays > 0 && !m.is_pinned) {
      const msgDate = parseMessageDate(m.created_at);
      const diffDays = (now - msgDate) / (1000 * 60 * 60 * 24);
      if (diffDays > selectedDays) return false;
    }

    if (platform !== 'ALL' && m.platform !== platform) return false;
    if (hideResolved && m.is_resolved) return false;
    if (query) {
      const targetStr = (m.target_users || []).join(' ');
      const matchText = (m.content + m.sender_name + m.channel_name + targetStr).toLowerCase();
      if (!matchText.includes(query)) return false;
    }
    return true;
  });

  const myMentions = filtered.filter(m => m.category === 'MENTION_ME');
  const teamMentions = filtered.filter(m => m.category === 'MENTION_TEAM' || m.category === 'MENTION_ME');
  const announcements = filtered.filter(m => m.category === 'ANNOUNCEMENT');

  // 計算頂部徽章總數
  const totalMyUnresolved = filtered.filter(m => m.category === 'MENTION_ME' && !m.is_resolved).length;
  const totalTeamUnresolved = filtered.filter(m => m.category === 'MENTION_TEAM' && !m.is_resolved).length;
  const totalAnnouncements = announcements.length;

  badgeMentions.textContent = totalMyUnresolved;
  badgeTeam.textContent = totalTeamUnresolved;
  badgeAnnouncements.textContent = totalAnnouncements;

  countTabMe.textContent = myMentions.length;
  countTabTeam.textContent = teamMentions.length;
  countAnnouncements.textContent = `${announcements.length} 則`;

  // 依當前 Tab 渲染左欄
  if (currentMentionTab === 'ME') {
    countMentions.textContent = `${myMentions.length} 則`;
    renderColumn(listMentions, myMentions, true, false, query, teamMentions.length);
  } else {
    countMentions.textContent = `${teamMentions.length} 則`;
    renderColumn(listMentions, teamMentions, true, true, query, myMentions.length);
  }

  renderColumn(listAnnouncements, announcements, false, false, query, 0);
}

function highlightMatch(text, query) {
  if (!text) return '';
  const escapedText = escapeHtml(text);
  if (!query) return escapedText;
  const escapedQuery = escapeHtml(query);
  try {
    const reg = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(reg, '<mark style="background:#fef08a; color:#854d0e; padding:1px 3px; border-radius:3px;">$1</mark>');
  } catch (e) {
    return escapedText;
  }
}

function renderColumn(container, list, isMentionCol, isTeamView, query = '', otherCount = 0) {
  if (list.length === 0) {
    if (query && isMentionCol && !isTeamView && otherCount > 0) {
      container.innerHTML = `
        <div class="empty-state" style="line-height:1.9; padding:24px 16px;">
          🔍 搜尋「<strong style="color:#60a5fa;">${escapeHtml(query)}</strong>」在 <em>@我的交辦</em> 無符合項目，<br>
          但在 <strong>全團隊交辦</strong> 中找到 <strong>${otherCount}</strong> 則相符交辦。<br>
          <button class="action-btn" onclick="switchMentionTab('TEAM')" style="margin-top:12px; display:inline-block; padding:7px 16px; background:#3b82f6; color:#fff; font-weight:600; border:none; border-radius:6px; cursor:pointer;">
            👉 立即切換至「全團隊交辦」查看 (${otherCount} 則)
          </button>
        </div>
      `;
    } else if (query) {
      container.innerHTML = `<div class="empty-state">未找到與「${escapeHtml(query)}」相符的訊息</div>`;
    } else {
      container.innerHTML = `<div class="empty-state">${isMentionCol ? (isTeamView ? '目前無團隊成員交辦訊息' : '目前無屬於您的 @個人 訊息') : '目前無符合條件的宣導或公告事項'}</div>`;
    }
    return;
  }

  container.innerHTML = list.map(msg => {
    const isLine = msg.platform === 'LINE';
    const isGChat = msg.platform === 'GOOGLE_CHAT';
    const platformClass = isLine ? 'badge-line' : (isGChat ? 'badge-gchat' : 'badge-sim');
    const platformName = isLine ? 'LINE' : (isGChat ? 'Google Chat' : '模擬');

    let priorityBadge = '';
    if (msg.priority === 'URGENT') {
      priorityBadge = `<span class="priority-badge p-urgent">緊急</span>`;
    } else if (msg.priority === 'HIGH') {
      priorityBadge = `<span class="priority-badge p-high">重要</span>`;
    } else {
      priorityBadge = `<span class="priority-badge p-normal">一般</span>`;
    }

    // 目標被標記者標籤
    let targetBadges = '';
    if (msg.target_users && msg.target_users.length > 0) {
      targetBadges = msg.target_users.map(u => `<span class="target-user-badge">@${highlightMatch(u, query)}</span>`).join(' ');
    }

    const cardClasses = [
      'msg-card',
      msg.is_resolved ? 'resolved' : '',
      msg.is_pinned ? 'pinned' : '',
      msg.priority === 'URGENT' ? 'urgent' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}" data-id="${msg.id}">
        <div class="card-top">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="platform-badge ${platformClass}">${platformName}</span>
            ${priorityBadge}
            ${targetBadges}
          </div>
          <span class="time-tag">${formatMessageTime(msg.created_at)}</span>
        </div>

        <div class="meta-info">
          <span class="channel-tag">${highlightMatch(msg.channel_name, query)}</span>
          <span>&bull;</span>
          <span class="sender-tag">${highlightMatch(msg.sender_name, query)}</span>
        </div>

        <div class="msg-content">${highlightMatch(msg.content, query)}</div>

        ${msg.matched_reason ? `<div class="matched-reason-bar">${escapeHtml(msg.matched_reason)}</div>` : ''}

        <div class="card-actions">
          ${isMentionCol ? `
            <button class="action-btn btn-resolve" onclick="toggleResolved('${msg.id}', ${!msg.is_resolved})">
              ${msg.is_resolved ? '取消完成' : '標記完成'}
            </button>
          ` : `
            <button class="action-btn" onclick="togglePinned('${msg.id}', ${!msg.is_pinned})">
              ${msg.is_pinned ? '取消置頂' : '置頂公告'}
            </button>
          `}
          <button class="action-btn btn-delete" onclick="deleteMessage('${msg.id}')">刪除</button>
        </div>
      </div>
    `;
  }).join('');
}

// 狀態操作
async function toggleResolved(id, status) {
  const idx = allMessages.findIndex(m => m.id === id);
  if (idx !== -1) {
    allMessages[idx].is_resolved = status;
    saveToLocalStorage(allMessages);
    renderMessages();
  }
  await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_resolved: status })
  });
}

async function togglePinned(id, status) {
  const idx = allMessages.findIndex(m => m.id === id);
  if (idx !== -1) {
    allMessages[idx].is_pinned = status;
    saveToLocalStorage(allMessages);
    renderMessages();
  }
  await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_pinned: status })
  });
}

async function deleteMessage(id) {
  allMessages = allMessages.filter(m => m.id !== id);
  saveToLocalStorage(allMessages);
  renderMessages();
  await fetch(`/api/messages/${id}`, { method: 'DELETE' });
}

// 快速模擬範本
function applyTemplate(type) {
  const channel = document.getElementById('sim-channel');
  const sender = document.getElementById('sim-sender');
  const content = document.getElementById('sim-content');

  if (type === 1) {
    channel.value = "半導體架構技術交流群";
    sender.value = "系統架構師 Kevin";
    content.value = "@Alex 請於今日下班前確認 API 規格書與佈告欄原型驗證，謝謝！";
  } else if (type === 5) {
    channel.value = "後端開發小組";
    sender.value = "產品經理 Sarah";
    content.value = "@David @Jessica 請儘速排查訂單模組的效能瓶頸問題！";
  } else if (type === 2) {
    channel.value = "全體員工公告頻道";
    sender.value = "資訊處維運組";
    content.value = "【公告】本週五 22:00 ~ 24:00 進行核心資料庫升級作業，屆時內部系統將暫停服務。";
  } else if (type === 3) {
    channel.value = "專案開發頻道";
    sender.value = "PM Eric";
    content.value = "@all 請全體同仁確認下週一 Sprint Planning 會議時間並更新 Jira 狀態。";
  } else if (type === 4) {
    channel.value = "午餐與閒聊群";
    sender.value = "同事 Brian";
    content.value = "大家今天中午要訂哪一家的便當？要喝飲料的請在下方 +1。";
  }
}

// 發送模擬訊息
btnSendSimulate.onclick = async () => {
  const platform = document.querySelector('input[name="sim-platform"]:checked').value;
  const channel_name = document.getElementById('sim-channel').value;
  const sender_name = document.getElementById('sim-sender').value;
  const content = document.getElementById('sim-content').value;
  const resultBox = document.getElementById('sim-result');

  try {
    const res = await fetch('/api/webhook/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        channel_name,
        sender_name,
        content
      })
    });
    const data = await res.json();
    resultBox.style.display = 'block';
    if (data.captured) {
      resultBox.style.borderLeftColor = '#22c55e';
      const catName = data.message.category === 'MENTION_ME' ? '📥 @我的交辦' : (data.message.category === 'MENTION_TEAM' ? '👥 全團隊交辦' : '📢 全域宣導');
      resultBox.innerHTML = `✅ <strong>成功擷取並分流！</strong> 分類：<code>${catName}</code> (${data.message.matched_reason})`;
    } else {
      resultBox.style.borderLeftColor = '#eab308';
      resultBox.innerHTML = `⚠️ <strong>未觸發規則：</strong> ${data.note}`;
    }
  } catch (err) {
    resultBox.style.display = 'block';
    resultBox.style.borderLeftColor = '#ef4444';
    resultBox.innerHTML = `❌ 發送失敗：${err.message}`;
  }
};

// 設定相關
function applyConfigToForm(cfg) {
  if (!cfg) return;
  const user = cfg.user_profile || {};
  const elName = document.getElementById('cfg-name');
  const elAliases = document.getElementById('cfg-aliases');
  const elLineIds = document.getElementById('cfg-line-ids');
  const elGoogleEmails = document.getElementById('cfg-google-emails');
  const elAnnKeywords = document.getElementById('cfg-ann-keywords');

  if (elName) elName.value = user.name || '';
  if (elAliases) elAliases.value = (user.aliases || []).join(', ');
  if (elLineIds) elLineIds.value = (user.line_user_ids || []).join(', ');
  if (elGoogleEmails) elGoogleEmails.value = (user.google_emails || []).join(', ');
  if (elAnnKeywords) {
    const kw = cfg.announcement_rules?.keywords || [];
    elAnnKeywords.value = kw.join(', ');
  }
}

async function syncConfigToServer(cfg) {
  try {
    const user = cfg.user_profile || {};
    const ann = cfg.announcement_rules || {};
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: user.name || '',
        aliases: user.aliases || [],
        line_user_ids: user.line_user_ids || [],
        google_emails: user.google_emails || [],
        announcement_keywords: ann.keywords || []
      })
    });
    return res.ok;
  } catch (e) {
    console.warn("Sync config to server failed:", e);
    return false;
  }
}

async function loadSettings() {
  // 1. 優先從本地 LocalStorage 帶入自訂設定
  const localCfg = loadConfigFromLocalStorage();
  if (localCfg) {
    applyConfigToForm(localCfg);
    currentConfig = localCfg;
  }

  // 2. 向伺服器確認最新設定
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverCfg = await res.json();
    const serverUser = serverCfg.user_profile || {};

    // 若伺服器為未修改預設 (Alex) 且本地有自訂設定，自動將本地設定補發至伺服器
    const isServerDefault = (!serverUser.name || serverUser.name === 'Alex');
    if (isServerDefault && localCfg && localCfg.is_customized) {
      console.log("偵測到伺服器為預設設定，自動同步本地自訂身分至伺服器...");
      applyConfigToForm(localCfg);
      await syncConfigToServer(localCfg);
    } else {
      // 否則以伺服器設定為準並更新本地快取
      currentConfig = serverCfg;
      applyConfigToForm(serverCfg);
      saveConfigToLocalStorage(serverCfg);
    }
  } catch (err) {
    console.warn("Load config from server failed, using local cache:", err);
  }
}

btnSaveSettings.onclick = async () => {
  const name = document.getElementById('cfg-name').value.trim();
  const aliases = document.getElementById('cfg-aliases').value.split(',').map(s => s.trim()).filter(Boolean);
  const line_user_ids = document.getElementById('cfg-line-ids').value.split(',').map(s => s.trim()).filter(Boolean);
  const google_emails = document.getElementById('cfg-google-emails').value.split(',').map(s => s.trim()).filter(Boolean);
  const announcement_keywords = document.getElementById('cfg-ann-keywords').value.split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    is_customized: true,
    user_profile: {
      name,
      aliases,
      line_user_ids,
      google_emails
    },
    announcement_rules: {
      keywords: announcement_keywords
    }
  };

  // 1. 立即持久化至本地 LocalStorage (重整永不遺失)
  saveConfigToLocalStorage(payload);
  currentConfig = payload;

  // 2. 發送至後端儲存
  try {
    const ok = await syncConfigToServer(payload);
    if (ok) {
      alert("設定已成功儲存並同步！");
      settingsModal.classList.remove('active');
      // 觸發伺服器重新校準歷史訊息歸屬並刷新
      try {
        await fetch('/api/messages/reclassify', { method: 'POST' });
        await fetchMessages();
      } catch (e) {}
    } else {
      alert("設定已儲存於瀏覽器本地，伺服器同步中...");
      settingsModal.classList.remove('active');
    }
  } catch (err) {
    alert("已儲存於瀏覽器本地，伺服器連線失敗：" + err.message);
    settingsModal.classList.remove('active');
  }
};

// 彈窗開關控制
btnOpenSimulate.onclick = () => {
  document.getElementById('sim-result').style.display = 'none';
  simulateModal.classList.add('active');
};
btnCloseSimulate.onclick = () => simulateModal.classList.remove('active');
btnCancelSimulate.onclick = () => simulateModal.classList.remove('active');

btnOpenSettings.onclick = () => {
  loadSettings();
  settingsModal.classList.add('active');
};
btnCloseSettings.onclick = () => settingsModal.classList.remove('active');
btnCancelSettings.onclick = () => settingsModal.classList.remove('active');

// 智慧搜尋分頁引導與切換
function handleSearchInput() {
  const query = searchInput.value.toLowerCase().trim();
  if (query && currentMentionTab === 'ME') {
    const selectedDays = timeFilter ? parseInt(timeFilter.value, 10) : 3;
    const now = new Date();

    const matchesMe = allMessages.some(m => {
      if (selectedDays > 0 && !m.is_pinned) {
        if ((now - parseMessageDate(m.created_at)) / (1000 * 60 * 60 * 24) > selectedDays) return false;
      }
      if (platformFilter.value !== 'ALL' && m.platform !== platformFilter.value) return false;
      if (unresolvedOnly.checked && m.is_resolved) return false;
      const targetStr = (m.target_users || []).join(' ');
      return (m.content + m.sender_name + m.channel_name + targetStr).toLowerCase().includes(query) && m.category === 'MENTION_ME';
    });

    const matchesTeam = allMessages.some(m => {
      if (selectedDays > 0 && !m.is_pinned) {
        if ((now - parseMessageDate(m.created_at)) / (1000 * 60 * 60 * 24) > selectedDays) return false;
      }
      if (platformFilter.value !== 'ALL' && m.platform !== platformFilter.value) return false;
      if (unresolvedOnly.checked && m.is_resolved) return false;
      const targetStr = (m.target_users || []).join(' ');
      return (m.content + m.sender_name + m.channel_name + targetStr).toLowerCase().includes(query) && (m.category === 'MENTION_TEAM' || m.category === 'MENTION_ME');
    });

    // 若 @我的交辦 無結果，但 全團隊交辦 有結果，自動切換至 全團隊交辦
    if (!matchesMe && matchesTeam) {
      switchMentionTab('TEAM');
      return;
    }
  }
  renderMessages();
}

// 事件監聽
searchInput.oninput = handleSearchInput;
if (timeFilter) timeFilter.onchange = fetchMessages;
platformFilter.onchange = renderMessages;
unresolvedOnly.onchange = renderMessages;
btnRefresh.onclick = fetchMessages;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 頁面初次載入
window.onload = () => {
  // 先載入本地快取快速呈現訊息
  allMessages = loadFromLocalStorage();
  if (allMessages.length > 0) {
    renderMessages();
  }

  // 靜默載入/檢查本地自訂設定，確保與伺服器雙向同步
  const localCfg = loadConfigFromLocalStorage();
  if (localCfg && localCfg.is_customized) {
    currentConfig = localCfg;
    syncConfigToServer(localCfg);
  }

  // 抓取伺服器最新資料並初始化 WebSocket
  fetchMessages();
  initWebSocket();
};
