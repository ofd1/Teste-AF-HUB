import { AppCategory } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { aiOrchestrator } from "./orchestrator";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateTemplateData {
  name: string;
  slug: string;
  description?: string;
  category: AppCategory;
  schema: Record<string, unknown>;
  promptTemplate: string;
  outputFormat?: string;
}

export interface GeneratedTemplateDefinition {
  name: string;
  slug: string;
  description: string;
  schema: Record<string, unknown>;
  promptTemplate: string;
  outputFormat: string;
}

// ─── TemplateEngine ──────────────────────────────────────────────────────────

export class TemplateEngine {
  /**
   * Lists all active templates, optionally filtered by category.
   */
  async listTemplates(category?: AppCategory) {
    return prisma.template.findMany({
      where: {
        isActive: true,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Retrieves a single template by its unique slug.
   * Throws if not found or inactive.
   */
  async getTemplate(slug: string) {
    const template = await prisma.template.findUnique({ where: { slug } });

    if (!template) {
      throw new Error(`Template "${slug}" not found.`);
    }

    if (!template.isActive) {
      throw new Error(`Template "${slug}" is currently inactive.`);
    }

    return template;
  }

  /**
   * Creates a new template record in the database.
   */
  async createTemplate(data: CreateTemplateData) {
    return prisma.template.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        category: data.category,
        schema: data.schema,
        promptTemplate: data.promptTemplate,
        outputFormat: data.outputFormat ?? "json",
      },
    });
  }

  /**
   * Fetches a template by slug, interpolates {{variables}} in the prompt,
   * sends it to the AI, and returns the raw response text.
   */
  async executeTemplate(
    slug: string,
    variables: Record<string, unknown>,
  ): Promise<string> {
    const template = await this.getTemplate(slug);

    // Replace all {{variableName}} placeholders with the provided values.
    const interpolated = this.interpolate(template.promptTemplate, variables);

    const systemPrompt = `You are an AI assistant for a financial platform.
Execute the following templated prompt precisely and return the result in ${template.outputFormat} format.`;

    return aiOrchestrator.chat(
      [{ role: "user", content: interpolated }],
      systemPrompt,
    );
  }

  /**
   * Uses the AI to generate a new template definition from a plain-language
   * description. Returns the generated definition (not yet persisted).
   */
  async generateFromDescription(
    description: string,
    category: string,
  ): Promise<GeneratedTemplateDefinition> {
    const systemPrompt = `You are a template-design assistant for a financial hub platform.
Given a natural-language description, produce a complete template definition as ONLY valid JSON (no markdown fences).

The JSON must match this exact shape:
{
  "name": "Human-readable template name",
  "slug": "kebab-case-unique-slug",
  "description": "One-sentence description",
  "schema": {
    "fields": [
      { "name": "fieldName", "type": "string|number|boolean|date", "required": true, "label": "Field Label" }
    ]
  },
  "promptTemplate": "Prompt text with {{fieldName}} placeholders matching schema fields",
  "outputFormat": "json|text|markdown"
}

Category context: ${category}`;

    const raw = await aiOrchestrator.chat(
      [{ role: "user", content: description }],
      systemPrompt,
    );

    try {
      const parsed = JSON.parse(raw) as GeneratedTemplateDefinition;
      return parsed;
    } catch {
      throw new Error(
        "AI returned an invalid template definition. Please refine your description and try again.",
      );
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Replaces {{key}} placeholders in a template string with values from the
   * provided map. Unknown placeholders are left as-is.
   */
  private interpolate(
    template: string,
    variables: Record<string, unknown>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        return String(variables[key]);
      }
      return match; // leave unrecognised placeholders intact
    });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const templateEngine = new TemplateEngine();
