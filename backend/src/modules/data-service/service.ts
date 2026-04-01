import { prisma } from "../../lib/prisma";
import Prisma from "@prisma/client";
import { logAudit } from "../../lib/audit";
import { aiOrchestrator } from "../ai/orchestrator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
}

export interface QueryFilters {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize an identifier (table or column name) to allow only alphanumeric
 * characters and underscores, preventing SQL injection via identifier names.
 */
function sanitizeIdentifier(raw: string): string {
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "");
  if (!sanitized) {
    throw new Error(
      `Invalid identifier "${raw}": must contain at least one alphanumeric character or underscore.`,
    );
  }
  return sanitized;
}

/**
 * Slugify a name into a lowercase, hyphen-separated string safe for use as a
 * DataSchema slug. The resulting slug is unique; collisions are handled by the
 * caller.
 */
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

/**
 * Derive a PostgreSQL-safe table name from the schema name.
 * The "ds_" prefix ensures no collision with system tables.
 */
function toTableName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `ds_${base}`;
}

/**
 * Map a simple type alias to the corresponding PostgreSQL data type.
 */
export function mapColumnType(type: string): string {
  const map: Record<string, string> = {
    text: "TEXT",
    string: "TEXT",
    varchar: "TEXT",
    number: "NUMERIC",
    numeric: "NUMERIC",
    integer: "INTEGER",
    int: "INTEGER",
    float: "DOUBLE PRECISION",
    double: "DOUBLE PRECISION",
    boolean: "BOOLEAN",
    bool: "BOOLEAN",
    date: "DATE",
    datetime: "TIMESTAMPTZ",
    timestamp: "TIMESTAMPTZ",
    timestamptz: "TIMESTAMPTZ",
    json: "JSONB",
    jsonb: "JSONB",
    uuid: "UUID",
  };
  const mapped = map[type.toLowerCase()];
  if (!mapped) {
    throw new Error(
      `Unsupported column type "${type}". Supported types: ${Object.keys(map).join(", ")}.`,
    );
  }
  return mapped;
}

// ─── DataService ─────────────────────────────────────────────────────────────

export class DataService {
  // ── Schema management ────────────────────────────────────────────────────

  /**
   * Persist a DataSchema record and CREATE the corresponding dynamic table.
   */
  async createSchema(data: {
    name: string;
    description?: string;
    columns: ColumnDef[];
    authorId: string;
  }): Promise<Prisma.DataSchema> {
    const slug = slugify(data.name);
    const tableName = toTableName(data.name);

    // Build column DDL (system columns are always prepended).
    const columnDDL = data.columns
      .map((col) => {
        const safeName = sanitizeIdentifier(col.name);
        const pgType = mapColumnType(col.type);
        const nullability = col.nullable === false ? "NOT NULL" : "";
        const defaultClause =
          col.defaultValue != null
            ? `DEFAULT ${col.defaultValue}` // caller is responsible for safe literal
            : "";
        return `  "${safeName}" ${pgType} ${defaultClause} ${nullability}`.trimEnd();
      })
      .join(",\n");

    const ddl = `
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()${data.columns.length ? ",\n" + columnDDL : ""}
      )
    `.trim();

    // Persist metadata first so any DDL failure leaves no orphan record.
    const schema = await prisma.dataSchema.create({
      data: {
        name: data.name,
        slug,
        tableName,
        description: data.description,
        columns: data.columns as unknown as Prisma.Prisma.InputJsonValue,
        authorId: data.authorId,
      },
    });

    try {
      await prisma.$executeRawUnsafe(ddl);
    } catch (err) {
      // Roll back the metadata record if the DDL fails.
      await prisma.dataSchema.delete({ where: { id: schema.id } });
      throw err;
    }

    await logAudit({
      action: "DATA_SCHEMA_CREATE",
      resource: "DataSchema",
      userId: data.authorId,
      details: { schemaId: schema.id, tableName },
    });

    return schema;
  }

  /** List all DataSchema records, ordered by creation date descending. */
  async listSchemas(): Promise<Prisma.DataSchema[]> {
    return prisma.dataSchema.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  /** Retrieve a single DataSchema by its slug. Throws if not found. */
  async getSchema(slug: string): Promise<Prisma.DataSchema> {
    const schema = await prisma.dataSchema.findUnique({ where: { slug } });
    if (!schema) {
      throw new Error(`DataSchema with slug "${slug}" not found.`);
    }
    return schema;
  }

  /**
   * Drop the underlying dynamic table and delete the DataSchema record.
   * The table is dropped first; if it succeeds the record is removed.
   */
  async deleteSchema(slug: string): Promise<void> {
    const schema = await this.getSchema(slug);
    const safeTable = sanitizeIdentifier(schema.tableName);

    await prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS "${safeTable}"`,
    );

    await prisma.dataSchema.delete({ where: { slug } });

    await logAudit({
      action: "DATA_SCHEMA_DELETE",
      resource: "DataSchema",
      details: { schemaId: schema.id, tableName: schema.tableName },
    });
  }

  // ── Row-level CRUD ────────────────────────────────────────────────────────

  /**
   * Insert a row into a dynamic table.
   * Returns the newly created row.
   */
  async insertRow(
    tableName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const safeTable = sanitizeIdentifier(tableName);

    const keys = Object.keys(data);
    if (keys.length === 0) {
      throw new Error("Cannot insert a row with no columns.");
    }

    const safeKeys = keys.map(sanitizeIdentifier);
    const columnList = safeKeys.map((k) => `"${k}"`).join(", ");
    const placeholders = safeKeys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map((k) => data[k]);

    const sql = `
      INSERT INTO "${safeTable}" (${columnList})
      VALUES (${placeholders})
      RETURNING *
    `.trim();

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      sql,
      ...values,
    );
    return rows[0];
  }

  /**
   * Query rows from a dynamic table with optional filtering, pagination and
   * ordering. All column-name references in `where` and `orderBy` are
   * sanitized.
   */
  async queryRows(
    tableName: string,
    filters?: QueryFilters,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const safeTable = sanitizeIdentifier(tableName);

    const values: unknown[] = [];
    let paramIdx = 1;

    // WHERE clause
    let whereClause = "";
    if (filters?.where && Object.keys(filters.where).length > 0) {
      const conditions = Object.entries(filters.where).map(([col, val]) => {
        const safeCol = sanitizeIdentifier(col);
        values.push(val);
        return `"${safeCol}" = $${paramIdx++}`;
      });
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    // ORDER BY clause
    let orderByClause = 'ORDER BY "created_at" DESC';
    if (filters?.orderBy) {
      const [rawCol, rawDir] = filters.orderBy.split(":");
      const safeCol = sanitizeIdentifier(rawCol);
      const dir =
        rawDir?.toLowerCase() === "asc" ? "ASC" : "DESC";
      orderByClause = `ORDER BY "${safeCol}" ${dir}`;
    }

    // COUNT
    const countSql = `SELECT COUNT(*)::int AS total FROM "${safeTable}" ${whereClause}`;
    const countRows = await prisma.$queryRawUnsafe<{ total: number }[]>(
      countSql,
      ...values,
    );
    const total = countRows[0]?.total ?? 0;

    // LIMIT / OFFSET
    const limit =
      filters?.limit != null && filters.limit > 0
        ? filters.limit
        : 100;
    const offset = filters?.offset != null && filters.offset >= 0
      ? filters.offset
      : 0;

    values.push(limit);
    const limitClause = `LIMIT $${paramIdx++}`;
    values.push(offset);
    const offsetClause = `OFFSET $${paramIdx++}`;

    const dataSql = `
      SELECT * FROM "${safeTable}"
      ${whereClause}
      ${orderByClause}
      ${limitClause}
      ${offsetClause}
    `.trim();

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      dataSql,
      ...values,
    );

    return { rows, total };
  }

  /**
   * Update a single row by its UUID primary key.
   * Returns the updated row.
   */
  async updateRow(
    tableName: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const safeTable = sanitizeIdentifier(tableName);

    const keys = Object.keys(data).filter(
      (k) => k !== "id" && k !== "created_at",
    );
    if (keys.length === 0) {
      throw new Error("No updatable columns provided.");
    }

    const values: unknown[] = [];
    let paramIdx = 1;

    const setClauses = keys.map((col) => {
      const safeCol = sanitizeIdentifier(col);
      values.push(data[col]);
      return `"${safeCol}" = $${paramIdx++}`;
    });

    // Always bump updated_at
    setClauses.push(`"updated_at" = now()`);

    values.push(id);
    const idParam = `$${paramIdx++}`;

    const sql = `
      UPDATE "${safeTable}"
      SET ${setClauses.join(", ")}
      WHERE "id" = ${idParam}::uuid
      RETURNING *
    `.trim();

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      sql,
      ...values,
    );

    if (!rows[0]) {
      throw new Error(
        `Row with id "${id}" not found in table "${tableName}".`,
      );
    }

    return rows[0];
  }

  /**
   * Delete a single row by its UUID primary key.
   */
  async deleteRow(tableName: string, id: string): Promise<void> {
    const safeTable = sanitizeIdentifier(tableName);

    const sql = `
      DELETE FROM "${safeTable}"
      WHERE "id" = $1::uuid
    `.trim();

    await prisma.$executeRawUnsafe(sql, id);
  }

  // ── AI-assisted schema generation ─────────────────────────────────────────

  /**
   * Use the AI orchestrator to derive a list of ColumnDef objects from a
   * free-text description of the data the user wants to store.
   */
  async generateSchemaFromDescription(
    description: string,
  ): Promise<ColumnDef[]> {
    const systemPrompt = `You are a database architect assistant.
Given a natural-language description of data the user wants to store, return a JSON array of column definitions.

Each element must follow this exact shape:
{
  "name": "<snake_case column name>",
  "type": "<one of: text, number, boolean, date, datetime, json, uuid>",
  "nullable": <true | false>,
  "defaultValue": "<optional SQL literal, e.g. 'active' or null>"
}

Rules:
- Do not include id, created_at, or updated_at — these are added automatically.
- Use snake_case for all names.
- Return ONLY the JSON array. No markdown fences, no prose.`;

    const raw = await aiOrchestrator.chat(
      [{ role: "user", content: description }],
      systemPrompt,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "AI returned non-parseable JSON for schema generation. Please rephrase your description.",
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error("AI response for schema generation is not an array.");
    }

    // Validate each element minimally before returning.
    return (parsed as Record<string, unknown>[]).map((col, idx) => {
      if (typeof col.name !== "string" || !col.name) {
        throw new Error(`Column at index ${idx} is missing a "name" field.`);
      }
      if (typeof col.type !== "string" || !col.type) {
        throw new Error(`Column at index ${idx} is missing a "type" field.`);
      }
      return {
        name: col.name as string,
        type: col.type as string,
        nullable: col.nullable !== false,
        defaultValue:
          typeof col.defaultValue === "string" ? col.defaultValue : undefined,
      } satisfies ColumnDef;
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const dataService = new DataService();
