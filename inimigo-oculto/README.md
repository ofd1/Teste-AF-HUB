# 😈 Inimigo Oculto

Versão "do mal" do amigo oculto: mesmas 9 pessoas e senhas, **sem lista de desejos e sem esperar ninguém**.
O sorteio é separado do amigo oculto (cada site tem o seu).

- Entra com nome e senha, clica em sortear e vê o nome com a animação do caldeirão.
- Cada conta só funciona no primeiro aparelho que entrou.
- Ninguém tira a si mesmo e todo mundo é tirado (um único ciclo, definido no servidor).
- Abrindo de novo, o nome já aparece.

## Rodar

```bash
cd inimigo-oculto
npm start   # porta 8080
```

## Discloud

1. Em **Domains → Criar subdomínio**, crie `inimigooculto-8ano` (ou troque o `ID=` no `discloud.config`).
2. Compacte o conteúdo desta pasta sem `data/`: `zip -r ../inimigo-oculto.zip . -x "data/*" "*.zip"`
3. Envie como um **app novo** (não substitua o do amigo oculto).

Para atualizar depois, use commit e nunca envie `data/`: é lá que ficam o sorteio e as travas.
Liberar uma conta: veja o README do amigo-oculto (mesmo comando `/api/admin/liberar`).
