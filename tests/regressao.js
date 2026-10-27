// Regressão: cada asserção corresponde a um item do pedido de ajuste.
const fs = require('fs'), E = require('../js/extractor.js');
const r = E.extract(fs.readFileSync(__dirname + '/atas/ata4-regressao.txt', 'utf8'));
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info ? '\n       ↳ ' + info : '')); };
const has = (arr, re) => arr.some(x => re.test((x.descricao || x)));
const prazos = [].concat(r.decisoes, r.encaminhamentos).map(x => x.prazo).filter(Boolean);
const refsTexto = [].concat(r.decisoes, r.encaminhamentos).flatMap(x => [x.prazo, x.prazoData].concat((x.referencias || []).map(y => y.texto))).filter(Boolean);

// 1. prazos
t('1a. "grade 2008/1" NÃO gera prazo', !refsTexto.some(p => /2008/.test(p)), JSON.stringify(refsTexto));
t('1b. "ementas de 2023/2" NÃO gera prazo', !refsTexto.some(p => /2023/.test(p)), JSON.stringify(refsTexto));
t('1c. "horário 2026.2" NÃO gera prazo', !refsTexto.some(p => /2026\.2/.test(p)), JSON.stringify(refsTexto));
const tf = E.findTemporal;
t('1d. "em 2026/2" é referência temporal', tf('A oferta ocorrerá em 2026/2.').principal && /2026\/2/.test(tf('A oferta ocorrerá em 2026/2.').principal.texto));
t('1e. "no semestre 2026/2" é referência temporal', !!tf('Ocorrerá no semestre 2026/2.').principal);
t('1f. "no período 2026/2" é referência temporal', !!tf('Ocorrerá no período 2026/2.').principal);
t('1g. "para 2026/2" é referência temporal', !!tf('O quadro será enviado para 2026/2.').principal);
t('1h. "matriz 2023/2" NÃO é temporal', !tf('Seguindo a matriz 2023/2.').principal);
t('1i. "horário 2026.2" NÃO é temporal', !tf('Conforme o horário 2026.2 divulgado.').principal);
const env = r.encaminhamentos.find(e => /enviará o quadro/.test(e.descricao));
t('1j. "enviará o quadro … para 2026/2" mantém referência 2026/2', env && /2026\/2/.test(env.prazo || ''), JSON.stringify(env));

// 2. encaminhamento != futuro
t('2a. "EDC, PS e RC2 serão ofertadas…" NÃO é encaminhamento', !has(r.encaminhamentos, /EDC, PS e RC2/));
t('2b. "ED2 será ofertada…" NÃO é encaminhamento', !has(r.encaminhamentos, /ED2 será ofertada/));
t('2c. "seguirá a matriz…"/"obedece…" NÃO é encaminhamento', !has(r.encaminhamentos, /seguirá|seguirão|obedece/));
const decOferta = r.decisoes.find(d => /seguirá a matriz/.test(d.descricao));
t('2d. regras seguintes viram DETALHES da decisão do bloco', decOferta && (decOferta.detalhes || []).some(x => /EDC, PS e RC2/.test(x.descricao)), JSON.stringify(decOferta && decOferta.detalhes));
t('2e. ação operacional atribuída continua sendo encaminhamento', has(r.encaminhamentos, /coordenação enviará o quadro/));
t('2f. encaminhamento posterior guarda relação com a decisão', env && env.relacao && /decisão/.test(env.relacao.tipo), JSON.stringify(env && env.relacao));

// 3. problema x sugestão
t('3a. "não há possibilidade de defesa" é PROBLEMA', has(r.problemas, /Não há possibilidade de defesa/));
t('3b. …e NÃO é sugestão', !has(r.sugestoes, /possibilidade de defesa/));
const prob = r.problemas.find(p => /possibilidade de defesa/.test(p.descricao));
t('3c. marcado como impedimento/status', prob && prob.subtipo === 'impedimento');
['Não existe possibilidade de defesa.', 'Sem possibilidade de defesa neste período.', 'Não foi possível realizar a defesa.', 'Não será possível marcar a banca.']
  .forEach(f => { const x = E.extract('1. Defesas\n' + f + '\n2. Outro\nTexto aqui.\n'); t('3d. "' + f + '" → problema, não sugestão', x.problemas.length === 1 && x.sugestoes.length === 0, JSON.stringify([x.problemas.length, x.sugestoes.length])); });

// 4. sugestão posteriormente deliberada
t('4a. sugestão de extensão NÃO permanece em "não deliberadas"', !has(r.sugestoes, /sugeriu que fosse dado o prazo de extensão/), JSON.stringify(r.sugestoes.map(s => s.descricao)));
const decExt = r.decisoes.find(d => /extensão por um ano foi aprovado/.test(d.descricao));
t('4b. a decisão aprovada existe e aponta a proposta de origem', decExt && decExt.origemProposta && /sugeriu/.test(decExt.origemProposta.descricao), JSON.stringify(decExt));
t('4c. a sugestão fica registrada como deliberada', r.sugestoesDeliberadas.some(s => s.situacao === 'deliberada' && /sugeriu/.test(s.descricao)));
// decisão NÃO imediatamente seguinte
const r2 = E.extract('1. Prazo\nO colegiado sugeriu que fosse dado o prazo de extensão de um ano. A coordenação analisou o histórico. Houve debate sobre o caso. O prazo de extensão por um ano foi aprovado por unanimidade.\n2. Outro\nTexto.');
t('4d. funciona mesmo com frases no meio (não só a seguinte)', r2.sugestoes.length === 0 && r2.decisoes.length >= 1, JSON.stringify(r2.sugestoes));
const r3 = E.extract('1. Prazo\nO colegiado sugeriu que fosse dado o prazo de extensão de um ano. Aprovado o calendário de matrícula por unanimidade.\n2. Outro\nTexto.');
t('4e. decisão sobre OUTRO tema NÃO apaga a sugestão', r3.sugestoes.length === 1, JSON.stringify(r3.sugestoes.map(s => s.descricao)));

// 5. responsáveis alternativos
const comunic = r.encaminhamentos.find(e => /comunicação à discente/.test(e.descricao));
t('5a. "pela Coordenação ou Direção" → 2 responsáveis', comunic && comunic.responsaveis && comunic.responsaveis.length === 2, JSON.stringify(comunic && comunic.responsaveis));
t('5b. …marcados como alternativa', comunic && comunic.responsavelTipo === 'alternativo' && comunic.responsaveis.every(x => x.alternativa));
t('5c. texto preserva "ou" e não trunca', comunic && comunic.responsavel === 'Coordenação ou Direção', comunic && comunic.responsavel);

// 6. demandas nominais
t('6a. "Solicitação de extensão de prazo…" é demanda (pauta)', r.demandas.some(d => /Solicitação de extensão de prazo/.test(d.descricao) && /pauta/.test(d.fonte)), JSON.stringify(r.demandas.map(d => [d.descricao, d.fonte])));
t('6b. demanda da pauta vinculada à decisão do mesmo assunto', r.demandas.some(d => /Solicitação de extensão/.test(d.descricao) && d.situacao === 'deliberada'));
t('6c. "Pedido de afastamento…" (pauta) é demanda', r.demandas.some(d => /Pedido de afastamento/.test(d.descricao)));
const rn = E.extract('1. Assunto\nSolicitação de extensão de prazo para entrega de TCC por parte dos discentes.\n2. Outro\nTexto.');
t('6d. frase nominal "Solicitação de…" no corpo é demanda', rn.demandas.length >= 1);
const rv = E.extract('1. Assunto\nO pedido de vista foi concedido ao professor.\n2. Outro\nTexto.');
t('6e. "pedido de vista" (procedimental) NÃO é demanda', rv.demandas.length === 0, JSON.stringify(rv.demandas));

// 7. termos recorrentes
const termos = r.termosRecorrentes.map(x => x.termo.toLowerCase());
['https', 'silva', 'jobson', 'ausência', 'ausencia', 'meet', 'google', 'souza', 'alves', 'carlos', 'maria'].forEach(w => t('7. termo "' + w + '" ausente', !termos.includes(w), termos.join(',')));
t('7. termos substantivos presentes', termos.some(w => /prazo|disciplina|extens|defesa/.test(w)), termos.join(','));
t('7. recorrência medida por blocos', r.termosRecorrentes.every(x => x.blocos >= 1) && r.termosRecorrentes.some(x => x.blocos >= 2));

// 8. títulos
const titulos = r.assuntos;
t('8a. ")" final preservado em "(2019123456)"', titulos.some(x => /\(2019123456\)$/.test(x)), JSON.stringify(titulos));
t('8b. parênteses em volta do título inteiro são removidos', E.extract('1. (Calendário)\nTexto sobre o calendário.\n2. (Outro)\nMais.').assuntos[0] === 'Calendário');
t('8c. título com parêntese interno e final preservado', E.extract('1. Defesa (TCC) de Ana (2019)\nTexto.\n2. Outro\nMais.').assuntos[0] === 'Defesa (TCC) de Ana (2019)');

// 7b. metadados institucionais/URL fora do título da reunião
t('7b. título da reunião não carrega URL/link', r.reuniao && !/link|https|meet/i.test(r.reuniao) && /Sistemas de Informação$/.test(r.reuniao), r.reuniao);

// 9. metadados
const d0 = r.decisoes[0];
t('9a. itens guardam fonte, gatilho, assunto e ordem', d0 && d0.fonte && d0.gatilho && d0.assunto && d0.ordem > 0, JSON.stringify(d0));
t('9b. confiança preservada', r.decisoes.concat(r.encaminhamentos).every(x => typeof x.confianca === 'number'));
t('9c. sugestões pendentes marcadas como pendente', r.sugestoes.every(s => s.situacao === 'pendente'));

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
