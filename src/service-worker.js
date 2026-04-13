const DEFAULT_SETTINGS = {
  // 翻译服务提供者：google_free（免费谷歌翻译）、openai_compatible（兼容 OpenAI 的模型）、custom_rest（自定义 REST 接口）
  provider: 'google_free',
  // 以下用于 openai_compatible
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4.1-mini',
  // 默认语言设置：来信翻译到中文，回复翻译为英语
  inboundTargetLanguage: 'zh-CN',
  replyTargetLanguage: 'en',
  // UI 行为开关
  enableFloatingToolbar: true,
  enableAutoDecorateMessages: true,
  // 翻译提示词，用于 openai_compatible
  customPrompt: 'You are a professional trade-assistant translator. Translate faithfully, naturally, and briefly. Preserve product codes, numbers, URLs, email addresses, prices, Incoterms, and business meaning. Output translation only.',
  // 以下用于 custom_rest
  customRestEndpoint: '',
  customRestApiKey: '',
  customRestMode: 'simple'
};

// 语言与默认地区的简单映射，用于从检测到的语言推断客户地区
const LANG_REGION_MAP = {
  'zh-CN': '中国',
  zh: '中国',
  'en': '全球',
  'es': '西班牙',
  'fr': '法国',
  'ar': '阿拉伯地区',
  'ru': '俄罗斯',
  'pt': '葡语地区',
  'hi': '印度',
  'sw': '非洲',
  'ja': '日本',
  'de': '德国',
  'it': '意大利'
};

// 默认标签结构
function defaultTags() {
  return {
    intention: '', // 意向程度，如 "高"、"中"、"低"
    region: '',    // 客户地区
    progress: '',  // 跟进进度，例如 "新询盘"、"报价"、"跟进中"、"成交"
    language: ''   // 客户语言
  };
}

// 初始化时合并默认设置
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...data };
  await chrome.storage.sync.set(merged);
  // 初始化聊天记录与标签存储
  const localData = await chrome.storage.local.get(['chatHistory', 'customerTags']);
  if (!localData.chatHistory) {
    await chrome.storage.local.set({ chatHistory: {} });
  }
  if (!localData.customerTags) {
    await chrome.storage.local.set({ customerTags: {} });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, payload } = message || {};
      if (!type) {
        sendResponse({ ok: false, error: '无消息类型' });
        return;
      }
      if (type === 'GET_SETTINGS') {
        const settings = await getSettings();
        sendResponse({ ok: true, settings });
        return;
      }
      if (type === 'SAVE_SETTINGS') {
        await saveSettings(payload || {});
        sendResponse({ ok: true });
        return;
      }
      if (type === 'TRANSLATE_TEXT') {
        const settings = await getSettings();
        const { translatedText, detectedLang } = await translateText(payload, settings);
        // 如果有会话 ID，则尝试更新标签
        if (payload && payload.conversationId && detectedLang) {
          await updateTags(payload.conversationId, { language: detectedLang, region: LANG_REGION_MAP[detectedLang] || '' });
        }
        sendResponse({ ok: true, translatedText, detectedLang });
        return;
      }
      if (type === 'LOG_MESSAGE') {
        await logMessage(payload);
        sendResponse({ ok: true });
        return;
      }
      if (type === 'EXPORT_SINGLE') {
        await exportConversation(payload?.conversationId);
        sendResponse({ ok: true });
        return;
      }
      if (type === 'EXPORT_ALL') {
        await exportAllConversations();
        sendResponse({ ok: true });
        return;
      }
      if (type === 'UPDATE_TAGS') {
        await updateTags(payload?.conversationId, payload?.tags || {});
        sendResponse({ ok: true });
        return;
      }
      if (type === 'GET_TAGS') {
        const tags = await getTags(payload?.conversationId);
        sendResponse({ ok: true, tags });
        return;
      }
      if (type === 'GET_ALL_TAGS') {
        const allTags = await getAllTags();
        sendResponse({ ok: true, tags: allTags });
        return;
      }
      // 打开选项页
      if (type === 'OPEN_OPTIONS') {
        // 直接打开插件的设置页
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: '未知消息类型' });
    } catch (error) {
      console.error('Service worker error:', error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  // 返回 true 表示异步响应
  return true;
});

// 获取设置
async function getSettings() {
  const data = await chrome.storage.sync.get(null);
  return { ...DEFAULT_SETTINGS, ...data };
}

// 保存设置
async function saveSettings(payload) {
  const current = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...current, ...payload });
}

// 主要翻译入口
async function translateText(payload = {}, settings = {}) {
  const text = (payload.text || '').trim();
  if (!text) {
    return { translatedText: '', detectedLang: '' };
  }
  const sourceLanguage = payload.sourceLanguage || 'auto';
  const targetLanguage = payload.targetLanguage || settings.inboundTargetLanguage || 'zh-CN';
  let result;
  if (settings.provider === 'google_free') {
    result = await callGoogleFree(text, sourceLanguage, targetLanguage);
  } else if (settings.provider === 'openai_compatible') {
    result = await callOpenAICompatible(text, sourceLanguage, targetLanguage, settings);
  } else if (settings.provider === 'custom_rest') {
    result = await callCustomRest(text, sourceLanguage, targetLanguage, settings);
  } else {
    throw new Error('未知翻译服务提供者');
  }
  return { translatedText: result.translated, detectedLang: result.detectedLang || '' };
}

// 免费谷歌翻译
async function callGoogleFree(text, sourceLanguage, targetLanguage) {
  // 官方接口无免费额度，此处使用未官方公开的 endpoint【106157235095832†L101-L111】
  const sl = sourceLanguage || 'auto';
  const tl = targetLanguage || 'zh-CN';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`谷歌翻译接口错误：${response.status} ${detail}`.slice(0, 300));
  }
  const data = await response.json();
  // data[0] 是翻译结果数组，data[2] 是检测到的源语言
  const translated = (data[0] || []).map(item => item[0]).join('');
  const detectedLang = data[2] || '';
  return { translated, detectedLang };
}

// OpenAI 兼容接口
async function callOpenAICompatible(text, sourceLanguage, targetLanguage, settings) {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error('请先在设置页填写 OpenAI 兼容接口地址、API Key 和模型名。');
  }
  const url = settings.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const prompt = [
    settings.customPrompt,
    `Source language: ${sourceLanguage}`,
    `Target language: ${targetLanguage}`,
    'Do not add notes, labels, or quotation marks.',
    'Return translation only.'
  ].join('\n');
  const body = {
    model: settings.model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text }
    ]
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`OpenAI 翻译接口错误：${response.status} ${detail}`.slice(0, 300));
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || '';
  // OpenAI 接口不提供语言检测，保持空
  return { translated: content, detectedLang: '' };
}

// 自定义 REST 接口
async function callCustomRest(text, sourceLanguage, targetLanguage, settings) {
  if (!settings.customRestEndpoint) {
    throw new Error('请先在设置页填写自定义 REST 翻译接口地址。');
  }
  const response = await fetch(settings.customRestEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.customRestApiKey ? { Authorization: `Bearer ${settings.customRestApiKey}` } : {})
    },
    body: JSON.stringify({
      text,
      sourceLanguage,
      targetLanguage
    })
  });
  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`自定义翻译接口错误：${response.status} ${detail}`.slice(0, 300));
  }
  const data = await response.json();
  const translated = data?.translatedText || data?.translation || data?.text;
  return { translated: String(translated || '').trim(), detectedLang: '' };
}

// 日志消息
async function logMessage(payload) {
  const { conversationId, fromMe, text, timestamp } = payload || {};
  if (!conversationId || !text) return;
  const local = await chrome.storage.local.get(['chatHistory']);
  const history = local.chatHistory || {};
  if (!history[conversationId]) history[conversationId] = [];
  history[conversationId].push({ fromMe: !!fromMe, text, timestamp: timestamp || new Date().toISOString() });
  await chrome.storage.local.set({ chatHistory: history });
}

// 导出单个会话
async function exportConversation(conversationId) {
  const local = await chrome.storage.local.get(['chatHistory', 'customerTags']);
  const history = (local.chatHistory || {})[conversationId] || [];
  const tags = (local.customerTags || {})[conversationId] || defaultTags();
  const data = { conversationId, tags, history };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `${sanitizeFilename(conversationId || 'conversation')}_${Date.now()}.json`;
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 导出全部会话
async function exportAllConversations() {
  const local = await chrome.storage.local.get(['chatHistory', 'customerTags']);
  const data = { chatHistory: local.chatHistory || {}, customerTags: local.customerTags || {} };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `all_conversations_${Date.now()}.json`;
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 更新标签
async function updateTags(conversationId, tagsUpdate) {
  if (!conversationId) return;
  const local = await chrome.storage.local.get(['customerTags']);
  const tags = local.customerTags || {};
  const existing = tags[conversationId] || defaultTags();
  tags[conversationId] = { ...existing, ...tagsUpdate };
  await chrome.storage.local.set({ customerTags: tags });
}

// 获取标签
async function getTags(conversationId) {
  const local = await chrome.storage.local.get(['customerTags']);
  const tags = local.customerTags || {};
  return tags[conversationId] || defaultTags();
}

async function getAllTags() {
  const local = await chrome.storage.local.get(['customerTags']);
  return local.customerTags || {};
}

// 安全读取响应文本（避免二进制错误）
async function safeReadText(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 200) : '';
  } catch {
    return '';
  }
}

// 文件名安全化
function sanitizeFilename(name) {
  return String(name || 'file').replace(/[^\w\-\.]+/g, '_');
}