const api = window.opengrokPrompt;

void api.config().then((config) => {
  const title = document.getElementById('title');
  const copy = document.getElementById('copy');
  const field = document.getElementById('field');
  const items = document.getElementById('items');
  const ok = document.getElementById('ok');
  const cancel = document.getElementById('cancel');
  const zh = String(config.locale || navigator.language || '')
    .toLowerCase()
    .startsWith('zh');
  title.textContent = config.title || 'OpenGrok';
  cancel.textContent = zh ? '取消' : 'Cancel';
  ok.textContent = zh ? '确定' : 'OK';
  if (config.prompt && config.prompt !== config.title) {
    copy.hidden = false;
    copy.textContent = config.prompt;
  }
  if (config.mode === 'pick') {
    items.hidden = false;
    ok.hidden = true;
    for (const item of config.items ?? []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = item.description
        ? `${escapeHtml(item.label)}<em>${escapeHtml(item.description)}</em>`
        : escapeHtml(item.label);
      btn.addEventListener('click', () => api.result(item.value));
      items.append(btn);
    }
  } else {
    field.hidden = false;
    field.type = config.mode === 'password' ? 'password' : 'text';
    if (config.value) {
      field.value = config.value;
    }
    field.focus();
    if (config.value) {
      field.select();
    }
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        api.result(field.value);
      }
      if (event.key === 'Escape') {
        api.cancel();
      }
    });
    ok.addEventListener('click', () => api.result(field.value));
  }
  cancel.addEventListener('click', () => api.cancel());
});

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
