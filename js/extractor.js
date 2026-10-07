/* ============================================================
   EXTRATOR DE ATAS  (js/extractor.js)  —  versão 2
   ------------------------------------------------------------
   Pipeline (cada etapa é uma função independente):

     1. normalizeText()      limpa o texto, preservando quebras de linha
     2. buildStructure()     descobre a estrutura (pauta, itens numerados,
                             títulos ou texto corrido) e divide em BLOCOS
     3. extractItems()       dentro de cada bloco, sentença a sentença:
                             decisões, encaminhamentos, problemas,
                             demandas e sugestões (com nível de confiança)
     4. findTemporal()       prazos e referências temporais (datas, períodos,
                             eventos, reuniões futuras, expressões vagas)
     5. extractActors()      responsáveis (pessoas, cargos e grupos)
     6. recurringTerms()     termos recorrentes — INDEPENDENTE dos assuntos
     7. dedupe + confiança

   Princípio: nada é inventado. Se não houver evidência textual
   suficiente, o campo fica vazio / "não identificado".
============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtaExtractor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSION = 2;

/* ---------- utilitários ---------- */
// Remove acentos MANTENDO o comprimento da string (índices continuam válidos
// na string original) e põe em minúsculas.
const fold = s => String(s)
  .replace(/[\u00C0-\u017F]/g, c => c.normalize('NFD').charAt(0))
  .replace(/[A-Z]/g, c => c.toLowerCase());
const rx = flags => (strs, ...vals) => new RegExp(String.raw(strs, ...vals), flags);
const wordsOf = s => (String(s).match(/\S+/g) || []);
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const squash = s => String(s).replace(/\s+/g, ' ').trim();
const trimEnd = s => String(s).replace(/[\s.,;:!?\-–—]+$/, '');
const trimStart = s => String(s).replace(/^[\s\-–—•*·.,;:]+/, '');
const clip = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
const pad2 = n => String(n).padStart(2, '0');

const MES_ALT = 'janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const MES_F = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const MES_NUM = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };

function isoOf(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (y < 100) y += 2000;
  return y + '-' + pad2(m) + '-' + pad2(d);
}

/* ============================================================
   1. NORMALIZAÇÃO
============================================================ */
function normalizeText(raw) {
  let t = String(raw == null ? '' : raw);
  t = t.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F\u2009]/g, ' ')
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
    .replace(/\f/g, '\n\n');
  // palavra partida por hífen no fim da linha: "infor-\nmação"
  t = t.replace(/([a-zà-ú])-[ \t]*\n[ \t]*([a-zà-ú])/g, '$1$2');

  let lines = t.split('\n').map(l =>
    l.replace(/^[ ]+/, '').replace(/[ \t]+$/, '').replace(/ {3,}/g, '\t').replace(/ {2}/g, ' '));

  // números de página ("Página 2 de 5", "- 3 -", "2/5")
  const pageRe = /^(?:p[áa]g(?:ina)?\.?\s*)?\d{1,3}\s*(?:\/|de)\s*\d{1,3}$|^[-–—]\s*\d{1,3}\s*[-–—]$|^p[áa]gina\s+\d{1,3}$/i;
  lines = lines.filter(l => !pageRe.test(l.trim()));

  // cabeçalhos/rodapés repetidos (3+ vezes). Não remove linhas que pareçam
  // decisões ("Aprovado por unanimidade") nem que terminem em pontuação.
  const counts = new Map();
  lines.forEach(l => { const k = l.trim(); if (k.length >= 12 && k.length <= 140) counts.set(k, (counts.get(k) || 0) + 1); });
  const keepRe = /aprov|decid|defer|rejeit|unanim|maioria|encaminh|respons|prazo|votac/i;
  lines = lines.filter(l => {
    const k = l.trim();
    if ((counts.get(k) || 0) < 3) return true;
    if (/^\d/.test(k) || /[.!?;:]$/.test(k) || keepRe.test(k)) return true;
    return false;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ============================================================
   DATA E TÍTULO DA REUNIÃO
============================================================ */
function findMeetingDate(text) {
  const scan = (src) => {
    const out = [];
    let m;
    const reTxt = new RegExp('(\\d{1,2})\\s*(?:º|°|o)?\\s*(?:dias?\\s+(?:do\\s+m[eê]s\\s+)?)?(?:de\\s+)?(' + MES_ALT + ')\\s+(?:de|do\\s+ano\\s+de)\\s+(\\d{4})', 'gi');
    while ((m = reTxt.exec(src))) {
      const mes = MES_NUM[fold(m[2])];
      const iso = isoOf(m[3], mes, m[1]);
      if (iso) out.push({ idx: m.index, iso });
    }
    const reNum = /(?:^|[^\d\/.\-])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?![\d])/g;
    while ((m = reNum.exec(src))) {
      const iso = isoOf(m[3], m[2], m[1]);
      if (iso) out.push({ idx: m.index, iso });
    }
    return out.sort((a, b) => a.idx - b.idx);
  };
  const head = scan(text.slice(0, 2500));
  if (head.length) return head[0].iso;
  const all = scan(text);
  return all.length ? all[0].iso : null;
}

function findReuniao(text) {
  const head = text.slice(0, 3000).replace(/\s+/g, ' ');
  const mTitle = head.match(/\b(?:\d+\s*[ªºa°]?\s*)?Reuni[ãa]o\s+(?:Ordin[áa]ria|Extraordin[áa]ria|Solene|Conjunta)(?:\s+(?:n[ºo°.]*\s*)?\d+(?:[\/.]\d{2,4})?)?/i);
  const mCurso = head.match(/Colegiado\s+(?:do|de)\s+Curso\s+(?:de|do)\s+[^.,;\d]{3,80}?(?=\s+(?:\d{1,2}\s+de\s+[a-zçãéíóú]+|em\s+\d|realizad|ocorrid|aos\s)|[.,;]|$)/i)
    || head.match(/Colegiado\s+(?:do|de)\s+[^.,;\d]{3,70}/i);
  if (mTitle && mCurso) return squash(mTitle[0] + ' — ' + mCurso[0]);
  if (mTitle) return squash(mTitle[0]);
  if (mCurso) return squash(mCurso[0]);
  const alt = text.slice(0, 600).match(/Ata\s+d[aeo]s?\s+[^.\n]{3,80}/i);
  return alt ? squash(alt[0]) : null;
}

/* ============================================================
   SEPARAÇÃO EM SENTENÇAS (sem lookbehind — compatível com Safari antigo)
============================================================ */
const ABBR = new Set(['prof','profa','dr','dra','sr','sra','srs','art','arts','n','nr','p','pp','cap','inc','par','al',
  'ex','av','cia','ltda','obs','fig','vol','ed','ref','resp','coord','dept','depto','univ','vs','ilmo','exmo','exma',
  'pag','proc','cf','aprox','tel']);

function splitSentences(text) {
  const out = [];
  const L = text.length;
  let start = 0;
  for (let i = 0; i < L; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    let j = i;
    while (j + 1 < L && /[.!?…]/.test(text[j + 1])) j++;
    let k = j + 1;
    while (k < L && /["”')\]]/.test(text[k])) k++;
    if (k < L && !/\s/.test(text[k])) { i = j; continue; }
    let p = k;
    while (p < L && /\s/.test(text[p])) p++;
    if (p < L && c === '.') {
      if (!/[A-ZÀ-Ú0-9"“(\[]/.test(text[p])) { i = j; continue; }       // minúscula depois: não é fim
      const m = text.slice(start, i).match(/([A-Za-zÀ-ú]+)$/);
      if (m) {
        if (j === i && ABBR.has(fold(m[1]))) { i = j; continue; }       // Prof. Dr. Art. ...
        if (m[1].length === 1 && /[A-ZÀ-Ú]/.test(m[1])) { i = j; continue; } // inicial: "J. Silva"
      }
    }
    out.push(text.slice(start, k).trim());
    start = p;
    i = Math.max(i, p - 1);
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);

  // sentenças muito longas: quebra em ';' (deliberações costumam vir assim)
  const final = [];
  out.filter(Boolean).forEach(s => {
    if (s.length <= 300 || s.indexOf(';') < 0) { final.push(s); return; }
    const parts = s.split(/;\s+/);
    let acc = '';
    parts.forEach((pt, idx) => {
      acc = acc ? acc + '; ' + pt : pt;
      if (acc.length >= 60 || idx === parts.length - 1) { final.push(acc); acc = ''; }
    });
  });
  return final;
}

/* ============================================================
   LÉXICOS COMPARTILHADOS
============================================================ */
const STOPWORDS = new Set(('de da do das dos em no na nos nas um uma uns umas e ou a o as os que se para por com sem sobre ' +
 'quais qual quando onde quem como foi foram é são ser está estão tem têm ainda mais menos entre até desde já não sim seu sua seus suas ' +
 'este esta esse essa aquele aquela isso isto aos às pelo pela pelos pelas nosso nossa nossos nossas qualquer ' +
 'ata atas reunião reuniões ordinária extraordinária colegiado curso bacharelado licenciatura ' +
 'presidente presentes presente ausentes ausente justificada pauta ' +
 'aprovado aprovada aprovados reprovado unanimidade membros membro coordenador coordenadora coordenação departamento setor assinado assinada assinatura ' +
 'documento processo parecer favorável contrário voto votação relato relator relatora assunto assuntos ' +
 'decisão decisões encaminhamento encaminhamentos prazo prazos responsável responsáveis data local horário horas abertura encerramento ' +
 'lista após palavra todos todas outros outras termo termos ' +
 'abril janeiro fevereiro março maio junho julho agosto setembro outubro novembro dezembro ' +
 'dia mês ano informes ordem assinam também ainda então assim sendo será serão deverá deverão ' +
 'foram havia havendo sobre sido ter tendo cada outro outra mesmo mesma essas esses estas estes ' +
 'resolução portaria lei artigo inciso conforme considerando resolve referentes ' +
 'professor professora prof profa alunos aluno aluna alunas discente docente ' +
 'informou informaram disse falou disseram colocou apresentou').split(/\s+/));

const ACTOR_LIST = ['coordenacao','coordenador','coordenadora','coordenadores','vice-coordenacao','vice-coordenador',
  'vice-coordenadora','secretaria','secretario','secretaria','equipe','equipes','grupo','grupos','comissao','comissoes',
  'colegiado','direcao','diretor','diretora','diretoria','departamento','chefia','chefe','professor','professora',
  'professores','professoras','docente','docentes','discente','discentes','estudante','estudantes','aluno','aluna',
  'alunos','alunas','representante','representantes','representacao','conselho','reitoria','pro-reitoria','proreitoria',
  'setor','nucleo','banca','presidente','vice-presidente','todos','membros','membro','relator','relatora','servidores',
  'servidor','orientador','orientadora','orientadores','tutor','tutores','monitores','bolsistas','assessoria','ouvidoria',
  'biblioteca','comite','nde','prograd','proex','propg','dce','daa'];
const ACTOR_SET = new Set(ACTOR_LIST);
const ACTOR_ALT = ACTOR_LIST.slice().sort((a, b) => b.length - a.length).join('|');
const ROLE_SET = new Set(['coordenador','coordenadora','vice-coordenador','vice-coordenadora','secretario','secretaria',
  'diretor','diretora','presidente','vice-presidente','professor','professora','chefe','relator','relatora',
  'representante','orientador','orientadora','tutor','aluno','aluna','estudante','discente','docente']);
const TITLE_SET = new Set(['prof','profa','professor','professora','dr','dra','sr','sra']);
const ORG_ACRONYMS = new Set(['NDE','PROGRAD','PROEX','PROPG','DAA','DCE','CAPES','CNPQ','MEC','PPC','TCC','CPA','CONSEPE','CONSUN','NAPNE','CDA']);

// Palavras capitalizadas que NÃO são nomes de pessoa.
const CAP_STOP = new Set(('O A Os As Um Uma Em No Na Nos Nas Ao Aos À Às Da Do De Das Dos Foi Ficou Ficaram Foram Será Serão Também Assim Então ' +
 'Ainda Colegiado Curso Coordenação Secretaria Universidade Departamento Reunião Ata Pauta Item Assunto Informes Segundo Conforme ' +
 'Após Antes Durante Quanto Sobre Para Por Com Sem Essa Esse Este Esta Isso Todos Todas Cada Alguns Algumas Nesse Nessa Neste Nesta ' +
 'Houve Há Mas Porém Contudo Todavia Já Ademais Além Portanto Logo Posteriormente Inicialmente Finalmente Primeiramente Depois Quando ' +
 'Se Caso Como Que Onde Qual Quais Deverá Deverão Prazo Responsável Decisão Encaminhamento Proposta Projeto Resolução Portaria Edital Lei ' +
 'Artigo Art Instituto Centro Escola Faculdade Federal Estadual Municipal Brasil Presidente Coordenador Coordenadora Professor Professora ' +
 'Prof Profa Dr Dra Sr Sra Aluno Aluna Estudante Discente Docente Representante Diretor Diretora Eu Nós Ele Ela Eles Elas ' +
 'Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro ' +
 'Segunda Terça Quarta Quinta Sexta Sábado Domingo Ordinária Extraordinária Semestre Período Ano Mês Dia Hoje Amanhã ' +
 'Seguindo Passando Prosseguindo Iniciando Encerrando Sobretudo Inclusive Aliás Enfim Ademais Igualmente Vale Pode Podem ' +
 'Nada Nenhum Nenhuma Outro Outra Outros Outras Ambos Ambas Mesmo Mesma').split(/\s+/));

const NON_ACTION_FUT = new Set(['sera','serao','estara','estarao','havera','haverao','podera','poderao','tera','terao',
  'ocorrera','ocorrerao','acontecera','acontecerao','vigorara','valera','dependera','constara','constarao','existira',
  'existirao','correspondera','equivalera','abrangera','incluira','contera','somara','totalizara','permitira',
  'possibilitara','implicara','significara','resultara','refletira','impactara','durara','vera','verao']);
const AMBIG_FUT = new Set(['iniciara','comecara','terminara','encerrara','passara','entrara','entrarao','aplicara','funcionara']);
const NON_ACTION_INF = new Set(['ser','estar','haver','ter','existir','depender','continuar','ocorrer','acontecer','parecer','valer','constar','vigorar']);
const NON_ACTION_PART = /^(?:aprovad|reprovad|deferid|indeferid|considerad|mantid|vigent|valid|permitid|tid|admitid|aceit|rejeitad)/;

/* ============================================================
   PAUTA, TÍTULOS E ESTRUTURA
============================================================ */
const RE_NUM_HEAD = /^(?:(?:item|ponto|assunto|pauta|t[óo]pico)\s*(?:n[ºo°.]*\s*)?)?(\d{1,2})\s*(?:[ºo°])?\s*[.)\]:–—-]+\s*(?=[A-Za-zÀ-ÿ"“(])(.+)$/i;
const RE_ITEM = /^(?:item|ponto|assunto|t[óo]pico)\s*(?:n[ºo°.]*\s*)?(\d{1,2})\b\s*[.:)\-–—]*\s*(.*)$/i;
const RE_LIST = /^(?:[-•*▪●○◦–—]\s+|[a-z]\s*[.)]\s+|\(\s*[a-z0-9]{1,2}\s*\)\s+|\d{1,2}\.\d{1,2}\.?\s+)/;
const ACT_INF_START = /^(?:encaminhar|providenciar|enviar|elaborar|verificar|solicitar|realizar|convocar|organizar|divulgar|publicar|agendar|contatar|consultar|analisar|revisar|atualizar|apresentar|levar|marcar|criar|retomar|reavaliar|comunicar|notificar|oficiar|formalizar|definir|incluir|preparar|redigir|cobrar|reunir|convidar|articular|propor|discutir|pautar|aprovar|rejeitar|manter|ratificar|homologar|autorizar|designar|nomear)\b/i;

const PROCEDURAL_RE = /^(?:informes?|comunicacoes?|expediente|abertura|encerramento|aprovacao\s+d[aeo]s?\s+(?:ata|pauta)|leitura\s+d[aeo]s?\s+ata|ata\s+anterior|verificacao\s+de\s+quorum|quorum|assuntos\s+gerais|outros\s+assuntos|assuntos\s+diversos|o\s+que\s+ocorrer|palavra\s+livre|o\s+que\s+houver|ordem\s+do\s+dia|pauta|presencas?|justificativas?|apresentacao\s+da\s+pauta|inclusao\s+de\s+pauta|assinaturas?|considera[cç]oes?\s+iniciais|aprovacao\s+da\s+ata\s+anterior|informe\s+geral)\b/;
function isProceduralSubject(s) { return PROCEDURAL_RE.test(fold(squash(s || ''))); }

function cleanTitle(t) {
  if (!t) return null;
  t = squash(t).replace(/^(?:item|ponto|assunto|t[óo]pico)\s*(?:n[ºo°.]*\s*)?\d{1,2}\s*[.:)\-–—]*\s*/i, '')
    .replace(/^\d{1,2}\s*[.)\]:–—-]+\s*/, '').replace(/^[\s\-–—•*·:]+/, '');
  t = trimEnd(t).replace(/^["“(]+|[")”]+$/g, '').trim();
  if (t.length < 3) return null;
  // cabeçalho TODO EM MAIÚSCULAS -> "Assuntos gerais" (siglas curtas ficam como estão)
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) t = t.split(/\s+/).map(w => w.length > 4 ? w.toLowerCase() : w).join(' ');
  if (wordsOf(t).length > 18) return null;
  return cap1(clip(t, 120));
}

function splitTitleBody(text) {
  const t = text.trim();
  const colon = t.indexOf(':');
  if (colon > 2 && colon <= 100 && wordsOf(t.slice(0, colon)).length <= 12) return [t.slice(0, colon), t.slice(colon + 1).trim()];
  const dash = t.match(/^(.{3,80}?)\s+[–—-]\s+(?=[A-ZÀ-Ú])(.+)$/);
  if (dash && wordsOf(dash[1]).length <= 9) return [dash[1], dash[2]];
  const per = t.match(/^(.{3,100}?)\.\s+(?=[A-ZÀ-Ú])(.+)$/);
  if (per && wordsOf(per[1]).length <= 12 && !ABBR.has(fold(per[1].split(/\s+/).pop()))) return [per[1], per[2]];
  if (t.length <= 110) return [t, ''];
  return [null, t];
}

// "1. Informes; 2. Calendário; ..."  ou  "a) ...; b) ..."  ou  "x; y; z"
function splitInlineItems(s) {
  const items = [];
  const re = /(?:^|[\s;])(\d{1,2}|[a-h])\s*[.)\-–]\s*([^;]+?)(?=\s*(?:;|\s\d{1,2}\s*[.)\-–]\s*[A-ZÀ-Ú]|\s[a-h]\)\s*[A-ZÀ-Ú]|$))/g;
  let m;
  while ((m = re.exec(s))) {
    const num = /^\d/.test(m[1]) ? +m[1] : null;
    const title = cleanTitle(m[2]);
    if (title) items.push({ num: num == null ? items.length + 1 : num, title });
  }
  // itens de pauta são curtos e a numeração só cresce; qualquer quebra disso é corpo de ata
  let cut = items.length;
  for (let k = 0; k < items.length; k++) {
    if ((k > 0 && items[k].num <= items[k - 1].num) || items[k].title.length > 100 || /[a-zà-ú]\.\s+[A-ZÀ-Ú]/.test(items[k].title)) { cut = k; break; }
  }
  items.length = cut;
  if (items.length >= 2) return items;
  const parts = s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every(p => p.length <= 110)) {
    return parts.map((p, i) => ({ num: i + 1, title: cleanTitle(p) })).filter(x => x.title);
  }
  return [];
}

function findPauta(info) {
  const N = info.length;
  const markAlone = /^(?:a\s+)?(?:pauta|ordem\s+do\s+dia|assuntos(?:\s+da\s+pauta)?|itens\s+d[ae]\s+pauta)(?:\s+d[aeo]\s+reuniao)?\s*$/;
  const markColon = /^(?:a\s+)?(?:pauta|ordem\s+do\s+dia|assuntos|itens\s+d[ae]\s+pauta)[^.:\n]{0,70}:/;
  for (let i = 0; i < N; i++) {
    if (!info[i].t) continue;
    const n = info[i].n;
    let inline = '';
    if (markAlone.test(n)) inline = '';
    else if (markColon.test(n)) inline = info[i].t.slice(info[i].t.indexOf(':') + 1).trim();
    else continue;

    let items = inline ? splitInlineItems(inline) : [];
    let to = i;
    if (!items.length && inline && inline.length <= 110 && !/[.]\s/.test(inline)) {
      const one = cleanTitle(inline);
      if (one) items = [{ num: 1, title: one }];
    }
    // linhas seguintes numeradas / com marcadores
    let j = i + 1, blanks = 0, lastItem = null;
    const inlineDone = items.length >= 2;
    while (!inlineDone && j < N && j <= i + 40) {
      const t = info[j].t;
      if (!t) { if (items.length > 0 || ++blanks > 1) break; j++; continue; }
      blanks = 0;
      const mNum = t.match(/^(\d{1,2})\s*(?:[.)\-–—]\s*|\s+(?=[A-ZÀ-Ú]))(\S.*)$/) || t.match(/^[-•*▪●–—]\s+(.+)$/);
      if (mNum) {
        const title = cleanTitle(mNum[2] || mNum[1]);
        if (title) { lastItem = { num: mNum[2] ? +mNum[1] : items.length + 1, title }; items.push(lastItem); to = j; }
        j++; continue;
      }
      if (lastItem && t.length <= 80 && /^[a-zà-ú]/.test(t) && !/[.;]$/.test(lastItem.title)) {   // continuação
        lastItem.title = cleanTitle(lastItem.title + ' ' + t) || lastItem.title; to = j; j++; continue;
      }
      break;
    }
    if (items.length) return { items, from: i, to };
  }
  // pauta inline em parágrafo corrido: "A pauta constou dos seguintes itens: 1) ...; 2) ..."
  // (analisa um parágrafo por vez, para não "vazar" para o corpo da ata)
  const paras = [];
  let acc = [];
  info.slice(0, 60).forEach(x => { if (x.t) acc.push(x.t); else if (acc.length) { paras.push(acc.join(' ')); acc = []; } });
  if (acc.length) paras.push(acc.join(' '));
  for (const para of paras) {
    const m = para.match(/(?:pauta|ordem\s+do\s+dia)[^:]{0,100}:\s*(\d{1,2}\s*[.)\-–]\s*.+)$/i);
    if (m) {
      const items = splitInlineItems(m[1]);
      if (items.length >= 2) return { items, from: -1, to: -1 };
    }
  }
  return null;
}

function markRegions(info) {
  const N = info.length;
  const region = new Array(N).fill(null);
  const presenca = /^(?:membros\s+)?(?:presentes|ausentes|participantes|compareceram|estiveram\s+presentes|presenca|lista\s+de\s+presenca|ausencias?\s+justificadas?|justificativas?\s+de\s+ausencia|convidados|assinam|assinaturas?)\b/;
  const closing = /^(?:nada\s+mais\s+(?:havendo|a\s+tratar)|nao\s+havendo\s+mais|e,?\s+nao\s+havendo|sem\s+mais\s+(?:a\s+tratar|assuntos)|encerrou-se|encerramento\b|eu,\s+.{0,60}lavrei|lavrei\s+a\s+presente|assinaturas?\b)/;
  for (let i = 0; i < N; i++) {
    if (!info[i].t) continue;
    if (i >= 3 && closing.test(info[i].n)) { for (let j = i; j < N; j++) region[j] = 'encerramento'; break; }
    if (presenca.test(info[i].n) && (info[i].t.length <= 80 || /:$/.test(info[i].t))) {
      region[i] = 'presenca';
      let j = i + 1, cnt = 0;
      while (j < N && cnt < 30) {
        const t = info[j].t;
        if (t && (t.length > 120 || RE_NUM_HEAD.test(t) || /^(?:pauta|ordem\s+do\s+dia)/i.test(t))) break;
        if (t && /[a-zà-ú]{4,}\s+[a-zà-ú]{4,}\s+[a-zà-ú]{4,}\s+[a-zà-ú]{4,}/.test(t) && /[.!?]$/.test(t)) break;  // virou prosa
        region[j] = 'presenca'; j++; cnt++;
      }
    }
  }
  return region;
}

function isCapsLine(t) {
  if (t.length < 4 || t.length > 100) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 4) return false;
  const up = letters.replace(/[^A-ZÀ-Ý]/g, '').length;
  return up / letters.length >= 0.85 && !/\d{2}[\/.]\d{2}/.test(t);
}
const DOC_TITLE_RE = /^(?:ata\b|universidade|ministerio|colegiado|reuniao\s+(?:ordinaria|extraordinaria)|curso\s+de|instituto|centro\s+de|faculdade|escola|\d+\s*[ªa]?\s*reuniao)/;

function buildStructure(text) {
  const lines = text.split('\n');
  const N = lines.length;
  const info = lines.map(l => { const t = l.trim(); return { t, n: fold(t) }; });
  const pauta = findPauta(info);
  const skip = new Array(N).fill(false);
  if (pauta && pauta.from >= 0) for (let i = pauta.from; i <= pauta.to; i++) skip[i] = true;
  const region = markRegions(info);

  // ---- candidatos a cabeçalho ----
  const numCands = [], capsCands = [], colonCands = [], titleCands = [];
  const lengths = info.filter(x => x.t).map(x => x.t.length).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 80;
  let actionLabelUntil = -1;
  for (let i = 0; i < N; i++) {
    const t = info[i].t;
    if (!t || skip[i] || region[i]) continue;
    if (/\||\t/.test(t)) continue;
    if (/^(?:encaminhamentos?|providencias|acoes|pendencias|tarefas|proximos\s+passos|decisoes?|deliberacoes?)\s*[:\-–]/.test(info[i].n)) actionLabelUntil = i + 8;
    let m = t.match(RE_NUM_HEAD) || null, num = null, text0 = null, kind = null;
    if (m) { num = +m[1]; text0 = m[2]; kind = 'num'; }
    else if ((m = t.match(RE_ITEM))) { num = +m[1]; text0 = m[2] || ''; kind = 'item'; }
    if (kind) {
      const looksAction = ACT_INF_START.test(text0) && i <= actionLabelUntil;
      if (!looksAction) numCands.push({ i, num, text: text0, kind });
      continue;
    }
    if (isCapsLine(t) && !DOC_TITLE_RE.test(info[i].n) && !/^(?:presentes|ausentes|assinaturas?)$/.test(info[i].n)) { capsCands.push({ i, text: t }); continue; }
    if (/^[A-ZÀ-Ú][^.!?]{2,80}:$/.test(t) && !/^(?:pauta|ordem|presentes|ausentes|encaminhamentos?|decis[õo]es|delibera[çc][õo]es)/i.test(t)) { colonCands.push({ i, text: t.replace(/:$/, '') }); continue; }
    // título provável: linha curta, sem pontuação final, entre blocos
    const prev = i > 0 ? info[i - 1].t : '';
    let nextIdx = i + 1; while (nextIdx < N && !info[nextIdx].t) nextIdx++;
    const next = nextIdx < N ? info[nextIdx].t : '';
    if (t.length <= 70 && t.length <= median * 0.7 && !/[.;,!?:]$/.test(t) && /^[A-ZÀ-Ú]/.test(t) &&
        wordsOf(t).length >= 1 && wordsOf(t).length <= 9 && (!prev || /[.!?:;]$/.test(prev)) &&
        next.length >= 60 && !DOC_TITLE_RE.test(info[i].n) && !RE_LIST.test(t) && i > 2 &&
        !/^(?:prof|profa|dr|dra)\b/i.test(t) && !/\d{2}[\/.]\d{2}/.test(t)) {
      titleCands.push({ i, text: t });
    }
  }

  // ---- escolhe o tipo de estrutura ----
  const accepted = [];
  let last = 0;
  numCands.forEach(c => {
    if ((c.num === last + 1) || (last === 0 && c.num <= 2) || (c.num === last + 2 && accepted.length > 0)) { accepted.push(c); last = c.num; }
  });
  let tipo = 'corrido', heads = [];
  if (accepted.length >= 2 || (accepted.length === 1 && pauta)) {
    tipo = 'numerada';
    heads = accepted.map(c => ({ i: c.i, num: c.num, raw: c.text, origem: c.kind === 'item' ? 'item numerado' : 'numeração', conf: 0.9 }));
  } else if (capsCands.length >= 2) {
    tipo = 'titulos';
    heads = capsCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'cabeçalho em maiúsculas', conf: 0.8 }));
  } else if (colonCands.length >= 2) {
    tipo = 'titulos';
    heads = colonCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'título seguido de dois-pontos', conf: 0.7 }));
  } else if (titleCands.length >= 2) {
    tipo = 'titulos';
    heads = titleCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'título provável', conf: 0.55 }));
  }

  // ---- monta blocos ----
  const pautaByNum = new Map();
  if (pauta) pauta.items.forEach(it => { if (!pautaByNum.has(it.num)) pautaByNum.set(it.num, it.title); });
  const headAt = new Map(heads.map(h => [h.i, h]));
  const blocks = [];
  let cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: 'abertura' };
  for (let i = 0; i < N; i++) {
    if (skip[i]) continue;
    if (region[i]) { if (cur.lines.length || cur.title) { blocks.push(cur); } cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: region[i] }; /* região ignorada */ continue; }
    if (cur.kind === 'presenca' || cur.kind === 'encerramento') { cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: 'texto' }; }
    const h = headAt.get(i);
    if (h) {
      blocks.push(cur);
      let title = null, body = '', origem = h.origem, conf = h.conf;
      if (h.raw) {
        const [tt, bb] = (tipo === 'numerada') ? splitTitleBody(h.raw) : [h.raw, ''];
        title = cleanTitle(tt); body = bb || '';
        if (tipo === 'numerada' && h.num != null && pautaByNum.has(h.num)) {
          const pt = pautaByNum.get(h.num);
          if (!title || wordsOf(tt || '').length > 12) { title = pt; origem = 'pauta + numeração'; }
          else origem = 'pauta + numeração';
          conf = 0.95;
        }
      } else if (h.num != null && pautaByNum.has(h.num)) { title = pautaByNum.get(h.num); origem = 'pauta + numeração'; conf = 0.95; }
      cur = { title, origem: title ? origem : null, conf: title ? conf : 0, num: h.num, lines: body ? [body] : [], kind: 'assunto' };
      continue;
    }
    cur.lines.push(info[i].t);
  }
  blocks.push(cur);
  return { tipo, pauta, blocks: blocks.filter(b => b.lines.some(Boolean) || b.title), rawLines: info, region };
}

/* ============================================================
   TERMOS TEMPORAIS — "PRAZO OU REFERÊNCIA TEMPORAL"
============================================================ */
const PREP_T = String.raw`(?:ate|durante|ao\s+longo\s+d[oa]|no\s+decorrer\s+d[oa]|em|no|na|ao|para\s+o|para\s+a|a\s+partir\s+d[oa]|antes\s+d[oa]|apos\s+o|apos\s+a|depois\s+d[oa]|desde\s+o|desde\s+a|por\s+todo\s+o)`;
const PERIOD_MOD = String.raw`(?:proxim[oa]s?|ultim[oa]|seguinte|presente|atual|corrente|este|esse|esta|essa|primeiro|segundo|terceiro|(?:1|2)\s*[ºo])`;
const EDGE = String.raw`(?:inicio|final|fim|meio|metade|termino|encerramento|comeco|decorrer)`;
const EVT_HEAD = String.raw`(?:prova|provas|avaliacao|avaliacoes|exame|exames|evento|eventos|semana\s+academica|congresso|seminario|jornada|colacao\s+de\s+grau|formatura|matricula|rematricula|periodo\s+de\s+matricula|inscricoes?|vestibular|enade|defesa|defesas|banca|bancas|feriado|recesso|ferias|greve|calendario|aprovacao|votacao|homologacao|publicacao|divulgacao|resultado|edital|visita|viagem|oficina|palestra|minicurso|mostra|feira|encontro|aula\s+inaugural|inicio\s+das\s+aulas|inicio\s+do\s+semestre|termino\s+do\s+semestre|fim\s+do\s+semestre|entrega|renovacao|credenciamento|processo\s+seletivo|selecao|concurso|chamada|conclusao|encerramento|abertura|retomada|retorno|implantacao|implementacao|execucao|realizacao|aplicacao)`;
const NOMINAL = String.raw`(?:realizacao|aplicacao|conclusao|divulgacao|publicacao|apresentacao|entrega|abertura|inicio|termino|fim|encerramento|aprovacao|homologacao|retorno|oferta|elaboracao|finalizacao|implantacao|implementacao|execucao)`;

const T_PATTERNS = [
  { tipo: 'data', kind: 'full', re: /(?:^|[^\d\/.\-])(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})(?![\d\/])/g },
  { tipo: 'data', kind: 'full2', re: /(?:^|[^\d\/.\-])(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2})(?![\d\/])/g },
  { tipo: 'data', kind: 'txt', re: rx('g')`(\d{1,2}\s*(?:º|o)?\s+de\s+(?:${MES_F})(?:\s+(?:de|do\s+ano\s+de)\s+\d{4})?)` },
  { tipo: 'data', kind: 'dm', re: /(?:^|[^\d\/.\-])(\d{1,2}\/\d{1,2})(?![\d\/])/g },
  { tipo: 'periodo', kind: 'mesano', re: rx('g')`\b((?:(?:no\s+)?mes\s+de\s+)?(?:${MES_F})\s+(?:de|do\s+ano\s+de)\s+\d{4})\b` },
  { tipo: 'periodo', kind: 'mes', re: rx('g')`\b((?:em|ate|no\s+mes\s+de|durante|a\s+partir\s+de|ate\s+o\s+(?:fim|final)\s+de|antes\s+de|apos|desde|ao\s+longo\s+de|no\s+inicio\s+de|no\s+final\s+de|na\s+primeira\s+quinzena\s+de|na\s+segunda\s+quinzena\s+de)\s+(?:o\s+mes\s+de\s+)?(?:${MES_F}))\b(?!\s+(?:de|do)\s+\d)` },
  { tipo: 'periodo', kind: 'sem', re: /(?:^|[^\d\/.\-])((?:20\d{2})[.\/-][12])(?!\d)/g },
  { tipo: 'periodo', kind: 'relA', re: rx('g')`\b(${PREP_T}\s+(?:(?:o|a)\s+)?(?:${EDGE}\s+d[oa]\s+)?(?:${PERIOD_MOD}\s+)?(?:semestre(?:\s+letivo)?|periodo(?:\s+letivo)?|trimestre|bimestre|quadrimestre|calendario\s+academico|recesso|ferias)(?:\s+(?:de\s+)?20\d{2}(?:[.\/][12])?)?)\b` },
  { tipo: 'periodo', kind: 'relB', re: rx('g')`\b(${PREP_T}\s+(?:(?:o|a)\s+)?(?:(?:${EDGE}\s+d[oa]\s+(?:${PERIOD_MOD}\s+)?)|(?:${PERIOD_MOD}\s+))(?:ano(?:\s+letivo)?|mes)(?:\s+(?:de\s+)?20\d{2})?)\b` },
  { tipo: 'periodo', kind: 'ano', re: /\b((?:em|ate|para|durante|no\s+ano\s+de|ate\s+o\s+(?:final|fim)\s+de|ao\s+longo\s+de|a\s+partir\s+de|desde|antes\s+de|apos)\s+20\d{2})\b(?![\/.\-]\d)/g },
  { tipo: 'periodo', kind: 'dur', re: /\b((?:em|dentro\s+de|no\s+prazo\s+de|no\s+maximo|ate|apos|depois\s+de)\s+(?:cerca\s+de\s+|aproximadamente\s+)?(?:\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|sessenta|noventa)\s*(?:\([^)]*\)\s*)?(?:dias?(?:\s+uteis|\s+corridos)?|semanas?|meses|mes|anos?|horas?|quinzenas?))\b/g },
  { tipo: 'periodo', kind: 'prox', re: /\b((?:nas|nos|na|no|nesta|neste|nessa|nesse|ate\s+a|ate\s+o|ate\s+as|ate\s+os)\s+(?:proxim[oa]s?|ultim[oa]s?|seguintes?)\s+(?:\d+\s+)?(?:semanas?|dias?(?:\s+uteis)?|meses|mes|quinzenas?|anos?))\b/g },
  { tipo: 'data', kind: 'wd', re: /\b((?:(?:na|ate\s+a|para\s+a|nesta|ate\s+esta|ate)\s+(?:proxima\s+)?(?:segunda|terca|quarta|quinta|sexta)(?:-feira)?(?!\s+(?:reuniao|vez|etapa|fase|parte|edicao|chamada|opcao|via|turma|sessao|pauta|unidade|prova|avaliacao))|(?:no|ate\s+o|neste|para\s+o|ate\s+este)\s+(?:proximo\s+)?(?:sabado|domingo)))\b/g },
  { tipo: 'reuniao', kind: 'reuA', re: /\b((?:ate|antes|apos|depois|durante|em|na|nas|para|logo\s+apos)\s+(?:a\s+|de\s+|da\s+|das\s+|o\s+)?(?:proxim[oa]s?|seguinte|futura|vindoura|subsequente)\s+(?:reuniao|reunioes|sessao|sessoes|assembleia|encontro|encontros|plenaria|oficina)(?:\s+(?:ordinaria|extraordinaria|do\s+colegiado|do\s+nde|do\s+curso|geral))?)/g },
  { tipo: 'reuniao', kind: 'reuB', re: rx('g')`\b((?:ate|antes\s+d[aeo]|apos|depois\s+d[aeo]|na|em|para\s+a|durante\s+a)\s+(?:a\s+)?reuniao\s+(?:seguinte|posterior|subsequente|futura|extraordinaria|de\s+(?:${MES_F}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|encerramento|avaliacao|planejamento)))` },
  { tipo: 'reuniao', kind: 'reuC', re: /\b((?:em|numa|em\s+uma)\s+(?:reuniao|sessao)\s+(?:futura|posterior|especifica|extraordinaria|especial)|em\s+nova\s+reuniao|em\s+outra\s+reuniao)\b/g },
  { tipo: 'evento', kind: 'evt', re: rx('g')`\b((?:antes|apos|depois|durante|ate|logo\s+apos|logo\s+antes|por\s+ocasiao|ao\s+final|ao\s+termino|no\s+momento|na\s+vespera|a\s+partir)\s+(?:d[aeo]s?|ao|aos|a|o|as|os|n[ao]s?)\s+(?:(?:proxim[oa]s?|ultim[oa]s?|primeir[oa]s?)\s+)?(?:${NOMINAL}\s+d[aeo]s?\s+)?${EVT_HEAD}(?:\s+d[aeo]s?\s+[\w-]+){0,2})` },
  { tipo: 'evento', kind: 'cond', re: /\b((?:assim\s+que|logo\s+que|tao\s+logo|uma\s+vez\s+(?:que\s+)?)\s*(?:\S+\s+){1,6}?)(?=[,.;]|$)/g },
  { tipo: 'indefinido', kind: 'vague', re: /\b((?:o\s+)?quanto\s+antes|com\s+urgencia|em\s+carater\s+de\s+urgencia|urgentemente|imediatamente|de\s+imediato|em\s+breve|brevemente|posteriormente|oportunamente|futuramente|a\s+curto\s+prazo|a\s+medio\s+prazo|a\s+longo\s+prazo|no\s+futuro|em\s+momento\s+oportuno|logo\s+que\s+possivel|assim\s+que\s+possivel|sem\s+demora|periodicamente|mensalmente|semestralmente|anualmente|semanalmente|regularmente|continuamente|hoje|amanha|na\s+proxima\s+semana|nesta\s+semana)\b/g }
];

const DATE_PREFIXES = ['prazo final de','prazo final:','prazo final','prazo maximo de','prazo maximo','prazo de','prazo:','prazo','data limite:','data limite de','data limite','ate o dia','ate dia','ate a data de','ate o','ate','a partir do dia','a partir de','a partir do','desde o dia','desde','antes do dia','antes de','antes do','apos o dia','apos','depois de','em','no dia','dia','para o dia','para'];

function parseDateRef(core, ctx) {
  const c = fold(core);
  let m;
  if ((m = c.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})/))) return isoOf(m[3], m[2], m[1]);
  if ((m = c.match(rx('')`(\d{1,2})\s*(?:º|o)?\s+de\s+(${MES_F})(?:\s+(?:de|do\s+ano\s+de)\s+(\d{4}))?`))) {
    let y = m[3];
    if (!y) {
      y = ctx && ctx.meetingISO ? +ctx.meetingISO.slice(0, 4) : null;
      if (y && ctx.meetingISO && MES_NUM[m[2]] < +ctx.meetingISO.slice(5, 7) - 1) y += 1;
    }
    return y ? isoOf(y, MES_NUM[m[2]], m[1]) : null;
  }
  if ((m = c.match(/^(\d{1,2})\/(\d{1,2})$/))) {
    let y = ctx && ctx.meetingISO ? +ctx.meetingISO.slice(0, 4) : null;
    if (y && +m[2] < +ctx.meetingISO.slice(5, 7) - 1) y += 1;
    return y ? isoOf(y, m[2], m[1]) : null;
  }
  return null;
}

/* Devolve { principal, refs }.  Cada ref: { texto, tipo, dataAssociada, iso, start, end }.
   Textos relativos são preservados exatamente como na ata.                    */
function findTemporal(sentence, ctx) {
  ctx = ctx || {};
  const n = fold(sentence);
  const found = [];
  T_PATTERNS.forEach(p => {
    p.re.lastIndex = 0;
    let x;
    while ((x = p.re.exec(n))) {
      if (x[0].length === 0) { p.re.lastIndex++; continue; }
      const g = x[1];
      const coreStart = x.index + x[0].indexOf(g);
      const coreEnd = coreStart + g.length;
      let rec = { tipo: p.tipo, kind: p.kind, start: coreStart, coreStart, end: coreEnd };
      if (p.tipo === 'data' && ['full', 'full2', 'txt', 'dm'].includes(p.kind)) {
        // dd/mm solto só vale com contexto temporal e fora de numeração oficial
        if (p.kind === 'dm') {
          const before = n.slice(Math.max(0, coreStart - 24), coreStart);
          if (!/(?:ate|em|dia|para|ao|data|prazo)\s+(?:o\s+)?(?:dia\s+)?$/.test(before)) continue;
          if (/(?:n[ºo°]?|resolucao|portaria|edital|processo|lei|decreto|art|instrucao|oficio|memorando)\s*\.?\s*$/.test(before)) continue;
          const mm = g.split('/'); if (+mm[0] > 31 || +mm[1] > 12) continue;
        }
        const iso = parseDateRef(sentence.slice(coreStart, coreEnd), ctx);
        if (p.kind !== 'txt' && !iso) continue;
        rec.iso = iso;
        // estende para trás: "prazo até", "até o dia", "a partir de", "de 10 a"
        let k = coreStart, pre = n.slice(0, coreStart), guard = 0;
        const range = pre.match(/(?:de\s+)?(\d{1,2})\s+a\s+$/);
        if (range) { k = coreStart - range[0].length; pre = n.slice(0, k); }
        while (guard++ < 3) {
          let hit = null;
          for (const pf of DATE_PREFIXES) {
            if (pre.endsWith(pf + ' ') || pre.endsWith(pf)) {
              const at = pre.length - (pre.endsWith(pf + ' ') ? pf.length + 1 : pf.length);
              if (at === 0 || /[^a-z]/.test(pre[at - 1])) { hit = pf.length + (pre.endsWith(pf + ' ') ? 1 : 0); break; }
            }
          }
          if (!hit) break;
          k -= hit; pre = n.slice(0, k);
        }
        rec.start = k;
      } else if (p.kind === 'cond') {
        rec.end = coreEnd;
      }
      // referências absolutas anteriores à data da reunião são passado, não prazo
      if (rec.iso && ctx.meetingISO && rec.iso < ctx.meetingISO) continue;
      if (p.kind === 'ano') {
        const yy = +(g.match(/20\d{2}/) || [0])[0];
        if (ctx.meetingISO && yy < +ctx.meetingISO.slice(0, 4)) continue;
      }
      found.push(rec);
    }
  });

  // resolve sobreposições: começa antes e é mais longo
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const refs = [];
  found.forEach(r => {
    const last = refs[refs.length - 1];
    if (last && r.start < last.end) {
      if ((r.end - r.start) > (last.end - last.start) && r.start <= last.start) refs[refs.length - 1] = r;   // o maior vence
      return;
    }
    refs.push(r);
  });

  // data absoluta logo depois de um evento/reunião/período -> "data associada"
  const LINK = /^[\s,;:(–-]*(?:(?:que\s+)?(?:esta\s+|estara\s+|sera\s+|foi\s+)?(?:marcad|previst|agendad|programad|fixad|convocad|designad)[oa]s?\s*)?(?:(?:que\s+)?(?:ocorrera|acontecera|ocorre|acontece|sera\s+realizad[oa]|sera\s+aplicad[oa]|sera|e)\s*)?(?:para\s+|em\s+|no\s+dia\s+|dia\s+|nos\s+dias\s+|de\s+|do\s+dia\s+|na\s+data\s+de\s+|a\s+partir\s+de\s+|ate\s+)?(?:o\s+dia\s+)?$/;
  const attached = new Set();
  refs.forEach((r, i) => {
    if (r.tipo === 'data' || r.tipo === 'indefinido') return;
    const d = refs[i + 1];
    if (d && d.tipo === 'data' && d.coreStart - r.end <= 90 && LINK.test(n.slice(r.end, d.coreStart))) {
      r.dataAssociada = sentence.slice(d.coreStart, d.end).trim();
      r.iso = d.iso || null;
      attached.add(d);
    }
  });

  const out = refs.map(r => ({
    texto: squash(sentence.slice(r.start, r.end)), core: squash(sentence.slice(r.coreStart, r.end)), tipo: r.tipo,
    dataAssociada: r.dataAssociada || null, iso: r.iso || null, start: r.start, end: r.end, anexa: attached.has(r)
  }));
  const standalone = out.filter(r => !r.anexa);
  const concrete = standalone.filter(r => r.tipo !== 'indefinido');
  const principal = (concrete[0] || standalone[0]) || null;
  return { principal, refs: out };
}

/* ============================================================
   RESPONSÁVEIS  (pessoas, cargos e grupos)
   Não depende da palavra "responsável": procura o SUJEITO que
   antecede o verbo de ação e agentes explícitos ("pela secretaria",
   "cabe ao NDE", "a cargo de ...", "Responsável: ...").
============================================================ */
const NAME_TOK = /^[A-ZÀ-Ú][a-zà-úA-ZÀ-Ú'’-]+\.?$|^[A-ZÀ-Ú]\.$/;
const DET_RE = /^(?:o|a|os|as|um|uma)$/;
const PART_RE = /^(?:d[aeo]s?|di|von|van)$/;

function tokClean(tk) { return tk.replace(/^[("“]+/, '').replace(/[,;:)"”]+$/, ''); }
function isNameTok(tk) {
  const w = tokClean(tk);
  if (!NAME_TOK.test(w)) return false;
  const bare = w.replace(/\.$/, '');
  if (CAP_STOP.has(bare) || TITLE_SET.has(fold(bare))) return false;
  if (/mente$/.test(bare)) return false;
  if (bare.length > 1 && bare === bare.toUpperCase()) return ORG_ACRONYMS.has(bare);
  return true;
}

// Caminha de trás para frente a partir do verbo e junta o sintagma do sujeito.
function subjectBefore(region) {
  let r = region.replace(/\s+$/, '');
  const FILL = /\s+(?:se|tamb[eé]m|ainda|ent[aã]o|logo|j[aá]|prontamente|depois|igualmente|n[aã]o)$/i;
  while (FILL.test(r)) r = r.replace(FILL, '');
  const toks = r.split(/\s+/).filter(Boolean);
  let e = toks.length - 1;
  const got = [];
  let entity = false;
  // complemento final: "... coordenação [do curso de Pedagogia]"
  for (let len = 1; len <= 3 && !got.length; len++) {
    const dIdx = e - len + 1;
    if (dIdx >= 1 && PART_RE.test(fold(toks[dIdx])) && ACTOR_SET.has(fold(tokClean(toks[dIdx - 1])))) {
      for (let k = e; k >= dIdx; k--) got.unshift(toks[k]);
      e = dIdx - 1; break;
    }
  }
  while (e >= 0) {
    const tk = toks[e];
    const f = fold(tokClean(tk));
    const right = got.length ? fold(tokClean(got[0])) : null;
    const rightIsDetOrNoun = right && (DET_RE.test(right) || ACTOR_SET.has(right) || TITLE_SET.has(right.replace(/\.$/, '')));
    if (ACTOR_SET.has(f)) { got.unshift(tk); entity = true; e--; continue; }
    if (TITLE_SET.has(f.replace(/\.$/, ''))) { got.unshift(tk); e--; continue; }
    if (isNameTok(tk) && !rightIsDetOrNoun) { got.unshift(tk); entity = true; e--; continue; }
    if (PART_RE.test(f) && got.length && e > 0 && isNameTok(toks[e - 1])) { got.unshift(tk); e--; continue; }
    if (f === 'e' && got.length && e > 0 && (isNameTok(toks[e - 1]) || ACTOR_SET.has(fold(tokClean(toks[e - 1]))))) { got.unshift(tk); e--; continue; }
    if (DET_RE.test(f) && got.length) { got.unshift(tk); e--; continue; }
    break;
  }
  if (!entity) return null;
  // nome solto logo após preposição ("reprovados em Álgebra") é complemento, não sujeito
  if (e >= 0 && /^(?:em|de|para|por|com|sem|sobre|no|na|nos|nas|ao|aos|pelo|pela|entre|ate|apos)$/.test(fold(tokClean(toks[e]))) &&
      !got.some(t => ACTOR_SET.has(fold(tokClean(t))) || TITLE_SET.has(fold(tokClean(t)).replace(/\.$/, '')))) return null;
  return got.join(' ');
}

function forwardPhrase(str) {
  const toks = str.trim().split(/\s+/).filter(Boolean).slice(0, 12);
  const got = [];
  let entity = false, i = 0;
  while (i < toks.length) {
    const tk = toks[i], f = fold(tokClean(tk));
    const prevEndsComma = got.length && /,$/.test(got[got.length - 1]);
    if (DET_RE.test(f) && (got.length === 0 || prevEndsComma || fold(got[got.length - 1]) === 'e')) { got.push(tk); i++; continue; }
    if (ACTOR_SET.has(f)) {
      got.push(tk); entity = true; i++;
      // complemento: "coordenação do curso (de X)"
      if (i + 1 < toks.length && PART_RE.test(fold(toks[i])) && /^(?:curso|colegiado|departamento|centro|instituto|escola|setor|nucleo|unidade)$/.test(fold(tokClean(toks[i + 1])))) {
        got.push(toks[i], toks[i + 1]); i += 2;
        if (i + 1 < toks.length && PART_RE.test(fold(toks[i])) && NAME_TOK.test(tokClean(toks[i + 1]))) { got.push(toks[i], toks[i + 1]); i += 2; }
      }
      continue;
    }
    if (TITLE_SET.has(f.replace(/\.$/, ''))) { got.push(tk); i++; continue; }
    if (isNameTok(tk)) { got.push(tk); entity = true; i++; continue; }
    if (PART_RE.test(f) && got.length && i + 1 < toks.length && isNameTok(toks[i + 1])) { got.push(tk); i++; continue; }
    if (f === 'e' && got.length && i + 1 < toks.length && (isNameTok(toks[i + 1]) || ACTOR_SET.has(fold(tokClean(toks[i + 1]))) || DET_RE.test(fold(toks[i + 1])))) { got.push(tk); i++; continue; }
    break;
  }
  return entity ? got.join(' ') : null;
}

function parseEntities(phrase, known) {
  const parts = phrase.split(/\s*,\s*|\s+e\s+(?=(?:o|a|os|as)\s|[A-ZÀ-Ú]|prof)/i).map(x => x.trim()).filter(Boolean);
  const out = [];
  parts.forEach(part => {
    const toks = part.split(/\s+/).map(tokClean).filter(Boolean);
    let cargo = null; const nameToks = []; const groupToks = [];
    let inName = false;
    toks.forEach(tk => {
      const f = fold(tk);
      if (!inName && DET_RE.test(f)) return;
      if (!inName && TITLE_SET.has(f.replace(/\.$/, ''))) { cargo = cargo || ({ prof: 'Professor', profa: 'Professora', professor: 'Professor', professora: 'Professora', dr: 'Dr.', dra: 'Dra.', sr: 'Sr.', sra: 'Sra.' }[f.replace(/\.$/, '')] || cap1(tk)); return; }
      if (!inName && ACTOR_SET.has(f)) { groupToks.push(tk); if (ROLE_SET.has(f) && !cargo) cargo = cap1(tk); return; }
      if (isNameTok(tk)) { inName = true; nameToks.push(tk); return; }
      if (PART_RE.test(f)) { (inName ? nameToks : groupToks).push(tk); return; }
      if (!inName) groupToks.push(tk);
    });
    while (nameToks.length && PART_RE.test(fold(nameToks[nameToks.length - 1]))) nameToks.pop();
    if (nameToks.length) {
      let nome = nameToks.join(' ').replace(/\.$/, m => (nameToks.length === 1 && nameToks[0].length === 2) ? m : '');
      if (known && known.length && nameToks.length === 1) {
        const hits = known.filter(k => fold(k.split(/\s+/)[0]) === fold(nome));
        if (hits.length === 1) nome = hits[0];
      }
      out.push({ nome, cargo: cargo && !ACTOR_SET.has(fold(nome)) ? cargo : null, tipo: 'pessoa' });
    } else if (groupToks.length) {
      const g = squash(groupToks.join(' '));
      if (g) out.push({ nome: cap1(g), cargo: null, tipo: 'grupo' });
    }
  });
  const seen = new Set();
  return out.filter(o => { const k = fold(o.nome); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Retorna [{nome,cargo,tipo}]
function extractActors(orig, n, cueStart, ctx, explicitOnly) {
  const known = ctx.participantes || [];
  let m;
  // 1. rótulo "Responsável: X, Y"
  if ((m = n.match(/respons[a-z]*\s*[:\-–]\s*/))) {
    const after = orig.slice(m.index + m[0].length).replace(/[.;].*$/, '');
    const ents = parseEntities(after.replace(/\bprazo\b.*$/i, ''), known).filter(Boolean);
    if (ents.length) return ents;
  }
  // 2. agente explícito
  const expl = [
    /\ba\s+cargo\s+d[aeo]s?\s+/, /\bsob\s+(?:a\s+)?responsabilidade\s+d[aeo]s?\s+/,
    /\b(?:cabe|cabera|caberao|compete|competira|competirao|incumbe|incumbira)\s+(?:a|ao|aos|as)\s+/
  ];
  for (const re of expl) {
    if ((m = n.match(re))) {
      const ph = forwardPhrase(orig.slice(m.index + m[0].length));
      if (ph) { const ents = parseEntities(ph, known); if (ents.length) return ents; }
    }
  }
  // 3. agente da passiva: "será enviado pela secretaria"
  const pel = n.slice(cueStart >= 0 ? cueStart : 0).match(/\bpel[ao]s?\s+/);
  if (pel) {
    const at = (cueStart >= 0 ? cueStart : 0) + pel.index + pel[0].length;
    const ph = forwardPhrase(orig.slice(at));
    if (ph) { const ents = parseEntities(ph, known); if (ents.length) return ents; }
  }
  if (explicitOnly || cueStart < 0) return [];
  // 4. sujeito antes do verbo
  const pre = orig.slice(0, cueStart);
  const segs = pre.split(/(?:[;:]|\bque\b|,\s+(?:e\s+|mas\s+)?(?:ent[aã]o\s+)?)/i).map(x => x.trim());
  let tried = 0;
  for (let i = segs.length - 1; i >= 0 && tried < 3; i--) {
    if (!segs[i]) continue;
    tried++;
    const ph = subjectBefore(segs[i]);
    if (ph) { const ents = parseEntities(ph, known); if (ents.length) return ents; }
    if (i === segs.length - 1 && tried === 1 && segs[i].split(/\s+/).length > 6) break;
  }
  return [];
}

/* ============================================================
   CLASSIFICAÇÃO LINGUÍSTICA DE SENTENÇAS
   Cada sentença recebe pontuações independentes (0–1) para:
   decisão · encaminhamento · sugestão/proposta · problema · demanda.
   Palavras isoladas ("aprovar") nunca bastam: é preciso uma
   ESTRUTURA (foi + particípio, verbo + "-se", sujeito + verbo
   deliberativo, resultado de votação...).
============================================================ */
const DEC_PART = String.raw`(?:(?:aprovad|reprovad|deferid|indeferid|homologad|acordad|decidid|definid|deliberad|estabelecid|aceit|rejeitad|negad|autorizad|acatad|mantid|referendad|ratificad|consensuad|pactuad|convalidad|combinad|acertad|ajustad|escolhid|eleit|nomead|vetad|recusad|acolhid|concedid|adiad|prorrogad|cancelad|arquivad)[oa]s?|suspens[oa]s?)`;
const DEC_STRONG_PART = /(?:decidid|definid|acordad|combinad|deliberad|estabelecid|consensuad|pactuad|acertad)/;
const RE_FRAME = rx('g')`\b(?:foi|foram|ficou|ficaram|fica|ficam)\s+((?:\S+\s+){0,3}?)(${DEC_PART})\b`;
const RE_START_PART = /^(?:aprovad|reprovad|deferid|indeferid|homologad|rejeitad|aceit|acatad|negad|autorizad|mantid)[oa]s?\b/;
const RE_SE = /\b(?:decidiu|aprovou|deliberou|definiu|acordou|resolveu|determinou|estabeleceu|homologou|deferiu|indeferiu|rejeitou|aceitou|autorizou|ratificou|referendou|optou|consensuou|combinou|reprovou|acatou|vetou|decidiram|aprovaram|deliberaram|definiram|acordaram|resolveram|rejeitaram|aceitaram|deferiram|indeferiram|homologaram|autorizaram|optaram)-se\b/;
const RE_AGENT = /\b(?:decidiu|decidiram|deliberou|deliberaram|definiu|definiram|acordou|acordaram|aprovou|aprovaram|reprovou|reprovaram|rejeitou|rejeitaram|aceitou|aceitaram|acatou|acataram|deferiu|deferiram|indeferiu|indeferiram|homologou|homologaram|autorizou|autorizaram|ratificou|ratificaram|referendou|referendaram|optou|optaram|estabeleceu|estabeleceram|decidimos|deliberamos|definimos|acordamos|aprovamos|optamos)\b(?!-se)/;
const RE_CONCORD = /\b(?:concordou|concordaram|concordamos|consentiu|consentiram|determinou|determinaram)\b/;
const RE_COLLECTIVE = /\b(?:todos|todas|unanimemente|os\s+presentes|os\s+membros|o\s+colegiado|o\s+grupo|a\s+plenaria|o\s+conselho|a\s+assembleia|por\s+unanimidade|por\s+maioria|o\s+nde|a\s+comissao)\b/;
const RE_CONSENSO = /\bchegou-se\s+(?:a|ao)\s+(?:um\s+)?consenso\b|\bhouve\s+consenso\b/;
const RE_VOTE = /\bpor\s+(?:unanimidade|maioria)\b|\b(?:\d+|\w+)\s+votos?\s+(?:favoravei?s?|contr\w+|a\s+favor)|\bcolocad[oa]s?\s+em\s+votacao\b|\bem\s+votacao\b|\bapos\s+votacao\b|\bresultado\s+da\s+votacao\b|\bsem\s+objecoes?\b|\bsem\s+votos?\s+contrari/;
const RE_VOTE_START = /^(?:por\s+(?:unanimidade|maioria)(?:\s+(?:simples|absoluta|dos\s+votos|dos\s+presentes))?|com\s+\w+\s+votos?\s+\w+|sem\s+objecoes?)\b/;
const RE_REF_A = rx('g')`\b(?:conforme|como|segundo|de\s+acordo\s+com|nos\s+termos\s+d[aeo]s?|previst[oa]\s+n[aeo]s?|ja\s+(?:foi|foram|havia|haviam)|havia(?:m)?\s+sido|tinha(?:m)?\s+sido|anteriormente)\b(?:\S+\s+){0,6}?${DEC_PART}\b`;
const RE_REF_B = rx('g')`${DEC_PART}\s+(?:\S+\s+){0,4}?(?:n[ao]|em|durante)\s+(?:\S+\s+){0,2}?(?:reuniao|sessao|assembleia)\s+(?:anterior|passada|de\s+(?:\d|${MES_F}))`;
const RE_HEDGE = /\b(?:ainda\s+nao|a\s+ser\s+(?:aprovad|definid|decidid|deliberad)\w*|sera\s+(?:aprovad|definid|decidid|submetid|deliberad)\w*|a\s+(?:definir|decidir|deliberar|aprovar)|em\s+(?:discussao|analise|tramitacao|andamento)|aguard\w+|pendente|nao\s+ha\s+previsao|talvez|possivelmente|provavelmente|eventualmente|poderia|poderiam|gostaria|gostariam)\b/;
const RE_COND = /\b(?:caso|se\s+for|se\s+forem|se\s+houver|quando\s+for|uma\s+vez\s+aprovad\w*|desde\s+que)\b/;
const RE_STUDENT = /\b(?:alunos?|alunas?|estudantes?|discentes?|candidat[oa]s?|turma|formandos?|ingressantes?)\b/;
const RE_NOT_STUDENT_OBJ = /\b(?:proposta|pedido|solicitacao|requerimento|projeto|plano|calendario|ata|relatorio|parecer|ppc|matriz|regulamento|resolucao|edital|minuta|documento|reformulacao|alteracao|ementa|criacao|inclusao|exclusao|oferta|convenio|planejamento|programacao|carga|horario|quadro|distribuicao|proposicao|mocao|nome|indicacao|equivalencia|aproveitamento|prorrogacao|credenciamento|descredenciamento|afastamento|licenca)\b/;

const RE_PROP_VERB = /\b(?:sugeriu|sugeriram|sugere|sugerem|sugeria|propos|propoe|propuseram|propoem|propunha|recomendou|recomendaram|recomenda|recomendam|cogitou|cogitaram|ponderou|ponderaram|levantou\s+a\s+possibilidade|levantaram\s+a\s+possibilidade|opinou|opinaram|defendeu|defenderam|sugeriu-se|propos-se|recomenda-se|cogitou-se|sugere-se|propoe-se|ponderou-se|foi\s+(?:sugerid|propost|recomendad|cogitad|ponderad)[oa]|apresentou\s+(?:a|uma|duas|tres|algumas)?\s*(?:proposta|sugestao|ideia|alternativa|opcao)|apresentaram\s+(?:\w+\s+)?(?:proposta|sugestao|ideia|alternativa)|foi\s+apresentad[oa]\s+(?:a\s+|uma\s+)?(?:proposta|sugestao|ideia|alternativa))\b/;
const RE_PROP_MODAL = /\b(?:seria\s+(?:interessante|importante|necessario|recomendavel|bom|melhor|possivel|viavel|ideal|oportuno|valido|util)|poderia(?:m)?|poderiamos|poder-se-ia|talvez|e\s+possivel\s+(?:que|\w+r\b)|possibilidade\s+de|vale\s+a\s+pena|que\s+tal|a\s+ideia\s+(?:e|seria)|avaliar\s+a\s+possibilidade|estudar\s+a\s+possibilidade|pensar\s+em)\b/;
const RE_PROPOSAL_FORMAL = /\b(?:proposta|projeto|minuta)\b/;

const RE_DISCUSS = /\b(?:discuti(?:u|ram)|discutiu-se|discutiram-se|debate(?:u|ram)|debatid[oa]s?|discutid[oa]s?|discussao|discussoes|conversou|conversaram|dialogou|analisou-se|analisaram|analisad[oa]s?|apresentou|apresentaram|apresentad[oa]s?|relatou|relataram|informou|informaram|esclareceu|esclareceram|expos|expuseram|explanou|comentou|questionou|abordou|abordaram|abordad[oa]s?|tratou-se|trataram-se|foi\s+tratad[oa])\b/;

// ---- problemas e demandas ----
const RE_PROB_CUE = /\b(?:problema[s]?|problematic[oa]s?|dificuldade[s]?|dificil|dificeis|reclamac(?:ao|oes)|reclamou|reclamaram|queixa[s]?|queixou-se|queixaram-se|preocupac(?:ao|oes)|preocupad[oa]s?|preocupante[s]?|falta\s+de|ausencia\s+de|carencia|insuficien\w+|deficit|deficiencia[s]?|evas\w+|evadi\w+|retencao|reprovacoes?|infrequencia|desist\w+|atraso[s]?|atrasad[oa]s?|inadequad[oa]s?|inexistente[s]?|impossibilidade|impedimento[s]?|entrave[s]?|gargalo[s]?|limitac(?:ao|oes)|insatisfac(?:ao|oes)|conflito[s]?|falha[s]?|erro[s]?|sobrecarga|sobrecarregad[oa]s?|excesso\s+de|queda|baixo\s+(?:desempenho|rendimento|aproveitamento|numero)|baixa\s+(?:procura|adesao|frequencia|participacao)|dificultand\w+|prejudic\w+|impacto\s+negativo|riscos?|dificuldades|precari\w+|defasad[oa]s?|obsolet[oa]s?|sem\s+(?:acesso|estrutura|condicoes|recursos|professor\w*))\b/;
const RE_REPORT = /\b(?:foi|foram)\s+(?:relatad|apontad|identificad|observad|constatad|verificad|registrad|levantad|mencionad|pontuad|destacad|ressaltad|sinalizad|percebid|detectad|informad|comunicad|expost|manifestad)[oa]s?\b|\b(?:relatou|relataram|apontou|apontaram|destacou|ressaltou|pontuou|observou|constatou|verificou|salientou|alertou|denunciou|mencionou|mencionaram|expos|sinalizou|sinalizaram|verificou-se|constatou-se|observou-se|identificou-se|percebeu-se|notou-se|registrou-se|houve|ha\s+(?:relatos?|reclamac\w+|queixas?)|os\s+participantes\s+(?:demonstraram|manifestaram|relataram|apontaram)|demonstrou\s+preocupacao|manifestou\s+preocupacao|demonstraram\s+preocupacao|manifestaram\s+preocupacao)\b/;
const RE_STATE = /\b(?:ha|existe|existem|persiste|persistem|ocorre|ocorrem|esta|estao|continua|continuam|vem\s+\w+ndo|segue|seguem|tem|tem|apresenta|apresentam|enfrenta|enfrentam)\b/;
const RE_PROB_RESOLVED = /\b(?:resolveu|solucionou|resolvid[oa]s?|superad[oa]s?|sanad[oa]s?|equacionad[oa]s?|solucionad[oa]s?)\b/;
const RE_NO_PROB = /\bnao\s+(?:ha|houve|existe|existem|foram|foi|tem)\s+(?:\S+\s+){0,2}?(?:problemas?|dificuldades?|reclamac\w+|pendencias?|queixas?)|\bsem\s+(?:problemas?|dificuldades?|pendencias?)|\bnenhum[a]?\s+(?:problema|dificuldade|pendencia|reclamacao)/;

const RE_REQUEST = /\b(?:solicitou|solicitaram|solicita-se|solicitou-se|foi\s+solicitad[oa]s?|foram\s+solicitad[oa]s?|pediu|pediram|pede-se|foi\s+pedid[oa]|requereu|requereram|requer-se|reivindicou|reivindicaram|demandou|demandaram|manifestou\s+(?:interesse|desejo)|manifestaram\s+(?:interesse|desejo)|registrou-se\s+(?:a|uma)\s+demanda|foi\s+registrad[oa]\s+(?:a\s+|uma\s+)?demanda|os\s+participantes\s+solicitaram|demandas?\s+d[aeo]s?\s+\w+)\b/;
const RE_NEED = /\b(?:(?:ha|existe|surgiu|identificou-se|foi\s+identificad[oa]|foi\s+apontad[oa]|foi\s+levantad[oa]|verificou-se|constatou-se|observou-se)\s+(?:a\s+)?(?:necessidade|urgencia|carencia|demanda)\b|e\s+(?:necessario|preciso|imprescindivel|fundamental|urgente)\b|sera\s+necessari[oa]s?\b|faz(?:em)?\s+falta\b|precisa(?:m)?\s+(?:de|ser)\b|necessita(?:m)?\b|necessidade\s+de\b)/;
const RE_REQUEST_PROCEDURAL = /\b(?:solicit\w*|ped\w*)\s+(?:a\s+)?(?:palavra|esclarecimentos?|vista|licenca|inclusao\s+(?:de|na)\s+pauta|desculpas)\b/;

const RE_INTENT = /\b(?:gostaria|gostariam|pretende|pretendem|pretendia|planeja|planejam|tem\s+a\s+intencao|ha\s+a\s+intencao|espera-se|esperam-se|deseja|desejam|almeja)\b/;
const RE_FUT_HINT = /\b(?:sera|serao|devera|deverao|ira|irao|vai|vao|ate|antes|apos|a\s+partir|proxim\w+|prazo|durante|passa\s+a|passara|entrara|vigora|vigorar|valera|implant\w+|implement\w+)\b/;

function snippetOf(origTokens, m, start, len) {
  const w0 = (m.slice(0, start).match(/\S+/g) || []).length;
  const wc = (m.slice(start, start + len).match(/\S+/g) || []).length || 1;
  return origTokens.slice(w0, w0 + wc).join(' ').replace(/[,;]+$/, '');
}

function scoreDecision(orig, n, m, toks, sctx) {
  if (/^\s*(?:ata|reuniao)\b/.test(n) && n.length < 40) return null;
  let best = null;
  const consider = (score, gat, kind) => { if (!best || score > best.score) best = { score, gatilho: gat, kind }; };
  const refSpans = [];
  [RE_REF_A, RE_REF_B].forEach(re => { re.lastIndex = 0; let r; while ((r = re.exec(m))) { refSpans.push([r.index, r.index + r[0].length]); if (!r[0].length) re.lastIndex++; } });
  const inRef = idx => refSpans.some(([a, b]) => idx >= a && idx < b);

  // (1) foi/ficou + particípio
  RE_FRAME.lastIndex = 0;
  let fm;
  while ((fm = RE_FRAME.exec(m))) {
    const between = fm[1] || '';
    if (/\b(?:que|se|quando|caso|porque|pois|como|onde)\b/.test(between)) continue;
    const partIdx = fm.index + fm[0].length - fm[2].length;
    if (inRef(fm.index)) continue;
    let sc = DEC_STRONG_PART.test(fm[2]) ? 0.8 : 0.72;
    // resultado acadêmico de aluno ("alunos foram aprovados") não é deliberação
    if (/^(?:aprovad|reprovad)/.test(fm[2])) {
      const before = m.slice(0, fm.index);
      if (RE_STUDENT.test(before) && !RE_NOT_STUDENT_OBJ.test(m)) sc -= 0.5;
    }
    consider(sc, snippetOf(toks, m, fm.index, fm[0].length), 'frame');
  }
  if (!best) {
    const sp = m.match(RE_START_PART);
    if (sp && !/^(?:aprovad|reprovad)[oa]s?\s+(?:em|na|no|nas|nos)\b/.test(m)) consider(0.7, snippetOf(toks, m, sp.index, sp[0].length), 'start');
  }
  // (2) verbo + "-se"
  let x = m.match(RE_SE);
  if (x && !inRef(x.index)) consider(0.76, snippetOf(toks, m, x.index, x[0].length), 'se');
  // (3) sujeito + verbo deliberativo
  x = m.match(RE_AGENT);
  if (x && !inRef(x.index)) {
    const ctxAfter = m.slice(x.index, x.index + 40);
    if (!/^(?:aprovou|aprovaram|reprovou|reprovaram)\s+(?:o|a|os|as)\s+(?:alun|estud|candidat|discent)/.test(ctxAfter)) consider(0.72, snippetOf(toks, m, x.index, x[0].length), 'agente');
  }
  x = m.match(RE_CONCORD);
  if (x && RE_COLLECTIVE.test(m)) consider(0.7, snippetOf(toks, m, x.index, x[0].length), 'consenso');
  x = m.match(RE_CONSENSO);
  if (x && !/\bnao\s+(?:\S+\s+){0,1}?(?:chegou-se|houve)\b/.test(m)) consider(0.68, snippetOf(toks, m, x.index, x[0].length), 'consenso');
  // (4) só o resultado da votação, sem verbo ("Por unanimidade.")
  if (!best && RE_VOTE_START.test(m) && wordsOf(orig).length <= 8) consider(0.6, orig.replace(/[.!]+$/, ''), 'voto');
  // (5) bloco "Decisão:" / "Deliberação:" — o rótulo vale como evidência
  if (!best && sctx.labelType === 'decisao' && wordsOf(orig).length >= 3) consider(0.68, 'rótulo "Decisão"', 'rotulo');

  if (!best) return null;
  let score = best.score;
  if (RE_VOTE.test(m)) score += 0.12;
  const hedged = RE_HEDGE.exec(m);
  if (hedged && best.kind !== 'rotulo') score -= 0.35;
  if (RE_COND.test(m)) score -= /decid|defin|acord|delib|ficou/.test(m) ? 0.1 : 0.2;
  if (/\bnao\s+(?:foi|foram)\s+(?:\S+\s+){0,2}?(?:ainda\s+)?(?:decidid|definid|deliberad)/.test(m)) score -= 0.5;
  // proposta/sugestão que aparece ANTES do verbo de decisão, sem resultado: continua sendo proposta
  if (best.kind === 'frame' && RE_PROP_VERB.test(m) && !/\bpropost[oa]s?\s+(?:foi|foram)\b/.test(m) && !RE_VOTE.test(m) && !DEC_STRONG_PART.test(m)) {
    const pv = m.search(RE_PROP_VERB), fi = m.search(RE_FRAME);
    if (pv >= 0 && fi >= 0 && pv < fi && /\bque\b/.test(m.slice(pv, fi))) score -= 0.45;   // "sugeriu que fosse/foi aprovada"
  }
  score = Math.max(0, Math.min(0.97, score));
  if (score < 0.5) return null;
  // resposta curta que só faz sentido junto da frase anterior ("Aprovado por unanimidade.")
  const noVote = orig.replace(/\b(?:por\s+(?:unanimidade|maioria)(?:\s+(?:simples|absoluta|dos\s+votos|dos\s+presentes))?|com\s+\w+\s+votos?\s+\w+)/gi, '');
  const anaphoric = wordsOf(noVote).length <= 6 && (best.kind === 'start' || best.kind === 'voto' ||
    (best.kind === 'frame' && /^(?:a\s+(?:proposta|solicitacao|ata|mocao|materia|sugestao)\s+)?(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+){0,2}?(?:aprovad|rejeitad|deferid|indeferid|aceit|acatad|negad|reprovad)/.test(m)));
  return { score, gatilho: best.gatilho, anaphoric, kind: best.kind };
}

function scoreProposal(orig, n, m, toks) {
  let best = null;
  const consider = (score, gat, tipo) => { if (!best || score > best.score) best = { score, gatilho: gat, tipo }; };
  let x = m.match(RE_PROP_VERB);
  if (x) consider(0.72, snippetOf(toks, m, x.index, x[0].length), /\bpropost|proposta|propos/.test(x[0]) || RE_PROPOSAL_FORMAL.test(m) ? 'proposta' : 'sugestao');
  x = m.match(RE_PROP_MODAL);
  if (x) consider(0.58, snippetOf(toks, m, x.index, x[0].length), 'sugestao');
  if (!best && RE_PROPOSAL_FORMAL.test(m) && /\b(?:apresentad|encaminhad|elaborad|enviad|entregu)\w*/.test(m) && !/\b(?:aprovad|rejeitad|aceit|deferid|indeferid)/.test(m)) {
    x = m.match(RE_PROPOSAL_FORMAL); consider(0.55, snippetOf(toks, m, x.index, x[0].length), 'proposta');
  }
  return best;
}

function scoreProblem(orig, n, m, toks) {
  if (RE_NO_PROB.test(m)) return null;
  const cues = [];
  let re = new RegExp(RE_PROB_CUE.source, 'g'), x;
  while ((x = re.exec(m))) { cues.push(x); if (!x[0].length) re.lastIndex++; }
  if (!cues.length) return null;
  let score = 0.4 + (new Set(cues.map(c => c[0])).size > 1 ? 0.1 : 0);
  let rep = m.match(RE_REPORT);
  if (rep) score += 0.3;
  if (RE_STATE.test(m)) score += 0.2;
  if (RE_PROB_RESOLVED.test(m)) score -= 0.4;
  if (/^\W*(?:ata|reuniao)\b/.test(n)) score -= 0.2;
  score = Math.min(0.9, score);
  if (score < 0.6) return null;
  return { score, gatilho: snippetOf(toks, m, (rep || cues[0]).index, (rep || cues[0])[0].length) };
}

function scoreDemand(orig, n, m, toks) {
  if (RE_REQUEST_PROCEDURAL.test(m)) return null;
  let best = null, x = m.match(RE_REQUEST);
  if (x) best = { score: 0.72, gatilho: snippetOf(toks, m, x.index, x[0].length) };
  x = m.match(RE_NEED);
  if (x && (!best || 0.66 > best.score)) best = { score: 0.66, gatilho: snippetOf(toks, m, x.index, x[0].length) };
  return best;
}

/* ---------- ENCAMINHAMENTOS: AÇÃO + RESPONSÁVEL + PRAZO ---------- */
const FUT_GENERIC = /(^|[^a-zà-ú])((?:[a-zà-ú]{3,}(?:ará|erá|irá|arão|erão|irão))|fará|farão|dará|darão|trará|trarão)(?![a-zà-ú])/g;
const PART_ACTION = String.raw`(\w{3,}(?:ad|id)[oa]s?|feit[oa]s?|abert[oa]s?|propost[oa]s?|post[oa]s?|escrit[oa]s?|dit[oa]s?)`;

function findEncCue(orig, n, m, lc, sctx) {
  const cues = [];
  const add = (score, tipo, start, end, extra) => cues.push(Object.assign({ score, tipo, start, end }, extra || {}));
  let x;
  // atribuição explícita
  if ((x = n.match(/\b(?:ficara|ficarao|ficou|ficaram|fica|ficam|sera|serao)\s+(?:(?:o|a|os|as)\s+)?(?:\S+\s+)?(?:responsavel|responsaveis|incumbid[oa]s?|encarregad[oa]s?)\b/)))
    add(0.85, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /\s+(?:por|de|para|pel[ao]s?)\s+/ });
  if ((x = n.match(/\b(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+)?(?:incumbid|encarregad|designad)[oa]s?\s+(?:de|para|a)\s+/)))
    add(0.82, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:se\s+comprometeu|se\s+comprometeram|comprometeu-se|comprometeram-se|responsabilizou-se|responsabilizaram-se|se\s+responsabilizou|se\s+responsabilizaram|ofereceu-se|ofereceram-se|disponibilizou-se|disponibilizaram-se|prontificou-se|prontificaram-se|dispos-se|se\s+dispos\w*)\b/)))
    add(0.82, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /\s+(?:a|de|por|em)\s+/ });
  if ((x = n.match(/\b(?:assumiu|assumiram|assumira|assumirao)\s+(?:o\s+compromisso|a\s+tarefa|a\s+responsabilidade|a\s+missao|a\s+incumbencia)\s+(?:de|por|em)\s+/)))
    add(0.82, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:ficou|ficaram|ficara|ficarao)\s+de\s+(?=\w+(?:ar|er|ir|or)\b)/)))
    add(0.8, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:cabe|cabera|caberao|compete|competira|competirao|incumbe|incumbira)\s+(?:a|ao|aos|as)\s+/)))
    add(0.78, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /^/, inf: true });
  if ((x = n.match(/\bencaminh(?:ou|aram|a|am|e|em)-se\b|\bencaminhar-se-a\b|\b(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+){0,1}?encaminhad[oa]s?\b|\bfica(?:m)?\s+encaminhad[oa]s?\b|\bsera(?:o)?\s+encaminhad[oa]s?\b/)))
    add(0.8, 'encaminhado', x.index, x.index + x[0].length, { acaoAfter: null });
  if ((x = n.match(/\bencaminhamentos?\s*[:\-–]/))) add(0.8, 'rotulo', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  // obrigação / futuro com infinitivo
  const deon = /\b(devera|deverao|precisara|precisarao|tera\s+que|terao\s+que|tera\s+de|terao\s+de|necessitara|necessitarao)\s+((?:\S+\s+){0,2}?)(\w+(?:ar|er|ir|or))\b/g;
  while ((x = deon.exec(n))) {
    const inf = x[3];
    const infStart = x.index + x[0].length - inf.length;
    if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    if (inf === 'ser') { const pp = n.slice(infStart + 3).match(new RegExp('^\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION)); if (!pp || NON_ACTION_PART.test(pp[1])) continue; }
    add(0.68, 'obrigacao', x.index, x.index + x[0].length, { infStart });
    break;
  }
  const deve = /\b(deve|devem)\s+((?:\S+\s+){0,1}?)(\w+(?:ar|er|ir|or))\b/g;
  while ((x = deve.exec(n))) {
    const inf = x[3]; if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    add(0.45, 'obrigacao_presente', x.index, x.index + x[0].length, { infStart: x.index + x[0].length - inf.length });
    break;
  }
  const ir = /\b(ira|irao|vai|vao)\s+((?:\S+\s+){0,2}?)(\w{3,}(?:ar|er|ir|or))\b/g;
  while ((x = ir.exec(n))) {
    const inf = x[3]; const infStart = x.index + x[0].length - inf.length;
    if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    if (inf === 'ser') { const pp = n.slice(infStart + 3).match(new RegExp('^\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION)); if (!pp || NON_ACTION_PART.test(pp[1])) continue; }
    add(0.65, 'futuro_ir', x.index, x.index + x[0].length, { infStart });
    break;
  }
  // voz passiva futura: "será realizada uma consulta"
  const pas = new RegExp('\\b(?:sera|serao)\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION, 'g');
  while ((x = pas.exec(n))) {
    const part = x[1];
    if (NON_ACTION_PART.test(part)) continue;
    add(0.66, 'passiva_futura', x.index, x.index + x[0].length, { infStart: x.index });
    break;
  }
  // futuro do presente, 3ª pessoa (sujeito + verbo): "enviará", "elaborarão"
  FUT_GENERIC.lastIndex = 0;
  while ((x = FUT_GENERIC.exec(lc))) {
    const verb = x[2]; const f = fold(verb);
    const start = x.index + x[1].length;
    if (NON_ACTION_FUT.has(f)) continue;
    if (AMBIG_FUT.has(f)) {
      if (/^entrar[aã]o?$/.test(f) || /^entrar[a]?o?$/.test(f)) { if (!/^entr(?:ara|arao)\s+em\s+contato/.test(n.slice(start))) continue; }
      else if (/^passara$/.test(f)) { if (/^passara\s+a\b/.test(n.slice(start))) continue; }
      else { add(0.5, 'futuro_ambiguo', start, start + verb.length, { infStart: start }); break; }
    }
    add(0.55, 'futuro_ativo', start, start + verb.length, { infStart: start });
    break;
  }
  if ((x = n.match(/\b(?:vamos|iremos)\s+(?:\S+\s+){0,1}?\w{3,}(?:ar|er|ir|or)\b|\b\w{3,}(?:aremos|eremos|iremos)\b/)))
    add(0.62, 'futuro_nos', x.index, x.index + x[0].length, { infStart: x.index });
  // infinitivo no início de item de lista / sob rótulo "Encaminhamentos:"
  if ((sctx.listItem || sctx.labelType === 'encaminhamento') && ACT_INF_START.test(orig.replace(/^\W+/, '')))
    add(0.64, 'infinitivo', 0, 0, { infStart: orig.search(/[A-Za-zÀ-ú]/) });
  if (!cues.length) return null;
  cues.sort((a, b) => b.score - a.score || a.start - b.start);
  return cues[0];
}

function scoreEncaminhamento(orig, n, m, lc, toks, sctx, decisionHit) {
  const cue = findEncCue(orig, n, m, lc, sctx);
  const labeled = sctx.labelType === 'encaminhamento' && wordsOf(orig).length >= 3;
  let score = 0, tipo = null, c = cue;
  if (c) { score = c.score; tipo = c.tipo; }
  else if (labeled) { score = 0.62; tipo = 'rotulo'; c = { start: -1, tipo }; }
  else return null;
  if (labeled && c.tipo !== 'rotulo') score += 0.2;
  if (decisionHit && decisionHit.kind !== 'rotulo') score += 0.1;
  const propBlock = RE_PROP_VERB.test(m) || RE_PROP_MODAL.test(m);
  const firm = ['atribuicao', 'compromisso', 'encaminhado'].includes(c.tipo);
  if (propBlock && !firm && !decisionHit) score -= 0.6;
  if (RE_REQUEST.test(m) && !firm && !decisionHit) score -= 0.4;
  if (RE_INTENT.test(m) && !firm) score -= 0.4;
  if (RE_COND.test(m)) score -= 0.15;
  if (/\bnao\s+(?:sera|serao|\w+(?:ara|era|ira)\b)/.test(m)) score -= 0.3;
  if (/\bnecessario|\bpreciso\b/.test(m) && !firm && c.tipo === 'passiva_futura') score -= 0.2;
  return { score, cue: c, gatilho: c.start >= 0 && c.end > c.start ? orig.slice(c.start, c.end).trim() : (labeled ? 'rótulo "Encaminhamentos"' : null) };
}

/* ---------- apoio: ação, prazo e responsável ---------- */
function buildAcao(orig, n, cue, T) {
  if (!cue || cue.start < 0) return trimEnd(orig);
  let from = cue.infStart != null ? cue.infStart : cue.end;
  if (cue.acaoAfter) {
    const rest = n.slice(cue.end);
    const mm = rest.match(cue.acaoAfter);
    if (mm) from = cue.end + mm.index + mm[0].length;
  }
  if (cue.tipo === 'encaminhado') from = cue.start;
  if (cue.tipo === 'passiva_futura') from = cue.start;
  if (cue.inf) {
    const after = n.slice(cue.end);
    const ent = forwardPhrase(orig.slice(cue.end));
    const skip = ent ? ent.length : 0;
    const mi = n.slice(cue.end + skip).match(/(?:^|\s)(\w{3,}(?:ar|er|ir|or))\b/);
    if (mi) from = cue.end + skip + mi.index + (mi[0].length - mi[1].length);
  }
  let to = orig.length;
  if (T && T.principal && T.principal.start > from) to = T.principal.start;
  let out = orig.slice(from, to);
  out = out.replace(/[\s,;:(–-]+$/, '').replace(/\s+(?:at[ée]|em|para|no|na|de|a|ao)$/i, '');
  out = trimEnd(squash(out));
  return out.length >= 4 ? clip(out, 220) : trimEnd(orig);
}

function applyPrazo(item, T, orig, useIt) {
  if (!useIt || !T || !T.principal) return;
  const p = T.principal;
  item.prazo = p.texto;
  item.prazoTipo = p.tipo;
  const core = (T.refs.find(r => r.start === p.start) || {}).core;
  item.prazoData = p.dataAssociada || (p.tipo === 'data' ? (core || null) : null);
  item.prazoISO = p.iso || null;
  const others = T.refs.filter(r => !r.anexa && r.start !== p.start).map(r => ({ texto: r.texto, tipo: r.tipo, dataAssociada: r.dataAssociada }));
  if (others.length) item.referencias = others.slice(0, 4);
}

function applyActors(item, ents) {
  if (!ents || !ents.length) return;
  item.responsaveis = ents.map(e => ({ nome: e.nome, cargo: e.cargo || null }));
  item.responsavel = ents.map(e => e.nome).join(' e ');
  const withCargo = ents.find(e => e.cargo);
  if (withCargo && ents.length === 1) item.cargo = withCargo.cargo;
}

const level = s => s >= 0.8 ? 'alta' : (s >= 0.65 ? 'média' : 'baixa');

/* ============================================================
   EXTRAÇÃO POR BLOCO
============================================================ */
function toUnits(lines) {
  const units = [];
  let cur = null, afterBlank = true;
  const pushCur = () => { if (cur) units.push(cur); cur = null; };
  lines.forEach(raw => {
    const t = raw.trim();
    if (!t) { pushCur(); afterBlank = true; return; }
    // tabela: tabulação ou barras
    const cells = (t.indexOf('\t') >= 0 ? t.split(/\t+/) : (/\s\|\s|^\|/.test(t) ? t.split('|') : [t])).map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) { pushCur(); units.push({ cells, text: t, paraStart: afterBlank }); afterBlank = false; return; }
    const lab = fold(t).match(/^(encaminhamentos?|providencias|acoes(?:\s+a\s+\w+)?|pendencias|tarefas|proximos\s+passos|decisoes?|deliberacoes?|resolucoes?)\s*[:\-–]\s*(.*)$/);
    if (lab) {
      pushCur();
      const type = /^(?:decis|delib|resol)/.test(lab[1]) ? 'decisao' : 'encaminhamento';
      const rest = t.slice(t.indexOf(':') >= 0 ? t.indexOf(':') + 1 : t.search(/[-–]/) + 1).trim();
      units.push({ label: type, text: rest, paraStart: true });
      afterBlank = false; return;
    }
    if (RE_LIST.test(t)) { pushCur(); cur = { text: t.replace(RE_LIST, '').trim(), listItem: true, paraStart: afterBlank }; afterBlank = false; return; }
    if (cur && !cur.listItem && !afterBlank) { cur.text += ' ' + t; return; }
    if (cur && cur.listItem && !afterBlank && /^[a-zà-ú]/.test(t)) { cur.text += ' ' + t; return; }   // continuação de item
    pushCur();
    cur = { text: t, paraStart: afterBlank };
    afterBlank = false;
  });
  pushCur();
  return units;
}

const RE_INTRO = [
  { re: /\b(?:passando|passou-se|passou|passamos|passaram|seguindo|prosseguindo|prosseguiu-se|dando\s+prosseguimento)\b[^.]{0,40}?\bao?\s+(?:item|ponto|assunto)\s+(\d{1,2})\b\s*[,:\-–]?\s*(.*)/, num: true, conf: 0.7 },
  { re: /\b(?:tratou-se|trataram-se|discutiu|discutiram|debateu|debateram|trataram|abordaram|abordou|analisaram|discutiu-se|discutiram-se|debateu-se|debateram-se|abordou-se|abordaram-se|analisou-se|analisaram-se|iniciou-se\s+a\s+discussao|passou-se\s+a\s+discussao|deu-se\s+inicio\s+a\s+discussao|foi\s+(?:discutid|debatid|abordad|analisad|tratad)[oa]|foram\s+(?:discutid|debatid|abordad|analisad|tratad)[oa]s)\s+(?:(?:o|a|os|as)\s+)?(?:(?:assunto|tema|questao|pauta|ponto|proposta)\s+)?(?:sobre|acerca\s+d[eao]s?|a\s+respeito\s+d[eao]s?|referente\s+a|relativ[oa]s?\s+a|d[eao]s?)\s+(.{6,110}?)(?=[.;:]|\s+(?:que|onde|sendo|conforme|tendo|devido|em\s+razao|visto|pois|porque|ficou|foi|foram|com\s+o\s+objetivo)\b|$)/, conf: 0.66 },
  { re: /\b(?:o|a)\s+(?:coordenador[a]?|presidente|secretari[ao]|professor[a]?)\s+(?:\w+\s+){0,3}?(?:apresentou|trouxe|colocou|submeteu|levou|iniciou|abriu|expos)\s+(?:ao\s+(?:colegiado|plenario|grupo)\s+)?(?:(?:o|a|os|as)\s+)?(?:assunto|tema|questao|pauta|ponto|proposta)\s+(?:sobre|acerca\s+d[eao]s?|referente\s+a|relativ[oa]\s+a|d[eao]s?)\s+(.{6,110}?)(?=[.;:]|\s+(?:que|onde|sendo|conforme|tendo|devido|visto|pois|porque)\b|$)/, conf: 0.55 },
  { re: /^(?:sobre|quanto\s+(?:a|ao|aos|as)|em\s+relacao\s+(?:a|ao|aos|as)|no\s+que\s+(?:se\s+)?(?:refere|diz\s+respeito)\s+(?:a|ao|aos|as)|no\s+tocante\s+(?:a|ao|aos|as)|acerca\s+d[eao]s?|a\s+respeito\s+d[eao]s?|relativamente\s+(?:a|ao|aos|as)|referente\s+(?:a|ao|aos|as))\s+(.{6,110}?)(?=[,.;:])/, conf: 0.5 },
  { re: /^(?:assunto|tema|pauta|ponto)\s*(?:\d+)?\s*[:\-–]\s*(.{4,110}?)(?:[.;]|$)/, conf: 0.75 }
];
function detectIntroSubject(orig, n, pautaByNum) {
  for (const p of RE_INTRO) {
    const m = n.match(p.re);
    if (!m) continue;
    if (p.num) {
      const num = +m[1];
      if (pautaByNum && pautaByNum.has(num)) return { title: pautaByNum.get(num), conf: 0.85, origem: 'frase de transição + pauta' };
      const rest = m[2] ? orig.slice(orig.length - (n.length - n.indexOf(m[2], m.index))).trim() : '';
      const t = cleanTitle(rest.replace(/^(?:o|a)\s+/i, ''));
      return t ? { title: t, conf: p.conf, origem: 'frase de transição' } : null;
    }
    const idx = n.indexOf(m[1], m.index);
    const t = cleanTitle(orig.slice(idx, idx + m[1].length).replace(/^(?:(?:o|a|os|as|um|uma)\s+)/i, ''));
    return t ? { title: t, conf: p.conf, origem: 'frase introdutória' } : null;
  }
  return null;
}

function tokenSet(s) {
  return new Set((fold(s).match(/[a-z]{4,}/g) || []).filter(w => !STOP_F.has(w)).map(w => w.slice(0, 5)));
}
function matchPautaItem(text, items) {
  const ts = tokenSet(text);
  let best = null;
  items.forEach(it => {
    const its = tokenSet(it.title);
    if (!its.size) return;
    let shared = 0; its.forEach(t => { if (ts.has(t)) shared++; });
    const ok = (its.size <= 3 && shared >= 1 && shared / its.size >= 0.5) || shared >= 2;
    if (ok && (!best || shared > best.shared)) best = { it, shared };
  });
  return best ? best.it : null;
}

const STOP_F = new Set(Array.from(STOPWORDS).map(fold));

function extractItems(struct, ctx) {
  const out = { decisoes: [], encaminhamentos: [], problemas: [], demandas: [], sugestoes: [] };
  const subjects = [];            // assuntos detalhados
  const subjectIdx = new Map();
  const hasStructure = struct.tipo !== 'corrido';
  const pautaItems = struct.pauta ? struct.pauta.items : [];
  const pautaByNum = new Map(pautaItems.map(i => [i.num, i.title]));

  const registerSubject = (title, origem, conf) => {
    if (!title) return null;
    const key = fold(title).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) return null;
    if (!subjectIdx.has(key)) {
      const s = { titulo: title, origem, confianca: conf, nivel: level(conf), discutido: false, decisoes: 0, encaminhamentos: 0, problemas: 0, demandas: 0, sugestoes: 0, procedural: isProceduralSubject(title) };
      subjectIdx.set(key, s); subjects.push(s);
    }
    return subjectIdx.get(key);
  };
  if (struct.pauta) pautaItems.forEach(it => registerSubject(it.title, 'pauta', 0.88));

  struct.blocks.forEach(block => {
    if (block.kind === 'presenca' || block.kind === 'encerramento') return;
    let current = block.title ? registerSubject(block.title, block.origem, block.conf) : null;
    const units = toUnits(block.lines);
    let labelType = null, prevSent = null, lastItem = null, lastRefs = null;
    let tableHeader = null;

    const bump = (kind) => { if (current) current[kind]++; };
    const addItem = (kind, item) => {
      if (current) item.assunto = current.titulo;
      out[kind].push(item); bump(kind); lastItem = item;
    };

    units.forEach(u => {
      if (u.label) { labelType = u.label; if (!u.text) return; u = { text: u.text, listItem: false, paraStart: true, forcedLabel: u.label }; }
      else if (u.paraStart && !u.listItem && !u.cells) labelType = null;

      /* ---- tabelas ---- */
      if (u.cells) {
        const folded = u.cells.map(fold);
        const hAcao = folded.findIndex(c => /^(?:acao|acoes|encaminhamento|encaminhamentos|providencia|atividade|tarefa|demanda|descricao)/.test(c));
        const hDec = folded.findIndex(c => /^(?:decisao|deliberacao|resultado)/.test(c));
        const hResp = folded.findIndex(c => /^respons/.test(c));
        const hPrazo = folded.findIndex(c => /^(?:prazo|data|quando|periodo)/.test(c));
        if ((hAcao >= 0 || hDec >= 0) && (hResp >= 0 || hPrazo >= 0 || folded.length <= 3)) { tableHeader = { hAcao, hDec, hResp, hPrazo }; return; }
        const row = tableHeader ? {
          desc: u.cells[tableHeader.hDec >= 0 ? tableHeader.hDec : tableHeader.hAcao],
          resp: tableHeader.hResp >= 0 ? u.cells[tableHeader.hResp] : null,
          prazo: tableHeader.hPrazo >= 0 ? u.cells[tableHeader.hPrazo] : null,
          kind: tableHeader.hDec >= 0 ? 'decisoes' : 'encaminhamentos'
        } : null;
        let r = row;
        if (!r) {
          const T0 = u.cells.map(c => findTemporal(c, ctx).principal);
          const pi = T0.findIndex(Boolean);
          let longest = u.cells.findIndex(c => wordsOf(c).length >= 3 && !findTemporal(c, ctx).principal);
          if (longest < 0) longest = u.cells.reduce((a, c, i) => c.length > u.cells[a].length ? i : a, 0);
          r = { desc: u.cells[longest], prazo: pi >= 0 && pi !== longest ? u.cells[pi] : null, resp: null, kind: null };
        }
        if (!r.desc || wordsOf(r.desc).length < 3) return;
        const ents = r.resp ? parseEntities(r.resp, ctx.participantes) : [];
        const T = r.prazo ? findTemporal(r.prazo, ctx) : null;
        let kind = r.kind;
        if (!kind) {
          const d = scoreDecision(r.desc, fold(r.desc), fold(r.desc).replace(/[,;()"“”]/g, ' '), wordsOf(r.desc), { labelType });
          kind = d ? 'decisoes' : ((ents.length || T) ? 'encaminhamentos' : null);
        }
        if (!kind) return;
        const item = { descricao: clip(squash(r.desc), 600), confianca: row ? 0.88 : 0.7, gatilho: 'linha de tabela' };
        applyActors(item, ents);
        if (T && T.principal) applyPrazo(item, T, r.prazo, true);
        else if (r.prazo && !/^[-–—\s]*$/.test(r.prazo)) { item.prazo = squash(r.prazo); item.prazoTipo = 'indefinido'; }
        if (kind === 'encaminhamentos') item.acao = clip(squash(r.desc), 220);
        const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
        if (ctx.seen.has(kind + key)) return;
        ctx.seen.add(kind + key);
        addItem(kind, item);
        return;
      }

      /* ---- texto corrido / listas ---- */
      const sentences = splitSentences(u.text);
      sentences.forEach(sentRaw => {
        let orig = sentRaw;
        let sentLabel = u.forcedLabel || null;
        const lm = fold(orig).match(/^(decisao|deliberacao|resolucao|encaminhamentos?|providencias)\s*[:\-–]\s*/);
        if (lm) { sentLabel = /^(?:decis|delib|resol)/.test(lm[1]) ? 'decisao' : 'encaminhamento'; orig = cap1(orig.slice(lm[0].length)); }
        orig = squash(orig);
        if (orig.length < 8 || orig.length > 1400) return;
        const n = fold(orig);
        const lc = orig.toLowerCase();
        const m = n.replace(/[,;()"“”]/g, ' ').replace(/\s+/g, ' ').trim();
        const toks = orig.split(/\s+/);
        const sctx = { listItem: !!u.listItem, labelType: sentLabel || labelType };

        // "Prazo: ..." / "Responsável: ..." logo após um item -> complementa o item anterior
        const orph = n.match(/^(prazo|data\s+limite|responsaveis?)\s*[:\-–]\s*(.+)$/);
        if (orph && wordsOf(orig).length <= 18 && lastItem) {
          const restOrig = orig.slice(orig.indexOf(':') + 1 || orig.search(/[-–]/) + 1).trim();
          if (/^(?:prazo|data)/.test(orph[1])) { const T = findTemporal(restOrig, ctx); if (T.principal) applyPrazo(lastItem, T, restOrig, true); else if (!lastItem.prazo) { lastItem.prazo = trimEnd(restOrig); lastItem.prazoTipo = 'indefinido'; } }
          else { const ents = parseEntities(restOrig.replace(/[.;].*$/, ''), ctx.participantes); applyActors(lastItem, ents); }
          return;
        }

        // assunto por frase introdutória: só quando a ata NÃO tem estrutura
        if (!hasStructure && !pautaItems.length) {
          const intro = detectIntroSubject(orig, n, pautaByNum);
          if (intro) current = registerSubject(intro.title, intro.origem, intro.conf) || current;
        } else if (!hasStructure && pautaItems.length) {
          const intro = detectIntroSubject(orig, n, pautaByNum);
          let hit = null;
          if (intro) {
            const pm = matchPautaItem(intro.title, pautaItems);
            if (pm) hit = registerSubject(pm.title, 'pauta', 0.88);
            else if (intro.origem === 'frase de transição + pauta') hit = registerSubject(intro.title, intro.origem, intro.conf);
          }
          if (hit) current = hit;
          else if (u.paraStart) { const pm = matchPautaItem(orig, pautaItems); if (pm) current = registerSubject(pm.title, 'pauta', 0.88); }
        }

        if (/\?\s*$/.test(orig)) { if (current) current.discutido = true; prevSent = { text: orig }; lastRefs = null; return; }
        if (RE_DISCUSS.test(m) && current) current.discutido = true;

        const dec = scoreDecision(orig, n, m, toks, sctx);
        const enc = scoreEncaminhamento(orig, n, m, lc, toks, sctx, dec);
        const T = (dec || (enc && enc.score >= 0.4)) ? findTemporal(orig, ctx) : null;
        let produced = [];

        if (dec) {
          let desc = orig, contexto = false;
          if (dec.anaphoric && prevSent && prevSent.text && prevSent.text.length <= 450 && !(lastRefs && (lastRefs.dec || lastRefs.enc))) {
            desc = prevSent.text.replace(/[.!]+$/, '') + '. ' + orig; contexto = true;
            if (lastRefs && lastRefs.sug) {   // a proposta anterior virou decisão: não duplicar
              const i = out.sugestoes.indexOf(lastRefs.sug);
              if (i >= 0) { out.sugestoes.splice(i, 1); if (current && current.sugestoes) current.sugestoes--; }
            }
          }
          const item = { descricao: clip(squash(desc), 600), confianca: +dec.score.toFixed(2), gatilho: dec.gatilho, ...(contexto ? { contexto: true } : {}) };
          const explicitEnts = extractActors(orig, n, -1, ctx, true);
          applyActors(item, explicitEnts);
          applyPrazo(item, T, orig, true);
          const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
          if (!ctx.seen.has('decisoes' + key)) { ctx.seen.add('decisoes' + key); addItem('decisoes', item); produced.push(['dec', item]); labelType = (/:\s*$/.test(orig) ? 'decisao' : labelType); }
        }

        if (enc && enc.score >= 0.4) {
          const cue = enc.cue;
          const cueStart = cue.infStart != null ? Math.min(cue.start >= 0 ? cue.start : cue.infStart, cue.infStart) : cue.start;
          const passive = ['passiva_futura', 'encaminhado'].includes(cue.tipo);
          let ents = extractActors(orig, n, cue.start >= 0 ? cue.start : (cue.infStart != null ? cue.infStart : -1), ctx, passive);
          const hasActor = ents.length > 0;
          let sc = enc.score;
          if (['futuro_ativo', 'futuro_ambiguo'].includes(cue.tipo)) { if (hasActor) sc += 0.15; else sc -= 0.0; }
          if (cue.tipo === 'obrigacao_presente') { if (hasActor) sc += 0.1; if (T && T.principal) sc += 0.1; if (/decid|defin|acord|delib|ficou/.test(m)) sc += 0.15; }
          if (['obrigacao', 'futuro_ir'].includes(cue.tipo) && !hasActor && !/\bser\b/.test(n.slice(cue.infStart || 0, (cue.infStart || 0) + 12))) sc -= 0.15;
          if (T && T.principal) sc += 0.08;
          if (sc >= 0.6) {
            const item = { descricao: clip(squash(orig), 600), confianca: +Math.min(0.97, sc).toFixed(2), gatilho: enc.gatilho || undefined };
            item.acao = buildAcao(orig, n, cue, T);
            applyActors(item, ents);
            applyPrazo(item, T, orig, true);
            if (dec) item.decidido = true;
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
            if (!ctx.seen.has('encaminhamentos' + key)) { ctx.seen.add('encaminhamentos' + key); addItem('encaminhamentos', item); produced.push(['enc', item]); }
          }
        }

        if (!produced.length) {
          const prop = scoreProposal(orig, n, m, toks);
          const dem = scoreDemand(orig, n, m, toks);
          const prob = scoreProblem(orig, n, m, toks);
          if (prop && prop.score >= 0.55 && !(dem && dem.score > prop.score + 0.05 && /solicit|ped/.test(m))) {
            const item = { tipo: prop.tipo, descricao: clip(squash(orig), 600), confianca: +prop.score.toFixed(2), gatilho: prop.gatilho };
            const ents = extractActors(orig, n, n.search(RE_PROP_VERB), ctx, false);
            if (ents.length) item.proponente = ents.map(e => e.nome).join(' e ');
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
            if (!ctx.seen.has('sugestoes' + key)) { ctx.seen.add('sugestoes' + key); addItem('sugestoes', item); produced.push(['sug', item]); }
          } else if (dem && (!prob || dem.score >= prob.score)) {
            const item = { tipo: 'demanda', descricao: clip(squash(orig), 600), confianca: +dem.score.toFixed(2), gatilho: dem.gatilho };
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
            if (!ctx.seen.has('demandas' + key)) { ctx.seen.add('demandas' + key); addItem('demandas', item); produced.push(['dem', item]); }
          } else if (prob) {
            const item = { tipo: 'problema', descricao: clip(squash(orig), 600), confianca: +prob.score.toFixed(2), gatilho: prob.gatilho };
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140);
            if (!ctx.seen.has('problemas' + key)) { ctx.seen.add('problemas' + key); addItem('problemas', item); produced.push(['prob', item]); }
          }
        }

        lastRefs = { dec: produced.some(p => p[0] === 'dec'), enc: produced.some(p => p[0] === 'enc'), sug: (produced.find(p => p[0] === 'sug') || [])[1] || null };
        if (produced.some(p => p[0] === 'enc') && /:\s*$/.test(orig)) labelType = 'encaminhamento';
        prevSent = { text: orig };
      });
    });
  });

  // próximos de duplicata (Jaccard) dentro de cada lista
  ['decisoes', 'encaminhamentos', 'problemas', 'demandas', 'sugestoes'].forEach(k => {
    const kept = [];
    out[k].forEach(it => {
      const ts = new Set(fold(it.descricao).match(/[a-z0-9]{3,}/g) || []);
      const dup = kept.find(o => {
        const os = o._t; let inter = 0; ts.forEach(t => { if (os.has(t)) inter++; });
        const uni = ts.size + os.size - inter; return uni && inter / uni >= 0.88;
      });
      if (dup) { if (it.confianca > dup.confianca) { Object.assign(dup, it, { _t: ts }); } return; }
      Object.defineProperty(it, '_t', { value: ts, enumerable: false, writable: true });
      kept.push(it);
    });
    out[k] = kept;
  });
  return { out, subjects };
}

/* ============================================================
   PARTICIPANTES E TERMOS RECORRENTES
============================================================ */
function findParticipants(text, struct) {
  const names = [];
  const NAME_RUN = /(?:Prof(?:essor)?a?\.?|Dr\.?a?|Sr\.?a?)?\s*((?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.)(?:\s+(?:d[aeo]s?|di|von|van)?\s*(?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.)){1,5})/g;
  const take = s => {
    let m; NAME_RUN.lastIndex = 0;
    while ((m = NAME_RUN.exec(s))) {
      const toks = m[1].split(/\s+/).filter(t => !PART_RE.test(fold(t)));
      if (toks.length < 2 || toks.some(t => CAP_STOP.has(t.replace(/\.$/, '')))) continue;
      const nm = m[1].replace(/\s+/g, ' ');
      if (!names.includes(nm)) names.push(nm);
    }
  };
  if (struct && struct.rawLines && struct.region) struct.rawLines.forEach((l, i) => { if (struct.region[i] === 'presenca' && l.t) take(l.t); });
  const head = text.slice(0, 3500);
  const pm = head.match(/(?:estiveram\s+presentes|presentes\s*:|compareceram|participaram)/i);
  if (pm) {
    let seg = head.slice(pm.index, pm.index + 900).split(/\bPauta\b/)[0];
    const re = /([A-Za-zÀ-ú]+)\.\s+(?=[A-ZÀ-Ú])/g; let mm;
    while ((mm = re.exec(seg))) { if (!ABBR.has(fold(mm[1])) && mm[1].length > 1) { seg = seg.slice(0, mm.index + mm[0].length); break; } }
    take(seg);
  }
  return names.slice(0, 60);
}

function recurringTerms(text, participantes) {
  const nameTok = new Set();
  (participantes || []).forEach(p => p.split(/\s+/).forEach(w => nameTok.add(fold(w.replace(/\./g, '')))));
  const freq = new Map();
  (text.toLowerCase().match(/[a-zà-ú]{5,}/g) || []).forEach(w => {
    const f = fold(w);
    if (STOP_F.has(f) || nameTok.has(f)) return;
    const e = freq.get(f) || { termo: w, contagem: 0 };
    e.contagem++; freq.set(f, e);
  });
  return Array.from(freq.values()).filter(e => e.contagem >= 2).sort((a, b) => b.contagem - a.contagem).slice(0, 15);
}

/* ============================================================
   ORQUESTRADOR
============================================================ */
function extract(rawText, opts) {
  opts = opts || {};
  const text = normalizeText(rawText);
  const data = findMeetingDate(text);
  const reuniao = findReuniao(text);
  const struct = buildStructure(text);
  const participantes = findParticipants(text, struct);
  const ctx = { meetingISO: data, participantes, seen: new Set() };
  const { out, subjects } = extractItems(struct, ctx);

  // assuntos: só o que tem evidência estrutural/linguística. Nunca palavras frequentes.
  const detalhe = subjects.filter(s => s.titulo).map(s => ({
    titulo: s.titulo, origem: s.origem, confianca: +s.confianca.toFixed(2), nivel: s.nivel,
    procedural: s.procedural, discutido: s.discutido || (s.decisoes + s.encaminhamentos + s.problemas + s.demandas + s.sugestoes) > 0,
    contagens: { decisoes: s.decisoes, encaminhamentos: s.encaminhamentos, problemas: s.problemas, demandas: s.demandas, sugestoes: s.sugestoes }
  }));
  const termosRecorrentes = recurringTerms(text, participantes);
  const degraded = (out.decisoes.length + out.encaminhamentos.length) === 0;
  const LIM = 120;
  const result = {
    versao: VERSION, reuniao, data,
    assuntos: detalhe.map(d => d.titulo), assuntosDetalhe: detalhe,
    decisoes: out.decisoes.slice(0, LIM), encaminhamentos: out.encaminhamentos.slice(0, LIM),
    problemas: out.problemas.slice(0, LIM), demandas: out.demandas.slice(0, LIM), sugestoes: out.sugestoes.slice(0, LIM),
    termosRecorrentes, participantes,
    estrutura: { tipo: struct.tipo, pauta: struct.pauta ? struct.pauta.items.map(i => i.title) : [], blocos: struct.blocks.filter(b => b.title).length },
    degraded
  };
  if (opts.debug) result._struct = struct;
  return result;
}

return { extract, normalizeText, buildStructure, splitSentences, findTemporal, findMeetingDate, findReuniao,
  scoreDecision, isProceduralSubject, STOPWORDS, fold, level, VERSION };
}));
