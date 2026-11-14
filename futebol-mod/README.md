# ⚽ Futebol — mod de Minecraft (Fabric, 26.3)

Campo de futebol completo, igual aos vídeos do TikTok:

| Papel | Quem é |
|---|---|
| Time 1 — **Saqueadores** (camisa vermelha) | **Pillagers** |
| Time 2 — **Vindicadores** (camisa azul) | **Vindicators** (os do machado) |
| Goleiros | **Villagers** |
| Bola | **Cubo de Enxofre com madeira dentro** (arquétipo "quicante" do próprio jogo) |

## Instalar
Precisa de **Minecraft 26.3**, **Fabric Loader ≥ 0.20**, **Fabric API 0.166.2+26.3** e **Java 25**.
Coloque `dist/futebol-mod-1.0.0.jar` e o Fabric API na pasta `mods`. O mod funciona só no servidor/mundo (cliente vanilla também entra).

## Como jogar
1. `/futebol ativar` — constrói o campo (64×40, linhas, áreas, gols com rede, placas, refletores), coloca os 22 jogadores uniformizados com número e nome acima da cabeça, a bola no centro, e te dá o **Graveto do Árbitro** (graveto encantado).
2. **Botão direito com o graveto** — apita e começa o jogo.
3. Durante o jogo: botão esquerdo na bola = você chuta; graveto num jogador = ver a ficha de estatísticas; graveto + agachar = reiniciar a partida.
4. `/futebol desativar` — remove tudo e **restaura o terreno original**.

Outros comandos: `/futebol elenco`, `/futebol saqueadores <1-11>`, `/futebol vindicadores <1-11>` (ficha com a melhor estatística em verde ▲ e a pior em vermelho ▼), `/futebol tempo <segundos por tempo>` (padrão 150 s), `/futebol graveto`, `/futebol iniciar`.

## O que está implementado
- **Formação 4-4-2** com posições fixas por papel (goleiro, 2 zagueiros, 2 laterais, volante, meia, 2 pontas, centroavante e segundo atacante). Os jogadores mantêm a sua faixa do campo: a linha defensiva sobe e desce junto, os pontas ficam abertos, o atacante respeita a linha de impedimento.
- **Estatísticas por jogador** (1–99): velocidade, finalização, passe, drible, desarme, força, visão de jogo, fôlego, agressividade e reflexo (goleiro). Todas entram no jogo de verdade:
  - velocidade/fôlego → quanto o jogador corre (e cansa);
  - **finalização → precisão do chute** (erro angular e vertical, potência, escolha do canto; pressão e correria aumentam o erro);
  - passe → precisão e alcance do passe; visão → qualidade da escolha do passe e posicionamento;
  - drible/desarme/força/agressividade → disputa de bola, desarmes, faltas (zagueiros brutos marcam colado e cometem mais faltas);
  - reflexo → tempo de reação, alcance e chance de pegar ou espalmar do goleiro.
- **IA tática**: o mais próximo pressiona o portador, o segundo faz a cobertura, defensores marcam o atacante da sua zona do lado do gol, meias dão linhas de passe, laterais apoiam, pontas e atacantes atacam a área; com a bola solta, quem chega primeiro vai buscar (previsão da trajetória). O portador escolhe entre chutar, passar (rasteiro/alto, evitando impedimento e linha bloqueada), conduzir ou afastar.
- **Regras**: gol, **lateral**, **escanteio**, tiro de meta, faltas (falta/pênalti), pênalti, 2 tempos com troca de lados, intervalo e fim de jogo, placar na barra de ação.
- **Goleiro**: se posiciona na bissetriz, antecipa o ponto de chegada (com erro menor nos melhores), mergulha, pega, espalma ou toma o gol; sai para a bola solta na área e distribui o jogo.

## Compilar
```bash
cd futebol-mod
JAVA_HOME=/caminho/do/jdk25 ./gradlew build
```

## Notas
- Pillagers/Vindicators não existem no modo Pacífico: ao ativar, o mod muda a dificuldade para Fácil se necessário.
- Não há cartões nem impedimento apitado (os atacantes só evitam ficar em posição irregular).
- Teste automático de desenvolvimento: `FUTEBOL_AUTOTEST=<ticks> FUTEBOL_FAST=1 ./gradlew runServer` simula uma partida sem jogador.
