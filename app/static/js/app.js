// 智慧通訊佈告欄前端邏輯 (交辦事項統一專區 + 模糊搜尋 + 本地持久化快取)

const STORAGE_KEY = 'bulletin_local_messages_v1';
const CONFIG_STORAGE_KEY = 'bulletin_local_config_v1';

let allMessages = [];
let ws = null;
let currentConfig = null;

// DOM 元素快取
const listMentions = document.getElementById('list-mentions');
const listAnnouncements = document.getElementById('list-announcements');
const countMentions = document.getElementById('count-mentions');
const countAnnouncements = document.getElementById('count-announcements');
const badgeTeam = document.getElementById('badge-team');
const badgeAnnouncements = document.getElementById('badge-announcements');
const wsIndicator = document.getElementById('ws-indicator');
const wsStatusText = document.getElementById('ws-status-text');

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

// 本地快取操作 (系統篩選設定)
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

// ----------------- 模糊搜尋核心演算法 (Fuzzy Search Engine) -----------------

/**
 * 針對單一文字區塊執行模糊比對並計算分數
 * @param {string} text 目標文字
 * @param {string} pattern 搜尋關鍵字
 * @returns {{ match: boolean, score: number, ranges: Array<[number, number]> }}
 */
function fuzzyMatch(text, pattern) {
  if (!pattern) return { match: true, score: 1, ranges: [] };
  if (!text) return { match: false, score: 0, ranges: [] };

  const t = String(text);
  const tLower = t.toLowerCase();
  const p = String(pattern).trim();
  const pLower = p.toLowerCase();

  if (!pLower) return { match: true, score: 1, ranges: [] };

  // 1. 完全精確子字串包含 (最高優先度)
  const directIdx = tLower.indexOf(pLower);
  if (directIdx !== -1) {
    return {
      match: true,
      score: 100 + (pLower.length / tLower.length) * 40,
      ranges: [[directIdx, directIdx + pLower.length]]
    };
  }

  // 2. 多關鍵字空格分詞 (Token AND Search)
  const tokens = pLower.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let allTokensFound = true;
    let ranges = [];
    let tokenScore = 60;
    for (const token of tokens) {
      const idx = tLower.indexOf(token);
      if (idx !== -1) {
        ranges.push([idx, idx + token.length]);
        tokenScore += 10;
      } else {
        allTokensFound = false;
        break;
      }
    }
    if (allTokensFound) {
      return { match: true, score: tokenScore, ranges };
    }
  }

  // 3. 子序列字元模糊搜尋 (Subsequence Fuzzy Match)
  let pIdx = 0;
  let score = 0;
  let consecutive = 0;
  let ranges = [];
  let currentRange = null;

  for (let tIdx = 0; tIdx < tLower.length && pIdx < pLower.length; tIdx++) {
    if (tLower[tIdx] === pLower[pIdx]) {
      pIdx++;
      consecutive++;
      score += 4 + (consecutive * 3); // 連續命中字元額外加分

      // 單詞邊界命中 (前一個字為空格、標點或 @)
      if (tIdx === 0 || /[\s@#，。、；：\(\)\[\]\-]/.test(tLower[tIdx - 1])) {
        score += 8;
      }

      if (!currentRange) {
        currentRange = [tIdx, tIdx + 1];
      } else if (currentRange[1] === tIdx) {
        currentRange[1] = tIdx + 1;
      } else {
        ranges.push(currentRange);
        currentRange = [tIdx, tIdx + 1];
      }
    } else {
      consecutive = 0;
    }
  }

  if (currentRange) {
    ranges.push(currentRange);
  }

  if (pIdx === pLower.length) {
    return { match: true, score, ranges };
  }

  return { match: false, score: 0, ranges: [] };
}

/**
 * 對一則訊息物件進行全欄位模糊評分
 * 欄位包括：內容、發送者、頻道群組、目標標記者名單、匹配理由
 */
function scoreMessageForSearch(msg, query) {
  if (!query) return { isMatch: true, totalScore: 0 };

  const targetStr = (msg.target_users || []).join(' ');
  const resContent = fuzzyMatch(msg.content, query);
  const resTarget = fuzzyMatch(targetStr, query);
  const resSender = fuzzyMatch(msg.sender_name, query);
  const resChannel = fuzzyMatch(msg.channel_name, query);
  const resReason = fuzzyMatch(msg.matched_reason, query);

  const isMatch = resContent.match || resTarget.match || resSender.match || resChannel.match || resReason.match;
  if (!isMatch) return { isMatch: false, totalScore: 0 };

  // 加權計算整體相關度分數
  const totalScore = (resContent.score * 2.5) +
                     (resTarget.score * 2.0) +
                     (resSender.score * 1.5) +
                     (resChannel.score * 1.2) +
                     (resReason.score * 1.0);

  return { isMatch: true, totalScore };
}

/**
 * 模糊高亮字元渲染
 */
function highlightFuzzy(text, query) {
  if (!text) return '';
  const plainText = String(text);
  if (!query) return escapeHtml(plainText);

  const res = fuzzyMatch(plainText, query);
  if (!res.match || res.ranges.length === 0) {
    return escapeHtml(plainText);
  }

  // 合併重疊或相鄰的 range
  const sorted = [...res.ranges].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of sorted) {
    if (!merged.length) {
      merged.push([...r]);
    } else {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([...r]);
      }
    }
  }

  let html = '';
  let lastIdx = 0;
  for (const [start, end] of merged) {
    if (start > lastIdx) {
      html += escapeHtml(plainText.slice(lastIdx, start));
    }
    html += `<mark style="background:#fef08a; color:#854d0e; padding:1px 3px; border-radius:3px; font-weight:600;">${escapeHtml(plainText.slice(start, end))}</mark>`;
    lastIdx = end;
  }
  if (lastIdx < plainText.length) {
    html += escapeHtml(plainText.slice(lastIdx));
  }
  return html;
}

// ----------------- WebSocket 連線初始化 -----------------
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

    localMsgs.forEach(m => msgMap.set(m.id, m));
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

// 渲染訊息列表
function renderMessages() {
  const query = searchInput.value.trim();
  const platform = platformFilter.value;
  const hideResolved = unresolvedOnly.checked;
  const selectedDays = timeFilter ? parseInt(timeFilter.value, 10) : 3;

  const now = new Date();

  // 1. 條件過濾與模糊搜尋評分
  const filteredWithScore = [];
  for (const m of allMessages) {
    // 時間過濾 (非置頂訊息且選擇特定天數時)
    if (selectedDays > 0 && !m.is_pinned) {
      const msgDate = parseMessageDate(m.created_at);
      const diffDays = (now - msgDate) / (1000 * 60 * 60 * 24);
      if (diffDays > selectedDays) continue;
    }

    if (platform !== 'ALL' && m.platform !== platform) continue;
    if (hideResolved && m.is_resolved) continue;

    if (query) {
      const searchRes = scoreMessageForSearch(m, query);
      if (!searchRes.isMatch) continue;
      filteredWithScore.push({ msg: m, score: searchRes.totalScore });
    } else {
      filteredWithScore.push({ msg: m, score: 0 });
    }
  }

  // 若處於搜尋狀態，依匹配度分數高者排序；否則依置頂與時間排序
  if (query) {
    filteredWithScore.sort((a, b) => {
      if (a.msg.is_pinned !== b.msg.is_pinned) return b.msg.is_pinned ? 1 : -1;
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      return parseMessageDate(b.msg.created_at) - parseMessageDate(a.msg.created_at);
    });
  }

  const filtered = filteredWithScore.map(item => item.msg);

  // 所有交辦事項 (無論 MENTION_TEAM 或 MENTION_ME 均為待處理交辦)
  const teamMentions = filtered.filter(m => m.category !== 'ANNOUNCEMENT');
  const announcements = filtered.filter(m => m.category === 'ANNOUNCEMENT');

  // 計算頂部徽章總數 (未結案交辦與全域宣導)
  const totalTeamUnresolved = filtered.filter(m => m.category !== 'ANNOUNCEMENT' && !m.is_resolved).length;
  const totalAnnouncements = announcements.length;

  if (badgeTeam) badgeTeam.textContent = totalTeamUnresolved;
  if (badgeAnnouncements) badgeAnnouncements.textContent = totalAnnouncements;

  if (countMentions) countMentions.textContent = `${teamMentions.length} 則`;
  if (countAnnouncements) countAnnouncements.textContent = `${announcements.length} 則`;

  // 渲染雙欄
  renderColumn(listMentions, teamMentions, true, query);
  renderColumn(listAnnouncements, announcements, false, query);
}

function renderColumn(container, list, isMentionCol, query = '') {
  if (list.length === 0) {
    if (query) {
      container.innerHTML = `<div class="empty-state">未找到與「<strong style="color:#60a5fa;">${escapeHtml(query)}</strong>」相符的訊息</div>`;
    } else {
      container.innerHTML = `<div class="empty-state">${isMentionCol ? '目前無待處理交辦事項' : '目前無符合條件的宣導或公告事項'}</div>`;
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
      targetBadges = msg.target_users.map(u => `<span class="target-user-badge">@${highlightFuzzy(u, query)}</span>`).join(' ');
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
          <span class="channel-tag">${highlightFuzzy(msg.channel_name, query)}</span>
          <span>&bull;</span>
          <span class="sender-tag">${highlightFuzzy(msg.sender_name, query)}</span>
        </div>

        <div class="msg-content">${highlightFuzzy(msg.content, query)}</div>

        ${msg.matched_reason ? `<div class="matched-reason-bar">${highlightFuzzy(msg.matched_reason, query)}</div>` : ''}

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
    content.value = "@國賓 請確認英業達分子篩更換發包進度，謝謝！";
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
      const catName = data.message.category === 'ANNOUNCEMENT' ? '📢 全域宣導' : '👥 團隊交辦事項';
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

// ----------------- 設定相關邏輯 -----------------
function applyConfigToForm(cfg) {
  if (!cfg) return;
  const user = cfg.user_profile || {};
  const elLineIds = document.getElementById('cfg-line-ids');
  const elAnnKeywords = document.getElementById('cfg-ann-keywords');

  if (elLineIds) elLineIds.value = (user.line_user_ids || []).join(', ');
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
  const localCfg = loadConfigFromLocalStorage();
  if (localCfg) {
    applyConfigToForm(localCfg);
    currentConfig = localCfg;
  }

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverCfg = await res.json();
    currentConfig = serverCfg;
    applyConfigToForm(serverCfg);
    saveConfigToLocalStorage(serverCfg);
  } catch (err) {
    console.warn("Load config from server failed, using local cache:", err);
  }
}

btnSaveSettings.onclick = async () => {
  const line_user_ids = (document.getElementById('cfg-line-ids')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const announcement_keywords = (document.getElementById('cfg-ann-keywords')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    is_customized: true,
    user_profile: {
      name: "",
      aliases: [],
      line_user_ids,
      google_emails: []
    },
    announcement_rules: {
      keywords: announcement_keywords
    }
  };

  saveConfigToLocalStorage(payload);
  currentConfig = payload;

  try {
    const ok = await syncConfigToServer(payload);
    if (ok) {
      alert("設定已成功儲存並同步！");
      settingsModal.classList.remove('active');
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

// 搜尋輸入監聽
searchInput.oninput = () => {
  renderMessages();
};

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
  allMessages = loadFromLocalStorage();
  if (allMessages.length > 0) {
    renderMessages();
  }

  const localCfg = loadConfigFromLocalStorage();
  if (localCfg && localCfg.is_customized) {
    currentConfig = localCfg;
    syncConfigToServer(localCfg);
  }

  fetchMessages();
  initWebSocket();
};

