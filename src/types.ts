// ─── Filters ──────────────────────────────────────────────────────────────────

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "is"
  | "contains"
  | "overlaps"
  | "textSearch";

export interface Filter {
  column: string;
  operator: FilterOperator;
  value: unknown;
}

export interface OrFilter {
  type: "or";
  filters: Filter[];
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface QueryResult<T = Record<string, unknown>> {
  data: T[] | null;
  count: number | null;
  error: string | null;
}

export interface SingleResult<T = Record<string, unknown>> {
  data: T | null;
  error: string | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  phone?: string | null;
  role?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: AuthUser;
}

export interface AuthResponse {
  data: { user: AuthUser | null; session: Session | null };
  error: string | null;
}

/** Providers that support the native id_token flow (Apple native SDK, Google Sign-In) */
export type NativeOAuthProvider = "apple" | "google";

export interface AuthClient {
  /** Sign up with email + password */
  signUp(options: { email: string; password: string; options?: { data?: Record<string, unknown> } }): Promise<AuthResponse>;
  /** Sign in with email + password */
  signInWithPassword(options: { email: string; password: string }): Promise<AuthResponse>;
  /** Send magic link / OTP to email */
  signInWithOtp(options: { email: string; type?: "otp" | "magic_link"; options?: { redirectTo?: string } }): Promise<{ data: null; error: string | null }>;
  /** Verify a 6-digit OTP code */
  verifyOtp(options: { email: string; token: string }): Promise<AuthResponse>;
  /**
   * Sign in with a native provider id_token (Apple Sign In, Google Sign-In).
   * Use this in iOS/macOS/Android apps where the OS hands you an id_token directly —
   * no browser redirect needed. The token is validated server-side against the
   * provider's public JWKS and exchanged for a Postbase session.
   */
  signInWithIdToken(options: { provider: NativeOAuthProvider; idToken: string; nonce?: string }): Promise<AuthResponse>;
  /** Sign in with OAuth provider (browser redirect or custom URL scheme PKCE flow) */
  signInWithOAuth(options: { provider: string; options?: { redirectTo?: string; scopes?: string } }): Promise<void>;
  /**
   * Call after OAuth completes to parse tokens and store the session.
   * - Browser: reads from window.location.search automatically.
   * - Native apps: pass the full callback URL (e.g. the URL your custom scheme
   *   received) as the `url` option.
   */
  handleOAuthCallback(options?: { url?: string }): Promise<{ data: { session: Session | null; user: AuthUser | null }; error: string | null }>;
  /** Sign out the current user */
  signOut(): Promise<{ error: string | null }>;
  /** Get the current session (from cookie / storage) */
  getSession(): Promise<{ data: { session: Session | null }; error: string | null }>;
  /** Get the current user (server-verified) */
  getUser(jwt?: string): Promise<{ data: { user: AuthUser | null }; error: string | null }>;
  /** Update the current authenticated user's profile */
  updateUser(attributes: { name?: string; image?: string; data?: Record<string, unknown> }): Promise<{ data: { user: AuthUser | null }; error: string | null }>;
  /** Send a 6-digit OTP code to email (uses /email-otp endpoint) */
  signInWithEmailOtp(options: { email: string }): Promise<{ data: { message: string } | null; error: string | null }>;
  /** Verify a 6-digit email OTP code and get session tokens */
  verifyEmailOtp(options: { email: string; code: string }): Promise<AuthResponse>;
  /** Refresh the session using a refresh token */
  refreshSession(refreshToken?: string): Promise<AuthResponse>;
  /** Listen to auth state changes (browser only) */
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): { data: { subscription: { unsubscribe: () => void } } };
  /**
   * Persist a session that was obtained outside the SDK (e.g. forwarded from a
   * server-side OAuth callback route). Updates in-memory state, localStorage,
   * and — when a CookieAdapter is present on the server client — writes a
   * `postbase-session` cookie so subsequent SSR requests are authenticated.
   *
   * Typical use: in a Next.js App Router API route that receives the OAuth
   * tokens via a POST from the client callback page.
   *
   * @example
   * // app/api/auth/callback/route.ts
   * import { cookies } from 'next/headers'
   * import { createServerClient } from 'postbasejs/ssr'
   *
   * export async function POST(req: Request) {
   *   const { session } = await req.json()
   *   const cookieStore = await cookies()
   *   const postbase = createServerClient(url, key, {
   *     projectId,
   *     cookies: {
   *       getAll: () => cookieStore.getAll(),
   *       setAll: (cs) => cs.forEach(c => cookieStore.set(c.name, c.value, c.options)),
   *     },
   *   })
   *   const { error } = await postbase.auth.setSession(session)
   *   if (error) return Response.json({ error }, { status: 400 })
   *   return Response.json({ ok: true })
   * }
   */
  setSession(session: Session): Promise<{ error: string | null }>;
  /** Admin methods — require service role key */
  admin: AuthAdminClient;
}

export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

export interface AuthAdminClient {
  /** List all users (service role only) */
  listUsers(options?: { page?: number; perPage?: number }): Promise<{ data: { users: AuthUser[]; total: number } | null; error: string | null }>;
  /** Get a user by id (service role only) */
  getUserById(id: string): Promise<{ data: { user: AuthUser | null }; error: string | null }>;
  /** Create a user (service role only) */
  createUser(options: { email: string; password?: string; email_confirm?: boolean; user_metadata?: Record<string, unknown> }): Promise<{ data: { user: AuthUser | null }; error: string | null }>;
  /** Update a user (service role only) */
  updateUserById(id: string, attributes: { email?: string; password?: string; user_metadata?: Record<string, unknown> }): Promise<{ data: { user: AuthUser | null }; error: string | null }>;
  /** Delete a user (service role only) */
  deleteUser(id: string): Promise<{ data: null; error: string | null }>;
}

// ─── Query Builder ────────────────────────────────────────────────────────────

export interface SelectOptions {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
}

export type JoinType = "inner" | "left" | "right" | "full";

export interface JoinClause {
  table: string;
  on: string;
  type?: JoinType;
}

export interface QueryBuilder<T = Record<string, unknown>> {
  /** Select columns. Pass '*' for all. */
  select(columns?: string, options?: SelectOptions): QueryBuilder<T>;
  /** Join another table */
  join(table: string, options: { on: string; type?: JoinType }): QueryBuilder<T>;
  /** Filter: column = value */
  eq(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column != value */
  neq(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column > value */
  gt(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column >= value */
  gte(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column < value */
  lt(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column <= value */
  lte(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column LIKE pattern */
  like(column: string, pattern: string): QueryBuilder<T>;
  /** Filter: column ILIKE pattern (case-insensitive) */
  ilike(column: string, pattern: string): QueryBuilder<T>;
  /** Filter: column IN (values) */
  in(column: string, values: unknown[]): QueryBuilder<T>;
  /** Filter: column IS NULL or IS NOT NULL */
  is(column: string, value: null | boolean): QueryBuilder<T>;
  /** Filter: column @> value (array/jsonb contains) */
  contains(column: string, value: unknown): QueryBuilder<T>;
  /** Filter: column && value (array overlaps) */
  overlaps(column: string, value: unknown[]): QueryBuilder<T>;
  /** Full-text search */
  textSearch(column: string, query: string, options?: { config?: string }): QueryBuilder<T>;
  /** Combine filters with OR */
  or(filters: string): QueryBuilder<T>;
  /** Negate the next filter */
  not(column: string, operator: string, value: unknown): QueryBuilder<T>;
  /** Order results */
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T>;
  /** Limit number of rows */
  limit(count: number): QueryBuilder<T>;
  /** Offset rows */
  offset(count: number): QueryBuilder<T>;
  /** Return a range of rows */
  range(from: number, to: number): QueryBuilder<T>;
  /** Execute and return a single row (error if not exactly one) */
  single(): Promise<SingleResult<T>>;
  /** Execute and return a single row or null */
  maybeSingle(): Promise<SingleResult<T>>;
  /** Execute as SELECT (thenable) */
  then: Promise<QueryResult<T>>["then"];
  /** Insert row(s) */
  insert(data: Partial<T> | Partial<T>[], options?: { returning?: string }): InsertBuilder<T>;
  /** Upsert row(s) — insert or update on conflict */
  upsert(data: Partial<T> | Partial<T>[], options?: { onConflict?: string; returning?: string }): InsertBuilder<T>;
  /** Update rows */
  update(data: Partial<T>): UpdateBuilder<T>;
  /** Delete rows */
  delete(): DeleteBuilder<T>;
}

export interface InsertBuilder<T> {
  select(columns?: string): InsertBuilder<T>;
  single(): Promise<SingleResult<T>>;
  then: Promise<QueryResult<T>>["then"];
}

export interface UpdateBuilder<T> {
  eq(column: string, value: unknown): UpdateBuilder<T>;
  neq(column: string, value: unknown): UpdateBuilder<T>;
  gt(column: string, value: unknown): UpdateBuilder<T>;
  gte(column: string, value: unknown): UpdateBuilder<T>;
  lt(column: string, value: unknown): UpdateBuilder<T>;
  lte(column: string, value: unknown): UpdateBuilder<T>;
  like(column: string, pattern: string): UpdateBuilder<T>;
  ilike(column: string, pattern: string): UpdateBuilder<T>;
  in(column: string, values: unknown[]): UpdateBuilder<T>;
  is(column: string, value: null | boolean): UpdateBuilder<T>;
  contains(column: string, value: unknown): UpdateBuilder<T>;
  overlaps(column: string, value: unknown[]): UpdateBuilder<T>;
  textSearch(column: string, query: string, options?: { config?: string }): UpdateBuilder<T>;
  or(filters: string): UpdateBuilder<T>;
  not(column: string, operator: string, value: unknown): UpdateBuilder<T>;
  select(columns?: string): UpdateBuilder<T>;
  single(): Promise<SingleResult<T>>;
  then: Promise<QueryResult<T>>["then"];
}

export interface DeleteBuilder<T> {
  eq(column: string, value: unknown): DeleteBuilder<T>;
  neq(column: string, value: unknown): DeleteBuilder<T>;
  gt(column: string, value: unknown): DeleteBuilder<T>;
  gte(column: string, value: unknown): DeleteBuilder<T>;
  lt(column: string, value: unknown): DeleteBuilder<T>;
  lte(column: string, value: unknown): DeleteBuilder<T>;
  like(column: string, pattern: string): DeleteBuilder<T>;
  ilike(column: string, pattern: string): DeleteBuilder<T>;
  in(column: string, values: unknown[]): DeleteBuilder<T>;
  is(column: string, value: null | boolean): DeleteBuilder<T>;
  contains(column: string, value: unknown): DeleteBuilder<T>;
  overlaps(column: string, value: unknown[]): DeleteBuilder<T>;
  textSearch(column: string, query: string, options?: { config?: string }): DeleteBuilder<T>;
  or(filters: string): DeleteBuilder<T>;
  not(column: string, operator: string, value: unknown): DeleteBuilder<T>;
  select(columns?: string): DeleteBuilder<T>;
  single(): Promise<SingleResult<T>>;
  then: Promise<QueryResult<T>>["then"];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StorageObject {
  name: string;
  size: number;
  contentType: string;
  updatedAt: string;
  createdAt: string;
}

export interface Bucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StorageBucketClient {
  upload(path: string, file: File | Blob | Buffer | ArrayBuffer, options?: {
    contentType?: string;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<SingleResult<{ path: string; fullPath: string }>>;
  download(path: string): Promise<{ data: Blob | null; error: string | null }>;
  remove(paths: string[]): Promise<QueryResult<{ name: string }>>;
  list(prefix?: string, options?: { limit?: number; offset?: number; sortBy?: { column: string; order?: "asc" | "desc" } }): Promise<QueryResult<StorageObject>>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  createSignedUrl(path: string, expiresIn: number): Promise<SingleResult<{ signedUrl: string }>>;
  move(fromPath: string, toPath: string): Promise<{ error: string | null }>;
  copy(fromPath: string, toPath: string): Promise<SingleResult<{ path: string }>>;
}

export interface StorageClient {
  from(bucket: string): StorageBucketClient;
  createBucket(name: string, options?: {
    public?: boolean;
    fileSizeLimit?: number;
    allowedMimeTypes?: string[];
  }): Promise<SingleResult<Bucket>>;
  getBucket(id: string): Promise<SingleResult<Bucket>>;
  listBuckets(): Promise<QueryResult<Bucket>>;
  updateBucket(id: string, options: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Promise<SingleResult<Bucket>>;
  deleteBucket(id: string): Promise<{ error: string | null }>;
  emptyBucket(id: string): Promise<{ error: string | null }>;
}

// ─── RPC ──────────────────────────────────────────────────────────────────────

export interface RpcOptions {
  head?: boolean;
  count?: "exact" | "planned" | "estimated";
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface RealtimePayload<T = Record<string, unknown>> {
  eventType: RealtimeEvent;
  new: T | null;
  old: T | null;
  schema: string;
  table: string;
  commitTimestamp: string;
}

export interface RealtimeChannel {
  on<T = Record<string, unknown>>(
    event: RealtimeEvent,
    callback: (payload: RealtimePayload<T>) => void
  ): RealtimeChannel;
  subscribe(callback?: (status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR") => void): RealtimeChannel;
  unsubscribe(): void;
}

// ─── Email ────────────────────────────────────────────────────────────────────

export interface EmailSendOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailClient {
  /** Send a transactional email using the project's configured email provider */
  send(options: EmailSendOptions): Promise<{ data: { ok: boolean } | null; error: string | null }>;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface PostbaseClientOptions {
  /** The project ID to scope all auth API calls (e.g. `/api/auth/v1/[projectId]/...`) */
  projectId?: string;
  auth?: {
    persistSession?: boolean;
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
    storageKey?: string;
  };
  global?: {
    headers?: Record<string, string>;
    fetch?: typeof fetch;
  };
  cookies?: CookieAdapter;
}

export interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }> | Promise<Array<{ name: string; value: string }>>;
  setAll(cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>): void | Promise<void>;
}

export interface PostbaseClient {
  auth: AuthClient;
  email: EmailClient;
  from<T = Record<string, unknown>>(table: string): QueryBuilder<T>;
  storage: StorageClient;
  rpc<T = Record<string, unknown>>(fn: string, args?: Record<string, unknown>, options?: RpcOptions): Promise<QueryResult<T>>;
  /** Execute a raw parameterized SQL query. Params replace $1, $2, … placeholders. RLS context is still enforced. */
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): void;
  removeAllChannels(): void;
  /** The raw base URL */
  url: string;
  /** The API key in use */
  key: string;
}
