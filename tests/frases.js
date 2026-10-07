// Teste de frases isoladas: cada linha = [frase, categoria esperada]
const E = require('../js/extractor.js');
const casos = [
 // DECISÕES reais
 ['Foi aprovado o novo calendário acadêmico.','decisoes'],
 ['O colegiado aprovou a alteração da matriz curricular.','decisoes'],
 ['Ficou definido que as aulas começam em março.','decisoes'],
 ['Deliberou-se pela manutenção da oferta noturna.','decisoes'],
 ['Foi decidido que a prova será remarcada.','decisoes'],
 ['Foi acordado que as reuniões serão mensais.','decisoes'],
 ['A proposta foi aceita por todos.','decisoes'],
 ['A solicitação foi rejeitada.','decisoes'],
 ['O grupo decidiu adotar o novo formulário.','decisoes'],
 ['Após discussão, definiu-se que o horário será mantido.','decisoes'],
 ['Colocada em votação, a proposta foi aprovada por unanimidade.','decisoes'],
 // NÃO decisões
 ['O professor sugeriu que a proposta fosse aprovada na próxima reunião.','sugestoes'],
 ['Caso seja aprovado, o calendário entra em vigor em 2027.',null],
 ['Vinte alunos foram reprovados em Cálculo I.',null],
 ['A aprovação do PPC depende do conselho.',null],
 ['Conforme aprovado na reunião anterior, o prazo será mantido.',null],
 ['Foi proposto que as reuniões passem a ser mensais.','sugestoes'],
 ['Seria interessante criar um canal de comunicação com os estudantes.','sugestoes'],
 ['A proposta de alteração do PPC foi apresentada ao colegiado.','sugestoes'],
 // ENCAMINHAMENTOS sem a palavra
 ['João ficará responsável por entrar em contato com a secretaria.','encaminhamentos'],
 ['A coordenação deverá verificar a situação.','encaminhamentos'],
 ['Será realizada uma consulta aos estudantes.','encaminhamentos'],
 ['O assunto será levado ao conselho.','encaminhamentos'],
 ['A equipe irá elaborar um novo documento.','encaminhamentos'],
 ['Foi definido que a coordenação entrará em contato com os envolvidos.','encaminhamentos'],
 ['Maria se comprometeu a enviar o relatório.','encaminhamentos'],
 ['O grupo deverá analisar a proposta na próxima reunião.','encaminhamentos'],
 ['Os professores deverão participar das atividades antes da realização da prova, marcada para 29/11/2026.','encaminhamentos'],
 // não encaminhamento
 ['A prova ocorrerá em 29/11/2026.',null],
 ['O calendário entrará em vigor em 2027.',null],
 ['O professor gostaria de criar um grupo de estudos.',null],
 ['O estudante deve cumprir a carga horária mínima.',null],
 ['Maria solicitou a palavra.',null],
 // PROBLEMAS / DEMANDAS
 ['Foi relatada dificuldade de acesso à plataforma.','problemas'],
 ['Houve reclamações sobre o horário das disciplinas.','problemas'],
 ['Os participantes demonstraram preocupação com a evasão.','problemas'],
 ['Verificou-se que muitos alunos desistem no primeiro semestre.','problemas'],
 ['Foram observadas dificuldades na oferta de optativas.','problemas'],
 ['Foi identificada a necessidade de ampliar o laboratório.','demandas'],
 ['Há necessidade de contratar mais professores.','demandas'],
 ['Os participantes solicitaram mais vagas nas turmas de laboratório.','demandas'],
 ['Foi registrada uma demanda por mais bolsas de monitoria.','demandas'],
 ['Não há problemas com o sistema de matrícula.',null],
 ['A reunião foi aberta pela coordenadora.',null],
];
let ok=0, bad=0;
casos.forEach(([s,esp])=>{
  const r = E.extract('1. Assunto de teste\n'+s+'\n2. Outro assunto\nTexto.\n');
  const got = ['decisoes','encaminhamentos','sugestoes','demandas','problemas'].filter(k=>r[k].length);
  const principal = got.includes(esp)?esp:(got[0]||null);
  const pass = esp===null ? got.length===0 : got.includes(esp);
  pass?ok++:bad++;
  const it = got.length? r[got[0]][0]:null;
  console.log((pass?'OK  ':'FAIL')+' esp='+String(esp).padEnd(15)+' got='+(got.join('+')||'-').padEnd(26)+'| '+s.slice(0,70)+(it&&it.gatilho?'  ⟨'+it.gatilho+'⟩':''));
});
console.log('\n'+ok+' ok / '+bad+' falhas');
