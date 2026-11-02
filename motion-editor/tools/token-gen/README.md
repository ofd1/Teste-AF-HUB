# Gerador de tokens do MotionFrame

Compila o `.exe` do Windows com a chave secreta (que nunca vai para o repositório):

```
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -X main.keyB64=$(cat priv.b64)" -o MotionFrame-Tokens.exe .
```

A chave pública correspondente está em `js/access.js` (PUBLIC_KEY). Se trocar a chave, troque as duas.
