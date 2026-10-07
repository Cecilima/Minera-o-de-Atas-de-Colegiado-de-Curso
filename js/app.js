(function(){
"use strict";

/* ============================================================
   ICONS (inline, no emoji)
============================================================ */
const ICONS = {
  eye: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"/><circle cx="10" cy="10" r="2.3"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15V6h8Z"/></svg>',
  close: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  info: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7.3"/><path d="M10 9v5" stroke-linecap="round"/><circle cx="10" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg>',
  warn: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.5 18 16H2L10 2.5Z"/><path d="M10 8v3.5" stroke-linecap="round"/><circle cx="10" cy="13.6" r=".9" fill="currentColor" stroke="none"/></svg>',
  archive: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M4.5 8.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"/><path d="M10 13h4"/></svg>'
};

/* ============================================================
   STATE
============================================================ */
const state = {
  atas:[], chatHistory:[], activeView:'arquivo',
  sortKey:'uploadedAt', sortDir:'desc'
};

/* ============================================================
   PERSISTÊNCIA LOCAL
============================================================ */
const STORAGE_KEY = 'arquivo-atas-colegiado:v1';
function loadAtasFromStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ console.error('Falha ao ler localStorage', e); return []; }
}
function saveAtasToStorage(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.atas)); }
  catch(e){ console.error('Falha ao salvar no localStorage', e); toast('Não foi possível guardar os dados localmente.', true); }
}

const QUESTION_SUGGESTIONS = [
  "Quais encaminhamentos não têm responsável definido?",
  "Resuma os principais assuntos discutidos até agora",
  "Quais prazos vencem em breve?",
  "Quais problemas foram relatados com mais frequência?"
];

// Lista única de stopwords (definida em js/extractor.js) — evita duas listas divergentes.
const STOPWORDS = AtaExtractor.STOPWORDS;

/* ============================================================
   BOOTSTRAP
============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  bindStaticUI();
  updateClock();
  state.atas = loadAtasFromStorage();
  renderAll();
});

/* ============================================================
   STATIC UI
============================================================ */
function bindStaticUI(){
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  const dz = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  dz.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value=''; });
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e=>{e.preventDefault(); dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e=>{e.preventDefault(); dz.classList.remove('drag');}));
  dz.addEventListener('drop', e=>{ if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  document.getElementById('search-input').addEventListener('input', e=>{
    document.getElementById('global-search-input').value = e.target.value;
    renderAtaTable();
  });
  document.getElementById('global-search-input').addEventListener('input', e=>{
    document.getElementById('search-input').value = e.target.value;
    renderAtaTable();
  });
  document.getElementById('export-btn').addEventListener('click', exportData);

  document.querySelectorAll('table.index-table thead th[data-key]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(state.sortKey === key){ state.sortDir = state.sortDir==='asc'?'desc':'asc'; }
      else{ state.sortKey = key; state.sortDir = 'asc'; }
      renderAtaTable();
    });
  });

  document.getElementById('drawer-backdrop').addEventListener('click', e=>{ if(e.target.id==='drawer-backdrop') closeDrawer(); });

  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('input', ()=>{ chatInput.style.height='44px'; chatInput.style.height=Math.min(120,chatInput.scrollHeight)+'px'; });
  chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); submitQuestion(); } });
  document.getElementById('chat-send').addEventListener('click', submitQuestion);

  document.getElementById('resp-search-input').addEventListener('input', renderResponsaveis);

  const sugWrap = document.getElementById('chat-suggestions');
  QUESTION_SUGGESTIONS.forEach(q=>{
    const b = document.createElement('button');
    b.textContent = q;
    b.addEventListener('click', ()=>{ document.getElementById('chat-input').value=q; submitQuestion(); });
    sugWrap.appendChild(b);
  });
}

function updateClock(){
  const el = document.getElementById('hero-clock');
  el.textContent = new Date().toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
}

function switchView(view){
  state.activeView = view;
  document.querySelectorAll('.tab-btn').forEach(b=> b.setAttribute('aria-selected', String(b.dataset.view===view)));
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('active', v.id==='view-'+view));

  if(view==='painel') renderDashboard();
  if(view==='responsaveis') renderResponsaveis();
}

/* ============================================================
   TOOLTIP HELPERS
============================================================ */
function showTooltip(evt, html){
  const t = document.getElementById('tooltip');
  t.innerHTML = html;
  t.classList.add('show');
  moveTooltip(evt);
}
function moveTooltip(evt){
  const t = document.getElementById('tooltip');
  const x = evt.clientX, y = evt.clientY;
  t.style.left = Math.min(x+14, window.innerWidth-260)+'px';
  t.style.top = Math.max(y-10, 10)+'px';
}
function hideTooltip(){ document.getElementById('tooltip').classList.remove('show'); }

/* ============================================================
   FILE HANDLING + EXTRACTION
============================================================ */
async function handleFiles(fileList){
  const files = Array.from(fileList).filter(f=>{
    const n = f.name.toLowerCase();
    return n.endsWith('.pdf') || n.endsWith('.txt') || f.type==='application/pdf' || f.type==='text/plain';
  });
  if(!files.length){ toast('Selecione ficheiros PDF ou TXT.', true); return; }
  for(const file of files){ await processFile(file); }
}

async function processFile(file){
  const pendingId = 'pending-'+Math.random().toString(36).slice(2);
  addPendingRow(pendingId, file.name);
  try{
    const text = await extractText(file);
    if(!text || text.trim().length < 20) throw Object.assign(new Error('texto vazio'), {code:'empty_text'});
    const analysis = await analyzeText(text, file.name);
    const doc = {
      filename:file.name, uploadedAt:new Date().toISOString(),
      data:analysis.data||null, reuniao:analysis.reuniao||null,
      textExcerpt:text.slice(0,20000), charCount:text.length,
      analysis:packAnalysis(analysis),
      status: analysis.degraded ? 'parcial' : 'concluido'
    };
    doc.id = 'local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    state.atas.unshift(doc);
    saveAtasToStorage();
    renderAll();
    toast('"'+file.name+'" processada com sucesso.');
  }catch(e){
    console.error(e);
    toast('Falha ao processar "'+file.name+'": '+(e.message||e.code||'erro desconhecido'), true);
  }finally{ removePendingRow(pendingId); }
}

function packAnalysis(an){
  return {versao:an.versao, assuntos:an.assuntos, assuntosDetalhe:an.assuntosDetalhe,
    decisoes:an.decisoes, encaminhamentos:an.encaminhamentos, problemas:an.problemas,
    demandas:an.demandas, sugestoes:an.sugestoes, termosRecorrentes:an.termosRecorrentes,
    participantes:an.participantes, estrutura:an.estrutura};
}

async function extractText(file){
  const isPdf = file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if(isPdf) return extractPdfText(file);
  return await file.text();
}
async function extractPdfText(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  let out=''; const maxPages = Math.min(pdf.numPages, 80);
  for(let i=1;i<=maxPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstrói as LINHAS usando a posição vertical (y) de cada trecho. Sem isso, títulos,
    // itens numerados e tabelas se perdem — e a detecção de estrutura fica impossível.
    // Lacunas horizontais grandes viram TAB (colunas de tabela).
    let line='', lastY=null, lastEnd=null;
    content.items.forEach(it=>{
      if(!it.str && !it.hasEOL) return;
      const y = it.transform[5], x = it.transform[4], h = it.height || 10;
      if(lastY!==null && Math.abs(y-lastY) > h*0.6){ out += line.trimEnd()+'\n'; line=''; lastEnd=null; }
      if(lastEnd!==null && line){ const gap = x-lastEnd; line += gap > h*3 ? '\t' : (/\s$/.test(line)||/^\s/.test(it.str) ? '' : ' '); }
      line += it.str;
      lastY = y; lastEnd = x + (it.width||0);
    });
    out += line.trimEnd()+'\n\n';
  }
  return out;
}

/* ============================================================
   ANÁLISE
============================================================ */
async function analyzeText(text, filename){
  // Toda a lógica de extração vive em js/extractor.js (testável fora do navegador).
  return AtaExtractor.extract(text, {filename});
}

/* ============================================================
   RENDER: banners / hero / table
============================================================ */
function renderBanners(){
  const el = document.getElementById('banners');
  if(!state.atas.length){
    el.innerHTML = '<div class="banner">'+ICONS.info+'<div><strong>Como funciona:</strong> a extração de assuntos, decisões, encaminhamentos, responsáveis e prazos é feita localmente no navegador, por estrutura do texto e padrões linguísticos (sem IA externa) — os ficheiros não são enviados para nenhum servidor. Cada item mostra um nível de confiança; revise sempre os resultados na tela de detalhe.</div></div>';
  }else{
    el.innerHTML = '';
  }
}

function renderAll(){
  renderHero();
  renderAtaTable();
  renderDashboard();
  renderBanners();
}

function renderHero(){
  const list = document.getElementById('hero-now-list');
  const pulse = document.getElementById('hero-pulse');
  const lbl = document.getElementById('hero-lbl-text');
  const pending = document.querySelectorAll('#ata-tbody tr.pending').length;
  if(pending>0){
    lbl.textContent = 'A PROCESSAR';
    pulse.style.display='block';
  }else{
    lbl.textContent = 'RESUMO DO ARQUIVO';
    pulse.style.display = 'none';
  }
  if(!state.atas.length){ list.innerHTML = '<div class="now-empty">Nenhuma ata enviada ainda.</div>'; return; }
  const decisions = state.atas.reduce((n,a)=>n+(a.analysis?.decisoes||[]).length,0);
  const encs = state.atas.reduce((n,a)=>n+(a.analysis?.encaminhamentos||[]).length,0);
  list.innerHTML = [
    ['n', state.atas.length, 'atas no arquivo'],
    ['n', decisions, 'decisões registadas'],
    ['n', encs, 'encaminhamentos registados']
  ].map(([,n,l])=>'<div class="now-row"><span class="n">'+n+'</span><span class="l">'+l+'</span></div>').join('');
}

function addPendingRow(id, name){
  const tbody = document.getElementById('ata-tbody');
  const tr = document.createElement('tr');
  tr.className = 'pending'; tr.id = id;
  tr.innerHTML = '<td colspan="7"><div class="processing-flag"><span class="spin"></span> a analisar <strong>'+escapeHtml(name)+'</strong>…</div></td>';
  tbody.prepend(tr);
  renderHero();
}
function removePendingRow(id){ document.getElementById(id)?.remove(); renderHero(); if(!document.getElementById('ata-tbody').children.length) renderAtaTable(); }

function sortedFilteredAtas(){
  const q = (document.getElementById('search-input').value||'').toLowerCase().trim();
  let items = state.atas.filter(a=>{
    if(!q) return true;
    const hay = [a.filename, a.reuniao, (a.analysis?.assuntos||[]).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const key = state.sortKey, dir = state.sortDir==='asc'?1:-1;
  items = items.slice().sort((a,b)=> compareSortValues(sortValue(a,key), sortValue(b,key), dir));
  return items;
}
function sortValue(a, key){
  if(key==='decisoes') return (a.analysis?.decisoes||[]).length;
  if(key==='encaminhamentos') return (a.analysis?.encaminhamentos||[]).length;
  return a[key];
}
function compareSortValues(va, vb, dir){
  const aEmpty = va===null || va===undefined || va==='';
  const bEmpty = vb===null || vb===undefined || vb==='';
  if(aEmpty && bEmpty) return 0;
  if(aEmpty) return 1;
  if(bEmpty) return -1;
  if(typeof va==='number' && typeof vb==='number') return dir*(va-vb);
  return dir*String(va).localeCompare(String(vb), 'pt-BR', {sensitivity:'base', numeric:true});
}

function renderAtaTable(){
  document.querySelectorAll('table.index-table thead th[data-key]').forEach(th=>{
    const isSorted = th.dataset.key===state.sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.sort-arrow').textContent = isSorted ? (state.sortDir==='asc'?'▲':'▼') : '▲';
  });

  const items = sortedFilteredAtas();
  document.getElementById('filter-count').textContent = items.length+' de '+state.atas.length+' ata(s)';
  const tbody = document.getElementById('ata-tbody');

  if(!items.length){
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">'+ICONS.archive.replace('viewBox="0 0 24 24" width="26" height="26"','viewBox="0 0 24 24" width="24" height="24"')+
      '<div class="t">'+(state.atas.length ? 'Nenhuma ata corresponde ao filtro' : 'Arquivo vazio')+'</div>'+
      '<div class="d">'+(state.atas.length ? 'Ajuste a busca.' : 'Envie um PDF ou TXT acima para começar.')+'</div></div></td></tr>';
    return;
  }

  tbody.innerHTML = '';
  items.forEach(a=>{
    const decCount = (a.analysis?.decisoes||[]).length;
    const encCount = (a.analysis?.encaminhamentos||[]).length;
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="nome-cell"><span class="nm">'+escapeHtml(a.filename)+'</span><span class="sub">'+escapeHtml(a.reuniao||'Reunião não identificada')+'</span></td>'+
      '<td>'+escapeHtml(a.reuniao||'—')+'</td>'+
      '<td>'+(a.data ? '<span class="sec-tag date">'+fmtDate(a.data)+'</span>' : '<span class="sec-tag">sem data</span>')+
        (a.status==='parcial' ? ' <span class="sec-tag warn" title="Extração básica">parcial</span>' : '')+'</td>'+
      '<td class="count-cell">'+decCount+'</td>'+
      '<td class="count-cell">'+encCount+'</td>'+
      '<td class="sub" style="color:var(--slate);">'+fmtDateShort(a.uploadedAt)+'</td>'+
      '<td><div class="row-actions">'+
        '<button class="icon-btn" data-action="view" title="Ver detalhes">'+ICONS.eye+'</button>'+
        '<button class="icon-btn" data-action="del" title="Excluir">'+ICONS.trash+'</button>'+
      '</div></td>';
    tr.addEventListener('click', e=>{
      const action = e.target.closest('[data-action]')?.dataset.action;
      if(action==='del'){ e.stopPropagation(); deleteAta(a); return; }
      openDrawer(a);
    });
    tbody.appendChild(tr);
  });
}

function deleteAta(a){
  if(!confirm('Excluir "'+a.filename+'" do arquivo? Esta ação não pode ser desfeita.')) return;
  try{
    state.atas = state.atas.filter(x=>x.id!==a.id);
    saveAtasToStorage();
    renderAll();
    toast('Ata excluída.');
  }catch(e){ toast('Não foi possível excluir: '+(e.message||e), true); }
}

/* ============================================================
   DRAWER
============================================================ */
const TIPO_PRAZO = {data:'data', periodo:'período', evento:'evento', reuniao:'reunião', indefinido:'sem data definida'};
const descOf = x => (typeof x==='string' ? x : (x && x.descricao) || '');
function respList(item){
  if(item.responsaveis && item.responsaveis.length) return item.responsaveis;
  return item.responsavel ? [{nome:item.responsavel, cargo:item.cargo||null}] : [];
}
function respLabel(item){ return respList(item).map(r=>r.nome+(r.cargo?' ('+r.cargo+')':'')).join(' e '); }
function confChip(x){
  if(x.confianca==null) return '';
  const lv = AtaExtractor.level(x.confianca);
  return '<span class="conf conf-'+(lv==='média'?'media':lv)+'" title="Confiança da extração: '+Math.round(x.confianca*100)+'%">confiança '+lv+'</span>';
}
function prazoLabel(x){
  if(!x.prazo) return '';
  let t = 'prazo / referência: '+escapeHtml(x.prazo)+(x.prazoTipo && TIPO_PRAZO[x.prazoTipo] ? ' ['+TIPO_PRAZO[x.prazoTipo]+']' : '');
  if(x.prazoData && x.prazoData!==x.prazo && !x.prazo.includes(x.prazoData)) t += ' · data associada: '+escapeHtml(x.prazoData);
  return '<span>'+t+'</span>';
}
function itemCard(x, chipClass, chipLabel){
  const resp = respLabel(x);
  return '<div class="item-card"><span class="chip '+chipClass+'">'+chipLabel+'</span>'+confChip(x)+
    (x.decidido?'<span class="conf" title="A frase registra uma decisão que atribui uma ação">decidido</span>':'')+
    '<div class="desc" style="margin-top:7px;">'+escapeHtml(descOf(x))+'</div>'+
    (x.acao?'<div class="acao"><b>Ação:</b> '+escapeHtml(x.acao)+'</div>':'')+
    '<div class="tags">'+
      (resp?'<span>responsável: '+escapeHtml(resp)+'</span>':'')+prazoLabel(x)+
      (x.proponente?'<span>proposto por: '+escapeHtml(x.proponente)+'</span>':'')+
      (x.assunto?'<span>assunto: '+escapeHtml(x.assunto)+'</span>':'')+
    '</div>'+
    (x.contexto?'<div class="ctx">Inclui a frase anterior, necessária para entender a decisão.</div>':'')+
    (x.gatilho?'<div class="ctx">detectado por: «'+escapeHtml(x.gatilho)+'»</div>':'')+
  '</div>';
}

function reanalyzeAta(id){
  const a = state.atas.find(x=>x.id===id);
  if(!a) return;
  const an = AtaExtractor.extract(a.textExcerpt||'', {filename:a.filename});
  a.analysis = packAnalysis(an);
  a.data = an.data || a.data; a.reuniao = an.reuniao || a.reuniao;
  a.status = an.degraded ? 'parcial' : 'concluido';
  saveAtasToStorage(); renderAll(); openDrawer(a);
  toast('Ata reanalisada.');
}

function openDrawer(a){
  const d = document.getElementById('drawer');
  const an = a.analysis || {};
  const listOrEmpty = (arr, render) => arr && arr.length ? arr.map(render).join('') : '<p class="muted">Nada identificado.</p>';
  const isLegacy = !an.versao;
  const canReanalyze = isLegacy && a.textExcerpt && a.textExcerpt.length >= (a.charCount||0);

  const respMap = new Map();
  const prazos = [];
  [...(an.decisoes||[]), ...(an.encaminhamentos||[])].forEach(item=>{
    respList(item).forEach(r=>{ if(!respMap.has(r.nome)) respMap.set(r.nome, r.cargo); });
    if(item.prazo) prazos.push(item);
  });

  const subj = an.assuntosDetalhe || [];
  let subjHtml;
  if(subj.length){
    subjHtml = '<ul class="subj-list">'+subj.map(x=>'<li><span>'+escapeHtml(x.titulo)+'</span>'+
      '<span class="why">'+escapeHtml(x.origem||'')+' · confiança '+x.nivel+'</span>'+
      (x.procedural?'<span class="proc">procedimental</span>':'')+'</li>').join('')+'</ul>';
  }else if(an.assuntos && an.assuntos.length){
    subjHtml = '<div class="tag-list">'+an.assuntos.map(t=>'<span class="tag">'+escapeHtml(t)+'</span>').join('')+'</div>';
  }else{
    subjHtml = '<p class="muted">Não identificado com segurança. A ata não traz pauta, títulos ou frases introdutórias reconhecíveis, e o sistema não inventa assuntos a partir de palavras frequentes.</p>';
  }

  const termos = an.termosRecorrentes||[];
  d.innerHTML =
    '<div class="drawer-head">'+
      '<button class="icon-btn drawer-close" id="drawer-close">'+ICONS.close+'</button>'+
      '<div class="dh-kicker">DETALHE DA ATA</div>'+
      '<h3>'+escapeHtml(a.reuniao || a.filename)+'</h3>'+
      '<div class="dh-meta">'+escapeHtml(a.filename)+' · '+(a.data ? fmtDate(a.data) : 'data não identificada')+' · enviada a '+fmtDateTime(a.uploadedAt)+
        (an.estrutura ? ' · estrutura: '+escapeHtml(an.estrutura.tipo) : '')+'</div>'+
    '</div>'+
    '<div class="drawer-body">'+
      (isLegacy ? '<div class="drawer-note">Esta ata foi analisada por uma versão anterior do extrator (assuntos baseados em palavras frequentes). '+
        (canReanalyze ? 'Clique para reanalisar com a lógica atual.<br><button class="btn" id="reanalyze-btn">Reanalisar esta ata</button>' : 'Reenvie o ficheiro para obter a análise atual.')+'</div>' : '')+
      '<h5>Assuntos</h5>'+subjHtml+
      '<h5>Responsáveis citados</h5><div class="tag-list">'+
        (respMap.size ? Array.from(respMap).map(([n,c])=>'<span class="tag" style="background:var(--teal-soft);color:var(--teal-deep);">'+escapeHtml(n)+(c?' · '+escapeHtml(c):'')+'</span>').join('') : '<p class="muted">Nenhum responsável identificado.</p>')+
      '</div>'+
      '<h5>Prazos e referências temporais</h5><div class="tag-list">'+
        (prazos.length ? prazos.map(p=>'<span class="tag" style="background:var(--amber-soft);color:var(--amber-deep);">'+escapeHtml(p.prazo)+(p.prazoData && !p.prazo.includes(p.prazoData)?' → '+escapeHtml(p.prazoData):'')+'</span>').join('') : '<p class="muted">Nenhum prazo ou referência temporal identificado.</p>')+
      '</div>'+
      '<h5>Decisões ('+(an.decisoes?an.decisoes.length:0)+')</h5>'+
      listOrEmpty(an.decisoes, x=>itemCard(x,'dec','DECISÃO'))+
      '<h5>Encaminhamentos ('+(an.encaminhamentos?an.encaminhamentos.length:0)+')</h5>'+
      listOrEmpty(an.encaminhamentos, x=>itemCard(x,'enc','ENCAM.'))+
      '<h5>Problemas ('+(an.problemas?an.problemas.length:0)+')</h5>'+
      listOrEmpty(an.problemas, x=>itemCard(typeof x==='string'?{descricao:x}:x,'prob','PROBLEMA'))+
      '<h5>Demandas ('+(an.demandas?an.demandas.length:0)+')</h5>'+
      listOrEmpty(an.demandas, x=>itemCard(x,'dem','DEMANDA'))+
      '<h5>Sugestões e propostas — não deliberadas ('+(an.sugestoes?an.sugestoes.length:0)+')</h5>'+
      listOrEmpty(an.sugestoes, x=>itemCard(x,'sug',x.tipo==='proposta'?'PROPOSTA':'SUGESTÃO'))+
      '<h5>Termos recorrentes</h5><div class="tag-list">'+
        (termos.length ? termos.map(t=>'<span class="tag">'+escapeHtml(t.termo)+' · '+t.contagem+'</span>').join('') : '<p class="muted">Nada identificado.</p>')+
      '</div>'+
      '<h5>Texto extraído</h5><details><summary>Mostrar texto</summary><div class="raw-text" style="margin-top:10px;">'+escapeHtml((a.textExcerpt||'').slice(0,20000))+'</div></details>'+
    '</div>';

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  const rb = document.getElementById('reanalyze-btn');
  if(rb) rb.addEventListener('click', ()=>reanalyzeAta(a.id));
  document.getElementById('drawer-backdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){ document.getElementById('drawer-backdrop').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }

/* ============================================================
   RESPONSÁVEIS
============================================================ */
function buildResponsaveis(atas){
  const map = {};
  atas.forEach(a=>{
    const an = a.analysis||{};
    const seen = new Set();   // uma decisão que atribui ação aparece nas duas listas: conta só uma vez por pessoa
    const addItem = (item, tipo) => {
      respList(item).forEach(r=>{
        const nome = (r.nome||'').trim(); if(!nome) return;
        const key = nome.toLowerCase();
        const dk = key+'|'+descOf(item).slice(0,100);
        if(seen.has(dk)) return; seen.add(dk);
        if(!map[key]) map[key] = {nome, decisoes:[], encaminhamentos:[]};
        map[key][tipo].push(Object.assign({ata:a.filename, data:a.data, reuniao:a.reuniao}, item));
      });
    };
    (an.decisoes||[]).forEach(d=>addItem(d,'decisoes'));
    (an.encaminhamentos||[]).forEach(d=>addItem(d,'encaminhamentos'));
  });
  return Object.values(map).sort((x,y)=>
    (y.decisoes.length+y.encaminhamentos.length) - (x.decisoes.length+x.encaminhamentos.length)
    || x.nome.localeCompare(y.nome,'pt-BR',{sensitivity:'base'}));
}

function renderResponsaveis(){
  const q = (document.getElementById('resp-search-input').value||'').toLowerCase().trim();
  const all = buildResponsaveis(state.atas);
  const list = q ? all.filter(r=>r.nome.toLowerCase().includes(q)) : all;
  document.getElementById('resp-filter-count').textContent = list.length+' de '+all.length+' responsável(is)';

  const el = document.getElementById('resp-content');
  if(!state.atas.length){
    el.innerHTML = '<div class="empty-state">'+ICONS.archive+'<div class="t">Nenhuma ata enviada</div><div class="d">Envie atas na aba Arquivo para identificar responsáveis.</div></div>';
    return;
  }
  if(!all.length){
    el.innerHTML = '<div class="empty-state">'+ICONS.archive+'<div class="t">Nenhum responsável identificado</div><div class="d">As atas enviadas não mencionam responsáveis de forma explícita.</div></div>';
    return;
  }
  if(!list.length){
    el.innerHTML = '<div class="empty-state">'+ICONS.archive+'<div class="t">Nenhum resultado</div><div class="d">Ajuste a busca.</div></div>';
    return;
  }
  el.innerHTML = '<div class="resp-grid">'+list.map((r,i)=>{
    const pendentes = r.decisoes.filter(d=>!d.prazo).length + r.encaminhamentos.filter(d=>!d.prazo).length;
    return '<div class="resp-card" data-i="'+i+'">'+
      '<div class="resp-name">'+escapeHtml(r.nome)+'</div>'+
      '<div class="resp-stats">'+
        '<div class="resp-stat"><span class="n">'+r.decisoes.length+'</span><span class="l">DECISÕES</span></div>'+
        '<div class="resp-stat"><span class="n">'+r.encaminhamentos.length+'</span><span class="l">ENCAM.</span></div>'+
      '</div>'+
      (pendentes>0 ? '<div class="resp-pending">'+pendentes+' item(ns) sem prazo ou referência temporal</div>' : '<div class="resp-ok">todos os itens com prazo</div>')+
    '</div>';
  }).join('')+'</div>';

  el.querySelectorAll('.resp-card').forEach(card=>{
    card.addEventListener('click', ()=> openRespDrawer(list[+card.dataset.i]));
  });
}

function openRespDrawer(r){
  const d = document.getElementById('drawer');
  const renderItems = (items, chipClass, chipLabel) => items.length ? items.map(it=>
    '<div class="item-card"><span class="chip '+chipClass+'">'+chipLabel+'</span><div class="desc" style="margin-top:7px;">'+escapeHtml(it.descricao)+'</div>'+
    (it.acao?'<div class="acao"><b>Ação:</b> '+escapeHtml(it.acao)+'</div>':'')+'<div class="tags"><span>'+escapeHtml(it.ata)+(it.data?' · '+fmtDate(it.data):'')+'</span>'+(it.prazo?prazoLabel(it):'<span>sem prazo</span>')+'</div></div>'
  ).join('') : '<p class="muted">Nenhum item.</p>';

  d.innerHTML =
    '<div class="drawer-head">'+
      '<button class="icon-btn drawer-close" id="drawer-close">'+ICONS.close+'</button>'+
      '<div class="dh-kicker">RESPONSÁVEL</div>'+
      '<h3>'+escapeHtml(r.nome)+'</h3>'+
      '<div class="dh-meta">'+r.decisoes.length+' decisão(ões) · '+r.encaminhamentos.length+' encaminhamento(s)</div>'+
    '</div>'+
    '<div class="drawer-body">'+
      '<h5>Decisões</h5>'+renderItems(r.decisoes,'dec','DECISÃO')+
      '<h5>Encaminhamentos</h5>'+renderItems(r.encaminhamentos,'enc','ENCAM.')+
    '</div>';

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}

/* ============================================================
   EXPORT
============================================================ */
function exportData(){
  if(!state.atas.length){ toast('Não há dados para exportar ainda.', true); return; }
  const payload = state.atas.map(a=>({filename:a.filename, reuniao:a.reuniao, data:a.data, uploadedAt:a.uploadedAt, analysis:a.analysis}));
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='atas-analise.json'; a.click();
  URL.revokeObjectURL(url);
  toast('Download iniciado.');
}

/* ============================================================
   DASHBOARD AGGREGATION
============================================================ */
function monthKey(iso){ if(!iso) return null; const d = new Date(iso.length===10 ? iso+'T12:00:00Z' : iso); if(isNaN(d)) return null; return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'); }
function monthLabel(key){ const [y,m]=key.split('-'); const d=new Date(Date.UTC(+y,+m-1,1)); return d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'}).replace('.',''); }

function themeFrequency(atas){
  const map = {};
  atas.forEach(a=> (a.analysis?.assuntos||[]).forEach(t=>{ const k=t.trim().toLowerCase(); if(!k || AtaExtractor.isProceduralSubject(t)) return; map[k]=map[k]||{label:t.trim(),count:0}; map[k].count++; }));
  return Object.values(map).sort((a,b)=>b.count-a.count);
}
function decisionsByPeriod(atas){
  const map = {};
  atas.forEach(a=>{ const mo=monthKey(a.data||a.uploadedAt); if(!mo) return; map[mo]=(map[mo]||0)+(a.analysis?.decisoes||[]).length; });
  const months = Object.keys(map).sort();
  return {months, counts: months.map(m=>map[m])};
}
function encaminhamentosPerAta(atas){
  const withData = atas.filter(a=>(a.analysis?.encaminhamentos||[]).length>0).sort((a,b)=>(b.analysis.encaminhamentos.length)-(a.analysis.encaminhamentos.length)).slice(0,10);
  return {labels:withData.map(a=>a.filename.length>18?a.filename.slice(0,16)+'…':a.filename), counts:withData.map(a=>a.analysis.encaminhamentos.length)};
}
function buildNetwork(atas, maxNodes){
  const freq = themeFrequency(atas).slice(0,maxNodes);
  const nodeKeys = freq.map(f=>f.label.toLowerCase());
  const edgeMap = {};
  atas.forEach(a=>{
    const present = (a.analysis?.assuntos||[]).map(t=>t.trim().toLowerCase()).filter(t=>nodeKeys.includes(t));
    for(let i=0;i<present.length;i++) for(let j=i+1;j<present.length;j++){ const key=[present[i],present[j]].sort().join('|'); edgeMap[key]=(edgeMap[key]||0)+1; }
  });
  const edges = Object.entries(edgeMap).map(([k,w])=>{ const [s,t]=k.split('|'); return {source:s,target:t,weight:w}; }).sort((a,b)=>b.weight-a.weight).slice(0,50);
  return {nodes:freq, edges};
}
function allDecisionsTimeline(atas){
  const rows = [];
  atas.forEach(a=> (a.analysis?.decisoes||[]).forEach(d=> rows.push({date:a.data, descricao:d.descricao, responsavel:d.responsavel, prazo:d.prazo, ata:a.filename, reuniao:a.reuniao})));
  rows.sort((a,b)=>{ const x=a.date||'9999', y=b.date||'9999'; return x<y?-1:(x>y?1:0); });
  return rows;
}

/* ============================================================
   DASHBOARD RENDER
============================================================ */
function renderDashboard(){
  const has = state.atas.length>0;
  document.getElementById('painel-empty').style.display = has? 'none':'block';
  document.getElementById('painel-content').style.display = has? 'block':'none';
  if(!has) return;
  renderKpiRow();
  renderHtmlCharts();
  renderTimeline();
  renderNetwork();
}

function renderKpiRow(){
  const atas = state.atas;
  const decisions = atas.reduce((n,a)=>n+(a.analysis?.decisoes||[]).length,0);
  const encs = atas.reduce((n,a)=>n+(a.analysis?.encaminhamentos||[]).length,0);
  const themes = themeFrequency(atas).length;
  const dates = atas.map(a=>a.data).filter(Boolean).sort();
  const period = dates.length ? fmtDate(dates[0])+' – '+fmtDate(dates[dates.length-1]) : '—';
  const cards = [['Atas analisadas', atas.length], ['Decisões registadas', decisions], ['Encaminhamentos', encs], ['Temas distintos', themes], ['Período coberto', period]];
  document.getElementById('kpi-row').innerHTML = cards.map(([l,n])=> '<div class="kpi"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
}

/* ============================================================
   RENDER BARRA LARANJA (cor padrão do painel)
============================================================ */
const BAR_ORANGE = '#E1A03C';        // laranja principal (--amber)

function renderHtmlBarChart(containerId, dataArray, colorHex = BAR_ORANGE) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!dataArray || !dataArray.length) {
        el.innerHTML = '<p class="muted">Sem dados.</p>';
        return;
    }
    const max = Math.max(...dataArray.map(d => d.count), 1);
    el.innerHTML = dataArray.map((d, i) => {
        const pct = Math.max(2, Math.round((d.count / max) * 100)); // min 2% para ficar visível
        return `
            <div class="rank-row" data-i="${i}">
                <span class="name" title="${escapeHtml(d.label)}">${escapeHtml(d.label)}</span>
                <span class="bar-bg"><span class="bar-fill" style="width:${pct}%; background:${colorHex};"></span></span>
                <span class="n">${d.count}</span>
            </div>
        `;
    }).join('');
}

function renderHtmlCharts(){
    // Todas as barras do painel saem em LARANJA (--amber)
    const freq = themeFrequency(state.atas);

    renderHtmlBarChart('chart-freq-html', freq.slice(0, 5), BAR_ORANGE);
    renderHtmlBarChart('rank-list', freq.slice(0, 10), BAR_ORANGE);

    const dec = decisionsByPeriod(state.atas);
    const decData = dec.months.map((m, i) => ({ label: monthLabel(m), count: dec.counts[i] }));
    renderHtmlBarChart('chart-decisions-html', decData, BAR_ORANGE);

    const enc = encaminhamentosPerAta(state.atas);
    const encData = enc.labels.map((l, i) => ({ label: l, count: enc.counts[i] }));
    renderHtmlBarChart('chart-encaminhamentos-html', encData, BAR_ORANGE);

    const elEvo = document.getElementById('chart-evolution-html');
    if(elEvo) {
        const months = Array.from(new Set(state.atas.map(a=>monthKey(a.data||a.uploadedAt)).filter(Boolean))).sort();
        if(!months.length) {
            elEvo.innerHTML = '<p class="muted">Sem dados.</p>';
        } else {
            let evoHtml = '';
            months.forEach(mo => {
                const atasDoMes = state.atas.filter(a => monthKey(a.data||a.uploadedAt) === mo);
                const topTemas = themeFrequency(atasDoMes).slice(0, 2);
                const desc = topTemas.length ? topTemas.map(f => f.label + ' (' + f.count + ')').join(', ') : 'Nenhum tema isolado';
                evoHtml += `<div class="rank-row" style="grid-template-columns: 80px 1fr 0;">
                    <span class="name" style="font-weight:700;">${monthLabel(mo)}</span>
                    <span class="name" style="color:var(--slate);">${escapeHtml(desc)}</span>
                </div>`;
            });
            elEvo.innerHTML = evoHtml;
        }
    }
}

function renderTimeline(){
  const rows = allDecisionsTimeline(state.atas);
  const el = document.getElementById('timeline');
  if(!rows.length){ el.innerHTML = '<p class="muted">Nenhuma decisão identificada ainda.</p>'; return; }
  el.innerHTML = rows.map(r=>
    '<div class="tl-item"><div class="tl-date">'+(r.date?fmtDate(r.date):'SEM DATA')+'</div>'+
    '<div class="tl-desc">'+escapeHtml(r.descricao)+'</div>'+
    '<div class="tl-source">'+escapeHtml(r.ata)+(r.responsavel?' · responsável: '+escapeHtml(r.responsavel):'')+(r.prazo?' · prazo: '+escapeHtml(r.prazo):'')+'</div></div>'
  ).join('');
}

function renderNetwork(){
  const {nodes, edges} = buildNetwork(state.atas, 14);
  const wrap = document.getElementById('network');
  if(nodes.length < 2){ wrap.innerHTML = '<p class="network-empty">É preciso mais de um tema em comum entre atas para desenhar a rede.</p>'; return; }

  const W=520,H=420,cx=W/2,cy=H/2,r=Math.min(W,H)/2-70;
  const pos = {};
  nodes.forEach((n,i)=>{ const ang=(i/nodes.length)*2*Math.PI - Math.PI/2; pos[n.label.toLowerCase()] = {x:cx+r*Math.cos(ang), y:cy+r*Math.sin(ang)}; });
  const maxW = Math.max(1, ...edges.map(e=>e.weight));
  const maxC = Math.max(1, ...nodes.map(n=>n.count));

  let svg = '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">';
  edges.forEach(e=>{
    const s=pos[e.source], t=pos[e.target]; if(!s||!t) return;
    svg += '<line x1="'+s.x+'" y1="'+s.y+'" x2="'+t.x+'" y2="'+t.y+'" stroke="var(--teal)" stroke-opacity="'+(0.15+0.55*e.weight/maxW)+'" stroke-width="'+(1+2.5*e.weight/maxW)+'"/>';
  });
  nodes.forEach((n,i)=>{
    const p = pos[n.label.toLowerCase()];
    const rad = 5+9*n.count/maxC;
    svg += '<circle class="net-node" data-i="'+i+'" cx="'+p.x+'" cy="'+p.y+'" r="'+rad+'" fill="var(--amber-deep)" fill-opacity="0.9"/>';
    const anchor = p.x>cx+8?'start':(p.x<cx-8?'end':'middle');
    const dx = p.x>cx+8?rad+5:(p.x<cx-8?-(rad+5):0);
    const dy = p.y<cy-8?-(rad+3): (p.y>cy+8? rad+13 : 4);
    svg += '<text x="'+(p.x+dx)+'" y="'+(p.y+dy)+'" font-size="11" font-family="Manrope, sans-serif" font-weight="600" fill="var(--ink)" text-anchor="'+anchor+'">'+escapeHtml(n.label)+'</text>';
  });
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.net-node').forEach(node=>{
    const i = +node.dataset.i;
    node.addEventListener('mousemove', e=>{ showTooltip(e, '<b>'+escapeHtml(nodes[i].label)+'</b><br>'+nodes[i].count+' ata(s)'); });
    node.addEventListener('mouseleave', hideTooltip);
  });
}

/* ============================================================
   CONSULTA / CHAT INTELIGENTE
============================================================ */
function allItems(){
  const rows = [];
  state.atas.forEach(a=>{
    const an = a.analysis||{};
    const add = (list, tipo) => (list||[]).forEach(item=>{
      const it = typeof item==='string' ? {descricao:item} : item;
      rows.push({a, tipo, item:it});
    });
    add(an.decisoes,'decisão'); add(an.encaminhamentos,'encaminhamento'); add(an.problemas,'problema');
    add(an.demandas,'demanda'); add(an.sugestoes,'sugestão');
  });
  return rows;
}
function fmtRow(r, extra){
  const it = r.item;
  const resp = respLabel(it);
  return '• ['+r.a.filename+'] '+descOf(it)+(extra||'')+(resp?'\n  Responsável: '+resp:'');
}
const norm = s => AtaExtractor.fold(s||'');
const cut = (arr, n) => arr.slice(0,n).join('\n\n') + (arr.length>n ? '\n\n(Exibindo '+n+' de '+arr.length+')' : '');

function answerLocally(question){
  const q = norm(question);
  const rows = allItems();
  const acoes = rows.filter(r=>r.tipo==='decisão' || r.tipo==='encaminhamento');

  // ordem importa: "sem prazo" e "sem responsável" antes de "prazo"/"responsável"
  if (/(?:nao\s+tem|nao\s+tem|sem|ainda\s+nao\s+tem)\s+(?:um\s+)?prazo|sem\s+prazo|nao\s+definid\w*\s+prazo/.test(q)) {
    const res = acoes.filter(r=>r.tipo==='encaminhamento' || /decis/.test(q)).filter(r=>!r.item.prazo);
    return res.length ? 'Itens sem prazo nem referência temporal identificados:\n\n'+cut(res.map(r=>fmtRow(r)),10)
                      : 'Todos os encaminhamentos identificados possuem algum prazo ou referência temporal.';
  }
  if (/(?:nao\s+tem|sem)\s+responsavel|sem\s+responsavel|nao\s+(?:tem|possui)\s+(?:um\s+)?responsavel/.test(q)) {
    const res = acoes.filter(r=>(/decis/.test(q) ? true : r.tipo==='encaminhamento') && respList(r.item).length===0);
    return res.length ? 'Itens sem responsável identificado:\n\n'+cut(res.map(r=>fmtRow(r)),10)
                      : 'Todos os itens consultados têm responsável identificado.';
  }
  if (/prazo|vence|vencem|quando|data\s+limite|ate\s+quando/.test(q)) {
    const today = new Date().toISOString().slice(0,10);
    const withP = acoes.filter(r=>r.item.prazo);
    if(!withP.length) return 'Não encontrei prazos ou referências temporais nas atas enviadas.';
    const iso = r => r.item.prazoISO || null;
    const upcoming = withP.filter(r=>iso(r) && iso(r)>=today).sort((x,y)=>iso(x)<iso(y)?-1:1);
    const past = withP.filter(r=>iso(r) && iso(r)<today);
    const relative = withP.filter(r=>!iso(r));
    const line = r => fmtRow(r, '\n  Prazo/referência: '+r.item.prazo+(r.item.prazoData && !r.item.prazo.includes(r.item.prazoData)?' ('+r.item.prazoData+')':''));
    let out = '';
    if(upcoming.length) out += 'Com data a vencer (mais próximos primeiro):\n\n'+cut(upcoming.map(line),6)+'\n\n';
    if(relative.length) out += 'Com referência relativa (sem data exata):\n\n'+cut(relative.map(line),6)+'\n\n';
    if(past.length) out += past.length+' item(ns) têm data já passada.';
    return out.trim();
  }
  if (/resum|principais\s+assunto|quais\s+assuntos|assuntos\s+(?:discutid|trat|recorrent)/.test(q)) {
    const freq = themeFrequency(state.atas).slice(0, 6);
    if(freq.length) return 'Assuntos mais frequentes nas atas (excluindo itens procedimentais como "Informes"):\n\n' + freq.map(f => `• ${f.label} (${f.count} ata(s))`).join('\n');
    return 'Ainda não há assuntos identificados com segurança nas atas enviadas.';
  }
  const byTipo = (tipo, titulo, vazio) => {
    const res = rows.filter(r=>r.tipo===tipo);
    return res.length ? titulo+'\n\n'+cut(res.map(r=>fmtRow(r)),8) : vazio;
  };
  if (/demanda|solicit|pedid|necessidade/.test(q)) return byTipo('demanda','Demandas e necessidades registradas:','Não identifiquei demandas explícitas nas atas.');
  if (/sugest|proposta|ideia/.test(q)) return byTipo('sugestão','Sugestões e propostas (ainda não deliberadas):','Não identifiquei sugestões ou propostas nas atas.');
  if (/problema|dificuldade|reclama|preocupa/.test(q)) {
    const res = rows.filter(r=>r.tipo==='problema');
    if(!res.length) return 'Não identifiquei problemas explícitos nas atas.';
    const porAssunto = {};
    res.forEach(r=>{ const k=r.item.assunto||'Sem assunto identificado'; porAssunto[k]=(porAssunto[k]||0)+1; });
    const rank = Object.entries(porAssunto).sort((x,y)=>y[1]-x[1]).slice(0,5).map(([k,n])=>`• ${k}: ${n}`).join('\n');
    return 'Problemas relatados, por assunto:\n\n'+rank+'\n\nOcorrências:\n\n'+cut(res.map(r=>fmtRow(r)),6);
  }
  if (/decis|deliber|aprov/.test(q)) return byTipo('decisão','Decisões registradas:','Não identifiquei decisões nas atas.');
  if (/encaminh|acao|acoes|tarefa/.test(q)) return byTipo('encaminhamento','Encaminhamentos registrados:','Não identifiquei encaminhamentos nas atas.');

  // quem é responsável / o que cabe a <nome>
  const qWords = new Set((q.match(/[a-z0-9]+/g)||[]).filter(w=>w.length>2 && !STOPWORDS.has(w)));
  if(!qWords.size) return 'Tente reformular a pergunta com palavras mais específicas (ex: "prazo", "assunto", "responsável").';
  const hits = [];
  rows.forEach(r=>{
    const hay = norm(descOf(r.item)+' '+respLabel(r.item)+' '+(r.item.assunto||'')+' '+(r.item.acao||''));
    let score=0; qWords.forEach(w=>{ if(hay.includes(w)) score++; });
    if(score>0) hits.push({r, score});
  });
  hits.sort((x,y)=>y.score-x.score);
  if(!hits.length) return 'Não encontrei trechos relacionados. Tente usar termos que apareçam literalmente no texto ou use os botões de sugestão.';
  return 'Encontrei os seguintes trechos relacionados nas atas:\n\n'+cut(hits.map(h=>'['+h.r.tipo+'] '+fmtRow(h.r, h.r.a.data?'\n  Data da ata: '+fmtDate(h.r.a.data):'').replace(/^• /,'')),8);
}

function submitQuestion(){
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if(!question) return;
  input.value=''; input.style.height='44px';
  if(!state.atas.length){ addChatMsg('assistant','Envie ao menos uma ata antes de fazer perguntas.'); return; }
  document.getElementById('chat-empty').style.display='none';
  addChatMsg('user', question);
  const answer = answerLocally(question);
  addChatMsg('assistant', answer);
  state.chatHistory.push({role:'user', content:question});
  state.chatHistory.push({role:'assistant', content:answer});
  scrollChatToEnd();
}
function addChatMsg(role, text, loading){
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'msg '+role+(loading?' loading':'');
  div.textContent = text;
  log.appendChild(div); scrollChatToEnd();
  return div;
}
function scrollChatToEnd(){ const log=document.getElementById('chat-log'); log.scrollTop = log.scrollHeight; }

/* ============================================================
   UTIL
============================================================ */
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(iso){ const d = new Date(iso.length===10?iso+'T12:00:00Z':iso); if(isNaN(d)) return iso; return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}); }
function fmtDateShort(iso){ const d = new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}); }
function fmtDateTime(iso){ const d = new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function toast(msg, isErr){
  const stack = document.getElementById('toast-stack');
  const t = document.createElement('div');
  t.className = 'toast'+(isErr?' err':'');
  t.innerHTML = (isErr?ICONS.warn:ICONS.info)+'<span>'+escapeHtml(msg)+'</span>';
  stack.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 4200);
}

})();