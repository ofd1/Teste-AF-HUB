import { Job } from "bullmq";
import { createWorker } from "../../lib/queue";
import { prisma } from "../../lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutomationJobData {
  automationId: string;
  input?: unknown;
}

interface AutomationAction {
  type: "log" | "webhook" | "ai_generate" | "notify" | "query_data";
  config?: Record<string, unknown>;
}

// ─── Action executor ──────────────────────────────────────────────────────────

async function executeAction(
  action: AutomationAction,
  context: { automationId: string; runId: string; input: unknown },
): Promise<unknown> {
  switch (action.type) {
    case "log": {
      const message = action.config?.message ?? "Automation log step executed";
      console.log(`[AutomationRun:${context.runId}] LOG:`, message, context.input);
      return { logged: message };
    }

    case "webhook": {
      const url = action.config?.url ?? "(no URL configured)";
      // Stub: in production this would fire an HTTP request
      console.log(
        `[AutomationRun:${context.runId}] WEBHOOK: would POST to ${url}`,
        { payload: context.input },
      );
      return { stub: true, url };
    }

    case "ai_generate": {
      const prompt = action.config?.prompt ?? "(no prompt configured)";
      // Stub: in production this would call the AI orchestrator
      console.log(
        `[AutomationRun:${context.runId}] AI_GENERATE: would run prompt — "${prompt}"`,
      );
      return { stub: true, prompt };
    }

    case "notify": {
      const channel = action.config?.channel ?? "default";
      const message = action.config?.message ?? "Automation notification";
      // Stub: in production this would dispatch a real notification
      console.log(
        `[AutomationRun:${context.runId}] NOTIFY: channel=${channel} message="${message}"`,
      );
      return { stub: true, channel, message };
    }

    case "query_data": {
      const query = action.config?.query ?? "(no query configured)";
      // Stub: in production this would execute against the data service
      console.log(
        `[AutomationRun:${context.runId}] QUERY_DATA: would run query — "${query}"`,
      );
      return { stub: true, query };
    }

    default: {
      const unknownType = (action as AutomationAction).type;
      console.warn(
        `[AutomationRun:${context.runId}] Unknown action type: ${unknownType}`,
      );
      return { skipped: true, type: unknownType };
    }
  }
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processAutomationJob(job: Job<AutomationJobData>): Promise<void> {
  const { automationId, input } = job.data;
  const startedAt = Date.now();

  // Fetch the automation definition
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
  });

  if (!automation) {
    throw new Error(`Automation ${automationId} not found`);
  }

  // Create a run record
  const run = await prisma.automationRun.create({
    data: {
      automationId,
      status: "running",
      input: input !== undefined ? (input as any) : undefined,
    },
  });

  const actionResults: unknown[] = [];
  const logLines: string[] = [];

  try {
    const actions = automation.actions as AutomationAction[];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const logPrefix = `[step ${i + 1}/${actions.length}] type=${action.type}`;

      logLines.push(`${logPrefix} — starting`);
      console.log(`[AutomationRun:${run.id}] ${logPrefix} — starting`);

      const result = await executeAction(action, {
        automationId,
        runId: run.id,
        input,
      });

      actionResults.push(result);
      logLines.push(`${logPrefix} — completed`);
      console.log(`[AutomationRun:${run.id}] ${logPrefix} — completed`);
    }

    const duration = Date.now() - startedAt;

    // Mark run as completed
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        output: { results: actionResults } as any,
        logs: logLines.join("\n"),
        duration,
        completedAt: new Date(),
      },
    });

    // Update automation metadata
    await prisma.automation.update({
      where: { id: automationId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "completed",
      },
    });

    console.log(
      `[AutomationWorker] Run ${run.id} for automation ${automationId} completed in ${duration}ms`,
    );
  } catch (err) {
    const duration = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Mark run as failed
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: errorMessage,
        logs: [...logLines, `ERROR: ${errorMessage}`].join("\n"),
        duration,
        completedAt: new Date(),
      },
    });

    // Update automation metadata
    await prisma.automation.update({
      where: { id: automationId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "failed",
      },
    });

    console.error(
      `[AutomationWorker] Run ${run.id} for automation ${automationId} failed:`,
      errorMessage,
    );

    // Re-throw so BullMQ can handle retries / failure hooks
    throw err;
  }
}

// ─── Worker instance ──────────────────────────────────────────────────────────

export const automationWorker = createWorker<AutomationJobData>(
  "automation-tasks",
  processAutomationJob,
  3,
);
