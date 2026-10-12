import { hashSessionToken } from "../lib/data/sessions";

type Row = Record<string, any> & { id: string };

function matches(row: Row, filter = "") {
  return filter.split(/\s+&&\s+/).every((clause) => {
    const match = /^([\w]+)\s*(=|>=|<=|>|<)\s*(?:"((?:\\.|[^"])*)"|(true|false))$/.exec(clause.trim());
    if (!match) return true;
    const [, key, operator, quoted, bool] = match;
    const expected = quoted?.replace(/\\([\\"])/g, "$1") ?? bool;
    const actual = row[key!];
    switch (operator) {
      case "=": return String(actual ?? "") === expected;
      case ">=": return String(actual ?? "") >= expected!;
      case "<=": return String(actual ?? "") <= expected!;
      case ">": return String(actual ?? "") > expected!;
      case "<": return String(actual ?? "") < expected!;
      default: return false;
    }
  });
}

export function createPocketBaseFixture(userId: string, token: string) {
  const tables = new Map<string, Row[]>([["sessions", [{
    id: "session-record",
    user: userId,
    sessionId: "session-device",
    tokenHash: hashSessionToken(token),
    pocketbaseToken: "internal-pb-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
  }]]]);
  let nextId = 0;
  const collection = (name: string) => {
    const rows = tables.get(name) ?? [];
    tables.set(name, rows);
    return {
      async create(data: Row) {
        const row = { ...data, id: data.id ?? `${name}-${++nextId}`, created: new Date().toISOString() };
        rows.push(row);
        return row;
      },
      async getOne(id: string) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        return row;
      },
      async getFirstListItem(filter: string) {
        const row = rows.find((candidate) => matches(candidate, filter));
        if (!row) throw new Error("Record not found");
        return row;
      },
      async getFullList(arg1?: number | { filter?: string }, arg2?: { filter?: string }) {
        const options = typeof arg1 === "object" ? arg1 : arg2;
        return rows.filter((row) => matches(row, options?.filter));
      },
      async getList(page: number, perPage: number, options?: { filter?: string }) {
        const filtered = rows.filter((row) => matches(row, options?.filter));
        const start = (page - 1) * perPage;
        return {
          page,
          perPage,
          totalItems: filtered.length,
          totalPages: Math.ceil(filtered.length / perPage),
          items: filtered.slice(start, start + perPage),
        };
      },
      async update(id: string, changes: Row) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        Object.assign(row, changes);
        return row;
      },
      async delete(id: string) {
        const index = rows.findIndex((row) => row.id === id);
        if (index < 0) throw new Error("Record not found");
        rows.splice(index, 1);
      },
    };
  };
  const connector = {
    async getSuperuserClient() { return { collection }; },
    createServerClient() {
      let storedToken = "";
      return {
        authStore: { get token() { return storedToken; }, save(value: string) { storedToken = value; } },
        collection(name: string) {
          return { async authRefresh() {
            if (name !== "users" || storedToken !== "internal-pb-token") throw new Error("Unexpected auth refresh");
            return { record: { id: userId }, token: storedToken };
          } };
        },
      };
    },
  };
  return { connector, tables };
}
