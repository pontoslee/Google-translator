(function () {
  const state = {
    settings: null,
    toolbar: null,
    statusEl: null,
    decorated: new WeakSet(),
    originalComposerText: '',
    observer: null
  };

  init().catch((err) => console.error(err));

  async function init() {
    const resp = await sendMessage({ type: 'GET_SETTINGS' });
    state.settings = resp?.settings || {};
    if (state.settings.enableFloatingToolbar) {
      mountToolbar();
    }
    if (state.settings.enableAutoDecorateMessages) {
      decorateMessages();
      observeDom();
    }
  }

  function observeDom() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(() => decorateMessages());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function mountToolbar() {
    if (document.querySelector('.tt-final-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'tt-final-toolbar';
    toolbar.innerHTML = `
      <div class="tt-final-title">Trade Translator</div>
      <button class="tt-final-btn tt-primary" data-action="translate-page">来信转中文</button>
      <button class="tt-final-btn tt-light" data-action="translate-composer">输入框转客户语言</button>
      <button class="tt-final-btn tt-secondary" data-action="restore-composer">恢复输入框</button>
      <button class="tt-final-btn tt-secondary" data-action="export-current">导出本聊天</button>
      <button class="tt-final-btn tt-secondary" data-action="export-all">导出全部</button>
      <button class="tt-final-btn tt-secondary" data-action="open-settings">打开设置</button>
      <div class="tt-final-status">已就绪</div>
    `;
    toolbar.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'translate-page') {
        await translateVisibleMessages();
      } else if (action === 'translate-composer') {
        await translateComposer();
      } else if (action === 'restore-composer') {
        restoreComposer();
      } else if (action === 'export-current') {
        await exportCurrentConversation();
      } else if (action === 'export-all') {
        await exportAllConversations();
      } else if (action === 'open-settings') {
        await sendMessage({ type: 'OPEN_OPTIONS' });
      }
    });
    document.body.appendChild(toolbar);
    state.toolbar = toolbar;
    state.statusEl = toolbar.querySelector('.tt-final-status');
  }

  function setStatus(msg) {
    if (state.statusEl) state.statusEl.textContent = msg;
  }

  function getCandidateSelectors() {
    return [
      '[data-testid="msg-container"] [dir="ltr"] span.selectable-text',
      '[data-testid="msg-container"] span.selectable-text',
      'div[role="row"] span[dir="auto"]',
      'div[role="gridcell"] span[dir="auto"]',
      'div[role="main"] span[dir="auto"]',
      'div[role="main"] div[dir="auto"]',
      'div[aria-label] span[dir="auto"]',
      '[contenteditable="false"] span[dir="auto"]'
    ];
  }

  function collectMessageNodes() {
    const selectors = getCandidateSelectors();
    const nodes = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        const text = normalizeText(node.innerText || node.textContent || '');
        if (!text) return;
        if (text.length > 1500) return;
        if (/^(Search|Type a message|Message|Today|Yesterday)$/i.test(text)) return;
        nodes.add(node);
      });
    });
    return [...nodes];
  }

  function decorateMessages() {
    const nodes = collectMessageNodes();
    nodes.forEach((node) => {
      const host = node.closest('[data-testid="msg-container"]') || node.parentElement;
      if (!host || state.decorated.has(node)) return;
      state.decorated.add(node);
      // 日志记录
      logMessageFromNode(node);
      const tools = document.createElement('div');
      tools.className = 'tt-final-message-tools';
      tools.innerHTML = `<button class="tt-final-message-btn" data-action="translate-single">翻译</button>`;
      tools.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-action="translate-single"]');
        if (!btn) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '翻译中...';
        try {
          await translateSingleNode(node);
          btn.textContent = '已翻译';
        } catch (err) {
          btn.textContent = '失败';
          console.error(err);
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
          }, 1500);
        }
      });
      host.appendChild(tools);
    });
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getConversationId() {
    // 尝试从页面标题或聊天头部获得会话标识
    // WhatsApp Web 的标题通常是 "聊天名称 - WhatsApp"
    let title = document.title || '';
    if (title.includes('WhatsApp')) {
      title = title.replace(/\s*-\s*WhatsApp.*/, '').trim();
    } else if (title.includes('Facebook')) {
      title = title.replace(/\s*-\s*Facebook.*/, '').trim();
    }
    // 再尝试从页头读取
    const headerCandidates = [
      'header span[title]',
      'header [role="button"] span[dir="auto"]',
      'header h1',
      'header h2'
    ];
    for (const selector of headerCandidates) {
      const el = document.querySelector(selector);
      const text = normalizeText(el?.textContent || '');
      if (text) return text;
    }
    return title || 'unknown';
  }

  function isFromMe(node) {
    // WhatsApp Web: message-out class; Facebook: message-from-me ???
    const host = node.closest('[data-testid="msg-container"]') || node.parentElement;
    if (!host) return false;
    const cls = host.className || '';
    return /message-out/.test(cls) || /from-me/.test(cls);
  }

  async function logMessageFromNode(node) {
    try {
      const text = normalizeText(node.innerText || node.textContent || '');
      if (!text) return;
      const conversationId = getConversationId();
      const fromMe = isFromMe(node);
      const timestamp = new Date().toISOString();
      await sendMessage({
        type: 'LOG_MESSAGE',
        payload: { conversationId, fromMe, text, timestamp }
      });
      // 检测语言并更新标签（只针对对方消息）
      if (!fromMe && state.settings.provider === 'google_free') {
        // 调用翻译接口自动检测语言并更新
        await sendMessage({
          type: 'TRANSLATE_TEXT',
          payload: {
            text,
            sourceLanguage: 'auto',
            targetLanguage: state.settings.inboundTargetLanguage || 'zh-CN',
            conversationId
          }
        });
      }
    } catch (err) {
      console.error('logMessageFromNode error', err);
    }
  }

  async function translateSingleNode(node) {
    const text = normalizeText(node.innerText || node.textContent || '');
    if (!text) return;
    const conversationId = getConversationId();
    const targetLanguage = state.settings.inboundTargetLanguage || 'zh-CN';
    const res = await sendMessage({
      type: 'TRANSLATE_TEXT',
      payload: {
        text,
        sourceLanguage: 'auto',
        targetLanguage,
        conversationId
      }
    });
    if (!res?.ok) throw new Error(res?.error || '翻译失败');
    let box = node.parentElement?.querySelector(':scope > .tt-final-translation-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tt-final-translation-box';
      node.parentElement?.appendChild(box);
    }
    box.innerHTML = `<span class="tt-final-badge">译文</span>${escapeHtml(res.translatedText)}`;
  }

  async function translateVisibleMessages() {
    const nodes = collectMessageNodes().slice(-30);
    if (!nodes.length) {
      setStatus('未发现可翻译消息');
      return;
    }
    setStatus(`正在翻译 ${nodes.length} 条消息...`);
    const conversationId = getConversationId();
    const targetLanguage = state.settings.inboundTargetLanguage || 'zh-CN';
    for (const node of nodes) {
      try {
        const text = normalizeText(node.innerText || node.textContent || '');
        if (!text) continue;
        const res = await sendMessage({
          type: 'TRANSLATE_TEXT',
          payload: {
            text,
            sourceLanguage: 'auto',
            targetLanguage,
            conversationId
          }
        });
        let box = node.parentElement?.querySelector(':scope > .tt-final-translation-box');
        if (!box) {
          box = document.createElement('div');
          box.className = 'tt-final-translation-box';
          node.parentElement?.appendChild(box);
        }
        box.innerHTML = `<span class="tt-final-badge">译文</span>${escapeHtml(res.translatedText)}`;
      } catch (err) {
        console.error(err);
      }
    }
    setStatus('页面翻译完成');
  }

  async function translateComposer() {
    const input = getComposerElement();
    if (!input) {
      setStatus('未找到输入框');
      return;
    }
    const original = readComposerText(input).trim();
    if (!original) {
      setStatus('输入框为空');
      return;
    }
    state.originalComposerText = original;
    input.classList.add('tt-final-highlight');
    setStatus('正在翻译输入框...');
    const conversationId = getConversationId();
    const res = await sendMessage({
      type: 'TRANSLATE_TEXT',
      payload: {
        text: original,
        sourceLanguage: state.settings.inboundTargetLanguage || 'zh-CN',
        targetLanguage: state.settings.replyTargetLanguage || 'en',
        conversationId
      }
    });
    if (!res?.ok) {
      input.classList.remove('tt-final-highlight');
      setStatus(`翻译失败：${res?.error || '未知错误'}`);
      return;
    }
    writeComposerText(input, res.translatedText);
    input.classList.remove('tt-final-highlight');
    setStatus(`已翻译为 ${state.settings.replyTargetLanguage || '目标语言'}`);
  }

  function restoreComposer() {
    const input = getComposerElement();
    if (!input || !state.originalComposerText) {
      setStatus('没有可恢复内容');
      return;
    }
    writeComposerText(input, state.originalComposerText);
    setStatus('已恢复原文');
  }

  async function exportCurrentConversation() {
    const conversationId = getConversationId();
    setStatus('正在导出本聊天...');
    await sendMessage({ type: 'EXPORT_SINGLE', payload: { conversationId } });
    setStatus('导出完成，文件已下载');
  }

  async function exportAllConversations() {
    setStatus('正在导出全部聊天...');
    await sendMessage({ type: 'EXPORT_ALL' });
    setStatus('全部聊天导出完成');
  }

  function getComposerElement() {
    const candidates = [
      'footer [contenteditable="true"]',
      '[data-tab="10"][contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea'
    ];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function readComposerText(el) {
    if ('value' in el) return el.value || '';
    return el.innerText || el.textContent || '';
  }

  function writeComposerText(el, text) {
    el.focus();
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }
})();