import type {
  PostbaseClient,
  PostbaseClientOptions,
  QueryBuilder,
  QueryResult,
  SingleResult,
  AuthClient,
  AuthAdminClient,
  AuthResponse,
  AuthUser,
  Session,
  AuthChangeEvent,
  NativeOAuthProvider,
  StorageClient,
  StorageBucketClient,
  StorageObject,
  Bucket,
  EmailClient,
  EmailSendOptions,
  RpcOptions,
  RealtimeChannel,
  RealtimePayload,
  RealtimeEvent,
  Filter,
  FilterOperator,
  SelectOptions,
  JoinClause,
  JoinType,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
  CookieAdapter,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_STORAGE_KEY = "postbase_session";

function getStorageKey(options?: PostbaseClientOptions): string {
  return options?.auth?.storageKey ?? SESSION_STORAGE_KEY;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(hash);
}

function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array.buffer);
}

// ─── Column parsing ───────────────────────────────────────────────────────────

interface ParsedColumn {
  col: string;   // bare identifier or table.column sent to the server
  alias: string; // key used in the returned row object
}

function parseColumns(columns: string): ParsedColumn[] {
  return columns.split(",").map((raw) => {
    const part = raw.trim();
    const asIdx = part.search(/\s+[Aa][Ss]\s+/);
    if (asIdx === -1) {
      return { col: part, alias: part };
    }
    const col = part.slice(0, asIdx).trim();
    const alias = part.slice(asIdx).replace(/^\s+[Aa][Ss]\s+/i, "").trim();
    return { col, alias };
  });
}

function applyAliases<T>(rows: T[], parsed: ParsedColumn[]): T[] {
  // Build serverKey → alias map. When two qualified columns share the same
  // bare name (e.g. apis.id and pricing_plans.id both resolve to "id"), the
  // server already collapsed them to one key before we see the response, so
  // only one alias can be applied. Process in declaration order so the first
  // alias wins, matching the most common intent.
  const aliasMap = new Map<string, string>();
  for (const { col, alias } of parsed) {
    if (col !== alias) {
      const serverKey = col.includes(".") ? col.split(".").pop()! : col;
      if (!aliasMap.has(serverKey)) aliasMap.set(serverKey, alias);
    }
  }
  if (aliasMap.size === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[aliasMap.get(k) ?? k] = v;
    }
    return out as T;
  });
}

// ─── OR filter string parser ──────────────────────────────────────────────────

// Parses Supabase-style filter strings into structured Filter arrays.
// Examples:
//   "email.ilike.%foo%,name.ilike.%foo%"  → [{col,op,val},{col,op,val}]
//   "status.eq.active,age.gt.18"           → [{col,op,val},{col,op,val}]
//   "role.in.(admin,owner)"                → [{col,"in",["admin","owner"]}]
//
// The value is everything after the second dot, so dots in values are safe.
// Commas inside parentheses (for `in` operator) are handled by not splitting
// on commas that appear inside balanced parentheses.
function parseOrFilterString(filterStr: string): Filter[] {
  // Split on commas that are NOT inside parentheses
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < filterStr.length; i++) {
    if (filterStr[i] === "(") depth++;
    else if (filterStr[i] === ")") depth--;
    else if (filterStr[i] === "," && depth === 0) {
      segments.push(filterStr.slice(start, i).trim());
      start = i + 1;
    }
  }
  segments.push(filterStr.slice(start).trim());

  return segments.filter(Boolean).map((seg) => {
    const firstDot = seg.indexOf(".");
    const secondDot = seg.indexOf(".", firstDot + 1);
    if (firstDot === -1 || secondDot === -1) {
      // Malformed segment — pass through as-is with eq operator
      return { column: seg, operator: "eq" as FilterOperator, value: null };
    }
    const column = seg.slice(0, firstDot);
    const operator = seg.slice(firstDot + 1, secondDot) as FilterOperator;
    const rawValue = seg.slice(secondDot + 1);

    let value: unknown = rawValue;

    if (operator === "in") {
      // "in" value looks like (a,b,c) — strip parens and split
      const inner = rawValue.replace(/^\(/, "").replace(/\)$/, "");
      value = inner.split(",").map((v) => v.trim());
    } else if (rawValue === "true") {
      value = true;
    } else if (rawValue === "false") {
      value = false;
    } else if (rawValue === "null") {
      value = null;
    }

    return { column, operator, value };
  });
}

// ─── Query Builder ────────────────────────────────────────────────────────────

interface QueryState<T> {
  baseUrl: string;
  apiKey: string;
  table: string;
  columns: string;
  selectOptions: SelectOptions;
  filters: Filter[];
  orFilters: Filter[][];
  notFilters: Array<{ column: string; operator: string; value: unknown }>;
  orderBy: Array<{ column: string; ascending?: boolean; nullsFirst?: boolean }>;
  joins: JoinClause[];
  _limit?: number;
  _offset?: number;
  _range?: { from: number; to: number };
  operation: "select" | "insert" | "update" | "delete" | "upsert";
  insertData?: Partial<T> | Partial<T>[];
  upsertOnConflict?: string;
  updateData?: Partial<T>;
  returning?: string;
  customHeaders?: Record<string, string>;
  cookieAdapter?: CookieAdapter;
}

async function executeQuery<T>(state: QueryState<T>): Promise<QueryResult<T>> {
  if (!state.baseUrl) throw new Error("[postbasejs] url is required — ensure POSTBASE_URL is set in your environment");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.apiKey}`,
      ...state.customHeaders,
    };

    // Forward session cookie as bearer token if using SSR cookie adapter
    if (state.cookieAdapter) {
      const cookies = await state.cookieAdapter.getAll();
      const sessionCookie = cookies.find((c) => c.name.startsWith("postbase-session") || c.name === "next-auth.session-token" || c.name === "__Secure-next-auth.session-token");
      if (sessionCookie) {
        headers["X-Postbase-Session"] = sessionCookie.value;
      }
    }

    const body: Record<string, unknown> = {
      operation: state.operation === "upsert" ? "upsert" : state.operation,
      table: state.table,
    };

    let parsedColumns: ParsedColumn[] = [];
    if (state.operation === "select") {
      if (state.columns && state.columns !== "*") {
        parsedColumns = parseColumns(state.columns);
        body.columns = parsedColumns.map((p) => p.col);
      }
      body.count = state.selectOptions.count;
      body.head = state.selectOptions.head;
      if (state.joins.length) body.joins = state.joins;
    }

    if (["select", "update", "delete"].includes(state.operation)) {
      const filters: Filter[] = [...state.filters];
      if (filters.length) body.filters = filters;
      if (state.orFilters.length) body.orFilters = state.orFilters;
      if (state.notFilters.length) body.notFilters = state.notFilters;
    }

    if (state.operation === "insert" || state.operation === "upsert") {
      body.data = state.insertData;
      if (state.upsertOnConflict) body.onConflict = state.upsertOnConflict;
    }

    if (state.operation === "update") {
      body.data = state.updateData;
    }

    if (state.orderBy.length) body.order = state.orderBy;
    if (state._limit !== undefined) body.limit = state._limit;
    if (state._offset !== undefined) body.offset = state._offset;
    if (state._range) body.range = state._range;
    if (state.returning) body.returning = state.returning;

    const res = await fetch(`${state.baseUrl}/api/db/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok) return { data: null, count: null, error: json.error ?? "Query failed" };
    const rawData: T[] = json.data ?? [];
    const data = parsedColumns.length > 0 ? applyAliases(rawData, parsedColumns) : rawData;
    return { data, count: json.count ?? null, error: null };
  } catch (err) {
    return { data: null, count: null, error: String(err) };
  }
}

class QueryBuilderImpl<T> implements QueryBuilder<T> {
  private state: QueryState<T>;

  constructor(state: QueryState<T>) {
    this.state = state;
  }

  private clone(patch: Partial<QueryState<T>>): QueryBuilderImpl<T> {
    return new QueryBuilderImpl<T>({ ...this.state, ...patch });
  }

  select(columns = "*", options: SelectOptions = {}): QueryBuilderImpl<T> {
    return this.clone({ columns, selectOptions: options, operation: "select" });
  }

  join(table: string, options: { on: string; type?: JoinType }): QueryBuilderImpl<T> {
    return this.clone({ joins: [...this.state.joins, { table, on: options.on, type: options.type }] });
  }

  private addFilter(column: string, operator: FilterOperator, value: unknown): QueryBuilderImpl<T> {
    return this.clone({ filters: [...this.state.filters, { column, operator, value }] });
  }

  eq(column: string, value: unknown) { return this.addFilter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.addFilter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.addFilter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.addFilter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.addFilter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.addFilter(column, "lte", value); }
  like(column: string, pattern: string) { return this.addFilter(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.addFilter(column, "ilike", pattern); }
  in(column: string, values: unknown[]) { return this.addFilter(column, "in", values); }
  is(column: string, value: null | boolean) { return this.addFilter(column, "is", value); }
  contains(column: string, value: unknown) { return this.addFilter(column, "contains", value); }
  overlaps(column: string, value: unknown[]) { return this.addFilter(column, "overlaps", value); }
  textSearch(column: string, query: string, options?: { config?: string }) {
    return this.addFilter(column, "textSearch", { query, config: options?.config });
  }

  or(filters: string): QueryBuilderImpl<T> {
    return this.clone({ orFilters: [...this.state.orFilters, parseOrFilterString(filters)] });
  }

  not(column: string, operator: string, value: unknown): QueryBuilderImpl<T> {
    return this.clone({ notFilters: [...this.state.notFilters, { column, operator, value }] });
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilderImpl<T> {
    return this.clone({
      orderBy: [...this.state.orderBy, { column, ascending: options?.ascending, nullsFirst: options?.nullsFirst }],
    });
  }

  limit(count: number): QueryBuilderImpl<T> {
    return this.clone({ _limit: count });
  }

  offset(count: number): QueryBuilderImpl<T> {
    return this.clone({ _offset: count });
  }

  range(from: number, to: number): QueryBuilderImpl<T> {
    return this.clone({ _range: { from, to }, _limit: to - from + 1, _offset: from });
  }

  insert(data: Partial<T> | Partial<T>[], options?: { returning?: string }): InsertBuilderImpl<T> {
    return new InsertBuilderImpl<T>({
      ...this.state,
      operation: "insert",
      insertData: data,
      returning: options?.returning ?? "*",
    });
  }

  upsert(data: Partial<T> | Partial<T>[], options?: { onConflict?: string; returning?: string }): InsertBuilderImpl<T> {
    return new InsertBuilderImpl<T>({
      ...this.state,
      operation: "upsert",
      insertData: data,
      upsertOnConflict: options?.onConflict,
      returning: options?.returning ?? "*",
    });
  }

  update(data: Partial<T>): UpdateBuilderImpl<T> {
    return new UpdateBuilderImpl<T>({
      ...this.state,
      operation: "update",
      updateData: data,
      returning: "*",
    });
  }

  delete(): DeleteBuilderImpl<T> {
    return new DeleteBuilderImpl<T>({
      ...this.state,
      operation: "delete",
      returning: "*",
    });
  }

  async single(): Promise<SingleResult<T>> {
    const result = await executeQuery<T>(this.clone({ _limit: 1 }).state);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    if (rows.length === 0) return { data: null, error: "No rows returned" };
    if (rows.length > 1) return { data: null, error: "Multiple rows returned" };
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<SingleResult<T>> {
    const result = await executeQuery<T>(this.clone({ _limit: 1 }).state);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  // Thenable — make the builder awaitable directly
  get then() {
    const promise = executeQuery<T>(this.state);
    return promise.then.bind(promise);
  }
}

class InsertBuilderImpl<T> {
  private state: QueryState<T>;

  constructor(state: QueryState<T>) {
    this.state = state;
  }

  select(columns = "*"): InsertBuilderImpl<T> {
    return new InsertBuilderImpl<T>({ ...this.state, returning: columns });
  }

  async single(): Promise<SingleResult<T>> {
    const result = await executeQuery<T>(this.state);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  get then() {
    const promise = executeQuery<T>(this.state);
    return promise.then.bind(promise);
  }
}

class UpdateBuilderImpl<T> {
  private state: QueryState<T>;

  constructor(state: QueryState<T>) {
    this.state = state;
  }

  private addFilter(column: string, operator: FilterOperator, value: unknown): UpdateBuilderImpl<T> {
    return new UpdateBuilderImpl<T>({ ...this.state, filters: [...this.state.filters, { column, operator, value }] });
  }

  eq(column: string, value: unknown) { return this.addFilter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.addFilter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.addFilter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.addFilter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.addFilter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.addFilter(column, "lte", value); }
  like(column: string, pattern: string) { return this.addFilter(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.addFilter(column, "ilike", pattern); }
  in(column: string, values: unknown[]) { return this.addFilter(column, "in", values); }
  is(column: string, value: null | boolean) { return this.addFilter(column, "is", value); }
  contains(column: string, value: unknown) { return this.addFilter(column, "contains", value); }
  overlaps(column: string, value: unknown[]) { return this.addFilter(column, "overlaps", value); }
  textSearch(column: string, query: string, options?: { config?: string }) {
    return this.addFilter(column, "textSearch", { query, config: options?.config });
  }
  or(filters: string): UpdateBuilderImpl<T> {
    return new UpdateBuilderImpl<T>({ ...this.state, orFilters: [...this.state.orFilters, parseOrFilterString(filters)] });
  }
  not(column: string, operator: string, value: unknown): UpdateBuilderImpl<T> {
    return new UpdateBuilderImpl<T>({ ...this.state, notFilters: [...this.state.notFilters, { column, operator, value }] });
  }

  select(columns = "*"): UpdateBuilderImpl<T> {
    return new UpdateBuilderImpl<T>({ ...this.state, returning: columns });
  }

  async single(): Promise<SingleResult<T>> {
    const result = await executeQuery<T>(this.state);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  get then() {
    const promise = executeQuery<T>(this.state);
    return promise.then.bind(promise);
  }
}

class DeleteBuilderImpl<T> {
  private state: QueryState<T>;

  constructor(state: QueryState<T>) {
    this.state = state;
  }

  private addFilter(column: string, operator: FilterOperator, value: unknown): DeleteBuilderImpl<T> {
    return new DeleteBuilderImpl<T>({ ...this.state, filters: [...this.state.filters, { column, operator, value }] });
  }

  eq(column: string, value: unknown) { return this.addFilter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.addFilter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.addFilter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.addFilter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.addFilter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.addFilter(column, "lte", value); }
  like(column: string, pattern: string) { return this.addFilter(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.addFilter(column, "ilike", pattern); }
  in(column: string, values: unknown[]) { return this.addFilter(column, "in", values); }
  is(column: string, value: null | boolean) { return this.addFilter(column, "is", value); }
  contains(column: string, value: unknown) { return this.addFilter(column, "contains", value); }
  overlaps(column: string, value: unknown[]) { return this.addFilter(column, "overlaps", value); }
  textSearch(column: string, query: string, options?: { config?: string }) {
    return this.addFilter(column, "textSearch", { query, config: options?.config });
  }
  or(filters: string): DeleteBuilderImpl<T> {
    return new DeleteBuilderImpl<T>({ ...this.state, orFilters: [...this.state.orFilters, parseOrFilterString(filters)] });
  }
  not(column: string, operator: string, value: unknown): DeleteBuilderImpl<T> {
    return new DeleteBuilderImpl<T>({ ...this.state, notFilters: [...this.state.notFilters, { column, operator, value }] });
  }

  select(columns = "*"): DeleteBuilderImpl<T> {
    return new DeleteBuilderImpl<T>({ ...this.state, returning: columns });
  }

  async single(): Promise<SingleResult<T>> {
    const result = await executeQuery<T>(this.state);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  get then() {
    const promise = executeQuery<T>(this.state);
    return promise.then.bind(promise);
  }
}

// ─── Auth Client ──────────────────────────────────────────────────────────────

function createAuthAdmin(baseUrl: string, apiKey: string, projectId: string, customHeaders?: Record<string, string>): AuthAdminClient {
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...customHeaders,
  });

  const adminBase = `${baseUrl}/api/auth/v1/${projectId}/admin/users`;

  return {
    async listUsers(options) {
      try {
        const url = new URL(adminBase);
        if (options?.page) url.searchParams.set("page", String(options.page));
        if (options?.perPage) url.searchParams.set("perPage", String(options.perPage));
        const res = await fetch(url.toString(), { headers: headers() });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Failed to list users" };
        return { data: { users: json.users, total: json.total }, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async getUserById(id) {
      try {
        const res = await fetch(`${adminBase}/${id}`, { headers: headers() });
        const json = await res.json();
        if (!res.ok) return { data: { user: null }, error: json.error ?? "User not found" };
        return { data: { user: json.user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: String(err) };
      }
    },

    async createUser(options) {
      try {
        const res = await fetch(adminBase, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(options),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null }, error: json.error ?? "Failed to create user" };
        return { data: { user: json.user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: String(err) };
      }
    },

    async updateUserById(id, attributes) {
      try {
        const res = await fetch(`${adminBase}/${id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify(attributes),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null }, error: json.error ?? "Failed to update user" };
        return { data: { user: json.user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: String(err) };
      }
    },

    async deleteUser(id) {
      try {
        const res = await fetch(`${adminBase}/${id}`, {
          method: "DELETE",
          headers: headers(),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Failed to delete user" };
        return { data: null, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },
  };
}

function createAuthClient(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  options?: PostbaseClientOptions,
  cookieAdapter?: CookieAdapter
): AuthClient {
  const storageKey = getStorageKey(options);
  const listeners: Array<(event: AuthChangeEvent, session: Session | null) => void> = [];
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let currentSession: Session | null = null;

  const customHeaders = options?.global?.headers;
  const authBase = `${baseUrl}/api/auth/v1/${projectId}`;

  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...customHeaders,
  });

  function persistSession(session: Session | null): void {
    if (!isBrowser()) return;
    if (options?.auth?.persistSession === false) return;
    if (session) {
      localStorage.setItem(storageKey, JSON.stringify(session));
    } else {
      localStorage.removeItem(storageKey);
    }
  }

  function loadPersistedSession(): Session | null {
    if (!isBrowser()) return null;
    if (options?.auth?.persistSession === false) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const session = JSON.parse(raw) as Session;
      // Check expiry
      if (session.expiresAt && Date.now() / 1000 > session.expiresAt) return null;
      return session;
    } catch {
      return null;
    }
  }

  function scheduleRefresh(session: Session): void {
    if (!isBrowser()) return;
    if (options?.auth?.autoRefreshToken === false) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    const expiresIn = session.expiresAt - Date.now() / 1000;
    const refreshIn = Math.max((expiresIn - 60) * 1000, 0); // 1 minute before expiry
    refreshTimer = setTimeout(async () => {
      if (session.refreshToken) {
        const result = await authClient.refreshSession(session.refreshToken);
        if (!result.error && result.data.session) {
          notifyListeners("TOKEN_REFRESHED", result.data.session);
        }
      }
    }, refreshIn);
  }

  function notifyListeners(event: AuthChangeEvent, session: Session | null): void {
    currentSession = session;
    persistSession(session);
    if (session) scheduleRefresh(session);
    listeners.forEach((fn) => fn(event, session));
  }

  const authClient: AuthClient = {
    async signUp({ email, password, rememberMe, options: signUpOptions }) {
      try {
        const res = await fetch(`${authBase}/signup`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email, password, data: signUpOptions?.data, remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Sign up failed" };
        const session: Session | null = json.session ?? null;
        const user: AuthUser | null = json.user ?? null;
        if (session) notifyListeners("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async signInWithPassword({ email, password, rememberMe }) {
      try {
        const res = await fetch(`${authBase}/token`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email, password, grant_type: "password", remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Sign in failed" };
        const session: Session = json.session;
        const user: AuthUser = json.user;
        notifyListeners("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async signInWithOtp({ email, type, options: otpOptions }) {
      try {
        const res = await fetch(`${authBase}/otp`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email, type, redirectTo: otpOptions?.redirectTo }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "OTP send failed" };
        return { data: null, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async verifyOtp({ email, token, rememberMe }) {
      try {
        const res = await fetch(`${authBase}/verify`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email, token, remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Verification failed" };
        const session: Session = json.session;
        const user: AuthUser = json.user;
        notifyListeners("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async signInWithIdToken({ provider, idToken, nonce, rememberMe }: { provider: NativeOAuthProvider; idToken: string; nonce?: string; rememberMe?: boolean }) {
      try {
        const res = await fetch(`${authBase}/oauth/id-token`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ provider, id_token: idToken, nonce, remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Sign in failed" };
        const session: Session = json.session;
        const user: AuthUser = json.user;
        notifyListeners("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async signInWithOAuth({ provider, options: oauthOptions }) {
      // Generate PKCE code_verifier + code_challenge (S256)
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // Generate random state for CSRF protection
      const state = generateState();

      const redirectTo = oauthOptions?.redirectTo ?? (isBrowser() ? window.location.href : "");

      // Persist code_verifier + state so handleOAuthCallback can verify them.
      // Use sessionStorage in browser; in native environments the caller is
      // responsible for persisting these if they want PKCE verification.
      if (isBrowser()) {
        sessionStorage.setItem(`${storageKey}_pkce_verifier`, codeVerifier);
        sessionStorage.setItem(`${storageKey}_pkce_state`, state);
      }

      // Build the authorize URL manually (not via new URL()) so that custom
      // URL schemes like com.myapp://auth in redirectTo survive as-is.
      const authorizeBase = `${baseUrl}/api/auth/v1/${projectId}/oauth/authorize`;
      const params = new URLSearchParams({
        provider,
        code_challenge: codeChallenge,
        state,
        redirect_to: redirectTo,
      });
      if (oauthOptions?.scopes) params.set("scopes", oauthOptions.scopes);
      const authorizeUrl = `${authorizeBase}?${params.toString()}`;

      if (isBrowser()) {
        window.location.href = authorizeUrl;
      }
      // In non-browser environments (React Native, native webview) the caller
      // should open authorizeUrl in an ASWebAuthenticationSession / Chrome Custom Tab.
      // Return the URL so native callers can use it directly.
      return authorizeUrl as unknown as void;
    },

    async handleOAuthCallback(callbackOptions?: { url?: string }) {
      // Accept an explicit URL (native apps) or fall back to window.location
      let searchString: string;
      if (callbackOptions?.url) {
        // Handle both https://... and custom schemes like com.myapp://auth?...
        const qIndex = callbackOptions.url.indexOf("?");
        searchString = qIndex >= 0 ? callbackOptions.url.slice(qIndex) : "";
      } else {
        if (!isBrowser()) return { data: { session: null, user: null }, error: "Not in browser" };
        searchString = window.location.search;
      }

      const params = new URLSearchParams(searchString);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const expiresAt = params.get("expires_at");
      const userB64 = params.get("user");
      const error = params.get("error");

      if (error) {
        return { data: { session: null, user: null }, error };
      }

      if (!accessToken || !refreshToken || !expiresAt) {
        return { data: { session: null, user: null }, error: null };
      }

      // Decode user
      let user: AuthUser | null = null;
      if (userB64) {
        try {
          user = JSON.parse(atob(userB64.replace(/-/g, "+").replace(/_/g, "/"))) as AuthUser;
        } catch {
          // ignore parse error
        }
      }

      const session: Session = {
        accessToken,
        refreshToken,
        expiresAt: Number(expiresAt),
        user: user ?? { id: "", email: "" },
      };

      notifyListeners("SIGNED_IN", session);

      // Clean up OAuth params from the browser URL (skip for native explicit-URL flows)
      if (isBrowser() && !callbackOptions?.url) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("access_token");
        cleanUrl.searchParams.delete("refresh_token");
        cleanUrl.searchParams.delete("expires_at");
        cleanUrl.searchParams.delete("user");
        cleanUrl.searchParams.delete("error");
        window.history.replaceState({}, "", cleanUrl.toString());
      }

      // Clean up PKCE storage
      if (isBrowser()) {
        sessionStorage.removeItem(`${storageKey}_pkce_verifier`);
        sessionStorage.removeItem(`${storageKey}_pkce_state`);
      }

      return { data: { session, user }, error: null };
    },

    async signOut() {
      try {
        const session = currentSession ?? loadPersistedSession();
        await fetch(`${authBase}/logout`, {
          method: "POST",
          headers: {
            ...headers(),
            ...(session ? { "X-Postbase-Token": session.accessToken } : {}),
          },
        });
        if (refreshTimer) clearTimeout(refreshTimer);
        notifyListeners("SIGNED_OUT", null);
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },

    async getSession() {
      try {
        // SSR: read from cookie adapter
        if (cookieAdapter) {
          const cookies = await cookieAdapter.getAll();
          const sessionCookie = cookies.find((c) =>
            c.name.startsWith("postbase-session") ||
            c.name === "next-auth.session-token" ||
            c.name === "__Secure-next-auth.session-token"
          );
          if (!sessionCookie) return { data: { session: null }, error: null };
          // Validate via server
          const res = await fetch(`${authBase}/session`, {
            headers: { ...headers(), "X-Postbase-Session": sessionCookie.value },
          });
          if (!res.ok) return { data: { session: null }, error: null };
          const json = await res.json();
          return { data: { session: json.session ?? null }, error: null };
        }

        // Browser: check localStorage
        if (isBrowser()) {
          const persisted = loadPersistedSession();
          if (persisted) {
            currentSession = persisted;
            return { data: { session: persisted }, error: null };
          }
        }

        // Fall back to server check
        const res = await fetch(`${authBase}/session`, { headers: headers() });
        if (!res.ok) return { data: { session: null }, error: null };
        const json = await res.json();
        return { data: { session: json.session ?? null }, error: null };
      } catch (err) {
        return { data: { session: null }, error: String(err) };
      }
    },

    async getUser(jwt?: string) {
      try {
        let token = jwt;
        if (!token && cookieAdapter) {
          const { data } = await authClient.getSession();
          token = data.session?.accessToken;
          if (!token) return { data: { user: null }, error: null };
        } else {
          token = token ?? currentSession?.accessToken ?? loadPersistedSession()?.accessToken;
        }
        const res = await fetch(`${authBase}/user`, {
          headers: {
            ...headers(),
            ...(token ? { "X-Postbase-Token": token } : {}),
          },
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null }, error: json.error ?? "Failed to get user" };
        return { data: { user: json.user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: String(err) };
      }
    },

    async updateUser(attributes) {
      try {
        const token = currentSession?.accessToken ?? loadPersistedSession()?.accessToken;
        const res = await fetch(`${authBase}/user`, {
          method: "PATCH",
          headers: {
            ...headers(),
            ...(token ? { "X-Postbase-Token": token } : {}),
          },
          body: JSON.stringify(attributes),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null }, error: json.error ?? "Failed to update user" };
        notifyListeners("USER_UPDATED", currentSession);
        return { data: { user: json.user }, error: null };
      } catch (err) {
        return { data: { user: null }, error: String(err) };
      }
    },

    async signInWithEmailOtp({ email }) {
      try {
        const res = await fetch(`${authBase}/email-otp`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Email OTP send failed" };
        return { data: { message: json.message ?? "OTP sent" }, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async verifyEmailOtp({ email, code, rememberMe }) {
      try {
        const res = await fetch(`${authBase}/email-otp/verify`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ email, code, remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Verification failed" };
        const session: Session = json.session;
        const user: AuthUser = json.user;
        notifyListeners("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async refreshSession(refreshToken?: string) {
      try {
        const token = refreshToken ?? currentSession?.refreshToken ?? loadPersistedSession()?.refreshToken;
        const res = await fetch(`${authBase}/token`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ refresh_token: token, grant_type: "refresh_token" }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Refresh failed" };
        const session: Session = json.session;
        const user: AuthUser = json.user;
        notifyListeners("TOKEN_REFRESHED", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    async setRememberMe(rememberMe: boolean) {
      try {
        const token = currentSession?.refreshToken ?? loadPersistedSession()?.refreshToken;
        if (!token) return { data: { user: null, session: null }, error: "No active session" };
        const res = await fetch(`${authBase}/session`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ refresh_token: token, remember_me: rememberMe }),
        });
        const json = await res.json();
        if (!res.ok) return { data: { user: null, session: null }, error: json.error ?? "Update failed" };
        const session: Session = json.session;
        const user: AuthUser = json.session?.user;
        notifyListeners("TOKEN_REFRESHED", session);
        return { data: { user, session }, error: null };
      } catch (err) {
        return { data: { user: null, session: null }, error: String(err) };
      }
    },

    onAuthStateChange(callback) {
      listeners.push(callback);

      // Emit current session immediately
      const session = currentSession ?? loadPersistedSession();
      if (session) {
        setTimeout(() => callback("SIGNED_IN", session), 0);
        currentSession = session;
        scheduleRefresh(session);
      }

      return {
        data: {
          subscription: {
            unsubscribe() {
              const idx = listeners.indexOf(callback);
              if (idx > -1) listeners.splice(idx, 1);
            },
          },
        },
      };
    },

    async setSession(session) {
      try {
        if (!session?.accessToken || !session?.refreshToken) {
          return { error: "Invalid session: accessToken and refreshToken are required" };
        }
        notifyListeners("SIGNED_IN", session);
        if (cookieAdapter) {
          // Secure must reflect the app's own origin, not the Postbase API's
          // baseUrl — those are frequently different (e.g. an https:// hosted
          // API called from an http://localhost dev app). Getting this wrong
          // makes Safari silently refuse to store the cookie: it enforces the
          // Secure attribute strictly even on localhost, unlike Chrome/Firefox.
          const isSecure = process.env.NODE_ENV === "production";
          await cookieAdapter.setAll([
            {
              name: "postbase-session",
              value: session.refreshToken,
              options: {
                httpOnly: true,
                secure: isSecure,
                sameSite: "lax",
                maxAge: session.expiresAt
                  ? Math.max(session.expiresAt - Math.floor(Date.now() / 1000), 0)
                  : 7 * 24 * 60 * 60,
                path: "/",
              },
            },
          ]);
        }
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },

    admin: createAuthAdmin(baseUrl, apiKey, projectId, customHeaders),
  };

  return authClient;
}

// ─── Storage Client ───────────────────────────────────────────────────────────

function createStorageClient(
  baseUrl: string,
  apiKey: string,
  options?: PostbaseClientOptions
): StorageClient {
  const customHeaders = options?.global?.headers;
  const headers = () => ({ Authorization: `Bearer ${apiKey}`, ...customHeaders });

  function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function bucketClient(bucket: string): StorageBucketClient {
    return {
      async upload(path, file, uploadOptions) {
        try {
          const form = new FormData();
          const filename = path.split("/").pop() ?? path;
          const blob = uploadOptions?.contentType
            ? new Blob([file as BlobPart], { type: uploadOptions.contentType })
            : (file as Blob);
          form.append("file", blob, filename);
          form.append("path", path);
          if (uploadOptions?.upsert) form.append("upsert", "true");
          if (uploadOptions?.cacheControl) form.append("cacheControl", uploadOptions.cacheControl);
          const res = await fetch(`${baseUrl}/api/storage/v1/object/${bucket}/${encodePath(path)}`, {
            method: uploadOptions?.upsert ? "PUT" : "POST",
            headers: headers(),
            body: form,
          });
          const text = await res.text();
          const json = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
          if (!res.ok) return { data: null, error: json.error ?? json.message ?? (text || "Upload failed") };
          return { data: { path, fullPath: `${bucket}/${path}` }, error: null };
        } catch (err) {
          return { data: null, error: String(err) };
        }
      },

      async download(path) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/${bucket}/${encodePath(path)}`, {
            headers: headers(),
          });
          if (!res.ok) return { data: null, error: "Download failed" };
          return { data: await res.blob(), error: null };
        } catch (err) {
          return { data: null, error: String(err) };
        }
      },

      async remove(paths) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/${bucket}`, {
            method: "DELETE",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: paths }),
          });
          const json = await res.json();
          if (!res.ok) return { data: null, count: null, error: json.error ?? "Delete failed" };
          return { data: json.data, count: json.data?.length ?? null, error: null };
        } catch (err) {
          return { data: null, count: null, error: String(err) };
        }
      },

      async list(prefix, listOptions) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/list/${bucket}`, {
            method: "POST",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({
              prefix: prefix ?? "",
              limit: listOptions?.limit ?? 100,
              offset: listOptions?.offset ?? 0,
              sortBy: listOptions?.sortBy,
            }),
          });
          const json = await res.json();
          if (!res.ok) return { data: null, count: null, error: json.error ?? "List failed" };
          return { data: json.data, count: json.data?.length ?? null, error: null };
        } catch (err) {
          return { data: null, count: null, error: String(err) };
        }
      },

      getPublicUrl(path) {
        return {
          data: { publicUrl: `${baseUrl}/api/storage/v1/object/public/${bucket}/${encodePath(path)}` },
        };
      },

      async createSignedUrl(path, expiresIn) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/sign/${bucket}/${encodePath(path)}`, {
            method: "POST",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn }),
          });
          const json = await res.json();
          if (!res.ok) return { data: null, error: json.error ?? "Sign failed" };
          return { data: { signedUrl: `${baseUrl}${json.signedUrl}` }, error: null };
        } catch (err) {
          return { data: null, error: String(err) };
        }
      },

      async move(fromPath, toPath) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/move`, {
            method: "POST",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({ bucketId: bucket, sourceKey: fromPath, destinationKey: toPath }),
          });
          const json = await res.json();
          if (!res.ok) return { error: json.error ?? "Move failed" };
          return { error: null };
        } catch (err) {
          return { error: String(err) };
        }
      },

      async copy(fromPath, toPath) {
        try {
          const res = await fetch(`${baseUrl}/api/storage/v1/object/copy`, {
            method: "POST",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({ bucketId: bucket, sourceKey: fromPath, destinationKey: toPath }),
          });
          const json = await res.json();
          if (!res.ok) return { data: null, error: json.error ?? "Copy failed" };
          return { data: { path: toPath }, error: null };
        } catch (err) {
          return { data: null, error: String(err) };
        }
      },
    };
  }

  return {
    from: bucketClient,

    async createBucket(name, bucketOptions) {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            id: name,
            public: bucketOptions?.public ?? false,
            file_size_limit: bucketOptions?.fileSizeLimit,
            allowed_mime_types: bucketOptions?.allowedMimeTypes,
          }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Create bucket failed" };
        return { data: json.data, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async getBucket(id) {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket/${id}`, { headers: headers() });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Get bucket failed" };
        return { data: json.data, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async listBuckets() {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket`, { headers: headers() });
        const json = await res.json();
        if (!res.ok) return { data: null, count: null, error: json.error ?? "List buckets failed" };
        return { data: json.data, count: json.data?.length ?? null, error: null };
      } catch (err) {
        return { data: null, count: null, error: String(err) };
      }
    },

    async updateBucket(id, bucketOptions) {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket/${id}`, {
          method: "PUT",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({
            public: bucketOptions.public,
            file_size_limit: bucketOptions.fileSizeLimit,
            allowed_mime_types: bucketOptions.allowedMimeTypes,
          }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Update bucket failed" };
        return { data: json.data, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },

    async deleteBucket(id) {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket/${id}`, {
          method: "DELETE",
          headers: headers(),
        });
        const json = await res.json();
        if (!res.ok) return { error: json.error ?? "Delete bucket failed" };
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },

    async emptyBucket(id) {
      try {
        const res = await fetch(`${baseUrl}/api/storage/v1/bucket/${id}/empty`, {
          method: "POST",
          headers: headers(),
        });
        const json = await res.json();
        if (!res.ok) return { error: json.error ?? "Empty bucket failed" };
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },
  };
}

// ─── Email Client ─────────────────────────────────────────────────────────────

function createEmailClient(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  options?: PostbaseClientOptions
): EmailClient {
  const customHeaders = options?.global?.headers;
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...customHeaders,
  });

  return {
    async send({ to, subject, text, html, replyTo }: EmailSendOptions) {
      try {
        const res = await fetch(`${baseUrl}/api/email/v1/${projectId}/send`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ to, subject, text, html, replyTo }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json.error ?? "Failed to send email" };
        return { data: { ok: true }, error: null };
      } catch (err) {
        return { data: null, error: String(err) };
      }
    },
  };
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

class RealtimeChannelImpl implements RealtimeChannel {
  private handlers: Array<{ event: RealtimeEvent; callback: (payload: RealtimePayload) => void }> = [];
  private ws: WebSocket | null = null;
  private statusCallback?: (status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR") => void;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private channelName: string
  ) {}

  on<T = Record<string, unknown>>(
    event: RealtimeEvent,
    callback: (payload: RealtimePayload<T>) => void
  ): RealtimeChannel {
    this.handlers.push({ event, callback: callback as (p: RealtimePayload) => void });
    return this;
  }

  subscribe(callback?: (status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR") => void): RealtimeChannel {
    if (typeof window === "undefined") return this;
    this.statusCallback = callback;

    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    try {
      this.ws = new WebSocket(`${wsUrl}/api/realtime?channel=${encodeURIComponent(this.channelName)}&apikey=${this.apiKey}`);

      this.ws.onopen = () => {
        this.statusCallback?.("SUBSCRIBED");
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as RealtimePayload;
          this.handlers.forEach(({ event: eventType, callback }) => {
            if (eventType === "*" || eventType === payload.eventType) {
              callback(payload);
            }
          });
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onerror = () => {
        this.statusCallback?.("CHANNEL_ERROR");
      };

      this.ws.onclose = () => {
        this.statusCallback?.("CLOSED");
      };
    } catch {
      this.statusCallback?.("CHANNEL_ERROR");
    }

    return this;
  }

  unsubscribe(): void {
    this.ws?.close();
    this.ws = null;
  }
}

// ─── Main factory ─────────────────────────────────────────────────────────────

const channels = new Set<RealtimeChannelImpl>();

export function createClient(
  url: string,
  key: string,
  options?: PostbaseClientOptions
): PostbaseClient {
  const baseUrl = (url ?? "").replace(/\/$/, "");
  const cookieAdapter = options?.cookies;
  const projectId = options?.projectId ?? "";

  const makeQueryState = <T>(table: string): QueryState<T> => ({
    baseUrl,
    apiKey: key,
    table,
    columns: "*",
    selectOptions: {},
    filters: [],
    orFilters: [],
    notFilters: [],
    orderBy: [],
    joins: [],
    operation: "select",
    customHeaders: options?.global?.headers,
    cookieAdapter,
  });

  return {
    url: baseUrl,
    key,
    auth: createAuthClient(baseUrl, key, projectId, options, cookieAdapter),
    email: createEmailClient(baseUrl, key, projectId, options),
    storage: createStorageClient(baseUrl, key, options),

    from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
      return new QueryBuilderImpl<T>(makeQueryState<T>(table)) as unknown as QueryBuilder<T>;
    },

    async sql<T = Record<string, unknown>>(
      query: string,
      params?: unknown[]
    ): Promise<QueryResult<T>> {
      if (!baseUrl) throw new Error("[postbasejs] url is required — ensure POSTBASE_URL is set in your environment");
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...options?.global?.headers,
        };
        if (cookieAdapter) {
          const cookies = await cookieAdapter.getAll();
          const sessionCookie = cookies.find((c) =>
            c.name.startsWith("postbase-session") ||
            c.name === "next-auth.session-token" ||
            c.name === "__Secure-next-auth.session-token"
          );
          if (sessionCookie) headers["X-Postbase-Session"] = sessionCookie.value;
        }
        const res = await fetch(`${baseUrl}/api/db/sql`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, params: params ?? [] }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, count: null, error: json.error ?? "SQL query failed" };
        return { data: json.data, count: json.count ?? null, error: null };
      } catch (err) {
        return { data: null, count: null, error: String(err) };
      }
    },

    async rpc<T = Record<string, unknown>>(
      fn: string,
      args?: Record<string, unknown>,
      rpcOptions?: RpcOptions
    ): Promise<QueryResult<T>> {
      if (!baseUrl) throw new Error("[postbasejs] url is required — ensure POSTBASE_URL is set in your environment");
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...options?.global?.headers,
        };
        if (cookieAdapter) {
          const cookies = await cookieAdapter.getAll();
          const sessionCookie = cookies.find((c) =>
            c.name.startsWith("postbase-session") ||
            c.name === "next-auth.session-token" ||
            c.name === "__Secure-next-auth.session-token"
          );
          if (sessionCookie) headers["X-Postbase-Session"] = sessionCookie.value;
        }
        const res = await fetch(`${baseUrl}/api/rpc/${fn}`, {
          method: rpcOptions?.head ? "HEAD" : "POST",
          headers,
          body: JSON.stringify({ args: args ?? {}, count: rpcOptions?.count }),
        });
        const json = await res.json();
        if (!res.ok) return { data: null, count: null, error: json.error ?? "RPC failed" };
        return { data: json.data, count: json.count ?? null, error: null };
      } catch (err) {
        return { data: null, count: null, error: String(err) };
      }
    },

    channel(name: string): RealtimeChannel {
      const ch = new RealtimeChannelImpl(baseUrl, key, name);
      channels.add(ch);
      return ch;
    },

    removeChannel(channel: RealtimeChannel): void {
      channel.unsubscribe();
      channels.delete(channel as RealtimeChannelImpl);
    },

    removeAllChannels(): void {
      channels.forEach((ch) => ch.unsubscribe());
      channels.clear();
    },
  };
}
