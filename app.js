(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const BUCKET = 'cdf-cartoes';
  const MAX_BYTES = 12 * 1024 * 1024;
  const config = window.CDF_CONFIG;
  let client;
  let currentUser = null;
  let uploading = false;
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const configured = config && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url || '') &&
    /^(sb_publishable_|eyJ)/.test(config.publishableKey || '') && !!window.supabase?.createClient;
  if (!configured) {
    $('setup-view').hidden = false;
    return;
  }
  client = window.supabase.createClient(config.url.replace(/\/$/, ''), config.publishableKey);

  function message(id, text, error = false) {
    const element = $(id);
    element.textContent = text;
    element.classList.toggle('error', error);
  }

  function empty(text) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = text;
    return el;
  }

  function fileInfo(name, detail) {
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'file-name';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = detail;
    info.append(title, meta);
    return info;
  }

  function when(iso) {
    try { return dateFormatter.format(new Date(iso)); }
    catch { return 'Data indisponível'; }
  }

  async function showWorkspace(user) {
    currentUser = user;
    $('login-view').hidden = !!user;
    $('workspace').hidden = !user;
    $('account').hidden = !user;
    if (user) {
      $('account-email').textContent = user.email || 'Conta conectada';
      await listFiles();
    } else {
      $('file-list').replaceChildren();
      $('results').replaceChildren(empty('Entre para pesquisar os arquivos.'));
    }
  }

  async function listFiles() {
    if (!currentUser) return;
    const target = $('file-list');
    target.replaceChildren(empty('Carregando arquivos...'));
    const { data, error } = await client.from('cdf_arquivos')
      .select('id,nome_arquivo,caminho_storage,quantidade_cartoes,criado_em,tamanho_bytes')
      .order('criado_em', { ascending: false }).limit(200);
    if (error) {
      target.replaceChildren(empty(`Não foi possível consultar os arquivos: ${error.message}`));
      return;
    }
    target.replaceChildren();
    if (!data.length) { target.append(empty('Nenhum CDF enviado. Selecione os arquivos para começar.')); return; }
    const fragment = document.createDocumentFragment();
    for (const item of data) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.append(fileInfo(item.nome_arquivo, `${when(item.criado_em)} · ${item.quantidade_cartoes} cartões · ${(item.tamanho_bytes / 1024).toFixed(0)} KB`));
      row.append(downloadButton(item));
      fragment.append(row);
    }
    target.append(fragment);
  }

  function downloadButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = 'Baixar CDF';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Baixando...';
      try {
        let path = item.caminho_storage;
        if (!path) {
          const { data, error } = await client.from('cdf_arquivos').select('caminho_storage').eq('id', item.arquivo_id || item.id).single();
          if (error) throw error;
          path = data.caminho_storage;
        }
        const { data, error } = await client.storage.from(BUCKET).download(path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.nome_arquivo;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        alert(`Não foi possível baixar: ${error.message || error}`);
      } finally {
        button.disabled = false;
        button.textContent = 'Baixar CDF';
      }
    });
    return button;
  }

  function parseCardEndings(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length || xml.documentElement.localName !== 'CDFTransmissionFile')
      throw new Error('XML inválido ou formato CDF não reconhecido');
    const cards = new Set();
    for (const account of xml.getElementsByTagName('AccountEntity')) {
      const trailing = account.getAttribute('AccountNumber')?.trim().match(/[0-9]+$/)?.[0] || '';
      if (trailing.length >= 4) cards.add(trailing.slice(-8));
    }
    return [...cards];
  }

  async function sha256(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function uploadOne(file) {
    if (!/\.(cdf|xml)$/i.test(file.name)) throw new Error('use .cdf ou .xml');
    if (file.size > MAX_BYTES) throw new Error('arquivo maior que 12 MB');
    if (!file.size) throw new Error('arquivo vazio');
    const bytes = await file.arrayBuffer();
    const endings = parseCardEndings(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!endings.length) throw new Error('nenhum cartão localizado no CDF');
    const digest = await sha256(bytes);
    const { data: existing, error: checkError } = await client.from('cdf_arquivos')
      .select('id').eq('sha256', digest).limit(1);
    if (checkError) throw checkError;
    if (existing.length) return 'duplicado';

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const path = `${currentUser.id}/${crypto.randomUUID()}/${safeName}`;
    const { error: storageError } = await client.storage.from(BUCKET).upload(path, file, {
      contentType: 'application/xml', upsert: false
    });
    if (storageError) throw storageError;
    let fileId = null;
    try {
      const { data, error } = await client.from('cdf_arquivos').insert({
        usuario_id: currentUser.id, nome_arquivo: file.name, caminho_storage: path,
        tamanho_bytes: file.size, quantidade_cartoes: endings.length, sha256: digest
      }).select('id').single();
      if (error) throw error;
      fileId = data.id;
      for (let offset = 0; offset < endings.length; offset += 400) {
        const rows = endings.slice(offset, offset + 400).map((ending) => ({
          arquivo_id: fileId, usuario_id: currentUser.id, final_cartao: ending
        }));
        const { error: indexError } = await client.from('cdf_cartoes').insert(rows);
        if (indexError) throw indexError;
      }
      return 'enviado';
    } catch (error) {
      if (fileId) await client.from('cdf_arquivos').delete().eq('id', fileId);
      await client.storage.from(BUCKET).remove([path]);
      throw error;
    }
  }

  async function uploadFiles(fileList) {
    if (uploading || !currentUser) return;
    const files = [...fileList].filter((f) => /\.(cdf|xml)$/i.test(f.name));
    if (!files.length) { message('upload-status', 'Nenhum arquivo .cdf ou .xml selecionado.', true); return; }
    uploading = true;
    $('upload-progress').hidden = false;
    $('upload-progress-bar').style.width = '0%';
    for (const id of ['folder-button', 'files-button']) $(id).disabled = true;
    let saved = 0, duplicated = 0;
    const failures = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        message('upload-status', `Enviando ${i + 1} de ${files.length}: ${file.name}`);
        try {
          const result = await uploadOne(file);
          if (result === 'duplicado') duplicated++;
          else saved++;
        } catch (error) {
          failures.push(`${file.name}: ${error.message || error}`);
        }
        $('upload-progress-bar').style.width = `${Math.round((i + 1) / files.length * 100)}%`;
      }
      message('upload-status', `${saved} enviado(s), ${duplicated} já existente(s), ${failures.length} com erro.${failures.length ? '\n' + failures.slice(0, 8).join('\n') : ''}`, failures.length > 0);
      await listFiles();
    } finally {
      uploading = false;
      for (const id of ['folder-button', 'files-button']) $(id).disabled = false;
      $('upload-progress').hidden = true;
    }
  }

  async function search() {
    const digits = $('digits').value.trim();
    if (!/^[0-9]{4,8}$/.test(digits)) return;
    const target = $('results');
    target.replaceChildren(empty('Pesquisando...'));
    const { data, error } = await client.rpc('buscar_arquivos_por_final', { p_final: digits });
    if (error) {
      target.replaceChildren(empty(`Falha na pesquisa: ${error.message}`));
      $('result-count').textContent = '—';
      return;
    }
    target.replaceChildren();
    $('result-count').textContent = `${data.length} ${data.length === 1 ? 'arquivo' : 'arquivos'}`;
    if (!data.length) { target.append(empty('Nenhum arquivo contém esse final de cartão.')); return; }
    const fragment = document.createDocumentFragment();
    for (const item of data) {
      const row = document.createElement('div');
      row.className = 'result-item';
      row.append(fileInfo(item.nome_arquivo, when(item.criado_em)));
      const actions = document.createElement('div');
      actions.className = 'result-actions';
      const count = document.createElement('span');
      count.className = 'match';
      count.textContent = `${item.correspondencias} ${item.correspondencias === 1 ? 'cartão' : 'cartões'}`;
      actions.append(count, downloadButton(item));
      row.append(actions);
      fragment.append(row);
    }
    target.append(fragment);
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('login-button').disabled = true;
    message('login-status', 'Entrando...');
    const { data, error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('login-button').disabled = false;
    if (error) { message('login-status', `Não foi possível entrar: ${error.message}`, true); return; }
    $('password').value = '';
    await showWorkspace(data.user);
  });
  $('logout').addEventListener('click', async () => {
    await client.auth.signOut();
    await showWorkspace(null);
  });
  $('search-form').addEventListener('submit', (event) => { event.preventDefault(); if ($('digits').reportValidity()) search(); });
  $('digits').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 8); });
  $('refresh-button').addEventListener('click', listFiles);
  $('folder-button').addEventListener('click', () => $('folder-input').click());
  $('files-button').addEventListener('click', () => $('files-input').click());
  for (const id of ['folder-input', 'files-input']) {
    $(id).addEventListener('change', (event) => {
      if (event.target.files.length) uploadFiles(event.target.files);
      event.target.value = '';
    });
  }
  const drop = $('drop-zone');
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('drag-over'); });
  for (const type of ['dragleave', 'drop']) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove('drag-over'); });
  drop.addEventListener('drop', (event) => { if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files); });

  client.auth.getUser().then(({ data, error }) => {
    if (error && !/session missing/i.test(error.message)) message('login-status', error.message, true);
    showWorkspace(data?.user || null);
  }).catch((error) => { $('login-view').hidden = false; message('login-status', error.message, true); });
})();
