# 🎁 Amigo Oculto

Sorteador de amigo oculto para 9 pessoas, com lista de desejos e animação de papelzinho.

## Como rodar

```bash
cd amigo-oculto
npm start          # sem dependências, só Node 18+
```

Abra http://localhost:3000. Variáveis opcionais: `PORT`, `DATA_DIR` (onde fica o `state.json`), `ADMIN_KEY`.

## Links

- `/desejos` — cada um escreve o que quer ganhar e o link de compra.
- `/sorteio` — sorteia o nome com a animação. Logo depois aparece a lista de desejos de quem foi tirado.

## Regras

- Na entrada a pessoa escolhe quem é e digita a senha.
- **Cada conta só funciona no primeiro aparelho que entrou.** Em outro aparelho, mesmo com a senha certa, a entrada é recusada.
- O sorteio é feito uma vez no servidor, em um único ciclo: ninguém tira a si mesmo e todo mundo é tirado.
- Ao abrir o link de novo, o nome já sorteado e a lista aparecem direto.
- O presentinho 🎁 no canto abre a lista de desejos atualizada de quem você tirou.

## Liberar uma conta (ex.: alguém trocou de celular)

Suba o servidor com `ADMIN_KEY=algum-segredo` e rode:

```bash
curl -X POST http://localhost:3000/api/admin/liberar \
  -H "x-admin-key: algum-segredo" -d '{"nome":"Gabriel"}'
```

## Refazer o sorteio do zero

Pare o servidor e apague `data/state.json`.
