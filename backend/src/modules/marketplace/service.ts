import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

export class MarketplaceService {
  /** List all published apps (the "app store") */
  async listPublishedApps(filters?: {
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      status: "PUBLISHED",
      isPublic: true,
    };

    if (filters?.category) {
      where.category = filters.category;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.app.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          author: { select: { id: true, name: true, email: true } },
          currentVersion: { select: { id: true, version: true, changelog: true } },
        },
      }),
      prisma.app.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Get a single published app with full details */
  async getPublishedApp(slug: string) {
    const app = await prisma.app.findFirst({
      where: { slug, status: "PUBLISHED" },
      include: {
        author: { select: { id: true, name: true, email: true } },
        currentVersion: true,
        versions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, version: true, changelog: true, createdAt: true },
        },
      },
    });

    if (!app) throw new Error("App not found in marketplace");
    return app;
  }

  /** Get featured/popular apps */
  async getFeaturedApps(limit = 6) {
    return prisma.app.findMany({
      where: { status: "PUBLISHED", isPublic: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, name: true } },
        currentVersion: { select: { id: true, version: true } },
      },
    });
  }

  /** Get marketplace stats */
  async getStats() {
    const [totalApps, totalByCategory, recentApps] = await Promise.all([
      prisma.app.count({ where: { status: "PUBLISHED" } }),
      prisma.app.groupBy({
        by: ["category"],
        where: { status: "PUBLISHED" },
        _count: true,
      }),
      prisma.app.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, slug: true, category: true, createdAt: true },
      }),
    ]);

    return {
      totalApps,
      byCategory: totalByCategory.map((g) => ({
        category: g.category,
        count: g._count,
      })),
      recentApps,
    };
  }

  /** Clone an app from marketplace to user's workspace */
  async cloneApp(slug: string, userId: string) {
    const sourceApp = await this.getPublishedApp(slug);

    const clonedApp = await prisma.app.create({
      data: {
        name: `${sourceApp.name} (Copy)`,
        slug: `${sourceApp.slug}-copy-${Date.now()}`,
        description: sourceApp.description,
        category: sourceApp.category,
        status: "DRAFT",
        tags: sourceApp.tags,
        authorId: userId,
      },
    });

    if (sourceApp.currentVersion) {
      const version = await prisma.appVersion.create({
        data: {
          version: "1.0.0",
          changelog: `Cloned from ${sourceApp.name}`,
          sourceCode: sourceApp.currentVersion.sourceCode,
          config: sourceApp.currentVersion.config,
          aiGenerated: false,
          appId: clonedApp.id,
          authorId: userId,
        },
      });

      await prisma.app.update({
        where: { id: clonedApp.id },
        data: { currentVersionId: version.id },
      });
    }

    await logAudit({
      action: "marketplace.clone",
      resource: `app:${clonedApp.id}`,
      userId,
      details: { sourceSlug: slug, clonedAppId: clonedApp.id },
    });

    return clonedApp;
  }
}

export const marketplaceService = new MarketplaceService();
