import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { integrationQueue } from "../../lib/queue";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectorInterface {
  name: string;
  provider: string;
  fetchData: (config: any, params: any) => Promise<any>;
}

// ─── Connector Registry ───────────────────────────────────────────────────────

const registry = new Map<string, ConnectorInterface>();

// ─── Built-in Connector Stubs ─────────────────────────────────────────────────

const cvmConnector: ConnectorInterface = {
  name: "CVM Data Connector",
  provider: "cvm",
  async fetchData(config: any, params: any) {
    // Real implementation would call CVM (Comissão de Valores Mobiliários) API
    // endpoints such as https://dados.cvm.gov.br/dados/
    const action = params?.action ?? "company";

    if (action === "filings") {
      return {
        provider: "cvm",
        action: "filings",
        data: [
          {
            id: "cvm-filing-001",
            companyId: params?.companyId ?? "unknown",
            type: "ITR",
            referenceDate: "2024-03-31",
            deliveryDate: "2024-05-15",
            url: "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/",
          },
        ],
      };
    }

    // Default: company data
    return {
      provider: "cvm",
      action: "company",
      data: {
        cnpj: params?.cnpj ?? "00.000.000/0001-00",
        corporateName: "Empresa Exemplo S.A.",
        tradeName: "Exemplo",
        situation: "ATIVO",
        listingSegment: "NM",
        registrationDate: "2000-01-01",
      },
    };
  },
};

const b3Connector: ConnectorInterface = {
  name: "B3 Stock Exchange Connector",
  provider: "b3",
  async fetchData(config: any, params: any) {
    // Real implementation would integrate with B3 market data APIs
    const action = params?.action ?? "quote";

    if (action === "historical") {
      return {
        provider: "b3",
        action: "historical",
        ticker: params?.ticker ?? "PETR4",
        data: [
          { date: "2024-03-28", open: 37.5, high: 38.1, low: 37.2, close: 37.8, volume: 45_200_000 },
          { date: "2024-03-27", open: 37.0, high: 37.6, low: 36.9, close: 37.5, volume: 38_100_000 },
        ],
      };
    }

    // Default: quote
    return {
      provider: "b3",
      action: "quote",
      ticker: params?.ticker ?? "PETR4",
      data: {
        lastPrice: 37.8,
        change: 0.3,
        changePercent: 0.8,
        volume: 45_200_000,
        marketCap: 493_000_000_000,
        updatedAt: new Date().toISOString(),
      },
    };
  },
};

const bloombergConnector: ConnectorInterface = {
  name: "Bloomberg API Connector",
  provider: "bloomberg",
  async fetchData(config: any, params: any) {
    // Real implementation would use Bloomberg Data License or B-PIPE API
    const action = params?.action ?? "market-data";

    if (action === "reference-data") {
      return {
        provider: "bloomberg",
        action: "reference-data",
        security: params?.security ?? "PETR4 BZ Equity",
        data: {
          name: "PETROLEO BRASILEIRO SA PETROBRAS",
          currency: "BRL",
          exchange: "BVMF",
          sector: "Energy",
          industry: "Integrated Oil & Gas",
          peRatio: 4.2,
          dividendYield: 0.18,
        },
      };
    }

    // Default: market data
    return {
      provider: "bloomberg",
      action: "market-data",
      security: params?.security ?? "PETR4 BZ Equity",
      data: {
        bid: 37.75,
        ask: 37.82,
        last: 37.8,
        volume: 45_200_000,
        openInterest: null,
        updatedAt: new Date().toISOString(),
      },
    };
  },
};

const googleSheetsConnector: ConnectorInterface = {
  name: "Google Sheets Connector",
  provider: "google-sheets",
  async fetchData(config: any, params: any) {
    // Real implementation would use Google Sheets API v4
    // config should contain { accessToken, spreadsheetId }
    const action = params?.action ?? "read";

    if (action === "write") {
      return {
        provider: "google-sheets",
        action: "write",
        spreadsheetId: config?.spreadsheetId ?? "unknown",
        range: params?.range ?? "Sheet1!A1",
        updatedCells: params?.values?.flat().length ?? 0,
        updatedAt: new Date().toISOString(),
      };
    }

    // Default: read
    return {
      provider: "google-sheets",
      action: "read",
      spreadsheetId: config?.spreadsheetId ?? "unknown",
      range: params?.range ?? "Sheet1!A1:Z1000",
      data: {
        values: [
          ["Column A", "Column B", "Column C"],
          ["Row 1A",   "Row 1B",   "Row 1C"],
        ],
      },
    };
  },
};

const slackConnector: ConnectorInterface = {
  name: "Slack Webhook Connector",
  provider: "slack",
  async fetchData(config: any, params: any) {
    // Real implementation would POST to config.webhookUrl via fetch/axios
    // config should contain { webhookUrl } or { botToken, channel }
    return {
      provider: "slack",
      action: "send-notification",
      ok: true,
      channel: params?.channel ?? config?.channel ?? "#general",
      message: params?.text ?? "(empty message)",
      timestamp: new Date().toISOString(),
    };
  },
};

// Register all built-in connectors
registry.set(cvmConnector.provider, cvmConnector);
registry.set(b3Connector.provider, b3Connector);
registry.set(bloombergConnector.provider, bloombergConnector);
registry.set(googleSheetsConnector.provider, googleSheetsConnector);
registry.set(slackConnector.provider, slackConnector);

// ─── Service ──────────────────────────────────────────────────────────────────

class IntegrationsHub {
  // ── Registry management ───────────────────────────────────────────────────

  registerConnector(connector: ConnectorInterface): void {
    registry.set(connector.provider, connector);
  }

  listConnectors(): Array<{ name: string; provider: string }> {
    return Array.from(registry.values()).map(({ name, provider }) => ({
      name,
      provider,
    }));
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createIntegration(data: {
    name: string;
    provider: string;
    config: Record<string, unknown>;
    userId?: string;
  }) {
    const integration = await prisma.integration.create({
      data: {
        name: data.name,
        provider: data.provider,
        config: data.config,
      },
    });

    await logAudit({
      action: "CREATE",
      resource: "integration",
      userId: data.userId,
      details: { integrationId: integration.id, provider: data.provider },
    });

    return integration;
  }

  async listIntegrations() {
    return prisma.integration.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async getIntegration(id: string) {
    const integration = await prisma.integration.findUnique({ where: { id } });
    if (!integration) {
      throw new Error(`Integration not found: ${id}`);
    }
    return integration;
  }

  async updateIntegration(
    id: string,
    data: {
      name?: string;
      provider?: string;
      config?: Record<string, unknown>;
      userId?: string;
    },
  ) {
    const { userId, ...updateData } = data;

    const integration = await prisma.integration.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      action: "UPDATE",
      resource: "integration",
      userId,
      details: { integrationId: id },
    });

    return integration;
  }

  async deleteIntegration(id: string, userId?: string) {
    const integration = await prisma.integration.delete({ where: { id } });

    await logAudit({
      action: "DELETE",
      resource: "integration",
      userId,
      details: { integrationId: id, provider: integration.provider },
    });

    return integration;
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  async syncIntegration(id: string, userId?: string) {
    const integration = await this.getIntegration(id);

    await integrationQueue.add(
      "sync",
      { integrationId: id, provider: integration.provider },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );

    const updated = await prisma.integration.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });

    await logAudit({
      action: "SYNC",
      resource: "integration",
      userId,
      details: { integrationId: id, provider: integration.provider },
    });

    return updated;
  }

  // ── Connector execution ───────────────────────────────────────────────────

  async executeConnector(provider: string, config: any, params: any) {
    const connector = registry.get(provider);
    if (!connector) {
      throw new Error(`Connector not found for provider: ${provider}`);
    }
    return connector.fetchData(config, params);
  }

  async testConnection(
    provider: string,
    config: any,
  ): Promise<{ ok: boolean; message?: string }> {
    const connector = registry.get(provider);
    if (!connector) {
      return { ok: false, message: `No connector registered for provider: ${provider}` };
    }

    try {
      // Stub: call fetchData with a ping-like params object
      await connector.fetchData(config, { action: "test" });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection test failed";
      return { ok: false, message };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const integrationsHub = new IntegrationsHub();
