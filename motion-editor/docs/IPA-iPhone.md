# Como gerar o IPA (iPhone)

O MotionFrame já tem o projeto iOS pronto (Capacitor, pasta `ios/`). O GitHub Actions gera a cada atualização um
**IPA sem assinatura** e um **.app para o Simulador** (aba *Actions* → execução “MotionFrame — APK e IPA” → *Artifacts*).

Um iPhone só instala apps **assinados**. Há três caminhos:

1. **Sem gastar nada (recomendado para uso pessoal): PWA**
   Abra https://ofd1.github.io/Teste-AF-HUB/ no **Safari** → Compartilhar → **Adicionar à Tela de Início**.
   Vira um app em tela cheia, funciona offline e não precisa de assinatura.

2. **Assinar o IPA com o seu Apple ID (grátis, vale 7 dias)**
   - No PC, instale o **Sideloadly** (Windows/Mac) ou o **AltStore**.
   - Baixe o `MotionFrame-unsigned.ipa` dos Artifacts do GitHub.
   - Conecte o iPhone por cabo, arraste o IPA no Sideloadly, entre com seu Apple ID e clique em *Start*.
   - No iPhone: Ajustes → Geral → VPN e Gerenciamento de Dispositivo → confie no seu Apple ID.
   - Com conta grátis o app expira em 7 dias (é só reinstalar).

3. **Conta Apple Developer (US$ 99/ano) — App Store / TestFlight**
   - Precisa de um **Mac com Xcode**.
   - Na pasta `motion-editor`: `npm install` → `npm run ios` (abre o Xcode).
   - No Xcode: *Signing & Capabilities* → escolha seu Team → *Product › Archive* → *Distribute App*
     (TestFlight para testar com amigos, ou App Store).
   - Sem Mac: dá para fazer o mesmo no GitHub Actions (runner macOS) cadastrando o certificado e o perfil de
     provisionamento como *secrets* do repositório.
