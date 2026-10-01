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
  statusFilter:'all', sortKey:'uploadedAt', sortDir:'desc'
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
  "Quais decisões ainda não têm responsável definido?",
  "Resuma os principais assuntos discutidos até agora",
  "Quais prazos vencem em breve?",
  "Quais problemas foram relatados com mais frequência?"
];

const STOPWORDS = new Set(("de da do das dos em no na nos nas um uma uns umas e ou a o as os que se para por com sem sobre "+
 "quais qual quando onde quem como foi foram é são ser está estão tem têm ainda mais menos entre até desde já não sim seu sua seus suas "+
 "este esta esse essa aquele aquela isso isto aos às pelo pela pelos pelas nosso наша nossos nossas qualquer "+
 "ata atas reunião ordinária extraordinária colegiado curso bacharelado licenciatura alunos aluno aluna alunas professor professora prof profa "+
 "presidente presentes presente ausentes ausente justificada aprovação pauta período discente docente universidade silva santos oliveira pereira costa "+
 "aprovado reprovado unanimidade membros membro coordenador coordenadora coordenação departamento centro setor assinado assinada assinatura "+
 "documento processo requerimento pedido solicitação parecer favorável contrário voto votação relato relator relatora assunto assuntos "+
 "decisão decisões encaminhamento encaminhamentos prazo prazos responsável responsáveis data local horário horas abertura encerramento "+
 "lista após palavra todos todas outros outras termo termos "+
 "ausência federal estado unirio geiza jobson massollar atividade atividades disciplina disciplinas abril janeiro fevereiro março maio junho julho agosto setembro outubro novembro dezembro "+
 "ensino pesquisa extensão projeto projetos carga horária semestre letivo matriz curricular dia mês ano pautas informes ordem assinam "+
 "instituto superior campus reitoria resolução portaria lei artigo inciso conforme considerando resolve referentes").split(" "));

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

  document.querySelectorAll('#status-filter button').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('#status-filter button').forEach(x=>x.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed','true');
      state.statusFilter = b.dataset.status;
      renderAtaTable();
    });
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
      analysis:{assuntos:analysis.assuntos, decisoes:analysis.decisoes, encaminhamentos:analysis.encaminhamentos, problemas:analysis.problemas, termosRecorrentes:analysis.termosRecorrentes},
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

async function extractText(file){
  const isPdf = file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if(isPdf) return extractPdfText(file);
  return await file.text();
}
async function extractPdfText(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  let out=''; const maxPages = Math.min(pdf.numPages, 80);
  for(let i=1;i<=maxPages;i++){ const page = await pdf.getPage(i); const content = await page.getTextContent(); out += content.items.map(it=>it.str).join(' ') + '\n\n'; }
  return out;
}

/* ============================================================
   ANÁLISE
============================================================ */
async function analyzeText(text, filename){
  return heuristicExtract(text, filename);
}

const MESES = {janeiro:'01',fevereiro:'02','março':'03',marco:'03',abril:'04',maio:'05',junho:'06',julho:'07',agosto:'08',setembro:'09',outubro:'10',novembro:'11',dezembro:'12'};
const ABREV_RE = /\b(Prof|Profa|Prof[ªa]|Sr|Sra|Dr|Dra|Art|nº|n°|Exmo|Exma|etc|Av|Rua)\./gi;

function findMeetingDate(text){
  const m1 = text.match(/\b(\d{1,2})\s*(?:de)?\s*([a-zç]+)\s+de\s+(\d{4})\b/i);
  const m2 = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if(m1 && MESES[m1[2].toLowerCase()]) return m1[3]+'-'+MESES[m1[2].toLowerCase()]+'-'+String(m1[1]).padStart(2,'0');
  if(m2) return m2[3]+'-'+m2[2]+'-'+m2[1];
  return null;
}

function findReuniao(text){
  const mTitle = text.match(/\d+ª?\s*Reuni[ãa]o\s+(?:Ordin[áa]ria|Extraordin[áa]ria)(?:\s+\d{4}(?:\.\d+)?)?/i);
  const mCurso = text.match(/Colegiado do Curso de[^\n]*?(?=\s+\d{1,2}\s+de\s+[a-zçãéíóú]+\s+de\s+\d{4}\b)/i) ||
                 text.match(/Colegiado do Curso de[^.\n]{0,80}/i);
  if(mTitle && mCurso) return (mTitle[0].trim()+' — '+mCurso[0].trim()).replace(/\s+/g,' ');
  if(mTitle) return mTitle[0].trim();
  if(mCurso) return mCurso[0].trim().replace(/\s+/g,' ');
  const alt = text.match(/Ata\s+d[ao]\s+[^.\n]{0,80}/i);
  return alt ? alt[0].trim().replace(/\s+/g,' ') : null;
}

function splitSentences(text){
  const protectedText = text.replace(ABREV_RE, m => m.slice(0,-1)+'§');
  const raw = protectedText.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9"“(])/);
  return raw.map(s => s.replace(/§/g,'.').trim()).filter(Boolean);
}

/* ============================================================
   NOME / RESPONSÁVEL  (REESCRITO)
============================================================
   Antes, os regex tinham a flag /i junto com [A-ZÀ-Ú] — o /i
   neutralizava a exigência de maiúscula e o padrão "engolia"
   as palavras seguintes (verbos, conjunções, etc.), produzindo
   nomes do tipo "Felipe concordaram e".

   Agora:
   • O gatilho ("responsável", "sob responsabilidade", "Prof."…)
     é escrito à mão com classes [Rr], [Ss], [Pp]… — insensível
     a maiúsculas só no gatilho.
   • O NOME só aceita palavras com inicial MAIÚSCULA (sem /i),
     permitindo partículas minúsculas legítimas no meio
     (de, da, do, das, dos).
   • cleanName() remove caudas que claramente não são nome.
============================================================ */

// Bloco reutilizável: "Palavra" seguida de 0–4 palavras (partículas ou outra Palavra).
// Sem /i, então [A-ZÀ-Ú] realmente exige maiúscula.
const NAME_PATTERN =
  "[A-ZÀ-Ú][\\wà-úÀ-Ú.'-]*(?:\\s+(?:d[aeo]s?|[A-ZÀ-Ú][\\wà-úÀ-Ú.'-]*)){0,4}";

const RESP_EXPLICIT_PATTERNS = [
  new RegExp("[Rr]espons[áa]vel\\s*(?:pel[ao])?\\s*:?\\s*(" + NAME_PATTERN + ")"),
  new RegExp("[Ss]ob\\s+responsabilidade\\s+d[eo]\\s+(" + NAME_PATTERN + ")"),
  new RegExp("[Aa]\\s+cargo\\s+d[eo]\\s+(" + NAME_PATTERN + ")"),
  new RegExp("[Cc]oordenad[oa]\\s+por\\s+(" + NAME_PATTERN + ")")
];

const TITLE_NAME_PATTERN = new RegExp(
  "\\b(?:[Pp]rof(?:essor[a]?)?[ªa°]?\\.?|[Cc]oordenador[a]?\\.?|[Dd]iretor[a]?\\.?)\\s+(" +
  NAME_PATTERN + ")"
);

// Caudas que nunca fazem parte de um nome humano — usadas para limpar
// sobras defensivamente caso algum PDF estranho quebre as regras.
const NAME_TAIL_STOP = /^(?:e|ou|que|como|para|por|com|sem|sobre|de|da|do|das|dos|em|no|na|nos|nas|ao|aos|à|às|é|são|foi|foram|será|serão|est[áã]|est[ãa]o|inform(ou|aram)|relat(ou|aram)|explic(ou|aram)|concord(ou|aram)|apresent(ou|aram)|solicit(ou|aram)|prop[ôo]s|suger(iu|iram)|decid(iu|iram)|aprov(ou|aram)|encaminh(ou|aram))$/i;

function findResponsavel(sentence){
  for(const re of RESP_EXPLICIT_PATTERNS){
    const m = sentence.match(re);
    if(m) return cleanName(m[1]);
  }
  const mTitle = sentence.match(TITLE_NAME_PATTERN);
  if (mTitle) return cleanName(mTitle[1]);
  return null;
}

function cleanName(n){
  if(!n) return null;
  let name = n.trim().replace(/[.,;:]+$/,'');
  // Defensivo: corta palavras finais que claramente não são nome.
  const parts = name.split(/\s+/);
  while(parts.length > 1 && NAME_TAIL_STOP.test(parts[parts.length-1])) parts.pop();
  name = parts.join(' ').replace(/[.,;:]+$/,'').trim();
  return name || null;
}

function findPrazo(sentence){
  const m1 = sentence.match(/prazo\s*(?:de|final|:)?\s*(?:at[ée]\s*)?(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/i);
  if(m1) return m1[1];
  const m2 = sentence.match(/at[ée]\s+(?:o\s+dia\s+)?(\d{1,2}\s*(?:de)?\s*[a-zç]+(?:\s+de\s+\d{4})?)/i);
  if(m2) return m2[1].trim();
  const m3 = sentence.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\b/);
  if(m3 && /prazo|at[ée]/i.test(sentence)) return m3[1];
  return null;
}

const DECISION_VERB_RE = /\b(aprovad[oa]s?|reprovad[oa]s?|deferid[oa]s?|indeferid[oa]s?|decidiu-se|aprovou-se|deliberou-se|homologad[oa]s?)\b/i;

function heuristicExtract(text, filename){
  const lower = text.toLowerCase();
  const data = findMeetingDate(text);
  const reuniao = findReuniao(text);

  const sentences = splitSentences(text.replace(/\n+/g, ' '));
  const decisoes=[], encaminhamentos=[], problemas=[];
  sentences.forEach(s=>{
    if(s.length<8 || s.length>700) return;
    const ll = s.toLowerCase();
    const responsavel = findResponsavel(s);
    const prazo = findPrazo(s);

    if(DECISION_VERB_RE.test(s)) {
      decisoes.push({descricao:s, responsavel, prazo});
    } else if(/\b(encaminh|providenciar|solicitad[oa]|solicitou)\b/i.test(ll)) {
      encaminhamentos.push({descricao:s, responsavel, prazo});
    } else if(/problema|dificuldade|pend[êe]ncia|demanda|preocupa[çc][ãa]o/.test(ll)) {
      problemas.push(s);
    }
  });

  const freq={};
  lower.replace(/[^a-zà-ú\s]/g,' ').split(/\s+/).forEach(w=>{ if(w.length>4 && !STOPWORDS.has(w)) freq[w]=(freq[w]||0)+1; });
  const termosRecorrentes = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([termo,contagem])=>({termo,contagem}));

  const decisoesOut = decisoes.slice(0,30), encaminhamentosOut = encaminhamentos.slice(0,30);
  const degraded = (decisoesOut.length + encaminhamentosOut.length) === 0;

  return {
    reuniao, data, assuntos:termosRecorrentes.slice(0,8).map(t=>t.termo),
    decisoes:decisoesOut, encaminhamentos:encaminhamentosOut, problemas:problemas.slice(0,15),
    termosRecorrentes, degraded
  };
}

/* ============================================================
   RENDER: banners / hero / table
============================================================ */
function renderBanners(){
  const el = document.getElementById('banners');
  if(!state.atas.length){
    el.innerHTML = '<div class="banner">'+ICONS.info+'<div><strong>Como funciona:</strong> a extração de assuntos, decisões, encaminhamentos, responsáveis e prazos é feita localmente no navegador, por palavras-chave — os ficheiros não são enviados para nenhum servidor. Revise sempre os resultados na tela de detalhe.</div></div>';
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
    ['n', encs, 'encaminhamentos em aberto']
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
    if(state.statusFilter!=='all' && (a.status||'concluido')!==state.statusFilter) return false;
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
      '<div class="d">'+(state.atas.length ? 'Ajuste a busca ou o filtro de status.' : 'Envie um PDF ou TXT acima para começar.')+'</div></div></td></tr>';
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
function openDrawer(a){
  const d = document.getElementById('drawer');
  const an = a.analysis || {};
  const listOrEmpty = (arr, render) => arr && arr.length ? arr.map(render).join('') : '<p class="muted">Nada identificado.</p>';

  const responsaveisSet = new Set();
  const prazosSet = new Set();
  (an.decisoes||[]).forEach(item => { if(item.responsavel) responsaveisSet.add(item.responsavel); if(item.prazo) prazosSet.add(item.prazo); });
  (an.encaminhamentos||[]).forEach(item => { if(item.responsavel) responsaveisSet.add(item.responsavel); if(item.prazo) prazosSet.add(item.prazo); });
  const respList = Array.from(responsaveisSet);
  const prazoList = Array.from(prazosSet);

  d.innerHTML =
    '<div class="drawer-head">'+
      '<button class="icon-btn drawer-close" id="drawer-close">'+ICONS.close+'</button>'+
      '<div class="dh-kicker">DETALHE DA ATA</div>'+
      '<h3>'+escapeHtml(a.reuniao || a.filename)+'</h3>'+
      '<div class="dh-meta">'+escapeHtml(a.filename)+' · '+(a.data ? fmtDate(a.data) : 'data não identificada')+' · enviada a '+fmtDateTime(a.uploadedAt)+'</div>'+
    '</div>'+
    '<div class="drawer-body">'+
      '<h5>Assuntos</h5><div class="tag-list">'+
        (an.assuntos&&an.assuntos.length ? an.assuntos.map(s=>'<span class="tag">'+escapeHtml(s)+'</span>').join('') : '<p class="muted">Nada identificado.</p>')+
      '</div>'+
      '<h5>Responsáveis Citados</h5><div class="tag-list">'+
        (respList.length ? respList.map(r=>'<span class="tag" style="background:var(--teal-soft);color:var(--teal-deep);">'+escapeHtml(r)+'</span>').join('') : '<p class="muted">Nenhum responsável explícito identificado.</p>')+
      '</div>'+
      '<h5>Prazos Definidos</h5><div class="tag-list">'+
        (prazoList.length ? prazoList.map(p=>'<span class="tag" style="background:var(--amber-soft);color:var(--amber-deep);">'+escapeHtml(p)+'</span>').join('') : '<p class="muted">Nenhum prazo identificado.</p>')+
      '</div>'+
      '<h5>Decisões ('+(an.decisoes?an.decisoes.length:0)+')</h5>'+
      listOrEmpty(an.decisoes, dcs=>'<div class="item-card"><span class="chip dec">DECISÃO</span><div class="desc" style="margin-top:7px;">'+escapeHtml(dcs.descricao)+'</div><div class="tags">'+
        (dcs.responsavel?'<span>responsável: '+escapeHtml(dcs.responsavel)+'</span>':'')+(dcs.prazo?'<span>prazo: '+escapeHtml(dcs.prazo)+'</span>':'')+'</div></div>')+
      '<h5>Encaminhamentos ('+(an.encaminhamentos?an.encaminhamentos.length:0)+')</h5>'+
      listOrEmpty(an.encaminhamentos, dcs=>'<div class="item-card"><span class="chip enc">ENCAM.</span><div class="desc" style="margin-top:7px;">'+escapeHtml(dcs.descricao)+'</div><div class="tags">'+
        (dcs.responsavel?'<span>responsável: '+escapeHtml(dcs.responsavel)+'</span>':'')+(dcs.prazo?'<span>prazo: '+escapeHtml(dcs.prazo)+'</span>':'')+'</div></div>')+
      '<h5>Problemas / demandas</h5>'+
      (an.problemas&&an.problemas.length ? '<ul>'+an.problemas.map(p=>'<li>'+escapeHtml(p)+'</li>').join('')+'</ul>' : '<p class="muted">Nada identificado.</p>')+
      '<h5>Termos recorrentes</h5><div class="tag-list">'+
        (an.termosRecorrentes&&an.termosRecorrentes.length ? an.termosRecorrentes.map(t=>'<span class="tag">'+escapeHtml(t.termo)+' · '+t.contagem+'</span>').join('') : '<p class="muted">Nada identificado.</p>')+
      '</div>'+
      '<h5>Texto extraído</h5><details><summary>Mostrar texto</summary><div class="raw-text" style="margin-top:10px;">'+escapeHtml((a.textExcerpt||'').slice(0,20000))+'</div></details>'+
    '</div>';

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
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
    const addItem = (item, tipo) => {
      if(!item.responsavel) return;
      const key = item.responsavel.trim().toLowerCase();
      if(!map[key]) map[key] = {nome:item.responsavel.trim(), decisoes:[], encaminhamentos:[]};
      map[key][tipo].push(Object.assign({ata:a.filename, data:a.data, reuniao:a.reuniao}, item));
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
      (pendentes>0 ? '<div class="resp-pending">'+pendentes+' item(ns) sem prazo definido</div>' : '<div class="resp-ok">todos os itens com prazo</div>')+
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
    '<div class="tags"><span>'+escapeHtml(it.ata)+(it.data?' · '+fmtDate(it.data):'')+'</span>'+(it.prazo?'<span>prazo: '+escapeHtml(it.prazo)+'</span>':'<span>sem prazo</span>')+'</div></div>'
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
  atas.forEach(a=> (a.analysis?.assuntos||[]).forEach(t=>{ const k=t.trim().toLowerCase(); if(!k) return; map[k]=map[k]||{label:t.trim(),count:0}; map[k].count++; }));
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
  rows.sort((a,b)=> (a.date||'9999')<(b.date||'9999') ? -1 : 1);
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
const BAR_ORANGE_DEEP = '#B97A22';   // laranja escuro (--amber-deep) — alternativa

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
function answerLocally(question){
  const qLower = question.toLowerCase();

  if (qLower.includes("resum") || qLower.includes("principais assuntos")) {
    const freq = themeFrequency(state.atas).slice(0, 5);
    if(freq.length) return "Os assuntos mais recorrentes discutidos nas atas são:\n\n" + freq.map(f => `• ${f.label} (${f.count} menções)`).join('\n');
    return "Ainda não há dados suficientes para gerar um resumo.";
  }

  if (qLower.includes("não têm responsável") || qLower.includes("sem responsável")) {
    let res = [];
    state.atas.forEach(a => {
        const an = a.analysis || {};
        [...(an.decisoes||[]), ...(an.encaminhamentos||[])].forEach(item => {
            if (!item.responsavel) res.push(`• [${a.filename}] ${item.descricao}`);
        });
    });
    if (res.length) return "Aqui estão as decisões e encaminhamentos ainda sem responsável definido:\n\n" + res.slice(0, 10).join('\n\n') + (res.length > 10 ? '\n\n(Exibindo os 10 primeiros)' : '');
    return "Excelente! Todos os itens identificados possuem um responsável.";
  }

  if (qLower.includes("prazo") || qLower.includes("vence")) {
    let res = [];
    state.atas.forEach(a => {
        const an = a.analysis || {};
        [...(an.decisoes||[]), ...(an.encaminhamentos||[])].forEach(item => {
            if (item.prazo) res.push(`• [${a.filename}] ${item.descricao}\n  Prazo: ${item.prazo}` + (item.responsavel ? ` (Resp: ${item.responsavel})` : ''));
        });
    });
    if(res.length) return "Encontrei os seguintes itens com prazos definidos nas atas:\n\n" + res.slice(0, 8).join('\n\n');
    return "Não encontrei prazos definidos nas atas enviadas.";
  }

  if (qLower.includes("problema") || qLower.includes("frequência")) {
    let res = [];
    state.atas.forEach(a => {
        (a.analysis?.problemas||[]).forEach(p => res.push(`• [${a.filename}] ${p}`));
    });
    if(res.length) return "Estes foram os problemas ou demandas relatados:\n\n" + res.slice(0, 8).join('\n\n');
    return "Não identifiquei problemas ou demandas explícitas nas atas.";
  }

  const qWords = new Set((qLower.match(/[a-zà-ú0-9]+/g)||[]).filter(w=>w.length>2 && !STOPWORDS.has(w)));
  if(!qWords.size) return 'Tente reformular a pergunta com palavras mais específicas (ex: "prazo", "assunto", "resumo").';

  const hits = [];
  state.atas.forEach(a=>{
    const an = a.analysis||{};
    const consider = (list, tipo) => (list||[]).forEach(item=>{
      const desc = item.descricao||item;
      let score=0; qWords.forEach(w=>{ if(String(desc).toLowerCase().includes(w)) score++; });
      if(score>0) hits.push({a, tipo, item, score});
    });
    consider(an.decisoes, 'decisão');
    consider(an.encaminhamentos, 'encaminhamento');
    consider(an.problemas, 'problema');
  });
  hits.sort((x,y)=>y.score-x.score);

  if(!hits.length) return 'Não encontrei trechos exatos. Tente usar termos que apareçam literalmente no texto ou faça perguntas usando os botões de sugestão acima.';

  const lines = hits.slice(0,8).map(h=>{
    const d = h.item.descricao||h.item;
    const src = h.a.filename+(h.a.data?' — '+fmtDate(h.a.data):'');
    return `• [${h.tipo}] ${d}\n  fonte: ${src}`;
  });
  return 'Encontrei os seguintes trechos relacionados nas atas:\n\n'+lines.join('\n\n');
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