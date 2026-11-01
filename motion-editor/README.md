# MotionFrame Editor

Editor de motion graphics no navegador, no estilo Frameify / Nova Editor, que **importa presets `.ffx` do After Effects** e presets próprios em JSON.

Não tem build nem dependências: são ES modules puros. Funciona no desktop e no celular (layout responsivo e instalável como PWA).

## Como rodar

```bash
cd motion-editor
python3 -m http.server 8080     # ou: npm start
# abra http://localhost:8080
```

> Precisa de um servidor HTTP: módulos ES não carregam via `file://`.

## Recursos

- **Camadas:** texto, retângulo, elipse, sólido, imagem e vídeo (por arrastar e soltar ou pelo botão "+ Mídia"). Modos de mesclagem e pontos de entrada e saída.
- **Keyframes em tudo:** posição, escala, rotação, opacidade, ponto de ancoragem e todos os parâmetros de efeito. Funciona com cronômetro e navegação ‹ ◆ › como no AE.
- **Interpolações:** Linear, Easy Ease, Ease In/Out, Overshoot, Quicar, Hold e Bézier com influência (vinda do AE).
- **Timeline:** mover e aparar camadas, arrastar keyframes (com snap no quadro), zoom com Ctrl+roda e scrub.
- **Efeitos nativos:** desfoque gaussiano, desfoque direcional, glow, sombra projetada, preenchimento, tingir, matiz/saturação, brilho/contraste, preto e branco, inverter, mosaico, vinheta, aberração RGB, ruído/grão, gradiente, tremor (wiggle) e transformar.
- **Biblioteca de presets:** mais de 20 presets nativos (entradas, saídas, ênfase e looks). Você também pode salvar a animação de uma camada como preset e exportar ou importar `.json`.
- **Exportação:** vídeo WebM/MP4 (MediaRecorder), quadro PNG e projeto `.json`.
- **Outros:** desfazer/refazer, salvamento automático no navegador e atalhos de teclado.

### Atalhos

| Tecla | Ação |
|---|---|
| Espaço | Play/Pause |
| ← / → (Shift = 10 quadros) | Quadro anterior/próximo |
| Home / End | Início/fim |
| Delete | Exclui o keyframe selecionado (ou a camada) |
| Ctrl+Z / Ctrl+Shift+Z | Desfazer/Refazer |
| Ctrl+D | Duplicar camada |
| Ctrl+S | Salvar projeto |

## Importação de `.ffx`

O `.ffx` é um arquivo binário **RIFX** (RIFF big-endian, form type `FaFX`). O parser (`js/riff.js` + `js/ffx.js`) lê a árvore de chunks:

```
RIFX FaFX
 ├ head
 └ LIST besc
    ├ LIST tdsp   → caminho do alvo (tdmn "ADBE Effect Parade", tdmn "<matchName>", tdsn "<nome>")
    └ LIST sspc   → instância do efeito
       ├ LIST parT → definições dos parâmetros (tdmn "<mn>-0001" + pard: tipo, nome)
       └ LIST tdgp → valores (tdmn + LIST tdbs { tdsn, tdb4, cdat, LIST list { lhd3, ldat } })
```

Para cada efeito, o editor:

1. **Lê o match name** (por exemplo `ADBE Gaussian Blur 2`), os nomes, tipos e valores dos parâmetros (`cdat`, float64) e os keyframes (`lhd3`/`ldat`).
2. **Mapeia para um efeito nativo.** Ele procura primeiro pelo match name exato e depois por palavras-chave no nome ("glow", "shadow", "shake"…). Os parâmetros são casados pelo nome e, se não houver nome, pelo índice `-000N`. Também converte unidades: cores ARGB 0–255 viram RGBA 0–1, e a opacidade da sombra (0–255) vira %.
3. **Mantém o que não tem equivalente.** Pseudo-efeitos e plugins de terceiros sem correspondência viram "Controles importados": continuam editáveis e animáveis, mas não alteram a imagem.
4. **Lê presets de animação.** Propriedades de `ADBE Transform Group` (posição, escala, rotação, opacidade) viram keyframes da camada. A posição é aplicada de forma relativa, porque as coordenadas absolutas da comp do AE não valem para outra comp.
5. **Mostra um relatório:** status de cada efeito (Nativo / Aproximado / Sem equivalente), avisos (expressões, arquivo truncado) e a árvore RIFX para depuração. O fps usado para converter o tempo dos keyframes pode ser ajustado ali mesmo.

Se a estrutura não for reconhecida, uma varredura bruta dos chunks `tdmn` ainda lista os efeitos encontrados.

| Efeito do AE (match name) | Efeito no editor |
|---|---|
| ADBE Gaussian Blur 2, ADBE Fast Blur, ADBE Box Blur2 | Desfoque gaussiano |
| ADBE Motion Blur | Desfoque direcional |
| ADBE Glo2 | Glow |
| ADBE Drop Shadow | Sombra projetada |
| ADBE Fill | Preenchimento |
| ADBE Tint | Tingir |
| ADBE HUE SATURATION, ADBE Color Balance (HLS) | Matiz/Saturação |
| ADBE Brightness & Contrast 2 | Brilho e contraste |
| ADBE Black&White | Preto e branco |
| ADBE Invert | Inverter |
| ADBE Mosaic | Mosaico |
| CC Vignette | Vinheta |
| ADBE Noise, ADBE Add Grain | Ruído/Grão |
| ADBE Ramp | Gradiente |
| ADBE Geometry2 | Transformar |

Para adicionar um mapeamento, edite `ffx.matchNames` e `ffx.map` do efeito em `js/effects.js`.

### Limitações conhecidas

- O formato `.ffx` não é documentado pela Adobe. O layout foi obtido de engenharia reversa pública. A leitura de efeitos, parâmetros e valores segue essa estrutura. Já o layout binário dos **keyframes** (`ldat`) é *best-effort*: se os valores não passarem na checagem de plausibilidade, o parâmetro é importado como valor estático e um aviso aparece.
- **Expressões** são preservadas como texto, mas não são executadas.
- Não há suporte a animadores de texto, máscaras, 3D/câmeras nem plugins de terceiros (Saber, Deep Glow etc.), que viram aproximações ou controles sem render.
- O render usa Canvas 2D (`ctx.filter`), o que funciona melhor em navegadores Chromium. A exportação de vídeo é em tempo real.
- Vídeos não são embutidos no arquivo de projeto `.json` (imagens são).

## Testes

```bash
npm test            # parser FFX, conversão em preset e aplicação de presets (node:test)
npm run samples     # regenera samples/*.ffx
```

Os `.ffx` de teste e de exemplo (`samples/`) são gerados por `tests/ffx-builder.mjs`, que escreve o mesmo layout RIFX descrito acima. Vale testar também com arquivos `.ffx` exportados do seu After Effects. Se algum não importar bem, o painel "Estrutura RIFX (debug)" no relatório mostra a árvore lida.

## Estrutura

```
js/riff.js       parser RIFF/RIFX genérico
js/ffx.js        interpretação de .ffx (efeitos, parâmetros, keyframes)
js/presets.js    formato de preset, presets nativos, FFX→preset, aplicar/salvar
js/effects.js    efeitos (render Canvas 2D) + mapeamento de match names do AE
js/anim.js       keyframes, interpolação e easing
js/renderer.js   composição dos quadros, hit-test e mídia
js/state.js      projeto, camadas, histórico (undo/redo)
js/timeline.js   timeline
js/inspector.js  painel de propriedades e efeitos
js/library.js    biblioteca de presets + relatório de importação
js/exporter.js   exportação de vídeo/PNG
js/main.js       app, comandos, atalhos, arrastar e soltar
```
