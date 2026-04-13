(function () {
  const state = {
    settings: null,
    toolbar: null,
    statusEl: null,
    decoratedHosts: new WeakSet(),
    originalComposerText: '',
    observer: null,
    decorateTimer: null
  };

  const DOM_OBSERVER_DEBOUNCE_MS = 250;
  const MAX_VISIBLE_TRANSLATE_COUNT = 30;

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
    state.observer = new MutationObserver((mutations) => {
      const shouldDecorate = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;
        if (mutation.addedNodes.length === 0) return false;
        return [...mutation.addedNodes].some((node) => {
          if (!(node instanceof Element)) return false;
          if (node.closest?.('.tt-final-toolbar')) return false;
          if (node.matches?.('.tt-final-message-tools, .tt-final-translation-box')) return false;
          return true;
        });
      });
      if (shouldDecorate) {
        scheduleDecorateMessages();
      }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleDecorateMessages() {
    if (state.decorateTimer) {
      clearTimeout(state.decorateTimer);
    }
    state.decorateTimer = setTimeout(() => {
      state.decorateTimer = null;
      decorateMessages();
    }, DOM_OBSERVER_DEBOUNCE_MS);
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

  function collectMessageEntries() {
    const selectors = getCandidateSelectors();
    const hostMap = new Map();

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.closest('.tt-final-toolbar, .tt-final-message-tools, .tt-final-translation-box')) return;
        const text = normalizeText(node.innerText || node.textContent || '');
        if (!text) return;
        if (text.length > 1500) return;
        if (/^(Search|Type a message|Message|Today|Yesterday)$/i.test(text)) return;
        const host = getMessageHost(node);
        if (!host || host.closest('.tt-final-toolbar')) return;
        if (!hostMap.has(host)) {
          hostMap.set(host, { host, node, text });
        }
      });
    });

    return [...hostMap.values()];
  }

  function getMessageHost(node) {
    return node.closest('[data-testid="msg-container"]')
      || node.closest('[role="row"]')
      || node.closest('[role="gridcell"]')
      || node.parentElement;
  }

  function decorateMessages() {
    const entries = collectMessageEntries();
    entries.forEach(({ host, node }) => {
      if (!host || state.decoratedHosts.has(host)) return;
      if (host.querySelector(':scope > .tt-final-message-tools')) {
        state.decoratedHosts.add(host);
        return;
      }

      state.decoratedHosts.add(host);
      logMessageFromNode(node).catch((err) => console.error('logMessageFromNode error', err));

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
    let title = document.title || '';
    if (title.includes('WhatsApp')) {
      title = title.replace(/\s*-\s*WhatsApp.*/, '').trim();
    } else if (title.includes('Facebook')) {
      title = title.replace(/\s*-\s*Facebook.*/, '').trim();
    }

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
    const host = getMessageHost(node);
    if (!host) return false;
    const cls = host.className || '';
    return /message-out/.test(cls) || /from-me/.test(cls);
  }

  async function logMessageFromNode(node) {
    const text = normalizeText(node.innerText || node.textContent || '');
    if (!text) return;

    const conversationId = getConversationId();
    const fromMe = isFromMe(node);
    const timestamp = new Date().toISOString();
    const messageFingerprint = buildMessageFingerprint(node, text, conversationId, fromMe);

    const logRes = await sendMessage({
      type: 'LOG_MESSAGE',
      payload: { conversationId, fromMe, text, timestamp, messageFingerprint }
    });

    if (!logRes?.ok || logRes.duplicate || !logRes.inserted) {
      return;
    }

    if (!fromMe && state.settings.provider === 'google_free') {
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
  }

  function buildMessageFingerprint(node, text, conversationId, fromMe) {
    const host = getMessageHost(node);
    const hostSnapshot = host ? getHostSnapshotText(host) : text;
    const raw = [conversationId, fromMe ? 'me' : 'peer', hostSnapshot || text].join('|');
    return simpleHash(raw);
  }

  function getHostSnapshotText(host) {
    const clone = host.cloneNode(true);
    clone.querySelectorAll('.tt-final-message-tools, .tt-final-translation-box').forEach((el) => el.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
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

    const host = getMessageHost(node);
    let box = host?.querySelector(':scope > .tt-final-translation-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tt-final-translation-box';
      host?.appendChild(box);
    }
    box.innerHTML = `<span class="tt-final-badge">译文</span>${escapeHtml(res.translatedText)}`;
  }

  async function translateVisibleMessages() {
    const entries = collectMessageEntries().slice(-MAX_VISIBLE_TRANSLATE_COUNT);
    if (!entries.length) {
      setStatus('未发现可翻译消息');
      return;
    }

    setStatus(`正在翻译 ${entries.length} 条消息...`);
    const conversationId = getConversationId();
    const targetLanguage = state.settings.inboundTargetLanguage || 'zh-CN';

    for (const { host, text } of entries) {
      try {
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
        if (!res?.ok) continue;

        let box = host?.querySelector(':scope > .tt-final-translation-box');
        if (!box) {
          box = document.createElement('div');
          box.className = 'tt-final-translation-box';
          host?.appendChild(box);
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
    const value = String(text || '');
    el.focus();

    if ('value' in el) {
      setNativeInputValue(el, value);
      moveCaretToEnd(el);
      dispatchInputLifecycle(el, value);
      return;
    }

    if (tryExecCommandInsertText(el, value)) {
      dispatchInputLifecycle(el, value);
      placeCaretAtEnd(el);
      return;
    }

    replaceContentEditableText(el, value);
    dispatchInputLifecycle(el, value);
    placeCaretAtEnd(el);
  }

  function setNativeInputValue(el, value) {
    const prototype = Object.getPrototypeOf(el);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function moveCaretToEnd(el) {
    try {
      if (typeof el.setSelectionRange === 'function') {
        const length = String(el.value || '').length;
        el.setSelectionRange(length, length);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function tryExecCommandInsertText(el, value) {
    try {
      selectContentEditable(el);
      const success = document.execCommand && document.execCommand('insertText', false, value);
      return !!success;
    } catch (err) {
      return false;
    }
  }

  function selectContentEditable(el) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function replaceContentEditableText(el, value) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }

    const lines = value.split(/\n/);
    if (lines.length === 0) return;

    lines.forEach((line, index) => {
      if (index > 0) {
        el.appendChild(document.createElement('br'));
      }
      el.appendChild(document.createTextNode(line));
    });
  }

  function dispatchInputLifecycle(el, value) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertText'
      }));
    } catch (err) {
      // ignore
    }

    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText'
      }));
    } catch (err) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Process' }));
  }

  function placeCaretAtEnd(el) {
    try {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (err) {
      console.error(err);
    }
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

  function simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }
})();