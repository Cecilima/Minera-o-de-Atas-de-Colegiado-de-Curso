(function(){
"use strict";

/* ============================================================
   ICONS (inline, no emoji)
============================================================ */
const ICONS = {
  eye: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"/><circle cx="10" cy="10" r="2.3"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15V6h8Z"/></svg>',
  help: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7.3"/><path d="M7.9 7.6a2.2 2.2 0 1 1 3.1 2c-.7.3-1 .8-1 1.5v.4"/><circle cx="10" cy="14.2" r=".9" fill="currentColor" stroke="none"/></svg>',
  close: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  info: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7.3"/><path d="M10 9v5" stroke-linecap="round"/><circle cx="10" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg>',
  warn: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.5 18 16H2L10 2.5Z"/><path d="M10 8v3.5" stroke-linecap="round"/><circle cx="10" cy="13.6" r=".9" fill="currentColor" stroke="none"/></svg>',
  book: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 5.2C8.4 4 6.2 3.6 3 3.8v11.4c3.2-.2 5.4.2 7 1.4 1.6-1.2 3.8-1.6 7-1.4V3.8c-3.2-.2-5.4.2-7 1.4Z"/><path d="M10 5.2v11.4"/></svg>',
  arrowLeft: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10H4m0 0 5-5m-5 5 5 5"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/></svg>',
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
  dz.addEventListener('keydown', e => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fileInput.click(); } });
  document.addEventListener('keydown', e => {
    if(e.key!=='Escape') return;
    if(closeConfHelp()) return;
    if(document.getElementById('reader')?.classList.contains('open')) closeReader();
    else if(document.getElementById('drawer').classList.contains('open')) closeDrawer();
  });
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
  document.getElementById('help-btn').addEventListener('click', openConfHelp);
  document.getElementById('banners').addEventListener('click', e=>{ if(e.target.closest('[data-conf-help]')) openConfHelp(); });

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
  // vários ficheiros: um único aviso de resumo no fim (os erros continuam a aparecer um a um)
  const quiet = files.length > 1;
  let ok = 0;
  for(const file of files){ if(await processFile(file, quiet)) ok++; }
  if(quiet && ok) toast(ok+' de '+files.length+' atas processadas com sucesso.');
}

async function processFile(file, quiet){
  const pendingId = 'pending-'+Math.random().toString(36).slice(2);
  addPendingRow(pendingId, file.name);
  try{
    const res = await extractText(file, ev=>updatePendingRow(pendingId, file.name, ev));
    const text = res.text;
    if(!text || text.replace(/\s/g,'').length < 20){
      const why = res.ocrErro ? 'o PDF parece digitalizado e o reconhecimento de texto (OCR) não pôde ser carregado: '+res.ocrErro
                              : 'nenhum texto encontrado no ficheiro (nem por OCR)';
      throw Object.assign(new Error(why), {code:'empty_text'});
    }
    if((res.semTexto||[]).length) toast('"'+file.name+'": '+res.semTexto.length+' página(s) sem texto legível'+(res.ocrErro?' (OCR indisponível)':'')+'. O restante foi analisado.', true);
    const extra = { layout: res.layout || null, ocr: res.ocr || [] };
    updatePendingRow(pendingId, file.name, {fase:'analise'});
    const analysis = await analyzeText(text, file.name, extra);
    const doc = {
      filename:file.name, uploadedAt:new Date().toISOString(),
      data:analysis.data||null, reuniao:analysis.reuniao||null,
      dataOrigem:analysis.dataOrigem||null, reuniaoOrigem:analysis.reuniaoOrigem||null,
      layout: extra.layout, ocr: extra.ocr, paginas: res.paginas||null,
      textExcerpt:text.slice(0,20000), charCount:text.length,
      analysis:packAnalysis(analysis),
      status: analysis.degraded ? 'parcial' : 'concluido'
    };
    doc.id = 'local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    state.atas.unshift(doc);
    saveAtasToStorage();
    renderAll();
    if(!quiet) toast('"'+file.name+'" processada com sucesso'+(extra.ocr.length ? ' (texto de '+extra.ocr.length+' página(s) obtido por OCR).' : '.'));
    return true;
  }catch(e){
    console.error(e);
    toast('Falha ao processar "'+file.name+'": '+(e.message||e.code||'erro desconhecido'), true);
    return false;
  }finally{ removePendingRow(pendingId); }
}

function packAnalysis(an){
  return {versao:an.versao, assuntos:an.assuntos, assuntosDetalhe:an.assuntosDetalhe,
    decisoes:an.decisoes, encaminhamentos:an.encaminhamentos, problemas:an.problemas,
    demandas:an.demandas, sugestoes:an.sugestoes, sugestoesDeliberadas:an.sugestoesDeliberadas, termosRecorrentes:an.termosRecorrentes,
    participantes:an.participantes, presenca:an.presenca, estrutura:an.estrutura, avisos:an.avisos||[],
    dataOrigem:an.dataOrigem||null, reuniaoOrigem:an.reuniaoOrigem||null};
}

/* Texto + pistas de layout (negrito, fonte maior, parágrafos) e OCR para páginas digitalizadas.
   Tudo no navegador: ver js/pdftext.js. */
async function extractText(file, onProgress){
  const isPdf = file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if(!isPdf) return { text: await file.text(), layout: null, ocr: [] };
  const buf = await file.arrayBuffer();
  return AtaPdf.extract(pdfjsLib, buf, { maxPages: 80, onProgress });
}

/* ============================================================
   ANÁLISE
============================================================ */
async function analyzeText(text, filename, extra){
  // Toda a lógica de extração vive em js/extractor.js (testável fora do navegador).
  return AtaExtractor.extract(text, Object.assign({filename}, extra||{}));
}

/* ============================================================
   RENDER: banners / hero / table
============================================================ */
function renderBanners(){
  const el = document.getElementById('banners');
  if(!state.atas.length){
    el.innerHTML = '<div class="banner">'+ICONS.info+'<div><strong>Como funciona:</strong> a extração de assuntos, decisões, encaminhamentos, responsáveis e prazos é feita localmente no navegador, por estrutura do texto e padrões linguísticos (sem IA externa) — os ficheiros não são enviados para nenhum servidor. Cada item mostra um <b>nível de confiança</b>: o quanto o sistema considera segura a própria classificação (não a importância do item nem a confiabilidade da ata). <button type="button" class="link-btn" data-conf-help>Saiba mais</button></div></div>';
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
  tr.innerHTML = '<td colspan="6"><div class="processing-flag"><span class="spin"></span> a analisar <strong>'+escapeHtml(name)+'</strong>…</div></td>';
  tbody.prepend(tr);
  renderHero();
}
function updatePendingRow(id, name, ev){
  const tr = document.getElementById(id); if(!tr || !ev) return;
  let msg = 'a analisar <strong>'+escapeHtml(name)+'</strong>…';
  if(ev.fase==='texto') msg = 'a ler <strong>'+escapeHtml(name)+'</strong> · página '+ev.pagina+' de '+ev.total+'…';
  if(ev.fase==='ocr-carregando') msg = '<strong>'+escapeHtml(name)+'</strong> parece digitalizado · a carregar o reconhecimento de texto (OCR)…';
  if(ev.fase==='ocr') msg = 'OCR em <strong>'+escapeHtml(name)+'</strong> · página '+ev.pagina+' ('+ev.atual+' de '+ev.paginasOcr+' digitalizadas)'+(ev.progresso!=null ? ' · '+Math.round(ev.progresso*100)+'%' : '')+'…';
  if(ev.fase==='analise') msg = 'a identificar decisões, encaminhamentos e prazos em <strong>'+escapeHtml(name)+'</strong>…';
  const fl = tr.querySelector('.processing-flag'); if(fl) fl.innerHTML = '<span class="spin"></span> '+msg;
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
  document.getElementById('filter-count').textContent = state.atas.length ? (items.length===state.atas.length ? state.atas.length+' ata(s)' : items.length+' de '+state.atas.length+' ata(s)') : '';
  renderArquivoNote();
  const tbody = document.getElementById('ata-tbody');

  if(!items.length){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><div class="empty-state">'+ICONS.archive.replace('viewBox="0 0 24 24" width="26" height="26"','viewBox="0 0 24 24" width="24" height="24"')+
      '<div class="t">'+(state.atas.length ? 'Nenhuma ata corresponde ao filtro' : 'Arquivo vazio')+'</div>'+
      '<div class="d">'+(state.atas.length ? 'Ajuste a busca.' : 'Envie um PDF ou TXT em “Enviar atas” para começar.')+'</div></div></td></tr>';
    return;
  }

  tbody.innerHTML = '';
  items.forEach(a=>{
    const decCount = (a.analysis?.decisoes||[]).length;
    const encCount = (a.analysis?.encaminhamentos||[]).length;
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.setAttribute('aria-label', 'Abrir detalhes de '+(a.reuniao||a.filename));
    tr.innerHTML =
      // a reunião é o que identifica a ata; o nome do ficheiro fica como referência secundária
      '<td class="nome-cell"><span class="nm">'+escapeHtml(a.reuniao||'Reunião não identificada')+'</span><span class="sub">'+escapeHtml(a.filename)+'</span></td>'+
      '<td class="c-data">'+(a.data ? '<span class="sec-tag date'+(a.dataOrigem==='nome do ficheiro'?' from-name':'')+'"'+(a.dataOrigem==='nome do ficheiro'?' title="Data obtida do nome do ficheiro (o texto da ata não traz a data)"':'')+'>'+fmtDate(a.data)+(a.dataOrigem==='nome do ficheiro'?' *':'')+'</span>' : '<span class="sec-tag">sem data</span>')+
        ((a.ocr||[]).length ? '<span class="sec-tag ocr" title="Texto de '+a.ocr.length+' página(s) obtido por OCR">OCR</span>' : '')+
        (a.status==='parcial' ? '<span class="sec-tag warn" title="Nenhuma decisão ou encaminhamento identificado">parcial</span>' : '')+'</td>'+
      '<td class="count-cell" data-label="decisões">'+decCount+'</td>'+
      '<td class="count-cell" data-label="encam.">'+encCount+'</td>'+
      '<td class="c-env" data-label="enviada">'+fmtDateShort(a.uploadedAt)+'</td>'+
      '<td class="c-act"><div class="row-actions">'+
        '<button class="icon-btn" data-action="read" title="Ler o texto da ata" aria-label="Ler o texto da ata">'+ICONS.book+'</button>'+
        '<button class="icon-btn" data-action="view" title="Ver detalhes" aria-label="Ver detalhes">'+ICONS.eye+'</button>'+
        '<button class="icon-btn danger" data-action="del" title="Excluir" aria-label="Excluir ata">'+ICONS.trash+'</button>'+
      '</div></td>';
    tr.addEventListener('click', e=>{
      const action = e.target.closest('[data-action]')?.dataset.action;
      if(action==='del'){ e.stopPropagation(); deleteAta(a); return; }
      if(action==='read'){ e.stopPropagation(); openReader(a); return; }
      openDrawer(a);
    });
    tr.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target===tr){ e.preventDefault(); openDrawer(a); } });
    tbody.appendChild(tr);
  });
}

function renderArquivoNote(){
  const el = document.getElementById('arquivo-note');
  if(!el) return;
  if(!state.atas.length){ el.textContent = 'nenhuma ata ainda'; return; }
  const last = state.atas.reduce((m,a)=> a.uploadedAt > m ? a.uploadedAt : m, '');
  el.textContent = state.atas.length+' ata(s) · última enviada em '+fmtDateShort(last);
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
const TIPO_ENT = {pessoa:'pessoa', orgao:'órgão/grupo', cargo:'cargo', papel:'papel genérico'};
const clipText = (t,n) => { t=String(t||''); return t.length>n ? t.slice(0,n).replace(/\s+\S*$/,'')+'…' : t; };
const descOf = x => (typeof x==='string' ? x : (x && x.descricao) || '');
function respList(item){
  if(item.responsaveis && item.responsaveis.length) return item.responsaveis;
  return item.responsavel ? [{nome:item.responsavel, cargo:item.cargo||null}] : [];
}
function respLabel(item){
  // item.responsavel já preserva a conjunção original ("Coordenação ou Direção")
  if(item.responsavel) return item.responsavel + (item.cargo && respList(item).length===1 ? ' ('+item.cargo+')' : '');
  return respList(item).map(r=>r.nome+(r.cargo?' ('+r.cargo+')':'')).join(' e ');
}
/* ---------- NÍVEL DE CONFIANÇA ----------
   Significa SÓ a segurança da classificação automática feita pelo sistema —
   não a importância do item, nem a confiabilidade ou veracidade da ata. */
const CONF_LEVELS = {
  alta:  { cls:'alta',  label:'Alta',  geral:'há evidências claras no texto e/ou na estrutura da ata.' },
  'média':{ cls:'media', label:'Média', geral:'existem indícios relevantes, mas a interpretação pode depender do contexto.' },
  baixa: { cls:'baixa', label:'Baixa', geral:'a identificação é mais incerta e deve ser conferida na ata original.' }
};
const KIND_PHRASE = { dec:'uma decisão', enc:'um encaminhamento', prob:'um problema', dem:'uma demanda', sug:'uma sugestão ou proposta' };
function confLevelOf(x){ return x.nivel || AtaExtractor.level(x.confianca); }
function confSentence(lv, kind){
  const k = KIND_PHRASE[kind] || 'esta informação';
  if(lv==='alta') return '<b>Alta confiança:</b> o sistema encontrou evidências claras de que este trecho representa '+k+'.';
  if(lv==='média') return '<b>Média confiança:</b> há indícios relevantes de que este trecho representa '+k+', mas a interpretação depende do contexto. Vale conferir.';
  return '<b>Baixa confiança:</b> a identificação como '+k+' é incerta. Confira o trecho na ata original antes de usar.';
}
function confChip(x, kind, ref){
  if(x.confianca==null) return '';
  const lv = confLevelOf(x), L = CONF_LEVELS[lv] || CONF_LEVELS.baixa;
  const pid = 'conf-pop-'+(ref||Math.random().toString(36).slice(2)).replace(/\W/g,'-');
  const ev = x.evidencias || [];
  return '<button type="button" class="conf conf-'+L.cls+'" data-conf-toggle="'+pid+'" aria-expanded="false" aria-controls="'+pid+'" '+
      'title="'+escapeHtml(L.label+' confiança: '+L.geral+' Clique para ver o porquê.')+'">'+
      '<span class="dot" aria-hidden="true"></span>'+L.label+'<span class="visually-hidden"> confiança da classificação</span></button>'+
    '<div class="conf-pop" id="'+pid+'" hidden>'+
      '<p>'+confSentence(lv, kind)+'</p>'+
      (ev.length ? '<div class="cp-h">O que o sistema levou em conta</div><ul class="cp-ev">'+ev.map(e=>
        '<li class="ev-'+(e.sinal==='+'?'pos':(e.sinal==='=' ? 'base' : 'neg'))+'"><span class="sg" aria-hidden="true">'+(e.sinal==='='?'•':e.sinal)+'</span>'+escapeHtml(e.texto)+'</li>').join('')+'</ul>' : '')+
      '<div class="cp-foot">'+
        (ref && lv!=='alta' ? '<button type="button" class="btn btn-sm" data-focus="'+ref+'">'+ICONS.book+'Ver na ata</button>' : (ref ? '<button type="button" class="btn btn-sm btn-ghost" data-focus="'+ref+'">'+ICONS.book+'Ver na ata</button>' : ''))+
        '<button type="button" class="link-btn" data-conf-help>O que é o nível de confiança?</button>'+
      '</div>'+
    '</div>';
}

/* Explicação geral — acessível pelo "?" do cabeçalho, pela gaveta e por cada explicação */
function openConfHelp(){
  let dlg = document.getElementById('conf-help');
  if(!dlg){
    dlg = document.createElement('div');
    dlg.id = 'conf-help'; dlg.className = 'help-backdrop';
    dlg.innerHTML =
      '<div class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="conf-help-title">'+
        '<button class="icon-btn help-close" aria-label="Fechar">'+ICONS.close+'</button>'+
        '<div class="dh-kicker">AJUDA</div>'+
        '<h3 id="conf-help-title">Sobre o nível de confiança</h3>'+
        '<p>O nível de confiança indica o quanto o sistema considera segura a <b>classificação</b> de uma informação encontrada na ata, por exemplo se um trecho é mesmo uma decisão ou um encaminhamento.</p>'+
        '<ul class="help-levels">'+
          ['alta','média','baixa'].map(k=>'<li><span class="conf conf-'+CONF_LEVELS[k].cls+' static"><span class="dot" aria-hidden="true"></span>'+CONF_LEVELS[k].label+'</span><span>'+CONF_LEVELS[k].geral.charAt(0).toUpperCase()+CONF_LEVELS[k].geral.slice(1)+'</span></li>').join('')+
        '</ul>'+
        '<p class="help-important"><b>Importante:</b> o nível de confiança não indica a importância da informação nem a confiabilidade da ata. Ele representa apenas a segurança da análise automática realizada pelo sistema.</p>'+
        '<h4>Como o nível é calculado</h4>'+
        '<p>Não basta uma palavra-chave. O sistema combina:</p>'+
        '<ul class="help-list">'+
          '<li><b>evidência no texto</b>: construções que registram de fato uma decisão ("foi aprovada", "deliberou-se"), uma obrigação ("deverá…") ou um pedido ("solicitou…");</li>'+
          '<li><b>estrutura da ata</b>: o trecho está no bloco de um item da pauta, sob um rótulo como "Decisão:" ou numa tabela de ações;</li>'+
          '<li><b>contexto da frase</b>: relatos ("informou que…"), hipóteses ("talvez", "a definir") e condições ("caso…") reduzem a confiança;</li>'+
          '<li><b>relação com o assunto</b> do bloco e <b>consistência</b> entre as evidências (responsável e prazo identificados, resultado de votação…).</li>'+
        '</ul>'+
        '<p>Quando a evidência é insuficiente, o trecho <b>não é classificado</b>. Clique no nível de qualquer item para ver as evidências usadas e, se quiser, abrir o trecho no texto da ata.</p>'+
      '</div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e=>{ if(e.target===dlg || e.target.closest('.help-close')) closeConfHelp(); });
  }
  dlg._ret = document.activeElement;
  dlg.classList.add('open');
  dlg.querySelector('.help-close').focus();
}
function closeConfHelp(){
  const dlg = document.getElementById('conf-help');
  if(!dlg || !dlg.classList.contains('open')) return false;
  dlg.classList.remove('open');
  if(dlg._ret && document.contains(dlg._ret)) dlg._ret.focus();
  return true;
}

function prazoLabel(x){
  if(!x.prazo) return '';
  let t = 'prazo / referência: '+escapeHtml(x.prazo)+(x.prazoTipo && TIPO_PRAZO[x.prazoTipo] ? ' ['+TIPO_PRAZO[x.prazoTipo]+']' : '');
  if(x.prazoData && x.prazoData!==x.prazo && !x.prazo.includes(x.prazoData)) t += ' · data associada: '+escapeHtml(x.prazoData);
  return '<span>'+t+'</span>';
}
function itemCard(x, chipClass, chipLabel, ref){
  const resp = respLabel(x);
  const lv = x.confianca!=null ? confLevelOf(x) : null;
  return '<div class="item-card'+(lv==='baixa'?' is-low':'')+'"><div class="ic-head"><span class="chip '+chipClass+'">'+chipLabel+'</span>'+confChip(x, chipClass, ref)+'</div>'+
    (x.decidido?'<span class="tag-mini" title="A frase registra uma decisão que atribui uma ação">decidido</span>':'')+
    (lv==='baixa' ? '<div class="low-note">Identificação incerta: confira o trecho na ata original.</div>' : '')+
    '<div class="desc" style="margin-top:7px;">'+escapeHtml(descOf(x))+'</div>'+
    (x.acao?'<div class="acao"><b>Ação:</b> '+escapeHtml(x.acao)+'</div>':'')+
    '<div class="tags">'+
      (resp?'<span>'+(x.responsavelTipo==='alternativo'?'responsável (alternativas)':'responsável')+': '+escapeHtml(resp)+'</span>':'')+prazoLabel(x)+
      (x.proponente?'<span>proposto por: '+escapeHtml(x.proponente)+'</span>':'')+
      (x.solicitante?'<span>solicitado por: '+escapeHtml(x.solicitante)+'</span>':'')+
      (x.assunto?'<span>assunto: '+escapeHtml(x.assunto)+(x.subassunto?' › '+escapeHtml(x.subassunto):'')+'</span>':'')+
      (x.relatado?'<span title="A ação aparece dentro de um relato (“informou que…”); confira no texto">dentro de relato</span>':'')+
    '</div>'+
    (x.origemProposta?'<div class="ctx">Delibera a '+(x.origemProposta.tipo==='proposta'?'proposta':'sugestão')+' anterior ('+escapeHtml(x.origemProposta.resultado)+'): «'+escapeHtml(clipText(x.origemProposta.descricao,160))+'»</div>':'')+
    (x.relacao&&x.relacao.tipo?'<div class="ctx">relação: '+escapeHtml(x.relacao.tipo)+(x.relacao.decisao?' — «'+escapeHtml(clipText(x.relacao.decisao,110))+'»':'')+(x.relacao.evidencia?' · evidência: '+escapeHtml(x.relacao.evidencia):'')+'</div>':'')+
    (x.situacao&&x.situacao!=='pendente'?'<div class="ctx">situação: '+escapeHtml(x.situacao)+'</div>':'')+
    (x.detalhes&&x.detalhes.length?'<div class="ctx"><b>Regras decorrentes (parte da decisão):</b><ul style="margin:4px 0 0 16px;padding:0;">'+x.detalhes.map(d=>'<li>'+escapeHtml(clipText(d.descricao,200))+'</li>').join('')+'</ul></div>':'')+
    (x.contexto?'<div class="ctx">Inclui a frase anterior, necessária para entender a decisão.</div>':'')+
    ((x.referencias||[]).some(r=>r.papel==='contexto')?'<div class="ctx">referências temporais de contexto (não são prazo): '+
      x.referencias.filter(r=>r.papel==='contexto').map(r=>'«'+escapeHtml(r.texto)+'»').join(', ')+'</div>':'')+
    (x.gatilho?'<div class="ctx">detectado por: «'+escapeHtml(x.gatilho)+'»'+(x.fonte?' · fonte: '+escapeHtml(x.fonte):'')+'</div>':'')+
  '</div>';
}

function reanalyzeAta(id){
  const a = state.atas.find(x=>x.id===id);
  if(!a) return;
  const an = AtaExtractor.extract(a.textExcerpt||'', {filename:a.filename, layout:a.layout||null, ocr:a.ocr||[]});
  a.analysis = packAnalysis(an);
  a.data = an.data || a.data; a.reuniao = an.reuniao || a.reuniao;
  a.dataOrigem = an.dataOrigem || null; a.reuniaoOrigem = an.reuniaoOrigem || null;
  a.status = an.degraded ? 'parcial' : 'concluido';
  saveAtasToStorage(); renderAll(); openDrawer(a);
  toast('Ata reanalisada.');
}

function openDrawer(a){
  const d = document.getElementById('drawer');
  const an = a.analysis || {};
  const listOrEmpty = (arr, render) => arr && arr.length ? arr.map((x,i)=>render(x,i)).join('') : '<p class="muted">Nada identificado.</p>';
  const isLegacy = !an.versao || an.versao < AtaExtractor.VERSION;
  const canReanalyze = isLegacy && a.textExcerpt && a.textExcerpt.length >= (a.charCount||0);

  const respMap = new Map();
  const prazos = [];
  [...(an.decisoes||[]), ...(an.encaminhamentos||[])].forEach(item=>{
    respList(item).forEach(r=>{ if(!respMap.has(r.nome)) respMap.set(r.nome, [r.cargo, r.tipo]); });
    if(item.prazo) prazos.push(item);
  });

  const subj = an.assuntosDetalhe || [];
  let subjHtml;
  if(subj.length){
    // O título é CONTEÚDO; origem e confiança são METADADOS — ficam em elemento próprio, com rótulo,
    // e fora da seleção de texto (copiar o título nunca leva "numeração · confiança" junto).
    subjHtml = '<ul class="subj-list">'+subj.map(x=>{
      const meta = 'origem: '+(x.origem||'—')+' · confiança '+(x.nivel||'—');
      // aqui a confiança é a segurança de que este trecho é mesmo um ASSUNTO da ata (pela forma como foi encontrado)
      // metadados via data-meta + CSS ::before → nunca fazem parte do texto copiado/selecionado
      return '<li><span class="subj-title">'+escapeHtml(x.titulo)+'</span>'+
        '<span class="why meta" role="note" aria-label="'+escapeHtml(meta)+'" title="'+escapeHtml('Origem: '+(x.origem||'—')+'. Confiança '+(x.nivel||'—')+': segurança de que este é um assunto da ata, pela forma como foi encontrado (pauta, item numerado, título…).')+'" data-meta="'+escapeHtml(meta)+'"></span>'+
        (x.procedural?'<span class="proc meta" data-meta="procedimental"></span>':'')+
        (x.subtopicos&&x.subtopicos.length?'<ul class="subj-sub">'+x.subtopicos.map(t=>'<li>'+escapeHtml(t)+'</li>').join('')+'</ul>':'')+'</li>';
    }).join('')+'</ul>';
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
      '<div class="dh-meta">'+escapeHtml(a.filename)+' · '+(a.data ? fmtDate(a.data)+(a.dataOrigem==='nome do ficheiro' ? ' (data obtida do nome do ficheiro)' : '') : 'data não identificada')+
        (a.reuniaoOrigem==='nome do ficheiro' ? ' · reunião identificada pelo nome do ficheiro' : '')+
        ((a.ocr||[]).length ? ' · texto de '+a.ocr.length+' página(s) por OCR' : '')+' · enviada a '+fmtDateTime(a.uploadedAt)+
        (an.estrutura ? ' · estrutura: '+escapeHtml(an.estrutura.tipo) : '')+'</div>'+
      (a.textExcerpt ? '<div class="dh-actions"><button class="btn btn-primary" data-open-reader>'+ICONS.book+'Ler o texto da ata</button></div>' : '')+
    '</div>'+
    '<div class="drawer-body">'+
      (isLegacy ? '<div class="drawer-note">Esta ata foi analisada por uma versão anterior do extrator'+(an.versao?'':' (assuntos baseados em palavras frequentes)')+'. '+
        (canReanalyze ? 'Clique para reanalisar com a lógica atual.<br><button class="btn" id="reanalyze-btn">Reanalisar esta ata</button>' : 'Reenvie o ficheiro para obter a análise atual.')+'</div>' : '')+
      ((an.avisos||[]).length ? '<div class="drawer-note">'+an.avisos.map(x=>escapeHtml(x)).join('<br>')+'</div>' : '')+
      '<div class="conf-intro">'+ICONS.info+'<span>Cada item extraído mostra o <b>nível de confiança</b> da classificação automática: <span class="conf conf-alta static"><span class="dot"></span>Alta</span> <span class="conf conf-media static"><span class="dot"></span>Média</span> <span class="conf conf-baixa static"><span class="dot"></span>Baixa</span>. Itens de média ou baixa confiança podem precisar de conferência.</span><button type="button" class="link-btn" data-conf-help>Saiba mais</button></div>'+
      '<h5>Assuntos</h5>'+subjHtml+
      (an.presenca ? '<h5>Presença</h5><p class="muted" style="margin:0;">'+an.presenca.presentes.length+' presentes · '+an.presenca.ausentes.length+' ausentes · '+an.presenca.justificadas.length+' ausências justificadas</p>' : '')+
      '<h5>Responsáveis citados</h5><div class="tag-list">'+
        (respMap.size ? Array.from(respMap).map(([n,[c,t]])=>'<span class="tag" style="background:var(--teal-soft);color:var(--teal-deep);">'+escapeHtml(n)+(c?' · '+escapeHtml(c):'')+
          (TIPO_ENT[t]?'<span class="meta" style="opacity:.7;" data-meta=" · '+TIPO_ENT[t]+'"></span>':'')+'</span>').join('') : '<p class="muted">Nenhum responsável identificado.</p>')+
      '</div>'+
      '<h5>Prazos e referências temporais</h5><div class="tag-list">'+
        (prazos.length ? prazos.map(p=>'<span class="tag" style="background:var(--amber-soft);color:var(--amber-deep);">'+escapeHtml(p.prazo)+(p.prazoData && !p.prazo.includes(p.prazoData)?' → '+escapeHtml(p.prazoData):'')+'</span>').join('') : '<p class="muted">Nenhum prazo ou referência temporal identificado.</p>')+
      '</div>'+
      '<h5>Decisões ('+(an.decisoes?an.decisoes.length:0)+')</h5>'+
      listOrEmpty(an.decisoes, (x,i)=>itemCard(x,'dec','DECISÃO','decisoes|'+i))+
      '<h5>Encaminhamentos ('+(an.encaminhamentos?an.encaminhamentos.length:0)+')</h5>'+
      listOrEmpty(an.encaminhamentos, (x,i)=>itemCard(x,'enc','ENCAM.','encaminhamentos|'+i))+
      '<h5>Problemas ('+(an.problemas?an.problemas.length:0)+')</h5>'+
      listOrEmpty(an.problemas, (x,i)=>itemCard(typeof x==='string'?{descricao:x}:x,'prob','PROBLEMA','problemas|'+i))+
      '<h5>Demandas ('+(an.demandas?an.demandas.length:0)+')</h5>'+
      listOrEmpty(an.demandas, (x,i)=>itemCard(x,'dem','DEMANDA','demandas|'+i))+
      '<h5>Sugestões e propostas — não deliberadas ('+(an.sugestoes?an.sugestoes.length:0)+')</h5>'+
      ((an.sugestoesDeliberadas&&an.sugestoesDeliberadas.length)?'<p class="muted">'+an.sugestoesDeliberadas.length+' proposta(s)/sugestão(ões) já foram deliberadas e aparecem vinculadas à decisão correspondente.</p>':'')+
      listOrEmpty(an.sugestoes, (x,i)=>itemCard(x,'sug',x.tipo==='proposta'?'PROPOSTA':'SUGESTÃO','sugestoes|'+i))+
      '<h5>Termos recorrentes</h5><div class="tag-list">'+
        (termos.length ? termos.map(t=>'<span class="tag" title="'+t.contagem+' ocorrência(s)'+(t.blocos?' em '+t.blocos+' bloco(s)':'')+'">'+escapeHtml(t.termo)+' · '+t.contagem+(t.blocos>1?' · '+t.blocos+' blocos':'')+'</span>').join('') : '<p class="muted">Nada identificado.</p>')+
      '</div>'+
      '<h5>Texto da ata</h5>'+textCard(a)+
    '</div>';

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  d.querySelectorAll('[data-open-reader]').forEach(b=>b.addEventListener('click', ()=>openReader(a)));
  // um único manipulador (a gaveta é reaproveitada a cada abertura: addEventListener acumularia)
  d.onclick = e=>{
    const tg = e.target.closest('[data-conf-toggle]');
    if(tg){
      const pop = document.getElementById(tg.dataset.confToggle);
      const open = pop.hidden;
      d.querySelectorAll('.conf-pop').forEach(p=>{ p.hidden = true; });
      d.querySelectorAll('[data-conf-toggle]').forEach(b=>b.setAttribute('aria-expanded','false'));
      pop.hidden = !open; tg.setAttribute('aria-expanded', String(open));
      return;
    }
    if(e.target.closest('[data-conf-help]')){ openConfHelp(); return; }
    const fb = e.target.closest('[data-focus]');
    if(fb){ const [k, i] = fb.dataset.focus.split('|'); openReader(a, {kind:k, index:+i}); }
  };
  const rb = document.getElementById('reanalyze-btn');
  if(rb) rb.addEventListener('click', ()=>reanalyzeAta(a.id));
  document.getElementById('drawer-backdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){ document.getElementById('drawer-backdrop').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }

/* ============================================================
   LEITURA DO TEXTO DA ATA
   O texto vindo do PDF chega quebrado linha a linha. AtaExtractor.toReadable()
   remonta parágrafos, seções (itens da pauta), listas, presença e assinaturas;
   aqui só desenhamos — com recuo por seção e tipografia de leitura.
============================================================ */
const READER_PREFS_KEY = 'arquivo-atas-colegiado:leitor';
function readerPrefs(){ try{ return Object.assign({size:18, hl:false}, JSON.parse(localStorage.getItem(READER_PREFS_KEY)||'{}')); }catch(e){ return {size:18, hl:false}; } }
function saveReaderPrefs(p){ try{ localStorage.setItem(READER_PREFS_KEY, JSON.stringify(p)); }catch(e){} }

function readingStats(nodes){
  const words = nodes.reduce((n,nd)=> n + ((nd.texto||'')+' '+(nd.titulo||'')+' '+(nd.linhas||[]).flat().join(' ')).split(/\s+/).filter(Boolean).length, 0);
  return { words, minutes: Math.max(1, Math.round(words/200)), sections: nodes.filter(n=>n.tipo==='secao').length };
}

function textCard(a){
  if(!a.textExcerpt) return '<p class="muted">O texto desta ata não foi guardado.</p>';
  const nodes = AtaExtractor.toReadable(a.textExcerpt, a.layout||null);
  const st = readingStats(nodes);
  const first = nodes.find(n=>n.tipo==='paragrafo');
  return '<div class="text-card">'+
    (first ? '<p class="tc-preview">'+escapeHtml(clipText(first.texto, 260))+'</p>' : '')+
    '<div class="tc-meta">'+st.words.toLocaleString('pt-BR')+' palavras · cerca de '+st.minutes+' min de leitura'+(st.sections ? ' · '+st.sections+' seções' : '')+'</div>'+
    '<button class="btn btn-primary" data-open-reader>'+ICONS.book+'Abrir texto formatado</button>'+
  '</div>';
}

// marca no texto as frases que viraram decisão/encaminhamento (para conferir a extração)
function highlightText(text, marks){
  const ranges = [];
  marks.forEach(m=>{
    const cands = [m.texto];
    const parts = m.texto.replace(/([.!?])\s+/g, '$1\u0000').split('\u0000');   // decisão "com contexto" junta a frase anterior
    if(parts.length > 1) cands.push(parts[parts.length-1]);
    for(const c of cands){
      const at = c.length >= 12 ? text.indexOf(c.replace(/[.!?]+$/, '')) : -1;
      if(at >= 0){ ranges.push({s:at, e:at+c.replace(/[.!?]+$/, '').length, cls:m.cls, label:m.label, key:m.key, nivel:m.nivel}); break; }
    }
  });
  ranges.sort((x,y)=>x.s-y.s);
  let out = '', pos = 0;
  ranges.forEach(r=>{
    if(r.s < pos) return;
    out += escapeHtml(text.slice(pos, r.s)) + '<mark class="hl '+r.cls+'" data-kind="'+r.label+'"'+(r.key?' data-key="'+r.key+'"':'')+' title="'+escapeHtml(r.label+(r.nivel?' · confiança '+r.nivel:''))+'">'+escapeHtml(text.slice(r.s, r.e))+'</mark>';
    pos = r.e;
  });
  return out + escapeHtml(text.slice(pos));
}

let readerReturnFocus = null;
function openReader(a, focus){
  let r = document.getElementById('reader');
  if(!r){
    r = document.createElement('div');
    r.id = 'reader'; r.className = 'reader';
    r.setAttribute('role','dialog'); r.setAttribute('aria-modal','true'); r.setAttribute('aria-labelledby','reader-title');
    document.body.appendChild(r);
  }
  const nodes = AtaExtractor.toReadable(a.textExcerpt||'', a.layout||null);
  const an = a.analysis || {};
  const MK = { decisoes:['hl-dec','decisão'], encaminhamentos:['hl-enc','encaminhamento'], demandas:['hl-dem','demanda'], problemas:['hl-prob','problema'], sugestoes:['hl-sug','sugestão'] };
  const marks = [].concat(...Object.keys(MK).map(k=>(an[k]||[]).filter(x=>x && x.descricao && x.fonte!=='título da pauta')
    .map((x,i)=>({texto:x.descricao, cls:MK[k][0], label:MK[k][1], key:k+'|'+(an[k]||[]).indexOf(x), nivel: x.nivel || (x.confianca!=null ? AtaExtractor.level(x.confianca) : '')}))));
  const prefs = readerPrefs();
  const st = readingStats(nodes);
  const truncated = (a.charCount||0) > (a.textExcerpt||'').length;

  const toc = [], html = [];
  let inSec = false, secN = 0, listOpen = false;
  const closeList = ()=>{ if(listOpen){ html.push('</ul>'); listOpen=false; } };
  const closeSec = ()=>{ closeList(); if(inSec){ html.push('</div></section>'); inSec=false; } };
  const hl = t => highlightText(t, marks);
  nodes.forEach(nd=>{
    if(nd.tipo!=='item') closeList();
    switch(nd.tipo){
      case 'titulo': html.push('<p class="r-titulo">'+escapeHtml(nd.texto)+'</p>'); break;
      case 'pauta':
        closeSec();
        html.push('<aside class="r-box r-pauta" aria-label="Pauta"><div class="r-label">Pauta</div><ol>'+
          nd.itens.map(it=>'<li value="'+(it.num||'')+'"><span class="r-pnum">'+(it.num!=null?it.num+'.':'')+'</span><span>'+escapeHtml(it.titulo)+'</span></li>').join('')+'</ol></aside>');
        break;
      case 'secao': {
        closeSec();
        const id = 'r-sec-'+(++secN);
        toc.push({id, num:nd.num, titulo:nd.titulo});
        html.push('<section class="r-sec" aria-labelledby="'+id+'"><h3 class="r-h" id="'+id+'">'+
          (nd.num!=null ? '<span class="r-num">'+nd.num+'</span>' : '')+'<span class="r-htext">'+escapeHtml(nd.titulo)+'</span></h3><div class="r-sec-body">');
        inSec = true; break;
      }
      case 'paragrafo': html.push('<p class="r-p">'+hl(nd.texto)+'</p>'); break;
      case 'subsecao': closeList(); html.push('<h4 class="r-h4"><span class="r-mk">'+escapeHtml(nd.marcador)+')</span>'+escapeHtml(nd.titulo)+'</h4>'); break;
      case 'campo': {
        const v = nd.valor || '';
        const val = /^(?:https?:\/\/|www\.)\S+$/i.test(v)
          ? '<a href="'+escapeHtml(/^www\./i.test(v)?'https://'+v:v)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(v)+'</a>' : escapeHtml(v);
        html.push('<div class="r-campo"><span class="r-crot">'+escapeHtml(nd.rotulo)+'</span><span class="r-cval">'+val+'</span></div>'); break;
      }
      case 'item':
        if(!listOpen){ html.push('<ul class="r-list">'); listOpen = true; }
        html.push('<li><span class="r-mk">'+escapeHtml(nd.marcador)+'</span><span>'+hl(nd.texto)+'</span></li>'); break;
      case 'presenca': {
        const regs = nd.registros || [];
        const cnt = st => regs.filter(r=>r.status===st).length;
        const ST = {presente:'presente', ausente:'ausente', justificada:'ausência justificada', afastado:'afastado'};
        html.push('<div class="r-box r-presenca"><div class="r-label">'+escapeHtml(nd.titulo || 'Presença')+'</div>'+
          (regs.length ? '<div class="r-pres-sum">'+cnt('presente')+' presentes · '+cnt('ausente')+' ausentes · '+cnt('justificada')+' ausências justificadas</div>'+
            '<ul class="r-pres-list">'+regs.map(r=>'<li><span>'+escapeHtml(r.nome)+'</span><span class="st st-'+r.status+'">'+ST[r.status]+'</span></li>').join('')+'</ul>' : '')+
          (nd.linhas||[]).map(l=>'<p>'+escapeHtml(l)+'</p>').join('')+'</div>');
        break;
      }
      case 'tabela':
        html.push('<div class="r-table-wrap"><table class="r-table">'+nd.linhas.map((row,k)=>'<tr>'+row.map(c=>(k===0?'<th>':'<td>')+escapeHtml(c)+(k===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</table></div>'); break;
      case 'encerramento': closeSec(); html.push('<div class="r-divider" role="separator"><span>Encerramento</span></div>'); break;
      case 'assinatura': closeSec(); html.push('<div class="r-assin">'+nd.linhas.map(l=>'<p>'+escapeHtml(l)+'</p>').join('')+'</div>'); break;
    }
  });
  closeSec();

  const tocHtml = toc.length ? '<nav class="reader-toc" aria-label="Seções da ata"><div class="r-label">Seções</div><ol>'+
    toc.map(t=>'<li><a href="#'+t.id+'" data-target="'+t.id+'">'+(t.num!=null?'<span class="t-num">'+t.num+'</span>':'')+'<span>'+escapeHtml(t.titulo)+'</span></a></li>').join('')+'</ol></nav>' : '';

  r.innerHTML =
    '<div class="reader-bar">'+
      '<button class="btn btn-ghost" id="reader-back">'+ICONS.arrowLeft+'<span>Voltar</span></button>'+
      '<div class="rb-title"><span class="rb-kicker">TEXTO DA ATA</span><span class="rb-name" id="reader-title">'+escapeHtml(a.reuniao||a.filename)+'</span></div>'+
      '<div class="rb-actions">'+
        '<div class="rb-seg" role="tablist" aria-label="Forma de exibição"><button role="tab" aria-selected="true" data-mode="fmt">Formatado</button><button role="tab" aria-selected="false" data-mode="orig">Original</button></div>'+
        '<label class="rb-toggle" title="Destaca no texto os trechos que o sistema classificou (decisões, encaminhamentos, demandas, problemas, sugestões)"><input type="checkbox" id="reader-hl"'+(prefs.hl||focus?' checked':'')+'><span>Destacar itens extraídos</span></label>'+
        '<div class="rb-size" role="group" aria-label="Tamanho do texto"><button class="icon-btn" id="reader-smaller" aria-label="Diminuir texto">A−</button><button class="icon-btn" id="reader-bigger" aria-label="Aumentar texto">A+</button></div>'+
        '<button class="icon-btn" id="reader-copy" title="Copiar texto formatado" aria-label="Copiar texto formatado">'+ICONS.copy+'</button>'+
        '<button class="icon-btn" id="reader-close" title="Fechar (Esc)" aria-label="Fechar">'+ICONS.close+'</button>'+
      '</div>'+
    '</div>'+
    '<div class="reader-scroll" id="reader-scroll">'+
      '<div class="reader-layout'+(toc.length?'':' no-toc')+'">'+
        tocHtml+
        '<article class="reader-doc'+(prefs.hl||focus?' show-hl':'')+'" id="reader-doc" style="--r-size:'+prefs.size+'px">'+
          '<div class="r-meta">'+escapeHtml(a.filename)+(a.data?' · '+fmtDate(a.data):'')+' · '+st.words.toLocaleString('pt-BR')+' palavras · ~'+st.minutes+' min'+
            '<span class="r-legend"><mark class="hl hl-dec">decisão</mark><mark class="hl hl-enc">encaminhamento</mark><mark class="hl hl-dem">demanda</mark><mark class="hl hl-prob">problema</mark><mark class="hl hl-sug">sugestão</mark></span></div>'+
          (truncated ? '<div class="r-note">Mostrando os primeiros '+(a.textExcerpt||'').length.toLocaleString('pt-BR')+' caracteres do documento ('+(a.charCount||0).toLocaleString('pt-BR')+' no total).</div>' : '')+
          (html.length ? html.join('') : '<p class="muted">Não há texto para exibir.</p>')+
          '<p class="r-foot">Texto reorganizado em parágrafos a partir do ficheiro original: só as quebras de linha mudam, e cabeçalhos e rodapés repetidos em cada página são omitidos. O texto exato, como foi extraído, está em “Original”.</p>'+
        '</article>'+
        // texto original extraído, intacto e separado da análise
        '<article class="reader-orig" id="reader-orig" hidden><div class="r-meta">Texto exatamente como foi extraído do ficheiro, sem nenhuma alteração · '+(a.textExcerpt||'').length.toLocaleString('pt-BR')+' caracteres</div><pre>'+escapeHtml((a.textExcerpt||'').replace(/\f/g, '\n'))+'</pre></article>'+
      '</div>'+
    '</div>';

  readerReturnFocus = document.activeElement;
  r.classList.add('open');
  document.body.classList.add('reader-open');
  r.querySelector('#reader-scroll').scrollTop = 0;
  r.querySelector('#reader-close').focus();
  // veio de "Ver na ata": rola até o trecho e o destaca
  if(focus){
    const mk = r.querySelector('mark[data-key="'+focus.kind+'|'+focus.index+'"]');
    if(mk){
      const sc = r.querySelector('#reader-scroll');
      requestAnimationFrame(()=>{ sc.scrollTop = Math.max(0, mk.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 140); });
      mk.classList.add('focus'); mk.setAttribute('tabindex','-1');
    } else toast('Não foi possível localizar o trecho exato no texto (ele pode ter sido recortado).', true);
  }

  const doc = r.querySelector('#reader-doc');
  r.querySelector('#reader-back').addEventListener('click', closeReader);
  r.querySelector('#reader-close').addEventListener('click', closeReader);
  r.querySelectorAll('.rb-seg button').forEach(btn=>btn.addEventListener('click', ()=>{
    const orig = btn.dataset.mode==='orig';
    r.querySelectorAll('.rb-seg button').forEach(b=>b.setAttribute('aria-selected', String(b===btn)));
    r.querySelector('#reader-doc').hidden = orig;
    r.querySelector('#reader-orig').hidden = !orig;
    const tocEl = r.querySelector('.reader-toc'); if(tocEl) tocEl.hidden = orig;
    r.querySelector('.reader-layout').classList.toggle('no-toc', orig || !tocEl);
    r.querySelector('#reader-hl').closest('.rb-toggle').hidden = orig;
    r.querySelector('#reader-scroll').scrollTop = 0;
  }));
  r.querySelector('#reader-hl').addEventListener('change', e=>{ prefs.hl = e.target.checked; doc.classList.toggle('show-hl', prefs.hl); saveReaderPrefs(prefs); });
  const setSize = d => { prefs.size = Math.max(15, Math.min(23, prefs.size + d)); doc.style.setProperty('--r-size', prefs.size+'px'); saveReaderPrefs(prefs); };
  r.querySelector('#reader-smaller').addEventListener('click', ()=>setSize(-1));
  r.querySelector('#reader-bigger').addEventListener('click', ()=>setSize(1));
  r.querySelector('#reader-copy').addEventListener('click', ()=>{
    const plain = nodes.map(nd=>{
      if(nd.tipo==='secao') return '\n'+(nd.num!=null?nd.num+'. ':'')+nd.titulo;
      if(nd.tipo==='pauta') return 'Pauta:\n'+nd.itens.map(i=>'  '+(i.num!=null?i.num+'. ':'')+i.titulo).join('\n');
      if(nd.tipo==='item') return '  '+nd.marcador+' '+nd.texto;
      if(nd.tipo==='subsecao') return nd.marcador+') '+nd.titulo;
      if(nd.tipo==='campo') return nd.rotulo+': '+(nd.valor||'');
      if(nd.tipo==='presenca') return (nd.titulo||'Presença')+':\n'+(nd.registros||[]).map(r=>'  '+r.nome+' — '+r.status).concat(nd.linhas||[]).join('\n');
      if(nd.tipo==='tabela') return nd.linhas.map(rw=>rw.join(' | ')).join('\n');
      if(nd.tipo==='encerramento') return '';
      if(nd.linhas) return nd.linhas.join('\n');
      return nd.texto||'';
    }).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
    (navigator.clipboard ? navigator.clipboard.writeText(plain) : Promise.reject()).then(()=>toast('Texto copiado.'), ()=>toast('Não foi possível copiar o texto.', true));
  });
  // sumário: rolagem suave dentro do leitor + seção atual destacada
  const scroller = r.querySelector('#reader-scroll');
  r.querySelectorAll('.reader-toc a').forEach(link=>link.addEventListener('click', e=>{
    e.preventDefault();
    const target = r.querySelector('#'+link.dataset.target);
    if(target) scroller.scrollTo({top: target.offsetTop - 24, behavior:'smooth'});
  }));
  if('IntersectionObserver' in window && toc.length){
    const links = new Map(Array.from(r.querySelectorAll('.reader-toc a')).map(l=>[l.dataset.target, l]));
    const io = new IntersectionObserver(entries=>{
      entries.forEach(en=>{ if(en.isIntersecting){ links.forEach(l=>l.classList.remove('current')); links.get(en.target.id)?.classList.add('current'); } });
    }, {root: scroller, rootMargin:'0px 0px -70% 0px'});
    r.querySelectorAll('.r-h').forEach(h=>io.observe(h));
  }
}
function closeReader(){
  const r = document.getElementById('reader');
  if(!r) return;
  r.classList.remove('open');
  document.body.classList.remove('reader-open');
  if(readerReturnFocus && document.contains(readerReturnFocus)) readerReturnFocus.focus();
}

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
  while(stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 4200);
}

})();