import { AppCategory, AppStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

// ─── Helper ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface CreateAppData {
  name: string;
  description?: string;
  category: AppCategory;
  authorId: string;
}

interface ListAppsFilters {
  status?: AppStatus;
  category?: AppCategory;
  authorId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface UpdateAppData {
  name?: string;
  description?: string;
  category?: AppCategory;
  status?: AppStatus;
  icon?: string;
  tags?: string[];
  isPublic?: boolean;
}

interface CreateVersionData {
  version: string;
  changelog?: string;
  sourceCode: string;
  config?: Record<string, unknown>;
  authorId: string;
  setCurrent?: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AppEngine {
  // ── Apps ──────────────────────────────────────────────────────────────────

  async createApp(data: CreateAppData) {
    const baseSlug = slugify(data.name);

    // Ensure slug uniqueness by appending a suffix when necessary.
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.app.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const app = await prisma.app.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        category: data.category,
        authorId: data.authorId,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    await logAudit({
      action: "app.create",
      resource: `app:${app.id}`,
      userId: data.authorId,
      appId: app.id,
      details: { name: app.name, slug: app.slug, category: app.category },
    });

    return app;
  }

  async listApps(filters: ListAppsFilters = {}) {
    const { status, category, authorId, search, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(authorId ? { authorId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
              { tags: { has: search } },
            ],
          }
        : {}),
    };

    const [apps, total] = await Promise.all([
      prisma.app.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          author: { select: { id: true, name: true, email: true } },
          currentVersion: { select: { id: true, version: true, createdAt: true } },
          _count: { select: { versions: true, deployments: true } },
        },
      }),
      prisma.app.count({ where }),
    ]);

    return {
      data: apps,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getApp(id: string) {
    const app = await prisma.app.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, email: true } },
        currentVersion: true,
        _count: { select: { versions: true, deployments: true } },
      },
    });

    if (!app) throw new Error("App not found");

    return app;
  }

  async updateApp(id: string, data: UpdateAppData) {
    await this.getApp(id); // throws if not found

    const app = await prisma.app.update({
      where: { id },
      data,
      include: {
        author: { select: { id: true, name: true, email: true } },
        currentVersion: { select: { id: true, version: true } },
      },
    });

    await logAudit({
      action: "app.update",
      resource: `app:${id}`,
      appId: id,
      details: data,
    });

    return app;
  }

  async deleteApp(id: string) {
    await this.getApp(id); // throws if not found

    const app = await prisma.app.update({
      where: { id },
      data: { status: AppStatus.ARCHIVED },
    });

    await logAudit({
      action: "app.archive",
      resource: `app:${id}`,
      appId: id,
    });

    return app;
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  async createVersion(appId: string, data: CreateVersionData) {
    await this.getApp(appId); // throws if not found

    const version = await prisma.appVersion.create({
      data: {
        appId,
        version: data.version,
        changelog: data.changelog,
        sourceCode: data.sourceCode,
        config: data.config,
        authorId: data.authorId,
      },
    });

    // Optionally promote this version to current immediately.
    if (data.setCurrent) {
      await prisma.app.update({
        where: { id: appId },
        data: { currentVersionId: version.id },
      });
    }

    await logAudit({
      action: "app.version.create",
      resource: `app:${appId}`,
      userId: data.authorId,
      appId,
      details: { versionId: version.id, version: version.version },
    });

    return version;
  }

  async listVersions(appId: string) {
    await this.getApp(appId); // throws if not found

    return prisma.appVersion.findMany({
      where: { appId },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async rollbackVersion(appId: string, versionId: string) {
    await this.getApp(appId); // throws if not found

    const version = await prisma.appVersion.findFirst({
      where: { id: versionId, appId },
    });
    if (!version) throw new Error("Version not found for this app");

    const app = await prisma.app.update({
      where: { id: appId },
      data: { currentVersionId: versionId },
    });

    await logAudit({
      action: "app.version.rollback",
      resource: `app:${appId}`,
      appId,
      details: { versionId, version: version.version },
    });

    return app;
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  async publishApp(appId: string) {
    await this.getApp(appId); // throws if not found

    const app = await prisma.app.update({
      where: { id: appId },
      data: { status: AppStatus.PUBLISHED, isPublic: true },
    });

    await logAudit({
      action: "app.publish",
      resource: `app:${appId}`,
      appId,
    });

    return app;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async searchApps(query: string) {
    return prisma.app.findMany({
      where: {
        status: { not: AppStatus.ARCHIVED },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { tags: { has: query } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        author: { select: { id: true, name: true, email: true } },
        currentVersion: { select: { id: true, version: true } },
      },
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const appEngine = new AppEngine();
