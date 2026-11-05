# Jeito mais rápido: capturar a CC (cor idêntica ao plugin)

No app: **Presets › ◐ Capturar CC do After Effects**. Ou use direto `motionframe-captura-AE.png` desta pasta:

1. No AE, arraste `motionframe-captura-AE.png` para "Nova composição" (512×512, sem escalar). Project Settings › Working Space: **None**.
2. Aplique a sua CC (Looks, Colorista, Lumetri, Curves…). No Looks, desligue o que depende da posição
   (Vignette, Diffusion, Haze, Edge Softness, Spot/Grad Exposure, Grain, Chromatic Aberration).
3. Composição › Salvar quadro como › PNG (sem mudar o tamanho). Dê o nome da CC ao arquivo.
4. No app: Presets › Capturar CC › **Importar captura**. Pronto: vira preset em "Capturado do AE".

---

# Calibração do Looks e do Colorista (10–15 min no After Effects)

1. Importe `carta-teste.png` numa comp 1920×1080 (8 bits, sem gerenciamento de cor).
2. Para cada linha abaixo: aplique o Looks com **só essa ferramenta**, Strength 100%, e o resto padrão.
   Exporte o quadro (Composição › Salvar quadro como › PNG) com o nome indicado.
3. Exporte também `00-original.png` (sem efeito nenhum), para eu checar se o AE não mudou nada.
4. Mande a pasta zipada (Drive serve).

## Looks
| arquivo | ferramenta | valor |
|---|---|---|
| lk-exposure+1.png | Exposure | +1 stop |
| lk-exposure-1.png | Exposure | −1 stop |
| lk-contrast+50.png | Contrast | +50% |
| lk-shadows-1.png | Shadows & Highlights | Shadows −1 |
| lk-highs+1.png | Shadows & Highlights | Highlights +1 |
| lk-sat50.png | Saturation | 50% |
| lk-sat150.png | Saturation | 150% |
| lk-warm+1.png | Color Balance (Warm/Cool) | +1 |
| lk-mojo50.png | Mojo II | Mojo 50 (resto padrão) |
| lk-colorista-lift.png | Colorista 3-Way | Lift totalmente para azul |
| lk-colorista-gain.png | Colorista 3-Way | Gain totalmente para laranja |
| lk-curves.png | Curves | ponto 50% → 60% (master) |
| lk-diffusion.png | Diffusion | padrão |
| lk-haze.png | Haze/Flare | padrão |
| lk-lut-NOME.png | LUT | uma por LUT que você usa (escreva o nome) |

## Colorista (efeito separado)
| arquivo | controle | valor |
|---|---|---|
| col-exposure+1.png | Exposure | +1 |
| col-sat50.png | Saturation | 50 |
| col-lift-azul.png | Lift (shadows) | disco para azul ao máximo |
| col-gain-laranja.png | Gain (highlights) | disco para laranja ao máximo |
| col-hsl-red.png | HSL › Red | hue +30, sat −50 |

Se usar alguma ferramenta que não está aqui, exporte do mesmo jeito e anote o valor no nome do arquivo.
