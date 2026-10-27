const fs=require('fs'),E=require('../js/extractor.js');
const a1=fs.readFileSync('atas/ata1-numerada.txt','utf8');
// 1. vazio / lixo
['', '   ', '\n\n', 'x', '12345', 'Lorem ipsum dolor sit amet.'].forEach(t=>{ const r=E.extract(t); console.log('entrada',JSON.stringify(t).slice(0,20).padEnd(22),'-> assuntos',r.assuntos.length,'dec',r.decisoes.length,'enc',r.encaminhamentos.length,'degraded',r.degraded); });
// 2. ata inteira numa linha só (PDF sem quebras)
const flat=a1.replace(/\n+/g,' ');
let r=E.extract(flat);
console.log('\nSEM QUEBRAS  -> estrutura',r.estrutura.tipo,'| assuntos',JSON.stringify(r.assuntos),'| dec',r.decisoes.length,'enc',r.encaminhamentos.length,'prob',r.problemas.length);
// 3. desempenho: ~200 mil caracteres
const big=Array(120).fill(a1).join('\n\n');
let t0=Date.now(); r=E.extract(big); console.log('\nGRANDE',big.length,'chars em',Date.now()-t0,'ms | dec',r.decisoes.length,'enc',r.encaminhamentos.length,'(duplicatas removidas?)');
// 4. frase patológica (backtracking)
const patho='foi '+'aprovado '.repeat(300)+'e deverá '+'x '.repeat(500)+'.';
t0=Date.now(); E.extract(patho); console.log('PATOLÓGICA em',Date.now()-t0,'ms');
// 5. "nada inventado": ata sem nenhuma decisão
const neutro='Ata da 1ª Reunião Ordinária do Colegiado do Curso de Física\nAos 3 dias de abril de 2026 reuniram-se os membros. A coordenadora informou que o semestre começou normalmente. Os professores relataram que as aulas ocorreram sem intercorrências. Nada mais havendo, encerrou-se a reunião.';
r=E.extract(neutro); console.log('\nNEUTRA -> assuntos',JSON.stringify(r.assuntos),'dec',r.decisoes.length,'enc',r.encaminhamentos.length,'prob',r.problemas.length,'dem',r.demandas.length,'sug',r.sugestoes.length);
