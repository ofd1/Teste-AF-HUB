# Conecta 🟩🔵🟡

Um jogo de tabuleiro digital, em formato de **circuito fechado** (pista em loop), criado para uma
criança autista de 7 anos praticar — brincando — **contato visual** e **comunicação**.

Site: `index.html` (a ideia do projeto) · Jogo: `jogo.html` (o tabuleiro jogável).

## A ideia

Em vez de uma atividade repetitiva de treino, o Conecta transforma a prática de contato visual e
comunicação em uma aventura de tabuleiro:

- **Pista em circuito fechado** — um loop de 24 espaços que a criança percorre sem fim de jogo,
  quantas voltas quiser, no próprio ritmo. Previsibilidade e repetição em vez de pressão de tempo.
- **Cartas coloridas** — espaços azuis sorteiam cartas de *Contato Visual* (ex.: "olhe nos olhos da
  pessoa e dê um high-five"), espaços verdes sorteiam cartas de *Comunicação* (ex.: "peça algo
  dizendo 'por favor'"), e espaços dourados são bônus de celebração em dupla.
- **Sempre jogado a dois** — o jogo foi desenhado para ser usado com um adulto, terapeuta ou colega
  ao lado. A tela sorteia o convite; a conexão de verdade acontece entre as duas pessoas, fora da
  tela.
- **Visual chamativo e avatar de blocos** — cores vibrantes e um mascote/avatar "de blocos" 100%
  desenhado em CSS (sem usar nenhuma logo ou personagem de terceiros), no estilo dos jogos de
  construção e mundos coloridos que muitas crianças adoram. A criança personaliza cor e
  acessórios do seu Bloco e desbloqueia novidades ao juntar estrelas.
- **Leitura em voz alta** — cada carta tem um botão "🔊 Ouvir" (Web Speech API, `pt-BR`), útil para
  quem ainda está aprendendo a ler.
- **Ajustes sensoriais** — sons, animações/confete e um "modo calmo" (cores mais suaves) podem ser
  ligados ou desligados a qualquer momento nas configurações do jogo.

> 💙 O Conecta é um recurso lúdico de apoio, não um tratamento. Ele não substitui o acompanhamento
> de fonoaudiólogos, terapeutas ocupacionais, psicólogos ou outros profissionais especializados —
> use-o como um complemento divertido, sempre com um adulto por perto.

## Estrutura do projeto

```
jogo-conecta/
├── index.html        # site: explica a ideia do projeto e leva ao jogo
├── jogo.html          # o tabuleiro jogável
├── css/
│   └── style.css       # todo o visual (paleta, tabuleiro, cartas, avatar, modais)
└── js/
    ├── cards.js         # conteúdo: cartas de olhar/comunicação, mensagens, acessórios
    └── game.js           # lógica do tabuleiro, dado, cartas, avatar e progresso
```

Sem build step e sem dependências externas além de uma fonte do Google Fonts (com fallback para
fontes do sistema). O progresso (estrelas, voltas, Bloco personalizado) é salvo no
`localStorage` do próprio navegador — não há backend nem coleta de dados.

## Como rodar localmente

É um site estático — basta servir a pasta `jogo-conecta/`:

```bash
cd jogo-conecta
python3 -m http.server 8080
# depois abra http://localhost:8080
```

## Como hospedar

Qualquer hospedagem de site estático funciona, por exemplo:

- **GitHub Pages**: em Settings → Pages do repositório, aponte para a pasta `jogo-conecta/` (ou
  publique seu conteúdo na branch usada pelo Pages).
- **Netlify / Vercel**: importe o repositório e configure `jogo-conecta` como diretório de
  publicação (sem comando de build).

## Personalizar o conteúdo das cartas

Todo o texto do jogo (cartas, mensagens de bônus, acessórios, cores) fica em `js/cards.js` — dá
para ajustar as frases, adicionar novas cartas ou trocar os emojis sem tocar na lógica do jogo em
`js/game.js`.
