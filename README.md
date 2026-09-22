# Arquivo de Atas — Colegiado

Sistema estático (HTML/CSS/JS puro, sem backend) para enviar atas de
reunião em PDF/TXT, extrair automaticamente assuntos, decisões,
encaminhamentos, responsáveis, prazos e termos recorrentes, e explorar
tudo isso por um painel visual, uma aba de responsáveis e uma busca por
palavras-chave.

## Estrutura

```
index.html      → marcação da página (4 abas: Arquivo, Painel, Responsáveis, Consulta)
css/styles.css  → todo o estilo visual (tema único, claro)
js/app.js       → toda a lógica: upload, extração, análise, gráficos, busca
README.md       → este arquivo
```

## Como funciona (importante)

Esta versão foi preparada para rodar como **página estática no GitHub
Pages**, ou seja, sem nenhum servidor por trás. Por isso:

- **Extração de texto**: PDFs são lidos no navegador com `pdf.js`; TXT é
  lido diretamente.
- **Análise (assuntos, decisões, encaminhamentos, responsáveis, prazos,
  termos recorrentes)**: feita por regras e expressões regulares em
  JavaScript, no próprio navegador — não há chamada a nenhuma IA externa.
  A qualidade da extração depende de as atas usarem expressões como
  "decidiu-se", "ficou encaminhado", "responsável: Fulano", "prazo até
  dd/mm/aaaa" etc. Sempre revise os resultados na tela de detalhe de cada
  ata (clique na linha da tabela).
- **Persistência**: os dados ficam salvos no `localStorage` do navegador
  de quem está usando a página. Ou seja, cada pessoa que abre a página
  vê apenas as atas que ela mesma enviou naquele navegador — nada é
  compartilhado entre visitantes nem enviado a um servidor. Limpar os
  dados do site no navegador apaga o histórico.
- **Aba Consulta**: como não há IA por trás, as perguntas são respondidas
  por uma busca local por palavras-chave nas decisões, encaminhamentos e
  problemas identificados — não é um resumo gerado por um modelo de
  linguagem.

Se no futuro você quiser uma análise mais rica (com um modelo de
linguagem de verdade), será necessário acrescentar um backend próprio
(por exemplo, uma função serverless que chame a API da Anthropic com uma
chave protegida) e adaptar `analyzeText()` e `answerLocally()` em
`js/app.js` para chamar esse backend em vez da lógica local.

## Publicando no GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público ou privado, mas
   o GitHub Pages gratuito exige repositório público, a menos que você
   tenha GitHub Pro/Team/Enterprise).
2. Envie estes três arquivos (`index.html`, a pasta `css/` e a pasta
   `js/`) para a raiz do repositório:
   ```bash
   git init
   git add .
   git commit -m "Sistema de arquivo de atas"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings → Pages**.
4. Em "Build and deployment", escolha **Deploy from a branch**, selecione
   a branch `main` e a pasta `/ (root)`, e clique em **Save**.
5. Após alguns instantes, o GitHub mostrará o link público, algo como
   `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`.

Nenhuma configuração adicional é necessária — os únicos recursos
externos carregados são as fontes do Google Fonts e as bibliotecas
`pdf.js` e `Chart.js` via CDN (cdnjs.cloudflare.com), que funcionam
normalmente em qualquer página hospedada no GitHub Pages.

## Abas do sistema

- **Arquivo**: upload de PDFs/TXTs e índice de todas as atas processadas
  (buscável, filtrável por status e ordenável clicando no cabeçalho da
  coluna).
- **Painel**: frequência dos temas, evolução dos temas no tempo, decisões
  por período, quantidade de encaminhamentos por ata, assuntos mais
  recorrentes, rede de relacionamento entre temas e linha do tempo das
  decisões.
- **Responsáveis**: agrupa decisões e encaminhamentos por responsável
  identificado, mostrando quantos itens cada pessoa tem e quais ainda
  estão sem prazo definido.
- **Consulta**: perguntas em linguagem natural respondidas por busca
  local (sem IA) sobre o conteúdo já extraído das atas.
