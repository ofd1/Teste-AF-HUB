import { useState } from "react";

const TABS = [
  { id: "context", label: "1. Contexto" },
  { id: "arch", label: "2. Arquitetura" },
  { id: "roadmap", label: "3. Roadmap" },
  { id: "personas", label: "4. Validação" },
  { id: "improve", label: "5. Melhorias" },
];

const PERSONA_DATA = {
  cto: {
    name: "CTO",
    emoji: "🧑‍💻",
    color: "#0ea5e9",
    verdict: "APROVADO com ressalvas",
    score: "8.2/10",
    pros: [
      "Arquitetura modular com micro-serviços permite escalar independente cada componente",
      "AI Orchestrator como camada de abstração é a decisão certa — protege contra vendor lock-in",
      "Sandbox isolado por app protege o sistema core de código gerado por IA",
      "Event-driven via message queue (BullMQ/Redis) garante resiliência e auditoria",
    ],
    cons: [
      "Falta estratégia de observabilidade (logs, traces, métricas) — sem isso, debug de apps gerados por IA é pesadelo",
      "Governança de dados sensíveis: apps criados por analistas podem vazar dados de clientes entre silos",
      "CI/CD automatizado para apps gerados precisa de gates de segurança (SAST/DAST) antes de deploy",
      "Custo de LLM pode escalar rápido — precisa de caching inteligente e rate limiting por usuário",
    ],
    suggestion:
      "Adicionar camada de Policy Engine (OPA/Cedar) entre o AI Orchestrator e os recursos. Cada app gerado passa por validação de segurança, compliance e data access antes de ir pro ar.",
  },
  banker: {
    name: "IB / AM Analyst",
    emoji: "📊",
    color: "#f59e0b",
    verdict: "MUITO ENTUSIASMADO",
    score: "9.1/10",
    pros: [
      "Criador de tese de pitch resolve a dor #1: montar deck de investimento leva 3-5 dias, isso corta pra horas",
      "Slides de mercado padrão com dados atualizados automaticamente = nunca mais planilha desatualizada",
      "Lista de distribuição automatizada elimina o trabalho manual mais tedioso do fundraising",
      "Planilhador de balancete já prova o conceito — equipe já confia na ferramenta",
    ],
    cons: [
      "Preciso confiar que os números estão certos — erro em valuation é catastrófico para reputação",
      "Compliance: CVM/SEC podem questionar decks gerados por IA se não houver trilha de auditoria clara",
      "Dados de mercado precisam de fonte confiável (Bloomberg, Economatica, CVM) — não pode ser webscraping genérico",
      "Templates precisam ser customizáveis por deal — cada transação tem nuances que IA genérica não pega",
    ],
    suggestion:
      "Priorizar integração com fontes de dados do mercado financeiro (Bloomberg API, CVM, B3). Cada número gerado deve ter 'source tag' clicável mostrando a origem. Isso resolve compliance E confiança do analista.",
  },
  devil: {
    name: "Devil's Advocate",
    emoji: "😈",
    color: "#ef4444",
    verdict: "DESAFIO FORTE",
    score: "6.5/10",
    pros: [
      "A visão é genuinamente diferenciada — não é mais um no-code genérico, é vertical pra financial services",
      "Começar com dores internas reais (balancete, pitch) dá product-market fit orgânico",
    ],
    cons: [
      "Vocês estão construindo um PaaS inteiro. Retool, Vercel, Supabase já existem — qual o moat real?",
      "\"Vibe coding\" depende da qualidade do LLM — se OpenAI/Anthropic mudar pricing ou degradar, o hub quebra",
      "Adoção interna é o killer: se 2 de 10 pessoas usarem, o ROI não fecha. Já validaram demanda real?",
      "Manutenção de apps gerados por IA é um problema não-resolvido na indústria. Quem mantém 50 micro-apps daqui a 1 ano?",
      "Segurança financeira: um app mal gerado que puxa dados errados de um fundo pode causar dano regulatório real",
      "Build vs Buy: por que não usar Retool + Supabase + Zapier e customizar, em vez de construir do zero?",
    ],
    suggestion:
      "Antes de construir o hub completo, façam um 'concierge MVP': usem Claude/Cursor + Supabase + Vercel manualmente para criar 3 apps internos. Meçam adoção real, tempo economizado, e erros. Se provar ROI em 60 dias, aí sim invistam no hub proprietário. O moat não é a plataforma — é o conhecimento de domínio financeiro embutido nos templates e workflows.",
  },
};

const ROADMAP_PHASES = [
  {
    phase: "Fase 0",
    title: "Foundation Sprint",
    duration: "Semanas 1-3",
    color: "#6366f1",
    items: [
      {
        task: "Setup infra base (Docker, PostgreSQL, Redis, Auth)",
        ai: "Claude Code gera boilerplate + configs",
        effort: "40h",
      },
      {
        task: "Migrar Planilhador de Balancete pro hub",
        ai: "Refactor assistido por IA",
        effort: "20h",
      },
      {
        task: "Design system + component library",
        ai: "Claude gera componentes base",
        effort: "30h",
      },
      {
        task: "Auth (SSO/OAuth2) + RBAC básico",
        ai: "Scaffold por Claude Code",
        effort: "15h",
      },
    ],
  },
  {
    phase: "Fase 1",
    title: "AI Studio (Core)",
    duration: "Semanas 4-8",
    color: "#8b5cf6",
    items: [
      {
        task: "AI Orchestrator — interface conversacional",
        ai: "Anthropic API + prompt engineering",
        effort: "60h",
      },
      {
        task: "Template Engine — tese de pitch + mercado",
        ai: "Claude gera templates iniciais",
        effort: "40h",
      },
      {
        task: "App Builder — geração de código sandboxed",
        ai: "Claude Code API + validação",
        effort: "50h",
      },
      {
        task: "Database-as-a-Service interno (schemas auto)",
        ai: "IA sugere schema a partir de descrição",
        effort: "35h",
      },
    ],
  },
  {
    phase: "Fase 2",
    title: "Marketplace & Deploy",
    duration: "Semanas 9-13",
    color: "#a855f7",
    items: [
      {
        task: "App Store interno — publicar, versionar, compartilhar",
        ai: "Auto-documentação por IA",
        effort: "45h",
      },
      {
        task: "Hosting engine — deploy 1-click com isolamento",
        ai: "Containerização automática",
        effort: "50h",
      },
      {
        task: "Integrations Hub — APIs externas (B3, CVM, Bloomberg)",
        ai: "IA gera conectores",
        effort: "40h",
      },
      {
        task: "Criador de slides de distribuição + mercado",
        ai: "Template generation + data binding",
        effort: "35h",
      },
    ],
  },
  {
    phase: "Fase 3",
    title: "Scale & Govern",
    duration: "Semanas 14-20",
    color: "#c084fc",
    items: [
      {
        task: "Policy Engine — compliance, data access, audit trail",
        ai: "Rules engine com IA",
        effort: "50h",
      },
      {
        task: "Analytics & Observability dashboard",
        ai: "Auto-generated dashboards",
        effort: "30h",
      },
      {
        task: "Advanced AI — multi-agent workflows",
        ai: "Agent orchestration",
        effort: "60h",
      },
      {
        task: "API pública + SDK para integrações externas",
        ai: "Auto-gen de docs/SDK",
        effort: "40h",
      },
    ],
  },
];

function ArchDiagram() {
  const [hoveredNode, setHoveredNode] = useState(null);

  const layers = [
    {
      name: "PRESENTATION LAYER",
      color: "#0ea5e9",
      y: 0,
      nodes: [
        {
          id: "webapp",
          label: "Web App (React)",
          desc: "Dashboard principal, App Store, configurações",
        },
        {
          id: "aistudio",
          label: "AI Studio",
          desc: "Interface conversacional para criar apps/automações",
        },
        {
          id: "appviewer",
          label: "App Viewer",
          desc: "Renderiza e executa apps publicados",
        },
      ],
    },
    {
      name: "AI ORCHESTRATION LAYER",
      color: "#8b5cf6",
      y: 1,
      nodes: [
        {
          id: "orchestrator",
          label: "AI Orchestrator",
          desc: "Roteia prompts, valida intenção, faz perguntas de refinamento",
        },
        {
          id: "codegen",
          label: "Code Generator",
          desc: "Gera código React/Python sandboxed via LLM",
        },
        {
          id: "templateeng",
          label: "Template Engine",
          desc: "Aplica templates financeiros (pitch, mercado, distribuição)",
        },
      ],
    },
    {
      name: "SERVICE LAYER",
      color: "#f59e0b",
      y: 2,
      nodes: [
        {
          id: "appengine",
          label: "App Engine",
          desc: "Build, deploy, versionamento de apps",
        },
        {
          id: "dataservice",
          label: "Data Service",
          desc: "CRUD automático, schemas gerados por IA",
        },
        {
          id: "integrations",
          label: "Integrations Hub",
          desc: "Conectores: B3, CVM, Bloomberg, Google, Slack",
        },
        {
          id: "automations",
          label: "Automation Engine",
          desc: "Cron jobs, triggers, workflows event-driven",
        },
      ],
    },
    {
      name: "INFRASTRUCTURE LAYER",
      color: "#10b981",
      y: 3,
      nodes: [
        {
          id: "db",
          label: "PostgreSQL + Redis",
          desc: "Banco relacional + cache/queue",
        },
        {
          id: "storage",
          label: "Object Storage (S3)",
          desc: "Arquivos, slides, PDFs gerados",
        },
        {
          id: "containers",
          label: "Container Runtime",
          desc: "Isolamento de apps em Docker/Firecracker",
        },
        {
          id: "auth",
          label: "Auth + RBAC",
          desc: "SSO, permissões por role, audit log",
        },
      ],
    },
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          minWidth: 700,
        }}
      >
        {layers.map((layer) => (
          <div key={layer.name}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                color: layer.color,
                marginBottom: 8,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {layer.name}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${layer.nodes.length}, 1fr)`,
                gap: 10,
              }}
            >
              {layer.nodes.map((node) => (
                <div
                  key={node.id}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    background:
                      hoveredNode === node.id
                        ? `${layer.color}22`
                        : "rgba(255,255,255,0.03)",
                    border: `1px solid ${hoveredNode === node.id ? layer.color : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 10,
                    padding: "14px 16px",
                    cursor: "default",
                    transition: "all 0.2s",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#e2e8f0",
                      marginBottom: 4,
                    }}
                  >
                    {node.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      lineHeight: 1.4,
                    }}
                  >
                    {node.desc}
                  </div>
                </div>
              ))}
            </div>
            {layer.y < 3 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "6px 0",
                  color: "rgba(255,255,255,0.15)",
                  fontSize: 18,
                  letterSpacing: 8,
                }}
              >
                ▼ ▼ ▼
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: "rgba(139,92,246,0.08)",
          borderRadius: 10,
          border: "1px solid rgba(139,92,246,0.2)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#a78bfa",
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          APPS HOSPEDADOS (ATUAIS + FUTUROS)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {[
            { name: "📊 Planilhador de Balancete", status: "LIVE", statusColor: "#10b981" },
            { name: "📑 Hub Criação de Tese (Pitch)", status: "FASE 1", statusColor: "#f59e0b" },
            { name: "📬 Criador Slides Distribuição", status: "FASE 2", statusColor: "#8b5cf6" },
            { name: "📈 Criador Slides Mercado Padrão", status: "FASE 2", statusColor: "#8b5cf6" },
          ].map((app) => (
            <div
              key={app.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <span style={{ color: "#e2e8f0" }}>{app.name}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: app.statusColor,
                  background: `${app.statusColor}15`,
                  padding: "3px 8px",
                  borderRadius: 4,
                  letterSpacing: 1,
                }}
              >
                {app.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoadmapView() {
  const [expandedPhase, setExpandedPhase] = useState(0);

  const totalHours = ROADMAP_PHASES.reduce(
    (sum, p) => sum + p.items.reduce((s, i) => s + parseInt(i.effort), 0),
    0
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ background: "rgba(99,102,241,0.1)", borderRadius: 8, padding: "10px 16px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#818cf8" }}>{totalHours}h</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Total estimado</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.1)", borderRadius: 8, padding: "10px 16px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#34d399" }}>20 sem</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>~5 meses</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.1)", borderRadius: 8, padding: "10px 16px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fbbf24" }}>~40%</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Acelerado por IA</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {ROADMAP_PHASES.map((p, i) => {
          const phaseHours = p.items.reduce((s, item) => s + parseInt(item.effort), 0);
          const pct = (phaseHours / totalHours) * 100;
          return (
            <div
              key={i}
              style={{
                height: 6,
                borderRadius: 3,
                background: p.color,
                flex: `${pct} 0 0%`,
                opacity: expandedPhase === i ? 1 : 0.4,
                cursor: "pointer",
                transition: "opacity 0.2s",
              }}
              onClick={() => setExpandedPhase(i)}
            />
          );
        })}
      </div>

      {ROADMAP_PHASES.map((phase, idx) => (
        <div
          key={idx}
          onClick={() => setExpandedPhase(idx)}
          style={{
            marginBottom: 10,
            borderRadius: 10,
            border: `1px solid ${expandedPhase === idx ? phase.color : "rgba(255,255,255,0.06)"}`,
            background:
              expandedPhase === idx ? `${phase.color}0a` : "rgba(255,255,255,0.02)",
            overflow: "hidden",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: phase.color,
                  background: `${phase.color}20`,
                  padding: "4px 10px",
                  borderRadius: 5,
                  letterSpacing: 1,
                }}
              >
                {phase.phase}
              </span>
              <span style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 14 }}>
                {phase.title}
              </span>
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {phase.duration}
            </span>
          </div>

          {expandedPhase === idx && (
            <div style={{ padding: "0 18px 16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Task", "Como IA ajuda", "Esforço"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "rgba(255,255,255,0.3)",
                          letterSpacing: 1,
                          padding: "6px 8px",
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {h.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {phase.items.map((item, i) => (
                    <tr key={i}>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: 12,
                          color: "#e2e8f0",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        {item.task}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: 11,
                          color: "#a78bfa",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        🤖 {item.ai}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: phase.color,
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.effort}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonaCard({ id }) {
  const p = PERSONA_DATA[id];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: `1px solid ${expanded ? p.color : "rgba(255,255,255,0.08)"}`,
        borderRadius: 12,
        background: expanded ? `${p.color}08` : "rgba(255,255,255,0.02)",
        marginBottom: 12,
        overflow: "hidden",
        transition: "all 0.25s",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>{p.emoji}</span>
          <div>
            <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 15 }}>
              {p.name}
            </div>
            <div style={{ fontSize: 11, color: p.color, fontWeight: 600 }}>
              {p.verdict}
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: p.color,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {p.score}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#10b981",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                ✅ PONTOS FORTES
              </div>
              {p.pros.map((pro, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.7)",
                    lineHeight: 1.5,
                    marginBottom: 8,
                    paddingLeft: 12,
                    borderLeft: "2px solid rgba(16,185,129,0.3)",
                  }}
                >
                  {pro}
                </div>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#ef4444",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                ⚠️ RISCOS / CRÍTICAS
              </div>
              {p.cons.map((con, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.7)",
                    lineHeight: 1.5,
                    marginBottom: 8,
                    paddingLeft: 12,
                    borderLeft: "2px solid rgba(239,68,68,0.3)",
                  }}
                >
                  {con}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 14,
              background: `${p.color}10`,
              borderRadius: 8,
              border: `1px solid ${p.color}30`,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: p.color,
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              💡 RECOMENDAÇÃO-CHAVE
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#e2e8f0",
                lineHeight: 1.6,
              }}
            >
              {p.suggestion}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AFHubPlan() {
  const [activeTab, setActiveTab] = useState("context");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0e14",
        color: "#e2e8f0",
        fontFamily:
          "'Satoshi', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "24px 20px",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 3,
            color: "#6366f1",
            marginBottom: 6,
          }}
        >
          AF INTERNAL
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            background: "linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #f472b6 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            lineHeight: 1.2,
          }}
        >
          AF Hub — Plano Estratégico
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.45)",
            marginTop: 6,
            maxWidth: 600,
            lineHeight: 1.5,
          }}
        >
          Plataforma interna de vibe-coding, automação e apps para a equipe AF.
          Arquitetura, roadmap com IA, e validação por 3 personas.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background:
                activeTab === tab.id
                  ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                  : "rgba(255,255,255,0.04)",
              color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.45)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.06)",
          padding: 24,
        }}
      >
        {/* TAB 1 — CONTEXTO */}
        {activeTab === "context" && (
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 0,
                marginBottom: 6,
              }}
            >
              Contexto do Projeto
            </h2>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "0 0 20px" }}>
              Nota: não foram encontradas transcrições de chats anteriores no sistema. Contexto reconstruído a partir da sua descrição.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              {[
                {
                  title: "O que é a AF",
                  icon: "🏦",
                  content:
                    "Boutique de assessoria financeira / asset management. Equipe enxuta com analistas, gestores e operações que precisam de ferramentas internas ágeis.",
                },
                {
                  title: "A Dor",
                  icon: "🔥",
                  content:
                    "Criação de decks, análises e automações depende de conhecimento técnico que a equipe não tem. Processos manuais consomem horas em tarefas repetitivas (balancetes, slides de mercado, teses de pitch).",
                },
                {
                  title: "A Visão — AF Hub",
                  icon: "🚀",
                  content:
                    "Uma plataforma interna onde qualquer colaborador descreve em linguagem natural o que precisa, e a IA constrói o app/automação. Sem precisar de código. Com deploy, hosting e marketplace interno.",
                },
                {
                  title: "Apps Atuais & Futuros",
                  icon: "📦",
                  content:
                    "LIVE: Planilhador de Balancete. PIPELINE: Hub de Tese pra Pitch, Criador de Slides de Lista de Distribuição, Criador de Slides de Mercado Padrão.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                    padding: 18,
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      marginBottom: 8,
                    }}
                  >
                    {card.icon}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#e2e8f0",
                      marginBottom: 6,
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                      lineHeight: 1.6,
                    }}
                  >
                    {card.content}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: "rgba(99,102,241,0.08)",
                borderRadius: 10,
                border: "1px solid rgba(99,102,241,0.2)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#818cf8",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                PRINCÍPIOS DO HUB
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {[
                  "🗣️ Natural Language First — descreva, não code",
                  "🔒 Segurança by design — sandbox + RBAC",
                  "⚡ Deploy em 1 click — sem DevOps",
                  "🧩 Integrações pré-conectadas — B3, CVM, Google",
                  "🏪 Marketplace interno — compartilhe com a equipe",
                  "📊 Data-aware — schemas e fontes de dados embutidos",
                ].map((p, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.7)",
                      lineHeight: 1.5,
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: 6,
                    }}
                  >
                    {p}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2 — ARQUITETURA */}
        {activeTab === "arch" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
              Arquitetura do Sistema
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                marginBottom: 20,
              }}
            >
              4 camadas — passe o mouse sobre cada componente para detalhes.
            </p>
            <ArchDiagram />

            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 10,
                }}
              >
                STACK TECNOLÓGICO RECOMENDADO
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 8,
                }}
              >
                {[
                  { cat: "Frontend", tech: "Next.js + React + Tailwind" },
                  { cat: "Backend", tech: "Node.js (Fastify) ou Python (FastAPI)" },
                  { cat: "AI", tech: "Anthropic Claude API + Claude Code" },
                  { cat: "Database", tech: "PostgreSQL + Prisma ORM" },
                  { cat: "Cache/Queue", tech: "Redis + BullMQ" },
                  { cat: "Storage", tech: "MinIO / S3" },
                  { cat: "Auth", tech: "Auth.js + RBAC custom" },
                  { cat: "Deploy", tech: "Docker + Coolify ou Railway" },
                  { cat: "Sandbox", tech: "Docker containers isolados" },
                  { cat: "Monitoring", tech: "Grafana + Loki + Sentry" },
                ].map((s) => (
                  <div
                    key={s.cat}
                    style={{
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.3)",
                        letterSpacing: 1,
                        marginBottom: 4,
                      }}
                    >
                      {s.cat.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>
                      {s.tech}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3 — ROADMAP */}
        {activeTab === "roadmap" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
              Roadmap de Desenvolvimento
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                marginBottom: 20,
              }}
            >
              20 semanas, 4 fases. Clique em cada fase para ver detalhes. Cada task mostra como IA acelera o desenvolvimento.
            </p>
            <RoadmapView />
          </div>
        )}

        {/* TAB 4 — PERSONAS */}
        {activeTab === "personas" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
              Validação por 3 Personas
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                marginBottom: 20,
              }}
            >
              Cada persona avaliou o plano com prós, contras e uma recomendação-chave. Clique para expandir.
            </p>
            <PersonaCard id="cto" />
            <PersonaCard id="banker" />
            <PersonaCard id="devil" />

            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: "rgba(255,255,255,0.03)",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.3)",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                SÍNTESE DAS 3 PERSPECTIVAS
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
                <strong style={{ color: "#e2e8f0" }}>Consenso:</strong> A visão é forte e o timing é certo. A vertical financeira é o diferencial real.
                <br />
                <strong style={{ color: "#e2e8f0" }}>Alerta unânime:</strong> Governança de dados e audit trail são pré-requisitos, não nice-to-have.
                <br />
                <strong style={{ color: "#e2e8f0" }}>Ação imediata recomendada:</strong> Fazer o concierge MVP (3 apps com ferramentas existentes) para provar adoção antes de investir no hub completo.
              </div>
            </div>
          </div>
        )}

        {/* TAB 5 — MELHORIAS */}
        {activeTab === "improve" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
              Melhorias de Longo Prazo
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                marginBottom: 20,
              }}
            >
              Visão 12-36 meses para transformar o hub em vantagem competitiva permanente.
            </p>

            {[
              {
                horizon: "6-12 MESES",
                color: "#10b981",
                items: [
                  {
                    title: "Knowledge Graph Financeiro",
                    desc: "Construir um grafo de conhecimento com todas as empresas, fundos, deals e métricas que a AF trabalha. IA usa isso como contexto para gerar apps mais precisos.",
                  },
                  {
                    title: "Versionamento Inteligente de Apps",
                    desc: "Cada app gerado por IA tem histórico de versões com diff visual. Se algo quebrar, rollback em 1 click. IA explica o que mudou entre versões.",
                  },
                  {
                    title: "Feedback Loop — Apps que melhoram sozinhos",
                    desc: "Quando um usuário corrige um output (ex: muda um número no balancete), o sistema aprende e ajusta para próxima vez. Fine-tuning contínuo.",
                  },
                  {
                    title: "Data Lakehouse Interno",
                    desc: "Centralizar todos os dados financeiros (CVM, B3, Bloomberg, internos) num lakehouse. Todo app novo já nasce com acesso a dados limpos e atualizados.",
                  },
                ],
              },
              {
                horizon: "12-24 MESES",
                color: "#f59e0b",
                items: [
                  {
                    title: "Multi-Agent Workflows",
                    desc: "Fluxos onde múltiplos agentes de IA colaboram: um analisa o mercado, outro monta a tese, outro gera o deck, outro revisa compliance. Pipeline end-to-end.",
                  },
                  {
                    title: "White-label para outras boutiques",
                    desc: "O hub vira produto SaaS vertical para financial services. Outras boutiques pagam pra usar. Nova linha de receita para AF.",
                  },
                  {
                    title: "Compliance-as-Code",
                    desc: "Regras de CVM, ANBIMA, SEC codificadas. Todo app/automação passa por verificação automática antes de ir pro ar. Elimina risco regulatório.",
                  },
                ],
              },
              {
                horizon: "24-36 MESES",
                color: "#ef4444",
                items: [
                  {
                    title: "IA que gera IAs",
                    desc: "Agentes especializados por vertical (M&A, PE, VC, crédito) que não só executam tarefas, mas criam sub-agentes para tarefas específicas de cada deal.",
                  },
                  {
                    title: "Marketplace Externo Regulado",
                    desc: "Abrir a plataforma para terceiros criarem e venderem apps financeiros. AF cobra comissão e garante compliance. Efeito de rede.",
                  },
                  {
                    title: "Digital Twin de Operações",
                    desc: "Simulação completa das operações da AF em ambiente digital. Testar cenários (ex: e se fecharmos 3 deals simultâneos?) antes de agir no mundo real.",
                  },
                ],
              },
            ].map((horizon) => (
              <div key={horizon.horizon} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 2,
                    color: horizon.color,
                    marginBottom: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {horizon.horizon}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                    gap: 10,
                  }}
                >
                  {horizon.items.map((item) => (
                    <div
                      key={item.title}
                      style={{
                        padding: 16,
                        background: `${horizon.color}08`,
                        border: `1px solid ${horizon.color}20`,
                        borderRadius: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#e2e8f0",
                          marginBottom: 6,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.55)",
                          lineHeight: 1.6,
                        }}
                      >
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(192,132,252,0.1))",
                borderRadius: 10,
                border: "1px solid rgba(139,92,246,0.2)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#c4b5fd",
                  marginBottom: 8,
                }}
              >
                🎯 Norte Estratégico
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.7)",
                  lineHeight: 1.7,
                }}
              >
                O hub não é um projeto de TI — é a base de uma vantagem competitiva. Boutiques que dominarem IA aplicada a financial services terão 10x mais throughput com o mesmo headcount. O objetivo final é que a AF opere como uma "AI-native financial firm" onde cada colaborador tem um copiloto de IA, cada processo tem automação, e cada decisão tem dados em tempo real. O hub é o sistema nervoso central dessa transformação.
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 20,
          textAlign: "center",
          fontSize: 10,
          color: "rgba(255,255,255,0.2)",
        }}
      >
        AF Hub Strategic Plan v1.0 — Gerado em Abril 2026
      </div>
    </div>
  );
}
