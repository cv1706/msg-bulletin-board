// 智慧通訊佈告欄前端邏輯 (支援個人 / 全團隊雙模式)

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
    allMessages.unshift(data);
    renderMessages();
    playNotificationSound(data.priority === 'URGENT');
  } else if (type === 'UPDATE_MESSAGE') {
    const idx = allMessages.findIndex(m => m.id === data.id);
    if (idx !== -1) {
      if (data.is_read !== null && data.is_read !== undefined) allMessages[idx].is_read = data.is_read;
      if (data.is_resolved !== null && data.is_resolved !== undefined) allMessages[idx].is_resolved = data.is_resolved;
      if (data.is_pinned !== null && data.is_pinned !== undefined) allMessages[idx].is_pinned = data.is_pinned;
      renderMessages();
    }
  } else if (type === 'DELETE_MESSAGE') {
    allMessages = allMessages.filter(m => m.id !== data.id);
    renderMessages();
  } else if (type === 'CLEAR_MESSAGES') {
    allMessages = [];
    renderMessages();
  }
}

// 載入訊息
async function fetchMessages() {
  try {
    const res = await fetch('/api/messages');
    allMessages = await res.json();
    renderMessages();
  } catch (err) {
    console.error("Fetch messages failed:", err);
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

  const filtered = allMessages.filter(m => {
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
  const totalMyUnresolved = allMessages.filter(m => m.category === 'MENTION_ME' && !m.is_resolved).length;
  const totalTeamUnresolved = allMessages.filter(m => m.category === 'MENTION_TEAM' && !m.is_resolved).length;
  const totalAnnouncements = allMessages.filter(m => m.category === 'ANNOUNCEMENT').length;

  badgeMentions.textContent = totalMyUnresolved;
  badgeTeam.textContent = totalTeamUnresolved;
  badgeAnnouncements.textContent = totalAnnouncements;

  countTabMe.textContent = myMentions.length;
  countTabTeam.textContent = teamMentions.length;
  countAnnouncements.textContent = `${announcements.length} 則`;

  // 依當前 Tab 渲染左欄
  if (currentMentionTab === 'ME') {
    countMentions.textContent = `${myMentions.length} 則`;
    renderColumn(listMentions, myMentions, true, false);
  } else {
    countMentions.textContent = `${teamMentions.length} 則`;
    renderColumn(listMentions, teamMentions, true, true);
  }

  renderColumn(listAnnouncements, announcements, false, false);
}

function renderColumn(container, list, isMentionCol, isTeamView) {
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">${isMentionCol ? (isTeamView ? '目前無團隊成員交辦訊息' : '目前無屬於您的 @個人 訊息') : '目前無符合條件的宣導或公告事項'}</div>`;
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
      targetBadges = msg.target_users.map(u => `<span class="target-user-badge">@${escapeHtml(u)}</span>`).join(' ');
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
          <span class="time-tag">${msg.created_at.slice(11, 16)}</span>
        </div>

        <div class="meta-info">
          <span class="channel-tag">${escapeHtml(msg.channel_name)}</span>
          <span>&bull;</span>
          <span class="sender-tag">${escapeHtml(msg.sender_name)}</span>
        </div>

        <div class="msg-content">${escapeHtml(msg.content)}</div>

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
  await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_resolved: status })
  });
}

async function togglePinned(id, status) {
  await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_pinned: status })
  });
}

async function deleteMessage(id) {
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
async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    currentConfig = await res.json();
    const user = currentConfig.user_profile || {};
    document.getElementById('cfg-name').value = user.name || '';
    document.getElementById('cfg-aliases').value = (user.aliases || []).join(', ');
    document.getElementById('cfg-line-ids').value = (user.line_user_ids || []).join(', ');
    document.getElementById('cfg-google-emails').value = (user.google_emails || []).join(', ');
    document.getElementById('cfg-ann-keywords').value = (currentConfig.announcement_rules?.keywords || []).join(', ');
  } catch (err) {
    console.error("Load config failed:", err);
  }
}

btnSaveSettings.onclick = async () => {
  const name = document.getElementById('cfg-name').value.trim();
  const aliases = document.getElementById('cfg-aliases').value.split(',').map(s => s.trim()).filter(Boolean);
  const line_user_ids = document.getElementById('cfg-line-ids').value.split(',').map(s => s.trim()).filter(Boolean);
  const google_emails = document.getElementById('cfg-google-emails').value.split(',').map(s => s.trim()).filter(Boolean);
  const announcement_keywords = document.getElementById('cfg-ann-keywords').value.split(',').map(s => s.trim()).filter(Boolean);

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        aliases,
        line_user_ids,
        google_emails,
        announcement_keywords
      })
    });
    if (res.ok) {
      alert("設定已成功儲存！");
      settingsModal.classList.remove('active');
    }
  } catch (err) {
    alert("儲存失敗：" + err.message);
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

// 事件監聽
searchInput.oninput = renderMessages;
platformFilter.onchange = renderMessages;
unresolvedOnly.onchange = renderMessages;
btnRefresh.onclick = fetchMessages;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 頁面初次載入
window.onload = () => {
  fetchMessages();
  initWebSocket();
};
