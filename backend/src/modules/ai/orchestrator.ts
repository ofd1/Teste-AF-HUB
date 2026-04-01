import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RefinedIntent {
  intent: string;
  parameters: Record<string, unknown>;
  clarifications: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;

// ─── AIOrchestrator ──────────────────────────────────────────────────────────

export class AIOrchestrator {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  /**
   * Sends a conversation to Claude and returns the assistant response text.
   */
  async chat(
    messages: { role: string; content: string }[],
    systemPrompt?: string,
  ): Promise<string> {
    try {
      // Anthropic SDK requires strictly alternating user/assistant roles.
      // Filter to only valid roles and cast appropriately.
      const validMessages = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      if (validMessages.length === 0) {
        throw new Error("At least one user message is required.");
      }

      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: validMessages,
      });

      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("No text content in Claude response.");
      }

      return block.text;
    } catch (error) {
      throw this.wrapError("chat", error);
    }
  }

  /**
   * Generates code for the given language using a specialised financial-app
   * system prompt.
   */
  async generateCode(prompt: string, language: string): Promise<string> {
    const systemPrompt = `You are an expert software engineer specialising in financial applications.
Your task is to generate production-ready ${language} code that is:
- Clean, well-structured, and thoroughly commented
- Secure: never expose sensitive data or credentials in code
- Compliant with financial industry best practices (auditability, precision for monetary values, error handling)
- Following SOLID principles and idiomatic ${language} conventions

Return ONLY the code block. Do not include markdown fences, explanations, or prose outside of inline code comments.`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("No text content in Claude response.");
      }

      return block.text;
    } catch (error) {
      throw this.wrapError("generateCode", error);
    }
  }

  /**
   * Takes vague user input and returns a structured intent object.
   */
  async refinePrompt(userInput: string): Promise<RefinedIntent> {
    const systemPrompt = `You are a requirements-analysis assistant for a financial hub platform.
Your job is to interpret vague or ambiguous user input and return a structured JSON object.

Always respond with ONLY valid JSON matching this exact shape:
{
  "intent": "a concise action verb phrase describing what the user wants",
  "parameters": { /* key-value pairs of inferred parameters */ },
  "clarifications": ["list of questions to ask the user if anything is ambiguous"]
}

Do not wrap the JSON in markdown fences. Do not add any prose outside the JSON.`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userInput }],
      });

      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("No text content in Claude response.");
      }

      try {
        const parsed = JSON.parse(block.text) as RefinedIntent;
        return parsed;
      } catch {
        // If the model returned something non-parseable, wrap it gracefully.
        return {
          intent: userInput,
          parameters: {},
          clarifications: [
            "Could not automatically parse intent. Please rephrase your request.",
          ],
        };
      }
    } catch (error) {
      throw this.wrapError("refinePrompt", error);
    }
  }

  /**
   * Summarises a long piece of text into concise, actionable bullet points.
   */
  async summarize(text: string): Promise<string> {
    const systemPrompt = `You are a financial analyst assistant. Summarise the provided text concisely.
Use bullet points where possible. Focus on key facts, figures, risks, and action items.
Keep the summary under 300 words unless the source material is exceptionally long.`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: text }],
      });

      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("No text content in Claude response.");
      }

      return block.text;
    } catch (error) {
      throw this.wrapError("summarize", error);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private wrapError(method: string, error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      return new Error(
        `AIOrchestrator.${method}: Anthropic API error ${error.status} – ${error.message}`,
      );
    }
    if (error instanceof Error) {
      return new Error(`AIOrchestrator.${method}: ${error.message}`);
    }
    return new Error(`AIOrchestrator.${method}: Unknown error`);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const aiOrchestrator = new AIOrchestrator();
