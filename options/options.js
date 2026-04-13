(() => {
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
      const provider = providerSel.value;
      document.getElementById('openai-fields').style.display = provider === 'openai_compatible' ? 'block' : 'none';
      document.getElementById('custom-rest-fields').style.display = provider === 'custom_rest' ? 'block' : 'none';
    }

    function setStatus(message) {
      statusEl.textContent = message;
      if (message) {
        setTimeout(() => {
          if (statusEl.textContent === message) statusEl.textContent = '';
        }, 2500);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function fillSettings(settings) {
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
    }

    function loadSettings() {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
        fillSettings(resp?.settings || {});
      });
    }

    function saveSettings() {
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
        setStatus(res?.ok ? '设置已保存' : `保存失败：${res?.error || '未知错误'}`);
      });
    }

    function renderCustomers(customers) {
      const tbody = document.querySelector('#tags-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (!customers.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6">还没有客户记录。先在聊天页面打开对话，插件会自动采集。</td>';
        tbody.appendChild(tr);
        return;
      }

      customers.forEach((customer) => {
        const tags = customer.tags || {};
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div>${escapeHtml(customer.conversationId || '')}</div>
            <div style="font-size:12px;color:#888;">${escapeHtml(customer.lastMessagePreview || '')}</div>
          </td>
          <td><input data-field="intention" value="${escapeHtml(tags.intention || '')}" /></td>
          <td><input data-field="region" value="${escapeHtml(tags.region || '')}" /></td>
          <td><input data-field="progress" value="${escapeHtml(tags.progress || '')}" /></td>
          <td><input data-field="language" value="${escapeHtml(tags.language || '')}" /></td>
          <td><button data-action="save" data-convo="${escapeHtml(customer.conversationId || '')}">保存</button></td>
        `;
        tbody.appendChild(tr);
      });
    }

    function loadCustomers() {
      chrome.runtime.sendMessage({ type: 'GET_CUSTOMER_OVERVIEW' }, (res) => {
        renderCustomers(Array.isArray(res?.customers) ? res.customers : []);
      });
    }

    providerSel.addEventListener('change', showFields);
    document.getElementById('saveSettings').addEventListener('click', saveSettings);

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

      chrome.runtime.sendMessage({
        type: 'UPDATE_TAGS',
        payload: { conversationId: cid, tags: tag }
      }, (res) => {
        setStatus(res?.ok ? '标签已更新' : `更新失败：${res?.error || '未知错误'}`);
      });
    });

    window.addEventListener('focus', loadCustomers);

    loadSettings();
    loadCustomers();
  });
})();
