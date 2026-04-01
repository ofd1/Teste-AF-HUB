import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const SALT_ROUNDS = 12;

export const AuthService = {
  async register(
    email: string,
    password: string,
    name: string,
    role: Role = Role.ANALYST
  ) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("Email already in use");
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return user;
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("Invalid credentials");
    }

    if (!user.active) {
      throw new Error("Account is disabled");
    }

    const valid = await AuthService.validatePassword(password, user.passwordHash);
    if (!valid) {
      throw new Error("Invalid credentials");
    }

    const { passwordHash: _omit, ...safeUser } = user;
    return safeUser;
  },

  async validatePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  },
};
