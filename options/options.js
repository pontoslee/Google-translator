(() => {
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const providerSel = document.getElementById('provider');
    const baseUrlEl = document.getElementById('baseUrl');
    const apiKeyEl = document.getElementById('apiKey');
    const modelEl = document.getElementById('model');
    const customPromptEl = document.getElementById('customPrompt');
    const restEndpointEl = document.getElementById('restEndpoint');
    const restApiKeyEl = document.getElementById('restApiKey');
    const inboundLangEl = document.getElementById('inboundLang');
    const replyLangEl = document.getElementById('replyLang');
    const enableToolbarEl = document.getElementById('enableToolbar');
    const enableAutoDecorateEl = document.getElementById('enableAutoDecorate');
    const statusEl = document.getElementById('status');

    function showFields() {
      const val = providerSel.value;
      document.getElementById('openai-fields').style.display = val === 'openai_compatible' ? 'block' : 'none';
      document.getElementById('custom-rest-fields').style.display = val === 'custom_rest' ? 'block' : 'none';
    }

    providerSel.addEventListener('change', showFields);

    // Load settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      const settings = resp?.settings || {};
      providerSel.value = settings.provider || 'google_free';
      baseUrlEl.value = settings.baseUrl || '';
      apiKeyEl.value = settings.apiKey || '';
      modelEl.value = settings.model || '';
      customPromptEl.value = settings.customPrompt || '';
      restEndpointEl.value = settings.customRestEndpoint || '';
      restApiKeyEl.value = settings.customRestApiKey || '';
      inboundLangEl.value = settings.inboundTargetLanguage || '';
      replyLangEl.value = settings.replyTargetLanguage || '';
      enableToolbarEl.checked = !!settings.enableFloatingToolbar;
      enableAutoDecorateEl.checked = !!settings.enableAutoDecorateMessages;
      showFields();
    });

    document.getElementById('saveSettings').addEventListener('click', () => {
      const provider = providerSel.value;
      const payload = {
        provider,
        inboundTargetLanguage: inboundLangEl.value.trim(),
        replyTargetLanguage: replyLangEl.value.trim(),
        enableFloatingToolbar: enableToolbarEl.checked,
        enableAutoDecorateMessages: enableAutoDecorateEl.checked
      };
      if (provider === 'openai_compatible') {
        payload.baseUrl = baseUrlEl.value.trim();
        payload.apiKey = apiKeyEl.value.trim();
        payload.model = modelEl.value.trim();
        payload.customPrompt = customPromptEl.value.trim();
      } else if (provider === 'custom_rest') {
        payload.customRestEndpoint = restEndpointEl.value.trim();
        payload.customRestApiKey = restApiKeyEl.value.trim();
      }
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload }, (res) => {
        statusEl.textContent = res?.ok ? '设置已保存' : '保存失败：' + (res?.error || '未知错误');
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      });
    });

    // Load tags and populate table
    function loadTags() {
      chrome.runtime.sendMessage({ type: 'GET_ALL_TAGS' }, (res) => {
        const tbody = document.querySelector('#tags-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        const tags = res?.tags || {};
        const keys = Object.keys(tags);
        keys.sort();
        keys.forEach((cid) => {
          const t = tags[cid] || {};
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeHtml(cid)}</td>
            <td><input data-field="intention" value="${escapeHtml(t.intention || '')}" /></td>
            <td><input data-field="region" value="${escapeHtml(t.region || '')}" /></td>
            <td><input data-field="progress" value="${escapeHtml(t.progress || '')}" /></td>
            <td><input data-field="language" value="${escapeHtml(t.language || '')}" /></td>
            <td><button data-action="save" data-convo="${escapeHtml(cid)}">保存</button></td>
          `;
          tbody.appendChild(tr);
        });
      });
    }

    loadTags();

    // Delegate click for save buttons
    document.getElementById('tags-section').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action="save"]');
      if (!btn) return;
      const cid = btn.getAttribute('data-convo');
      const tr = btn.closest('tr');
      if (!tr || !cid) return;
      const tag = {};
      tr.querySelectorAll('input[data-field]').forEach((input) => {
        const field = input.getAttribute('data-field');
        tag[field] = input.value.trim();
      });
      chrome.runtime.sendMessage({ type: 'UPDATE_TAGS', payload: { conversationId: cid, tags: tag } }, (res) => {
        statusEl.textContent = res?.ok ? '标签已更新' : '更新失败：' + (res?.error || '未知错误');
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      });
    });

    // Refresh tags when page gains focus (in case tags updated elsewhere)
    window.addEventListener('focus', loadTags);
  });
})();