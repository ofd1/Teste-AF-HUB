#!/bin/sh
# Gera o MotionFrame.exe (Windows) com o editor embutido. Rode a partir de motion-editor/: sh tools/desktop/build.sh
set -e
node tools/build-www.mjs
rm -rf tools/desktop/www && cp -r www tools/desktop/www && rm -rf tools/desktop/www/tools
cd tools/desktop && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o MotionFrame.exe .
echo "pronto: tools/desktop/MotionFrame.exe"
