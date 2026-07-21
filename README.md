# postbasejs

The official JavaScript/TypeScript client for [Postbase](https://www.getpostbase.com) — a self-hosted, open-source backend as a service.

[![npm version](https://img.shields.io/npm/v/postbasejs)](https://www.npmjs.com/package/postbasejs)
[![license](https://img.shields.io/npm/l/postbasejs)](https://github.com/postbase/postbase/blob/main/LICENSE)

> **[getpostbase.com](https://www.getpostbase.com)** · [Documentation](https://www.getpostbase.com/docs) · [GitHub](https://github.com/postbase/postbase)

---

## What is Postbase?

Postbase is a self-hosted backend platform built on PostgreSQL. It gives you a database with a REST query API, authentication (password, magic link, OAuth), file storage, and row-level security — all running on your own infrastructure.

`postbasejs` is the client SDK for interacting with your Postbase instance from JavaScript or TypeScript apps.

---

## Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/1.png" alt="Postbase landing" width="100%" />
  <br/><em>Self-hosted auth + database platform for Next.js</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/2.png" alt="Dashboard" width="100%" />
  <br/><em>Dashboard — manage organisations and projects</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/3.png" alt="Project overview" width="100%" />
  <br/><em>Project overview with quick-start guide</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/4.png" alt="Auth providers" width="100%" />
  <br/><em>25+ auth providers — toggle any from the dashboard</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/5.png" alt="SQL editor" width="100%" />
  <br/><em>Built-in SQL editor with AI query generation</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/6.png" alt="Storage connections" width="100%" />
  <br/><em>S3-compatible storage — connect Amazon S3, Cloudflare R2, Backblaze B2, and more</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/7.png" alt="Cron jobs" width="100%" />
  <br/><em>Scheduled cron jobs — run SQL snippets or HTTP requests on any schedule</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/8.png" alt="API keys" width="100%" />
  <br/><em>API keys — anon and service role keys with SDK snippet</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/harshalone/postbase/main/images/9.png" alt="Project settings" width="100%" />
  <br/><em>Project settings — configure auth redirect URLs, JWT expiry, and more</em>
</p>

---

## Installation

```bash
npm install postbasejs
# or
pnpm add postbasejs
# or
yarn add postbasejs
```

---

## Quick Start

```typescript
import { createClient } from 'postbasejs'

const postbase = createClient(
  'https://your-postbase-instance.com',
  'pb_anon_your_api_key',
  { projectId: 'your-project-id' }
)
```

Your **URL**, **anon key**, and **project ID** can be found in the API Keys section of your Postbase dashboard.

---

## Database

Query your PostgreSQL tables with a fluent, chainable API.

### Select

```typescript
// Fetch all posts (wildcard or omit argument — both work)
const { data, error } = await postbase.from('posts').select('*')
const { data, error } = await postbase.from('posts').select()

// Select specific columns
const { data } = await postbase.from('posts').select('id, title, created_at')

// With filters
const { data } = await postbase
  .from('posts')
  .select('*')
  .eq('status', 'published')
  .order('created_at', { ascending: false })
  .limit(10)

// Get total count
const { data, count } = await postbase
  .from('posts')
  .select('*', { count: 'exact' })
```

### Filter operators

All filter methods are available on `select()`, `update()`, and `delete()` chains.

| Method | SQL equivalent | select | update | delete |
|---|---|:---:|:---:|:---:|
| `.eq(col, val)` | `col = val` | ✅ | ✅ | ✅ |
| `.neq(col, val)` | `col != val` | ✅ | ✅ | ✅ |
| `.gt(col, val)` | `col > val` | ✅ | ✅ | ✅ |
| `.gte(col, val)` | `col >= val` | ✅ | ✅ | ✅ |
| `.lt(col, val)` | `col < val` | ✅ | ✅ | ✅ |
| `.lte(col, val)` | `col <= val` | ✅ | ✅ | ✅ |
| `.like(col, pattern)` | `col LIKE pattern` | ✅ | ✅ | ✅ |
| `.ilike(col, pattern)` | `col ILIKE pattern` | ✅ | ✅ | ✅ |
| `.in(col, values)` | `col IN (values)` | ✅ | ✅ | ✅ |
| `.is(col, null \| boolean)` | `col IS NULL / TRUE / FALSE` | ✅ | ✅ | ✅ |
| `.contains(col, val)` | `col @> val` | ✅ | ✅ | ✅ |
| `.overlaps(col, val)` | `col && val` | ✅ | ✅ | ✅ |
| `.textSearch(col, query)` | full-text search | ✅ | ✅ | ✅ |
| `.or(filters)` | `col = val OR col = val` | ✅ | ✅ | ✅ |
| `.not(col, op, val)` | `NOT col op val` | ✅ | ✅ | ✅ |

### `.or()` — Supabase-compatible filter string

Pass a Supabase-style filter string and the SDK parses it into structured filters before sending to the server. Commas separate OR conditions; values with commas are safe inside parentheses (used by `in`).

```typescript
// Simple OR: match either condition
const { data } = await postbase
  .from('users')
  .select()
  .or('email.ilike.%alice%,name.ilike.%alice%')

// OR with in operator — values in parens are safe
const { data } = await postbase
  .from('orders')
  .select()
  .or('status.eq.active,status.in.(pending,review)')

// Combine OR with AND filters — the .eq() is ANDed with the OR group
const { data } = await postbase
  .from('posts')
  .select()
  .eq('published', true)
  .or('title.ilike.%hello%,body.ilike.%hello%')
```

**Supported operators inside `.or()`:** `eq` `neq` `gt` `gte` `lt` `lte` `like` `ilike` `in` `is`

### Joins

Use `.join()` to combine data from related tables. Chains are immutable and can be stacked.

```typescript
// Left join — include orders even if no matching user
const { data } = await postbase
  .from('orders')
  .join('users', { on: 'orders.user_id = users.id', type: 'left' })
  .select('orders.id, orders.total, users.email')

// Multiple joins
const { data } = await postbase
  .from('orders')
  .join('users',    { on: 'orders.user_id = users.id',       type: 'left' })
  .join('products', { on: 'orders.product_id = products.id' })
  .select('orders.id, users.email, products.name')
  .eq('orders.status', 'active')
  .order('orders.created_at', { ascending: false })
  .limit(20)
```

**Join types** (`type` defaults to `inner` if omitted):

| `type` | SQL |
|---|---|
| `'inner'` | `INNER JOIN` |
| `'left'` | `LEFT JOIN` |
| `'right'` | `RIGHT JOIN` |
| `'full'` | `FULL OUTER JOIN` |

**`on` expression rules** — the server validates the `on` string against a strict allow-list. Supported syntax:

- `table.column = table.column`
- Comparison operators: `=`, `<`, `>`, `!=`, `<=`, `>=`
- Identifiers and dotted column references only — no raw SQL, no functions, no subqueries

```typescript
// Valid
{ on: 'orders.user_id = users.id' }
{ on: 'order_items.order_id = orders.id' }

// Invalid — will be rejected by the server
{ on: 'orders.user_id = users.id AND users.active = true' }  // AND not allowed
{ on: "orders.status = 'active'" }                           // string literals not allowed
```

**Selecting columns from joined tables** — use `table.column` notation in `.select()`:

```typescript
.select('orders.id, users.email, products.name, products.price')
```

**Column aliases** — when two joined tables share a column name (e.g. both have `id` or `name`), use `AS` to rename them. The SDK strips the alias before sending to the server (which only accepts plain identifiers) and renames the keys in the returned rows client-side.

```typescript
// Without aliases: apis.id and pricing_plans.id both come back as "id" — last one wins silently
// With aliases: each column gets a unique key in the result
const { data } = await postbase
  .from('apis')
  .join('pricing_plans', { on: 'apis.pricing_plan_id = pricing_plans.id', type: 'left' })
  .select('apis.id as api_id, apis.name, pricing_plans.id as plan_id, pricing_plans.name as plan_name')
// data[0] → { api_id: '...', name: '...', plan_id: '...', plan_name: '...' }
```

> **Limitation:** if you select two columns with the same base name without aliasing both (e.g. `apis.id, pricing_plans.id`), the server collapses them to one `id` key before the SDK sees the response — only one value survives. Always alias at least all but one of any colliding columns.

**TypeScript** — define a type using the aliased key names:

```typescript
interface ApiWithPlan {
  api_id: string
  name: string
  plan_id: string
  plan_name: string
}

const { data } = await postbase
  .from<ApiWithPlan>('apis')
  .join('pricing_plans', { on: 'apis.pricing_plan_id = pricing_plans.id', type: 'left' })
  .select('apis.id as api_id, apis.name, pricing_plans.id as plan_id, pricing_plans.name as plan_name')
// data is ApiWithPlan[] | null
```

---

### Raw SQL

For complex queries that can't be expressed with the builder (multi-table aggregates, CTEs, window functions), use `postbase.sql()`. RLS context is still enforced — the authenticated user's JWT is forwarded exactly as with `.from()`.

```typescript
// Simple parameterized query
const { data, error } = await postbase.sql<{ id: string; email: string }>(
  `SELECT o.id, u.email
   FROM orders o
   INNER JOIN users u ON o.user_id = u.id
   WHERE o.status = $1`,
  ['active']
)

// Multiple params
const { data } = await postbase.sql<{ title: string; count: number }>(
  `SELECT p.title, COUNT(c.id) AS count
   FROM posts p
   LEFT JOIN comments c ON c.post_id = p.id
   WHERE p.author_id = $1 AND p.status = $2
   GROUP BY p.id, p.title
   ORDER BY count DESC
   LIMIT $3`,
  [userId, 'published', 10]
)
```

Params replace `$1`, `$2`, `$3`, … placeholders (standard PostgreSQL positional parameters). Never interpolate values directly into the query string — always use params to prevent SQL injection.

---

### Insert

```typescript
const { data, error } = await postbase
  .from('posts')
  .insert({ title: 'Hello World', status: 'draft' })
  .select()
  .single()
```

### Update

```typescript
const { data, error } = await postbase
  .from('posts')
  .update({ status: 'published' })
  .eq('id', 'post-id')
  .select()
  .single()
```

### Upsert

```typescript
const { data, error } = await postbase
  .from('profiles')
  .upsert({ id: 'user-id', username: 'alice' }, { onConflict: 'id' })
  .select()
```

### Delete

```typescript
const { error } = await postbase
  .from('posts')
  .delete()
  .eq('id', 'post-id')
```

### Single row helpers

```typescript
// Errors if not exactly one row
const { data, error } = await postbase.from('posts').select('*').eq('id', id).single()

// Returns null if not found (no error)
const { data } = await postbase.from('posts').select('*').eq('id', id).maybeSingle()
```

### Pagination

```typescript
// Limit + offset
const { data } = await postbase.from('posts').select('*').limit(20).offset(40)

// Range (inclusive)
const { data } = await postbase.from('posts').select('*').range(0, 19)
```

---

## Authentication

### Sign up

```typescript
const { data, error } = await postbase.auth.signUp({
  email: 'user@example.com',
  password: 'supersecret',
  rememberMe: true, // optional — 30-day refresh token instead of the default 7-day
})
// data.user, data.session
```

### Sign in with password

```typescript
const { data, error } = await postbase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'supersecret',
  rememberMe: true, // optional — 30-day refresh token instead of the default 7-day
})
```

### OTP & Magic Link (passwordless)

**Magic Link:**
```typescript
const { error } = await postbase.auth.signInWithOtp({
  email: 'user@example.com',
  type: 'magic_link', // optional, defaults to 'magic_link'
  options: { redirectTo: 'https://yourapp.com/dashboard' },
})
```

**6-digit OTP Code:**
```typescript
// 1. Request the code
const { error } = await postbase.auth.signInWithOtp({
  email: 'user@example.com',
  type: 'otp',
})

// 2. Verify the code
const { data, error } = await postbase.auth.verifyOtp({
  email: 'user@example.com',
  token: '123456', // 6-digit code from email
  rememberMe: true, // optional — 30-day refresh token instead of the default 7-day
})
// data.user, data.session
```

> `rememberMe` also applies to `verifyEmailOtp` (the `/email-otp/verify` flow). It's carried
> forward automatically on every subsequent `refreshSession()` call — the server stores the flag
> on the session row, so a 30-day session won't downgrade to 7 days on its first refresh.

### OAuth (browser redirect)

```typescript
await postbase.auth.signInWithOAuth({
  provider: 'google', // or 'github', 'discord', 'apple', etc.
  options: { redirectTo: 'https://yourapp.com/callback' },
})
```

### OAuth (native apps — custom URL scheme)

For iOS, macOS, or Android apps using an in-app browser (ASWebAuthenticationSession / Chrome Custom Tab), pass your app's custom URL scheme as `redirectTo`. The server callback will redirect to it instead of an `https://` URL, and your app receives the session tokens in the URL.

```typescript
// Opens the authorize URL — in native environments, open it in an
// ASWebAuthenticationSession or Chrome Custom Tab instead of a browser tab.
const authorizeUrl = await postbase.auth.signInWithOAuth({
  provider: 'github',
  options: { redirectTo: 'com.myapp://auth/callback' },
})

// After the in-app browser calls back to your app URL, parse the session:
const { data, error } = await postbase.auth.handleOAuthCallback({
  url: 'com.myapp://auth/callback?access_token=...&refresh_token=...', // the URL your app received
})
```

### Sign in with Apple / Google (native SDK — no browser)

For iOS/macOS apps using `ASAuthorizationController` (Apple) or `GIDSignIn` (Google), skip the browser entirely. Pass the `identityToken` (Apple) or `idToken` (Google) you get from the native SDK directly to Postbase:

```typescript
// iOS — Apple Sign In (Swift → pass identityToken to your JS layer)
const { data, error } = await postbase.auth.signInWithIdToken({
  provider: 'apple',
  idToken: appleCredential.identityToken, // string JWT from ASAuthorizationAppleIDCredential
  nonce: nonce, // optional — include if you passed a nonce to ASAuthorizationAppleIDRequest
  rememberMe: true, // optional — 30-day refresh token instead of the default 7-day (requires postbasejs >= 0.5.16)
})

// Android / Web — Google Sign-In
const { data, error } = await postbase.auth.signInWithIdToken({
  provider: 'google',
  idToken: googleCredential.idToken, // string JWT from GIDSignIn / Google Identity Services
  rememberMe: true, // optional
})

// data.session.accessToken, data.session.refreshToken, data.user
```

> **Note:** For Apple, the provider must be enabled in your Postbase dashboard. The `clientId` field should contain your Apple Service ID (for web) or comma-separated list of Bundle IDs (for native), matching the `aud` claim in Apple's `id_token`.

> Unlike browser/in-app-browser OAuth (`signInWithOAuth` + `handleOAuthCallback`), `signInWithIdToken`
> has a request body at the point the session is first issued — so `rememberMe` can be set directly
> here, in one call, with no `setRememberMe` follow-up needed.

### Handle OAuth callback

In browser apps, call this on the page your `redirectTo` URL points to — it reads `window.location.search` automatically:

```typescript
// pages/callback.tsx (or equivalent)
const { data, error } = await postbase.auth.handleOAuthCallback()
// data.session, data.user
```

For native apps, pass the URL your app scheme received:

```typescript
const { data, error } = await postbase.auth.handleOAuthCallback({
  url: incomingUrl, // e.g. 'com.myapp://auth/callback?access_token=...'
})
```

### Set session (SSR — persist OAuth session as a cookie)

After `handleOAuthCallback()` resolves on the client, forward the session to your API route and call `setSession` on a **server client** so the session is stored as an httpOnly `postbase-session` cookie. Subsequent SSR requests will be authenticated automatically.

```typescript
// app/auth/callback/page.tsx  (Client Component)
'use client'
import { createBrowserClient } from 'postbasejs/ssr'

const postbase = createBrowserClient(
  process.env.NEXT_PUBLIC_POSTBASE_URL!,
  process.env.NEXT_PUBLIC_POSTBASE_ANON_KEY!,
  { projectId: process.env.NEXT_PUBLIC_POSTBASE_PROJECT_ID! }
)

const { data, error } = await postbase.auth.handleOAuthCallback()
if (data.session) {
  // Hand the session to the server so it can write the httpOnly cookie
  await fetch('/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: data.session }),
    credentials: 'include',
  })
}
router.push('/dashboard')
```

```typescript
// app/api/auth/callback/route.ts  (API Route)
import { cookies } from 'next/headers'
import { createServerClient } from 'postbasejs/ssr'

export async function POST(req: Request) {
  const { session } = await req.json()
  const cookieStore = await cookies()

  const postbase = createServerClient(
    process.env.NEXT_PUBLIC_POSTBASE_URL!,
    process.env.NEXT_PUBLIC_POSTBASE_ANON_KEY!,
    {
      projectId: process.env.NEXT_PUBLIC_POSTBASE_PROJECT_ID!,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => cs.forEach(c => cookieStore.set(c.name, c.value, c.options as any)),
      },
    }
  )

  const { error } = await postbase.auth.setSession(session)
  if (error) return Response.json({ error }, { status: 400 })
  return Response.json({ ok: true })
}
```

The server client writes a `postbase-session` httpOnly cookie that the SDK's `createServerClient` reads on every subsequent request — no manual cookie parsing needed.

> **v0.5.13 fix:** `setSession()` previously derived the cookie's `Secure` attribute from the Postbase API's own URL (`https://...`), not your app's origin. This broke auth in dev whenever the API was hosted over HTTPS but the app ran on `http://localhost` — Chrome tolerates a `Secure` cookie on localhost, but Safari silently refuses to store it, so the session never persisted and users got bounced back to the login page after OTP/OAuth. `Secure` is now derived from `NODE_ENV === 'production'` instead. Upgrade to ≥ 0.5.13 if you saw OTP or OAuth logins loop back to the login page in Safari.

### Remember me

`rememberMe: true` issues a 30-day refresh token instead of the default 7-day one. The flag is
stored on the session row server-side, so it's carried forward automatically on every subsequent
`refreshSession()` call — no need to keep resending it.

Supported directly (single call, no follow-up needed) on:

```typescript
// Password
await postbase.auth.signInWithPassword({ email, password, rememberMe: true })

// Magic link / 6-digit OTP verify
await postbase.auth.verifyOtp({ email, token: '123456', rememberMe: true })

// Email OTP verify (/email-otp/verify flow)
await postbase.auth.verifyEmailOtp({ email, code: '123456', rememberMe: true })

// Native id-token sign-in — Apple / Google native SDKs (requires postbasejs >= 0.5.16)
await postbase.auth.signInWithIdToken({ provider: 'apple', idToken, rememberMe: true })
await postbase.auth.signInWithIdToken({ provider: 'google', idToken, rememberMe: true })
```

**Browser/in-app-browser OAuth redirects are the one exception.** `signInWithOAuth` +
`handleOAuthCallback` (Google, LinkedIn, GitHub, etc. via a redirect) have no request body at the
point the session is first issued — the tokens come back as URL query params on the callback, not
from a call you control. Use `setRememberMe` afterwards instead — it re-issues the current
session's refresh token with the right TTL, and works regardless of how the session was created:

```typescript
// After OAuth login, or whenever a user toggles a "remember me" checkbox
const { data, error } = await postbase.auth.setRememberMe(true)
// data.session.refreshToken is now valid for 30 days
```

#### OAuth + remember me (Google, LinkedIn, GitHub, etc.)

Since the browser navigates away to the provider and back, the checkbox state won't survive the
round trip on its own — stash it (`sessionStorage` is fine, same tab, cleared on close) before
redirecting, then apply it on the callback page once the session exists:

```typescript
// Login page — stash intent before redirecting
async function handleGoogleLogin(rememberMe: boolean) {
  sessionStorage.setItem('pb_remember_me', String(rememberMe))
  await postbase.auth.signInWithOAuth({
    provider: 'google', // same pattern for 'linkedin', 'github', etc.
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
}
```

```typescript
// app/auth/callback/page.tsx — apply it once the session exists
const { data, error } = await postbase.auth.handleOAuthCallback()
if (data.session) {
  const wantsRememberMe = sessionStorage.getItem('pb_remember_me') === 'true'
  sessionStorage.removeItem('pb_remember_me')

  if (wantsRememberMe) {
    await postbase.auth.setRememberMe(true)
  }
}
router.push('/dashboard')
```

Only call `setRememberMe` when the flag is `true` — the server default is already 7 days, so
there's nothing to change when the user didn't opt in.

**If you're also persisting the session server-side via `setSession()`** (see below), call
`setRememberMe` *before* forwarding to your API route, and forward the updated session it
returns. `setSession()` derives the cookie's `maxAge` from `session.expiresAt`, so passing the
post-`setRememberMe` session gives the cookie the correct 30-day lifetime from the start:

```typescript
const { data } = await postbase.auth.handleOAuthCallback()
if (data.session) {
  const wantsRememberMe = sessionStorage.getItem('pb_remember_me') === 'true'
  sessionStorage.removeItem('pb_remember_me')

  let session = data.session
  if (wantsRememberMe) {
    const { data: updated } = await postbase.auth.setRememberMe(true)
    if (updated.session) session = updated.session
  }

  await fetch('/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
    credentials: 'include',
  })
}
router.push('/dashboard')
```

#### Mobile apps (React Native / Expo / native iOS-Android)

Two different flows, two different amounts of ceremony:

- **Native Sign-In SDKs** (Apple `ASAuthorizationController`, Google `GIDSignIn`) → use
  `signInWithIdToken({ ..., rememberMe })` directly, same as above. No redirect involved, so no
  `sessionStorage`-style stash is needed — just hold the checkbox value in normal component state
  and pass it straight through.
- **In-app-browser OAuth** (`WebBrowser.openAuthSessionAsync` + `signInWithOAuth` /
  `handleOAuthCallback({ url })`) → same limitation as browser OAuth: no request body at
  token-issue time, so use `setRememberMe(true)` after `handleOAuthCallback` resolves. The app
  process stays alive through the whole flow (it's not a full page navigation), so an in-memory
  variable works fine here too — no persistent storage required just to survive the round trip.

### Get current user

```typescript
const { data: { user }, error } = await postbase.auth.getUser()
```

> **v0.5.9 fix:** on a `createServerClient` (SSR), `getUser()` previously ignored the `cookieAdapter` and always returned `{ user: null }`, even with a valid session cookie — `getSession()` worked correctly but `getUser()` silently reported "logged out" on every server request. Upgrade to ≥ 0.5.9 if you saw this in Server Components, Route Handlers, or middleware.

### Get current session

```typescript
const { data: { session }, error } = await postbase.auth.getSession()
// session.accessToken, session.user, session.expiresAt
```

### Sign out

```typescript
await postbase.auth.signOut()
```

### Update user

```typescript
const { data, error } = await postbase.auth.updateUser({
  name: 'Alice',
  metadata: { plan: 'pro' },
})
```

### Listen to auth state changes

```typescript
const { data: { subscription } } = postbase.auth.onAuthStateChange((event, session) => {
  // event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
  console.log(event, session)
})

// Cleanup
subscription.unsubscribe()
```

### Admin (service role key required)

```typescript
const adminClient = createClient(url, 'pb_service_your_service_key', { projectId: 'your-project-id' })

// List users
const { data } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 50 })

// Create user
const { data } = await adminClient.auth.admin.createUser({
  email: 'new@example.com',
  password: 'password',
  email_confirm: true,
})

// Update user
await adminClient.auth.admin.updateUserById(userId, { email: 'new@example.com' })

// Delete user
await adminClient.auth.admin.deleteUser(userId)
```

---

## Storage

### Upload a file

Pass `contentType` to ensure the correct MIME type is stored with the file. This is required for binary uploads (PNG, PDF, etc.) — without it the server may store the file without a content type.

```typescript
// Browser — File/Blob from an <input type="file">
const { data, error } = await postbase
  .storage
  .from('avatars')
  .upload('user-123.png', file, { contentType: 'image/png' })
// data.path, data.fullPath

// Node.js — Buffer from an API route
const { data, error } = await postbase
  .storage
  .from('avatars')
  .upload('user-123.png', imageBuffer, { contentType: 'image/png' })

// Upsert (overwrite an existing file)
const { data, error } = await postbase
  .storage
  .from('avatars')
  .upload('user-123.png', file, { contentType: 'image/png', upsert: true })
```

> **v0.5.8 fix:** `contentType` was silently ignored in earlier versions. Upgrade to 0.5.8 if binary uploads were stored without the correct MIME type.

### Get public URL

```typescript
const { data: { publicUrl } } = postbase
  .storage
  .from('avatars')
  .getPublicUrl('user-123.png')
```

### Download a file

```typescript
const { data: blob, error } = await postbase
  .storage
  .from('avatars')
  .download('user-123.png')
```

### Create a signed URL (temporary access)

```typescript
const { data, error } = await postbase
  .storage
  .from('private-docs')
  .createSignedUrl('report.pdf', 3600) // expires in 1 hour
// data.signedUrl
```

### List files

```typescript
const { data, error } = await postbase
  .storage
  .from('avatars')
  .list('folder/', { limit: 100, sortBy: { column: 'name', order: 'asc' } })
```

### Delete files

```typescript
const { error } = await postbase
  .storage
  .from('avatars')
  .remove(['user-123.png', 'user-456.png'])
```

### Move / Copy

```typescript
await postbase.storage.from('docs').move('old-name.pdf', 'new-name.pdf')
await postbase.storage.from('docs').copy('template.pdf', 'copy.pdf')
```

### Bucket management

```typescript
// Create
await postbase.storage.createBucket('avatars', {
  public: true,
  fileSizeLimit: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: ['image/png', 'image/jpeg'],
})

// List
const { data: buckets } = await postbase.storage.listBuckets()

// Update
await postbase.storage.updateBucket('avatars', { public: false })

// Delete
await postbase.storage.deleteBucket('avatars')

// Empty (delete all objects)
await postbase.storage.emptyBucket('avatars')
```

---

## RPC (PostgreSQL functions)

Call a stored procedure or function in your project's schema:

```typescript
const { data, error } = await postbase.rpc('get_nearby_posts', {
  lat: 37.7749,
  lng: -122.4194,
  radius: 10,
})
```

---

## Email

Send a transactional email using your project's configured email provider (e.g. AWS SES).

> **Server note:** SES SMTP authentication with raw IAM access keys (`ses_access_key_id` / `ses_secret_access_key`) requires **postbase server ≥ 0.3.6**. Earlier server versions sent the raw IAM secret access key as the SMTP password instead of deriving the SigV4-based SES SMTP password, causing `535 Authentication Credentials Invalid`. Upgrade your postbase server instance if you see this error.

```typescript
const { data, error } = await postbase.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  text: 'Hello there',
  html: '<p>Hello there</p>',
})
// data.ok
```

---

## SSR (Server-Side Rendering)

For Next.js App Router, SvelteKit, Nuxt, or any SSR framework, import from `postbasejs/ssr`. This forwards the user's session cookie to Postbase so that RLS policies apply server-side.

```bash
# No extra install needed — it's included in postbasejs
```

### Next.js App Router

**Server Component:**

```typescript
import { createServerClient } from 'postbasejs/ssr'
import { cookies } from 'next/headers'

export default async function Page() {
  const cookieStore = await cookies()

  const postbase = createServerClient(
    process.env.NEXT_PUBLIC_POSTBASE_URL!,
    process.env.NEXT_PUBLIC_POSTBASE_ANON_KEY!,
    {
      projectId: process.env.NEXT_PUBLIC_POSTBASE_PROJECT_ID!,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // read-only in server components
      },
    }
  )

  const { data: posts } = await postbase.from('posts').select('*')
  return <ul>{posts?.map(p => <li key={p.id}>{p.title}</li>)}</ul>
}
```

**Middleware (session refresh + route protection):**

```typescript
// middleware.ts
import { createServerClient } from 'postbasejs/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  const postbase = createServerClient(
    process.env.NEXT_PUBLIC_POSTBASE_URL!,
    process.env.NEXT_PUBLIC_POSTBASE_ANON_KEY!,
    {
      projectId: process.env.NEXT_PUBLIC_POSTBASE_PROJECT_ID!,
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) =>
          cookies.forEach(c => res.cookies.set(c.name, c.value, c.options as any)),
      },
    }
  )

  const { data: { session } } = await postbase.auth.getSession() // refreshes token if needed

  // Protect routes — redirect unauthenticated users to login
  if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/auth/login', req.url))
  }

  return res
}
```

> The session cookie is named `postbase-session` and is set by `auth.setSession()`. Do **not** read it manually — always use `createServerClient` + `auth.getSession()` so token refresh is handled automatically.

**Client Component:**

```typescript
'use client'
import { createBrowserClient } from 'postbasejs/ssr'

const postbase = createBrowserClient(
  process.env.NEXT_PUBLIC_POSTBASE_URL!,
  process.env.NEXT_PUBLIC_POSTBASE_ANON_KEY!,
  { projectId: process.env.NEXT_PUBLIC_POSTBASE_PROJECT_ID! }
)
```

---

## TypeScript

The SDK is fully typed. Pass your row type as a generic for full IntelliSense:

```typescript
interface Post {
  id: string
  title: string
  status: 'draft' | 'published'
  created_at: string
}

const { data } = await postbase.from<Post>('posts').select('*').eq('status', 'published')
// data is Post[] | null
```

---

## Row Level Security (RLS)

When a user is signed in, their session JWT is automatically forwarded with every query. Your RLS policies can reference the user via:

```sql
current_setting('postbase.user_id', true)  -- the authenticated user's ID
current_setting('postbase.role', true)     -- the user's role
```

Example policy — users can only read their own rows:

```sql
CREATE POLICY "own rows" ON posts
  FOR SELECT USING (
    user_id = current_setting('postbase.user_id', true)::uuid
  );
```

---

## Environment Variables

We recommend storing your Postbase credentials in environment variables:

```bash
NEXT_PUBLIC_POSTBASE_URL=https://your-postbase-instance.com
NEXT_PUBLIC_POSTBASE_ANON_KEY=pb_anon_...
NEXT_PUBLIC_POSTBASE_PROJECT_ID=your-project-id
```

Use your **service role key** (`pb_service_...`) only in server-side code — it bypasses RLS.

---

## License

MIT — see [LICENSE](https://github.com/postbase/postbase/blob/main/LICENSE).

---

Built with love by the [Postbase](https://www.getpostbase.com) team.
