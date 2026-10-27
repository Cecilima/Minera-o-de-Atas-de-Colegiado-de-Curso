// Nível de confiança (seção 10): segurança da CLASSIFICAÇÃO automática — não importância, não veracidade.
const E = require('../js/extractor.js');
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info !== undefined ? '\n       ↳ ' + JSON.stringify(info) : '')); };
const KINDS = ['decisoes', 'encaminhamentos', 'sugestoes', 'demandas', 'problemas'];
const one = (f, titulo) => E.extract('1. ' + (titulo || 'Assunto da pauta') + '\n' + f + '\n2. Outro assunto\nTexto.\n');
const flat = f => E.extract(f);                         // mesma frase SEM estrutura
const first = (r, k) => (k ? r[k] : KINDS.flatMap(x => r[x]))[0] || null;
const lv = (f, k) => { const x = first(one(f), k); return x ? x.nivel : null; };
const sc = (r, k) => (first(r, k) || {}).confianca;

console.log('— exemplos da especificação');
t('"A solicitação foi aprovada por unanimidade." → decisão, alta', lv('A solicitação foi aprovada por unanimidade.', 'decisoes') === 'alta');
t('"Foi aprovada a alteração do calendário." → decisão, alta', lv('Foi aprovada a alteração do calendário.', 'decisoes') === 'alta');
const disc = one('Foi discutida a possibilidade de alteração do calendário.');
t('"Foi discutida a possibilidade de alteração…" → NÃO é decisão', disc.decisoes.length === 0);
t('… e não é classificado como nada com confiança média/alta', KINDS.every(k => disc[k].every(x => x.nivel === 'baixa')), KINDS.flatMap(k => disc[k]));

console.log('— a confiança vem das evidências, não de uma palavra solta');
const a = sc(one('O recurso foi indeferido.'), 'decisoes'), b = sc(one('O recurso foi indeferido por unanimidade.'), 'decisoes');
t('resultado de votação explícito AUMENTA a confiança', b > a, [a, b]);
const s1 = sc(one('Foi aprovada a alteração do calendário.'), 'decisoes'), s2 = sc(flat('Foi aprovada a alteração do calendário.'), 'decisoes');
t('estar no bloco de um item da ata (estrutura) AUMENTA a confiança', s1 > s2, [s1, s2]);
const e1 = sc(one('A secretaria enviará o calendário.'), 'encaminhamentos'), e2 = sc(one('A secretaria enviará o calendário até 10/12/2099.'), 'encaminhamentos');
t('prazo relacionado à ação AUMENTA a confiança do encaminhamento', e2 > e1, [e1, e2]);
const r1 = sc(one('O processo será enviado à pró-reitoria até 10/12/2099.'), 'encaminhamentos'), r2 = sc(one('O professor relatou que o processo será enviado à pró-reitoria até 10/12/2099.'), 'encaminhamentos');
t('a mesma ação dentro de um RELATO tem confiança MENOR', r2 === undefined || r2 < r1, [r1, r2]);
t('… e um relato nunca chega a "alta"', r2 === undefined || E.level(r2) !== 'alta');
t('sugestão por verbo explícito > formulação hipotética', sc(one('O professor Rui Lima sugeriu criar um canal com os estudantes.'), 'sugestoes') > (sc(one('Seria interessante criar um canal com os estudantes.'), 'sugestoes') || 0));
t('formulação hipotética ("seria interessante") → baixa', lv('Seria interessante criar um canal de comunicação com os estudantes.', 'sugestoes') === 'baixa');
t('necessidade sem pedido explícito → baixa', lv('É necessário ampliar o número de vagas.', 'demandas') === 'baixa');
t('pedido explícito com solicitante identificado → alta', lv('O relator solicitou a autorização para lançar o trancamento da disciplina.', 'demandas') === 'alta');
t('pendência ("ainda não", "talvez") não vira sugestão nem decisão', KINDS.every(k => one('Ainda não foi definida a data, talvez seja aprovada depois.')[k].length === 0));
t('condição ("caso seja aprovado") não vira decisão', one('Caso seja aprovado, o calendário entra em vigor em 2027.').decisoes.length === 0);

console.log('— transparência e consistência');
const fs = require('fs');
const allItems = fs.readdirSync(__dirname + '/atas').filter(f => /\.txt$/.test(f))
  .flatMap(f => { const r = E.extract(fs.readFileSync(__dirname + '/atas/' + f, 'utf8')); return KINDS.flatMap(k => r[k].map(x => [f, k, x])); });
t('todo item tem confianca numérica entre ' + E.CONF_MIN + ' e 0.97', allItems.every(([, , x]) => typeof x.confianca === 'number' && x.confianca >= E.CONF_MIN && x.confianca <= 0.97), allItems.filter(([, , x]) => !(x.confianca >= E.CONF_MIN)).map(x => x[2].descricao));
t('nivel é sempre coerente com level(confianca)', allItems.every(([, , x]) => x.nivel === E.level(x.confianca)), allItems.filter(([, , x]) => x.nivel !== E.level(x.confianca)).map(x => [x[2].descricao, x[2].confianca, x[2].nivel]));
t('todo item explica a nota (evidência de base + ajustes)', allItems.every(([, , x]) => Array.isArray(x.evidencias) && x.evidencias.length && x.evidencias[0].sinal === '=' && x.evidencias.every(e => typeof e.texto === 'string' && e.texto.length > 5)));
t('as evidências nunca falam de importância/prioridade/veracidade', allItems.every(([, , x]) => x.evidencias.every(e => !/import[aâ]ncia|prioridad|relev[aâ]ncia|ver[ií]dic|verdade|confi[aá]vel/i.test(e.texto))));
t('há itens nos três níveis no conjunto de atas (escala não é decorativa)', ['alta', 'média', 'baixa'].every(n => allItems.some(([, , x]) => x.nivel === n)), ['alta', 'média', 'baixa'].map(n => allItems.filter(([, , x]) => x.nivel === n).length));
t('textos de explicação por nível exportados para a interface', ['alta', 'média', 'baixa'].every(n => typeof E.CONF_TEXT[n] === 'string'));
t('mesma frase, mesmo contexto → mesma confiança (determinística)', sc(one('O pedido foi deferido por maioria.'), 'decisoes') === sc(one('O pedido foi deferido por maioria.'), 'decisoes'));

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
