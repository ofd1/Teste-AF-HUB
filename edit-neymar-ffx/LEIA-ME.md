# Edit Neymar (Brasil 11) — efeitos identificados + presets .ffx

Feito a partir do vídeo (576×694, 30 fps). A edit vai até **20,3 s**; o resto é a vinheta do TikTok.

**Importante:** um vídeo exportado não guarda as configurações dos plugins. Os valores abaixo foram
**estimados olhando o vídeo quadro a quadro** (tempos medidos com precisão de 1 quadro). Os nomes dos plugins
são os que mais combinam com o visual. Ajuste fino no AE comparando com o vídeo.

## Como usar
1. Copie os `.ffx` para `Documentos/Adobe/After Effects <versão>/User Presets` (ou dê dois cliques).
2. Selecione a camada certa (tabela abaixo) e aplique o preset (Animação › Aplicar predefinição de animação).
3. Os presets com keyframes começam no ponto do cursor (CTI): coloque o cursor no início do trecho antes de aplicar.
4. Plugins necessários: **Twixtor**, **Sapphire** (S_Shake, S_BlurMoCurves, S_WarpChroma, S_EdgeRays, S_Sharpen,
   S_Flicker), **Deep Glow**, **BCC** (Directional Blur). Shatter, Tint, Matiz/Saturação, Brilho/Contraste,
   Vibrance e Motion Tile são nativos do AE.

## Linha do tempo da edit e presets

| Tempo | O que acontece | Preset | Onde aplicar |
|---|---|---|---|
| tudo | Cor quente/amarela, contraste forte, nitidez, brilho suave nos claros | `01_CC_camada_de_ajuste` | camada de ajuste por cima de tudo |
| 0,0–2,2 s · 2,2–4,5 s · 4,5–6,6 s | Closes em câmera lenta lisa | `02_Slowmo_Twixtor_35` | em cada clipe (pré-compor antes) |
| 2,1 / 4,4 / 6,5 s | Transição: risco de luz + dissolve claro (~4 quadros) | (manual) | dissolve com modo **Adicionar** + Optical Flares/risco de luz |
| 6,6–8,2 s | Chute: rápido → lento → rápido com borrão | `03_Velocity_chute_rampa` | clipe do chute (1,6 s) |
| 8,0 / 12,0 / 17,4 s | Tremor + zoom + RGB no corte | `04_Shake_impacto_transicao` | camada de ajuste de 0,5 s no corte |
| 9,2–9,5 s · 14,8–15,1 s | Flash vermelho (9 quadros, pico no 5º), jogador fica ciano | `05_Flash_vermelho_glitch` | camada de ajuste de 0,3 s |
| 10,0–10,8 s · 15,6–16,2 s | Cards 3D com o escudo da CBF | (manual) | camadas 3D: rotação Y −35°→0°, escala 120→100 %, fundo amarelo |
| 10,8–12,2 s · 16,4–17,4 s | Rastro duplicado, raios brancos, desintegra em **bolinhas** (que saem como um shatter) | `06_Rastro_raios_desintegrar` + **CC Ball Action** (manual, valores abaixo) | clipe (estoura em +1,0 s) |
| 10,8–11,6 s | Linhas de luz onduladas no fundo verde | (manual) | Saber ou Fractal Noise + Wave Warp, modo Tela |
| 12,6–13,4 s · 18,2–19,0 s | Estilhaços amarelos com brilho + espelho em túnel | `07_Estilhacos_amarelos_glow` | clipe (0,8 s) |
| 14,0–14,8 s · 19,4–20,2 s | Brilho verde no olho | `08_Glow_verde_olho` | duplicar o clipe, máscara no olho (com tracking) e aplicar |
| cortes rápidos | Piscada de brilho | `09_Flicker_transicao` | camada de ajuste curta |

A parte de 15,6 s a 20,2 s repete a sequência de 10,0 s a 14,8 s (mesmos efeitos).

## Valores de cada preset

- **01 CC** — Brilho/Contraste: Brilho −6, Contraste 28 · Matiz/Saturação: Saturação +18 · Vibrance 25 ·
  S_Sharpen: Amp 1,4, Width 1,5 · Deep Glow: Radius 90, Exposure 0,35, Threshold 70 %.
- **02 Slowmo** — Twixtor: Speed 35 %, Frame Interp **Motion Weighted Blend**.
- **03 Velocity** — Twixtor Speed: 250 % (0 s) → 30 % (0,5 s) → 30 % (1,1 s) → 320 % (1,6 s), Motion Weighted Blend ·
  BCC Directional Blur: 0 até 1,25 s → 70 em 1,6 s (ângulo 70°).
- **04 Shake** — S_Shake: Frequency 18, impacto com decaimento em ~0,5 s · S_BlurMoCurves: Z Dist 0,8 → 1,0 em 0,2 s ·
  S_WarpChroma (controles reais): Steps 15, From Z Dist 0,85, To Z Dist 1, Warp Amount 1,2 → 0 em 0,3 s, cores vermelho/verde/azul.
- **05 Flash vermelho** — Tint: preto → vermelho (219, 5, 15), branco → ciano claro (158, 255, 219), Amount
  0 → 100 % (quadro 5) → 0 (quadro 9) · S_WarpChroma: From Z Dist 0,9, To Z Dist 1,02, Warp Amount 0 → 0,9 → 0.
- **06 Desintegrar** — S_EdgeRays: brilho 0 → 2,6 em 1,0 s → 0 em 1,15 s · Shatter: Repetitions 37,5, Radius 1,85,
  Strength 3, gravidade baixa. Para o rastro, adicione **Echo** (nativo): Echo Time −0,06, 5 ecos, decaimento 0,6.
  **Bolinhas — CC Ball Action** (nativo do AE, adicione à mão: não tenho o bloco dele num .ffx real para gerar com segurança):
  Scatter 0 até +0,9 s → 420 em +1,4 s · Grid Spacing 5 · Ball Size 100 · Twist Angle 0° → 60° (de +0,9 s a +1,4 s).
  Se quiser que eu gere esse também, me mande qualquer .ffx que tenha o CC Ball Action.
- **07 Estilhaços** — Shatter: Repetitions 11, Strength 8, preenchido de amarelo · Deep Glow: Radius 60,
  Exposure 1,5, Threshold 50 %, Tint amarelo-limão · Motion Tile: 300 %, espelhado · S_BlurMoCurves: Z Dist 1,25 → 1,0.
- **08 Olho** — Deep Glow: Radius 40, Exposure 2,5, Threshold 75 %, Tint verde.
- **09 Flicker** — S_Flicker: Amplitude 25, Frequência 15.
