# MotionFrame — editor de edits (Android, iPhone e web)

Editor de vídeo e motion graphics com interface no estilo Alight Motion, feito para **edits** (futebol, velocity, shakes, glows…):

- **52 efeitos** que recriam os plugins mais usados no After Effects (Twixtor, Deep Glow, Twitch, Sapphire, BCC, RSMB, Optical Flares…) e os efeitos nativos famosos do AE.
- **Importador de `.ffx`** que identifica efeitos nativos e **plugins de terceiros** e converte cada um para o efeito equivalente do app, mantendo valores e keyframes.
- **Pacote de presets FREE**: basta colocar arquivos `.ffx`/`.json` numa pasta.
- **App Android e iOS** via Capacitor (projetos em `android/` e `ios/`) e também PWA instalável.

## Rodar

```bash
cd motion-editor
python3 -m http.server 8080        # ou: npm start
# abra http://localhost:8080 (no celular: use o IP do computador na mesma rede)
```

## Interface (estilo Alight Motion)

- **Prévia** no topo. Arraste com 1 dedo para mover a camada; use 2 dedos para escalar e girar.
- **Timeline** com playhead fixo no centro. Arraste para navegar e use pinça (ou Ctrl+roda) para zoom. Os clipes mostram miniatura (vídeo) ou forma de onda (áudio). Os marcadores de batida aparecem em laranja.
- **Barra inferior** contextual:
  - sem seleção: Camada, Mídia, Áudio, Texto, Ajuste, Efeitos, Presets, `.ffx`, Projeto;
  - com seleção: Efeitos, Presets, Ajustes, Keyframes, Velocidade, Dividir, Duplicar, Ordem, Ocultar, Excluir.
- **Painéis** deslizam de baixo (no desktop ficam na lateral).
- **Barra de keyframes** (acima da timeline):
  - **◆ Key** — cria um keyframe em posição, escala, rotação e opacidade;
  - **◆◆ Sel. todos** — seleciona todos os keyframes da camada (ou do projeto);
  - **⟷ Esticar** — estica ou comprime o comprimento dos keyframes selecionados. Use o slider de ¼× a 4× (com prévia ao vivo), os botões ½× / 0,75× / 1,5× / 2× ou digite a duração exata. A âncora pode ser o primeiro keyframe, o playhead ou o último;
  - **▾ Marca** — marcador de batida.
- **Painel Keyframes:**
  - interpolação em lote: Linear, Easy Ease, Ease In/Out, **Velocity forte/suave** (curva de influência alta, o “graph” clássico de edits), Overshoot e Hold;
  - inverter, mover para o playhead e excluir;
  - modo de seleção múltipla para celular.
- **Edição:**
  - camadas de vídeo, imagem, áudio, texto, formas, sólido e **camada de ajuste** (efeitos aplicados em tudo abaixo, como no AE);
  - dividir clipe (✂) e aparar pelas alças;
  - snap no playhead, nos marcadores e nas bordas de outros clipes;
  - desfazer/refazer.
- **Música:**
  - forma de onda na timeline;
  - **detecção automática de batidas**, que gera marcadores para sincronizar cortes e keyframes.
- **Salvamento:**
  - projeto salvo automaticamente no aparelho;
  - mídias guardadas no IndexedDB, então continuam lá depois de fechar o app.

Atalhos (desktop): Espaço (play), ←/→ (quadro), K (keyframe), M (marcador), Ctrl+A (selecionar keyframes), Ctrl+Shift+K (dividir), Ctrl+Z/Ctrl+Shift+Z, Ctrl+D, Delete.

## Efeitos

Renderização em **WebGL** (shaders próprios em `js/fx/`), o que funciona em Android e iPhone. O Safari não suporta `ctx.filter`.

| Categoria | Efeitos (entre parênteses: plugin/efeito do AE que recriam) |
|---|---|
| Luz e brilho | Deep Glow (Deep Glow), Glow (AE Glow), Raios de luz (CC Light Rays / Shine / S_Rays), Lens Flare (Optical Flares / S_LensFlare / BCC Lens Flare), Light Leaks (BCC Light Leaks), Strobe / Flash (Strobe Light) |
| Movimento | Shake (S_Shake / Universe Shake / wiggle), **Twitch** (Video Copilot Twitch: blur, cor, luz, escala, deslize), Transformar |
| Tempo | **Velocidade estilo Twixtor** (rampas de velocidade com keyframes + frame blending), Posterize Time (stutter), Echo (rastro) |
| Desfoque | Gaussiano, Direcional, Radial/Zoom (CC Radial Blur), **Motion blur estilo RSMB** (calculado a partir do movimento real da camada) |
| Estilizar | Sombra, Contorno, Mosaico, Vinheta, Ruído/Grão, Aberração cromática (S_WarpChroma), Prisma (BCC Prism), Glitch (BCC Glitch / S_DigitalDamage), VHS (BCC VHS), Encontrar bordas, Film Look (S_FilmEffect / FilmConvert) |
| Distorção | Wave Warp, Turbulent Displace, Bulge / CC Lens, Twirl, Optics Compensation, Mirror, CC Kaleida, **Motion Tile** |
| Cor | Color Grade (Lumetri / Looks), Exposição, Brilho/Contraste, Matiz/Saturação, Níveis, Vibração, Tint, P&B, Inverter, Fill, Gradiente, Posterizar, Threshold |
| Transições | Wipe linear, Wipe radial, Persianas, Dissolver em blocos |

> **Importante:** são **recriações próprias**, com a mesma função e parâmetros parecidos. Não são os plugins originais nem afiliados aos seus fabricantes. Os nomes aparecem apenas para identificar a compatibilidade na importação.

## Importador de `.ffx`

`js/riff.js` e `js/ffx.js` leem o binário RIFX (`FaFX`): efeitos, parâmetros, valores, keyframes e propriedades de transformação. Depois `js/import-map.js` identifica cada efeito:

1. **Nativo AE / CC.** O match name é exato (`ADBE Gaussian Blur 2`, `ADBE Glo2`, `CC Radial Blur`, `ADBE Lumetri`… são mais de 50).
2. **Plugin de terceiro.** O match name ou o nome é reconhecido por padrões:

   | Fabricante | Plugins reconhecidos |
   |---|---|
   | RE:Vision | Twixtor, RSMB |
   | Plugin Everything | Deep Glow |
   | Video Copilot | Twitch, Optical Flares, Saber, Heat Distortion |
   | Sapphire | `S_Glow`, `S_Shake`, `S_Blur*`, `S_WarpChroma`, `S_LensFlare`, `S_Rays`, `S_Film*`, `S_DigitalDamage`… |
   | BCC | Glow, Lens Flare, Light Leaks, Prism, Glitch, VHS, Shake… |
   | Red Giant | Universe (Glow, Shake, Glitch, VHS…), Shine, Starglow, Magic Bullet |
   | Outros | FilmConvert |

3. **Aproximado.** Quando nada acima casa, o app procura palavras-chave no nome (glow, shake, chromatic, glitch…).
4. **Sem equivalente.** O efeito vira “Controles importados”: os controles continuam editáveis e animáveis, mas não alteram a imagem.

Depois da importação, um relatório mostra o status de cada efeito, o plugin identificado, quais parâmetros foram convertidos e os avisos (expressões, arquivo truncado). Ali também dá para ajustar o fps usado para converter o tempo dos keyframes.

**Para adicionar ou corrigir um plugin:** inclua uma regra em `IMPORT_RULES` (`js/import-map.js`) com `test` (regex), `to` (efeito do app) e `map` (nome do parâmetro no plugin → parâmetro do app, com `conv` para converter unidades).

## Pacote de presets FREE

Coloque os arquivos em `presets/free/<Categoria>/`:

```
presets/free/
  Shakes/Shake forte RSMB.json
  Shakes/Shake forte RSMB.png      ← miniatura opcional (mesmo nome)
  Transições/zoom punch.ffx
  Velocity/rampa 1.ffx
```

Depois rode:

```bash
npm run presets      # gera presets/manifest.json
```

Os presets aparecem na aba **Presets** com o selo **FREE**, organizados por categoria. Arquivos `.ffx` são lidos e convertidos na hora em que o usuário toca neles. Também é possível exportar qualquer preset do app como `.json` (botão ⤓) e colocá-lo no pacote.

## Exportação

- **MP4 quadro a quadro.** Usa WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, em `js/vendor/`). A exportação é precisa: respeita Twixtor, motion blur e frame blending. Sai em H.264 (ou VP9/AV1, conforme o aparelho) e **com áudio** (AAC ou Opus).
- **Fallback.** Em navegadores sem WebCodecs, a gravação é feita em tempo real, sem áudio.
- **No celular**, o vídeo abre a folha de compartilhar, com as opções Salvar na galeria, TikTok, Instagram etc.

## Android e iPhone

O app é empacotado com **Capacitor 8**. Os projetos nativos já estão em `android/` e `ios/`.

```bash
cd motion-editor
npm install
npm run android   # copia o app para www/, sincroniza e abre no Android Studio → Run / Build APK/AAB
npm run ios       # idem para Xcode (requer macOS) → Run / Archive
```

- **Plugins nativos:** `@capacitor/filesystem` e `@capacitor/share`, usados para salvar e compartilhar os vídeos exportados.
- **iOS:** as permissões de galeria, câmera e microfone já estão no `Info.plist`. A exportação MP4 precisa de iOS 16.4 ou mais novo (WebCodecs).
- **PWA:** sem compilar nada, dá para abrir o site no celular e usar “Adicionar à tela inicial”. O app funciona offline graças ao service worker.

## Testes

```bash
npm test          # 14 testes: parser FFX, plugins, conversão, presets, esticar keyframes, Twixtor, posterize, batidas
npm run samples   # regenera samples/*.ffx e presets/free/Exemplos AE/
```

Também foram verificados no Chromium:

- interface no celular e no desktop;
- seleção e gestos;
- navegador de efeitos;
- selecionar todos / esticar keyframes;
- importação de `.ffx` com plugins;
- presets FREE;
- vídeo com rampa de velocidade (conferido medindo o movimento quadro a quadro no MP4 exportado);
- detecção de batidas;
- exportação MP4 com áudio.

## Limitações conhecidas

- **Formato `.ffx`.** Não é documentado. Os testes usam arquivos gerados com o mesmo layout RIFX obtido por engenharia reversa. **Ainda é preciso validar com `.ffx` reais do seu After Effects**, principalmente:
  - os match names exatos de plugins de terceiros (a detecção usa padrões de nome);
  - os nomes de parâmetros de cada plugin;
  - o layout binário dos keyframes (*best-effort*).

  Quando algo não converter bem, o relatório de importação mostra a estrutura do arquivo.
- **Expressões** (ex.: `wiggle()`) são preservadas como texto, mas não executadas. Use o efeito Shake.
- **Não suportado:** animadores de texto, máscaras, 3D/câmera, Element 3D, Particular e outros plugins de geração 3D.
- **Velocidade estilo Twixtor:** usa frame blending, não optical flow real. A interpolação fica mais suave em clipes com taxa de quadros alta.
- **Desempenho:** em celulares mais fracos, use prévia ½ ou ⅓. A exportação é feita quadro a quadro e não depende da velocidade da prévia.
- **Áudio do vídeo:** os clipes de vídeo entram mudos. O áudio vem das camadas de áudio, como é comum em edits.
- **Build nativo:** o APK/IPA não foi compilado neste ambiente, que não tem Android SDK nem Xcode. Os projetos foram gerados e sincronizados com sucesso pelo Capacitor.

## Estrutura

```
js/gl.js            motor WebGL (blur multi-escala, passes, pool de texturas)
js/fx/*.js          efeitos (shaders) por categoria
js/effects.js       registro dos efeitos
js/import-map.js    regras de identificação AE/plugins → efeitos do app
js/ffx.js, riff.js  leitura de .ffx
js/presets.js       presets nativos, FFX → preset, aplicar/salvar
js/renderer.js      composição: WebGL, motion blur, echo, camada de ajuste
js/timing.js        velocidade (Twixtor), posterize time, tempo da mídia
js/media.js         vídeo/imagem (seek preciso, frame blending)
js/audio.js         música, forma de onda, mixagem, detecção de batidas
js/keyframes.js     selecionar todos, esticar, inverter, easing em lote
js/timeline.js      timeline estilo Alight Motion
js/inspector.js     propriedades e controles de efeitos
js/keytools.js      painel de keyframes
js/fx-browser.js    navegador de efeitos
js/library.js       presets (nativos, FREE, importados)
js/exporter.js      exportação MP4 (WebCodecs) e fallback
js/platform.js      Capacitor (salvar/compartilhar), PWA
js/main.js          app, gestos, comandos
tools/              build-presets (manifest FREE) e build-www (Capacitor)
android/, ios/      projetos nativos (Capacitor)
```
