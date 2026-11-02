# Treino da rede "Iris (aprendido)"

Rede pequena (4 convoluções 3×3, 24 canais) que imita o Topaz Iris a partir de pares reais
(quadro original → mesmo quadro exportado pelo Topaz Iris). Roda no app na GPU (`js/fx/irisnet.js`).

1. `prep.py <pasta>` — alinha original ampliado e saída do Topaz (ORB + ECC) e gera `nn/pair.npz`.
2. `train.py <pasta> <iterações> <canais>` — treina (estrutura + energia de textura por região).
3. `export.py net24.pt ../../js/fx/iris-weights.js` — grava os pesos para o app.

Quanto mais pares (cenas diferentes: rosto, gramado, camisa, placar), mais parecido e menos artefatos.
