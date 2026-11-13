#!/bin/sh
# Gera o MotionFrame.exe de desktop (Electron, janela própria — não usa o navegador). Rode a partir de motion-editor/:
#   sh tools/electron/build.sh        → tools/electron/dist/MotionFrame.exe (portátil, não precisa instalar)
set -e
node tools/build-www.mjs
rm -rf tools/electron/www && cp -r www tools/electron/www && rm -rf tools/electron/www/tools tools/electron/www/app-update.zip tools/electron/www/version.json
cd tools/electron
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --win portable --x64
echo "pronto: tools/electron/dist/MotionFrame.exe"
