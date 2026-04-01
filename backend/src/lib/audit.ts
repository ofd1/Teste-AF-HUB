import { prisma } from "./prisma";

export async function logAudit(params: {
  action: string;
  resource: string;
  userId?: string;
  appId?: string;
  details?: any;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      resource: params.resource,
      userId: params.userId,
      appId: params.appId,
      details: params.details,
      ip: params.ip,
      userAgent: params.userAgent,
    },
  });
}
