# 🎁 Amigo Oculto

Sorteador de amigo oculto para 9 pessoas, com lista de desejos e animação de papelzinho.

## Como rodar

```bash
cd amigo-oculto
npm start          # sem dependências, só Node 18+
```

Abra http://localhost:8080. Variáveis opcionais: `PORT`, `DATA_DIR` (onde fica o `state.json`), `ADMIN_KEY`.

## Os dois sites

- **`/desejos`** — Site da lista de desejos: cada um escreve o que quer ganhar e o link de compra. Mostra quantos já preencheram.
- **`/sorteio`** — Site do sorteio: sorteia o nome com a animação do papelzinho e mostra a lista de desejos de quem foi tirado.
- `/` — página com os links para os dois sites.

O login vale para os dois sites no mesmo aparelho.

## Regras

- Na entrada a pessoa escolhe quem é e digita a senha.
- **Cada conta só funciona no primeiro aparelho que entrou.** Em outro aparelho, mesmo com a senha certa, a entrada é recusada.
- **O sorteio só libera quando as 9 pessoas tiverem pelo menos um desejo na lista.** Até lá, o site do sorteio mostra quem falta e se atualiza sozinho. Ninguém consegue apagar a lista inteira depois.
- O sorteio é feito uma vez no servidor, em um único ciclo: ninguém tira a si mesmo e todo mundo é tirado.
- Ao abrir o link de novo, o nome já sorteado e a lista aparecem direto.
- O presentinho 🎁 no canto abre a lista de desejos atualizada de quem você tirou.

## Liberar uma conta (ex.: alguém trocou de celular)

Suba o servidor com `ADMIN_KEY=algum-segredo` e rode:

```bash
curl -X POST http://localhost:8080/api/admin/liberar \
  -H "x-admin-key: algum-segredo" -d '{"nome":"Gabriel"}'
```

## Refazer o sorteio do zero

Pare o servidor e apague `data/state.json`.

## Hospedar no Discloud

Requer o **plano Platinum ou superior** (sites precisam de no mínimo 512 MB de RAM).

1. No painel do Discloud, abra **Domains → + Create subdomain** e crie o subdomínio `amigooculto-8ano`
   (se já existir, use outro nome e troque o `ID=` no `discloud.config`).
2. Compacte o conteúdo **desta pasta** (não a pasta em si), sem a pasta `data/`:
   `zip -r ../amigo-oculto.zip . -x "data/*" "*.zip"`
3. Envie o `.zip` pelo painel, pelo bot no Discord ou pela CLI.
4. Acesse `https://amigooculto-8ano.discloud.app` (o Discloud pode usar `.discloud.dev`).

**Cuidado com os dados:** o sorteio, as listas e as travas de aparelho ficam em `data/state.json` no servidor.
Para atualizar o site, use **commit** (substitui só os arquivos enviados) e nunca envie a pasta `data/`.
Apagar o app e subir de novo apaga esse arquivo: o sorteio é refeito e todos podem entrar de novo.
