import { PrismaClient, Role, AppCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding AF Hub database...");

  // ─── Users ────────────────────────────────────────────────

  const adminPassword = await bcrypt.hash("admin123", 12);
  const analystPassword = await bcrypt.hash("analyst123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@af.com.br" },
    update: {},
    create: {
      email: "admin@af.com.br",
      name: "Admin AF",
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  const analyst = await prisma.user.upsert({
    where: { email: "analista@af.com.br" },
    update: {},
    create: {
      email: "analista@af.com.br",
      name: "Analista AF",
      passwordHash: analystPassword,
      role: Role.ANALYST,
    },
  });

  console.log(`Created users: ${admin.email}, ${analyst.email}`);

  // ─── Templates ────────────────────────────────────────────

  const templates = [
    {
      name: "Tese de Pitch para Investidores",
      slug: "tese-pitch",
      description: "Gera uma tese de investimento completa para apresentação a investidores",
      category: AppCategory.PITCH,
      schema: {
        fields: [
          { name: "empresa", type: "text", label: "Nome da Empresa", required: true },
          { name: "setor", type: "text", label: "Setor de Atuação", required: true },
          { name: "valoracao", type: "number", label: "Valuation Estimado (R$)", required: true },
          { name: "receita", type: "number", label: "Receita Anual (R$)", required: true },
          { name: "crescimento", type: "number", label: "Crescimento YoY (%)", required: true },
          { name: "tese", type: "textarea", label: "Tese Resumida", required: false },
        ],
      },
      promptTemplate: `Você é um analista de Investment Banking sênior. Gere uma tese de investimento profissional para a empresa {{empresa}} do setor {{setor}}.

Dados:
- Valuation: R$ {{valoracao}}
- Receita Anual: R$ {{receita}}
- Crescimento YoY: {{crescimento}}%
{{#tese}}- Contexto adicional: {{tese}}{{/tese}}

Gere a tese completa em formato JSON com as seções:
1. Executive Summary
2. Oportunidade de Mercado
3. Análise Financeira
4. Riscos e Mitigações
5. Recomendação de Investimento
6. Múltiplos Comparáveis`,
      outputFormat: "json",
    },
    {
      name: "Slides de Mercado Padrão",
      slug: "slides-mercado",
      description: "Gera dados e conteúdo para slides de atualização de mercado",
      category: AppCategory.MERCADO,
      schema: {
        fields: [
          { name: "periodo", type: "text", label: "Período (ex: Jan/2026)", required: true },
          { name: "indices", type: "text", label: "Índices (IBOV, S&P500, etc)", required: true },
          { name: "setores", type: "text", label: "Setores de Foco", required: false },
          { name: "destaques", type: "textarea", label: "Destaques do Período", required: false },
        ],
      },
      promptTemplate: `Gere conteúdo para um slide deck de atualização de mercado financeiro para o período {{periodo}}.

Índices a cobrir: {{indices}}
{{#setores}}Setores de foco: {{setores}}{{/setores}}
{{#destaques}}Destaques: {{destaques}}{{/destaques}}

Retorne em JSON com seções:
1. Resumo do Mercado
2. Performance dos Índices
3. Setores em Destaque
4. Análise Macro
5. Perspectivas`,
      outputFormat: "json",
    },
    {
      name: "Lista de Distribuição",
      slug: "lista-distribuicao",
      description: "Gera slides e dados para lista de distribuição de fundos",
      category: AppCategory.DISTRIBUICAO,
      schema: {
        fields: [
          { name: "fundo", type: "text", label: "Nome do Fundo", required: true },
          { name: "tipo", type: "text", label: "Tipo (FII, FIA, FIM, etc)", required: true },
          { name: "pl", type: "number", label: "Patrimônio Líquido (R$)", required: true },
          { name: "rentabilidade", type: "number", label: "Rentabilidade 12m (%)", required: true },
          { name: "benchmark", type: "text", label: "Benchmark", required: true },
          { name: "publico", type: "text", label: "Público Alvo", required: false },
        ],
      },
      promptTemplate: `Gere conteúdo para material de distribuição do fundo {{fundo}}.

Dados:
- Tipo: {{tipo}}
- PL: R$ {{pl}}
- Rentabilidade 12m: {{rentabilidade}}%
- Benchmark: {{benchmark}}
{{#publico}}- Público Alvo: {{publico}}{{/publico}}

Retorne em JSON com:
1. Resumo Executivo do Fundo
2. Estratégia de Investimento
3. Performance Histórica
4. Composição da Carteira
5. Perfil de Risco
6. Informações para Investidor`,
      outputFormat: "json",
    },
    {
      name: "Planilhador de Balancete",
      slug: "planilhador-balancete",
      description: "Processa e estrutura dados de balancete contábil",
      category: AppCategory.BALANCETE,
      schema: {
        fields: [
          { name: "empresa", type: "text", label: "Empresa", required: true },
          { name: "periodo", type: "text", label: "Período", required: true },
          { name: "dados", type: "textarea", label: "Dados do Balancete (cole aqui)", required: true },
          { name: "formato", type: "text", label: "Formato de Saída (json/tabela)", required: false },
        ],
      },
      promptTemplate: `Você é um contador especializado. Processe os dados de balancete abaixo da empresa {{empresa}} para o período {{periodo}}.

Dados brutos:
{{dados}}

Formato de saída: {{formato}}

Retorne em JSON estruturado com:
1. Ativo (Circulante + Não Circulante)
2. Passivo (Circulante + Não Circulante)
3. Patrimônio Líquido
4. DRE resumido se disponível
5. Indicadores calculados (Liquidez Corrente, Endividamento, ROE)`,
      outputFormat: "json",
    },
  ];

  for (const template of templates) {
    await prisma.template.upsert({
      where: { slug: template.slug },
      update: {},
      create: template,
    });
  }

  console.log(`Created ${templates.length} templates`);

  // ─── Default Policy Rules ────────────────────────────────

  const rules = [
    {
      name: "Admin Full Access",
      description: "Admins can do everything",
      resource: "*",
      action: "*",
      conditions: { roles: ["ADMIN"] },
      effect: "allow",
      priority: 100,
    },
    {
      name: "Manager App Management",
      description: "Managers can create and manage apps",
      resource: "app",
      action: "*",
      conditions: { roles: ["ADMIN", "MANAGER"] },
      effect: "allow",
      priority: 90,
    },
    {
      name: "Analyst Read Apps",
      description: "Analysts can view and use published apps",
      resource: "app",
      action: "read",
      conditions: { roles: ["ADMIN", "MANAGER", "ANALYST"] },
      effect: "allow",
      priority: 80,
    },
    {
      name: "Analyst Use AI",
      description: "Analysts can use AI features",
      resource: "ai",
      action: "*",
      conditions: { roles: ["ADMIN", "MANAGER", "ANALYST"] },
      effect: "allow",
      priority: 80,
    },
    {
      name: "Block Viewer Mutations",
      description: "Viewers cannot create or modify anything",
      resource: "*",
      action: "create",
      conditions: { roles: ["VIEWER"] },
      effect: "deny",
      priority: 95,
    },
  ];

  for (const rule of rules) {
    const existing = await prisma.policyRule.findFirst({
      where: { name: rule.name },
    });
    if (!existing) {
      await prisma.policyRule.create({ data: rule });
    }
  }

  console.log(`Created ${rules.length} policy rules`);

  // ─── Sample App (Planilhador de Balancete) ────────────────

  const existingApp = await prisma.app.findUnique({
    where: { slug: "planilhador-balancete" },
  });

  if (!existingApp) {
    const app = await prisma.app.create({
      data: {
        name: "Planilhador de Balancete",
        slug: "planilhador-balancete",
        description:
          "Ferramenta para processamento e estruturação de balancetes contábeis. Transforma dados brutos em relatórios formatados.",
        category: AppCategory.BALANCETE,
        status: "PUBLISHED",
        isPublic: true,
        tags: ["balancete", "contabilidade", "financeiro"],
        authorId: admin.id,
      },
    });

    const version = await prisma.appVersion.create({
      data: {
        version: "1.0.0",
        changelog: "Versão inicial do Planilhador de Balancete",
        sourceCode: JSON.stringify({
          "index.ts": "// Planilhador de Balancete - processamento de dados contábeis",
        }),
        aiGenerated: false,
        appId: app.id,
        authorId: admin.id,
      },
    });

    await prisma.app.update({
      where: { id: app.id },
      data: { currentVersionId: version.id },
    });

    console.log("Created sample app: Planilhador de Balancete");
  }

  // ─── Sample Integrations ──────────────────────────────────

  const integrations = [
    {
      name: "CVM - Dados Abertos",
      slug: "cvm-dados-abertos",
      provider: "cvm",
      config: { baseUrl: "https://dados.cvm.gov.br/", apiVersion: "v1" },
    },
    {
      name: "B3 - Market Data",
      slug: "b3-market-data",
      provider: "b3",
      config: { baseUrl: "https://api.b3.com.br/", apiVersion: "v1" },
    },
  ];

  for (const integration of integrations) {
    const existing = await prisma.integration.findUnique({
      where: { slug: integration.slug },
    });
    if (!existing) {
      await prisma.integration.create({ data: integration });
    }
  }

  console.log(`Created ${integrations.length} integrations`);

  console.log("\nSeed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
