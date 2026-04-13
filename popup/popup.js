(() => {
  // Utility to escape HTML for placeholders
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

    // Fetch current settings and populate
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

    document.getElementById('saveBtn').addEventListener('click', () => {
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
        if (res?.ok) {
          statusEl.textContent = '设置已保存';
        } else {
          statusEl.textContent = '保存失败：' + (res?.error || '未知错误');
        }
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      });
    });

    document.getElementById('openOptions').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  });
})();