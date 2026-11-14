# ⚽ Futebol — mod de Minecraft (Fabric 26.3) · v2.1

Campo + estádio completos, 22 mobs jogando futebol de verdade: Pillagers (mandante) x Vindicators (visitante), goleiros Villager, bola de **Cubo de Enxofre com madeira dentro** e torcida de Villagers cantando.

**Requisitos:** Minecraft 26.3 · Fabric Loader ≥ 0.20 · Fabric API 0.166.2+26.3 · Java 25. Só precisa estar no mundo/servidor (cliente vanilla entra).

## Começando
```
/futebol ativar                      → Barcelona x Real Madrid (padrão)
/futebol ativar psg mancity          → qualquer dupla (/futebol times lista os 19 clubes)
```
Constrói campo + estádio, coloca os times uniformizados (camisa, calção, número e nome), a torcida, os telões, e te dá o **Graveto do Árbitro** e o **Controle de Câmeras**.
**Botão direito com o graveto = começa o jogo.** Graveto agachado = reinicia. `/futebol desativar` remove tudo e restaura o terreno.

## Novidades da v2.1
- **Campo maior** (90×56, gols de 9 blocos, áreas e círculo proporcionais) e estádio ampliado.
- **Jogo mais lento e mais realista:** jogadores ~20% mais lentos, aceleração gradual, curvas bruscas custam velocidade, decisões com mais calma, tempos de 4 minutos, reposições mais demoradas. Ajuste com `/futebol ritmo <0.4–1.6>`.
- **Mais mobilidade sem bola:** ninguém fica parado (movimentação sutil), tabelas (1-2) com corrida para receber de volta, enfiadas em profundidade, inversões de jogo, cruzamentos e bola para trás da área, laterais e pontas se movendo por dentro/fora.
- **Impedimento de verdade** (apita e dá tiro livre indireto), barreira a ~9 m.
- **Menos informação na tela:** só gol (título curto + chat), fim de jogo e telões. O resto (faltas, defesas, dribles, escanteios...) só com `/futebol info on`.

## O que tem
- **Clubes reais** (uniformes nas cores certas; camisa reserva automática se as cores baterem): Barcelona, Real Madrid, Cruzeiro, Atlético-MG, PSG, Manchester City, Arsenal, Liverpool, Chelsea, Manchester United, Tottenham, Newcastle, Aston Villa, Bayern, Dortmund, Flamengo, Palmeiras (+ Saqueadores x Vindicadores). Formações 4-3-3, 4-2-3-1 e 4-4-2.
- **Estatísticas por jogador** (10 atributos que mudam o jogo de verdade). `/futebol elenco <clube>`, `/futebol jogador <clube> <n>` (melhor ▲ verde, pior ▼ vermelho) ou graveto num jogador.
  > ⚠️ **Os nomes/escalações são de memória (temporada 25/26) e as notas são ESTIMATIVAS no estilo EA FC, não dados oficiais.** Tudo fica no arquivo editável `config/futebol/clubs.txt` — mude à vontade e use `/futebol recarregar`.
- **Fintas e dribles:** finta de corpo, pedalada, elástico, chapéu, caneta (chance depende de drible x desarme/velocidade do marcador). **Curvas:** chutes/faltas com efeito por cima da barreira, escanteios fechados, passes de trivela, cavadinha.
- **IA por posição:** linha de zaga coordenada, volante que desce entre os zagueiros, laterais que apoiam/fecham por dentro, meias que chegam de segunda linha, pontas que infiltram e recompõem, pivô que desce, contra-ataque e contra-pressão, goleiro-líbero que fecha o ângulo e sai nas costas da zaga.
- **Regras:** gol, lateral, escanteio, tiro de meta, faltas, pênalti, barreira, impedimento, 2 tempos, intervalo.
- **Estádio:** arquibancadas em anéis nas cores dos clubes, camarote VIP, teto com LED, fachada de vidro, telões (placar/tempo/público + tabela), bancos de reservas, iluminação.
- **Torcida:** Villagers sentados que olham a bola, pulam nos gols, vaiam faltas e cantam (bateria + melodia própria de cada clube; mais forte quando o time ataca). `/futebol torcida <n>`.
- **Câmeras** (`/futebol camera <modo>` ou o Controle de Câmeras): `tv`, `tatica`, `gol`, `bola`, `jogador` (olhos do jogador), `drone`, `arquibancada`, `auto` (diretor). Agache para sair.
- **Replays:** automáticos depois de cada gol (câmera lenta, vários ângulos para todos) e `/futebol replay [segundos]`.
- **Campeonatos:** `/futebol campeonato novo <premier|brasileirao|champions> <seuClube>` → `jogar` (você joga o seu jogo ao vivo; os outros são simulados pelas notas) → `tabela`. Liga de pontos corridos ou mata-mata com pênaltis; campeão ganha um troféu. (O campeonato vale enquanto o servidor estiver aberto.)
- **Torcedor e ingressos:** `/futebol torcer <clube>` (título quando o seu time marca); `/futebol ingresso setores|comprar <setor>` paga em **esmeraldas** (geral 1, visitante 1, central 3, camarote 8); botão direito no ingresso te leva ao assento; `/futebol bilheteria` mostra a renda.

## Comandos
`ativar [casa] [fora]` · `trocar <casa> <fora>` · `times` · `elenco <clube>` · `jogador <clube> <n>` · `iniciar` · `tempo <seg>` · `camera <modo>` · `controle` · `replay` · `telao <escala>` · `torcida <n>` · `torcer` · `info` · `ritmo` · `ingresso` · `bilheteria` · `campeonato` · `recarregar` · `desativar`

## Limites conhecidos
- Sem cartões. O goleiro Villager não mostra uniforme (só o nome colorido).
- Telões e câmeras foram validados só por simulação em servidor, **não visualmente**: se o texto dos telões ficar grande/pequeno use `/futebol telao <escala>`.
- Pillagers/Vindicators somem no Pacífico (o mod muda para Fácil ao ativar).

## Compilar
`JAVA_HOME=<jdk25> ./gradlew build`
