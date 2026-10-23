import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  createLink,
  deleteLink,
  getAnalytics,
  getLink,
  getSession,
  listAllLinks,
  login,
  logout,
  register,
} from './services/api'
import { formatDate, formatDateTime, isExpired, sumClicks, toUtcBoundary } from './utils/format'

const CURRENT_YEAR = new Date().getFullYear()
const DASHBOARD_REFRESH_INTERVAL_MS = 15_000

function App() {
  const [authStatus, setAuthStatus] = useState('loading')
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authView, setAuthView] = useState(() => window.location.pathname === '/register' ? 'register' : 'login')
  const [links, setLinks] = useState([])
  const [pagination, setPagination] = useState({ total: 0 })
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState('')
  const [form, setForm] = useState({ originalUrl: '', expiresAt: '' })
  const [formStatus, setFormStatus] = useState({ type: '', message: '' })
  const [createdCopyState, setCreatedCopyState] = useState('idle')
  const [createdCopyError, setCreatedCopyError] = useState('')
  const createdCopyTimeoutRef = useRef()
  const [copiedId, setCopiedId] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteStatus, setDeleteStatus] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [appliedRange, setAppliedRange] = useState({ from: '', to: '' })
  const selectedRequestRef = useRef(0)
  const refreshInFlightRef = useRef(false)

  useEffect(() => () => window.clearTimeout(createdCopyTimeoutRef.current), [])

  useEffect(() => {
    function syncAuthView() {
      setAuthView(window.location.pathname === '/register' ? 'register' : 'login')
    }

    window.addEventListener('popstate', syncAuthView)
    return () => window.removeEventListener('popstate', syncAuthView)
  }, [])

  function showAuthView(view) {
    const path = view === 'register' ? '/register' : '/'
    window.history.pushState({}, '', path)
    setAuthView(view)
    setAuthError('')
    setSessionError('')
  }

  const handleUnauthorized = useCallback((error) => {
    if (error.status !== 401) return false

    setUser(null)
    setAuthStatus('logged-out')
    setSelectedId('')
    return true
  }, [])

  useEffect(() => {
    let active = true
    getSession()
      .then((result) => {
        if (!active) return
        setUser(result.user)
        setAuthStatus(result.authenticated ? 'authenticated' : 'logged-out')
      })
      .catch((error) => {
        if (!active) return
        setSessionError(error.message)
        setAuthStatus('error')
      })

    return () => { active = false }
  }, [])

  const loadLinks = useCallback(async ({ background = false } = {}) => {
    if (authStatus !== 'authenticated') return
    if (!background) setLibraryLoading(true)
    setLibraryError('')
    try {
      const result = await listAllLinks()
      setLinks(result.items)
      setPagination(result.pagination)
    } catch (error) {
      if (!handleUnauthorized(error)) setLibraryError(error.message)
    } finally {
      if (!background) setLibraryLoading(false)
    }
  }, [authStatus, handleUnauthorized])

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    void loadLinks()
  }, [authStatus, loadLinks])

  const loadSelectedData = useCallback(async ({ background = false } = {}) => {
    if (!selectedId) return

    const requestId = selectedRequestRef.current + 1
    selectedRequestRef.current = requestId
    const isCurrent = () => requestId === selectedRequestRef.current

    if (!background) {
      setDetailLoading(true)
      setDetailError('')
      setAnalyticsLoading(true)
      setAnalyticsError('')
    }

    const detailRequest = getLink(selectedId)
      .then((result) => {
        if (isCurrent()) {
          setDetail(result)
          setDetailError('')
        }
      })
      .catch((error) => {
        if (isCurrent() && !handleUnauthorized(error)) setDetailError(error.message)
      })
      .finally(() => {
        if (isCurrent()) setDetailLoading(false)
      })

    const analyticsRequest = getAnalytics(selectedId, {
      from: toUtcBoundary(appliedRange.from),
      to: toUtcBoundary(appliedRange.to),
    })
      .then((result) => {
        if (isCurrent()) {
          setAnalytics(result)
          setAnalyticsError('')
        }
      })
      .catch((error) => {
        if (isCurrent() && !handleUnauthorized(error)) setAnalyticsError(error.message)
      })
      .finally(() => {
        if (isCurrent()) setAnalyticsLoading(false)
      })

    await Promise.all([detailRequest, analyticsRequest])
  }, [appliedRange, handleUnauthorized, selectedId])

  useEffect(() => {
    if (!selectedId) {
      selectedRequestRef.current += 1
      return undefined
    }

    void loadSelectedData()
    return () => { selectedRequestRef.current += 1 }
  }, [loadSelectedData, selectedId])

  useEffect(() => {
    function refreshDashboard() {
      if (authStatus !== 'authenticated' || document.visibilityState === 'hidden' || refreshInFlightRef.current) return

      refreshInFlightRef.current = true
      const selectedRefresh = selectedId ? loadSelectedData({ background: true }) : Promise.resolve()
      Promise.all([loadLinks({ background: true }), selectedRefresh])
        .finally(() => { refreshInFlightRef.current = false })
    }

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') refreshDashboard()
    }

    const intervalId = window.setInterval(refreshDashboard, DASHBOARD_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshDashboard)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshDashboard)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [authStatus, loadLinks, loadSelectedData, selectedId])

  async function handleLogin(credentials) {
    setAuthError('')
    setAuthNotice('')
    const result = await login(credentials.username, credentials.password)
    setUser(result.user)
    setAuthStatus('authenticated')
  }

  async function handleRegister(credentials) {
    setAuthError('')
    const result = await register(credentials.username, credentials.password)
    setAuthNotice(`Account created for ${result.user.username}. You can sign in now.`)
    showAuthView('login')
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (error) {
      if (error.status !== 401) setAuthError(error.message)
    } finally {
      setUser(null)
      setAuthStatus('logged-out')
      setSelectedId('')
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    setFormStatus({ type: '', message: '' })
    setCreatedCopyState('idle')
    setCreatedCopyError('')
    try {
      const payload = { originalUrl: form.originalUrl.trim() }
      if (form.expiresAt) payload.expiresAt = toUtcBoundary(form.expiresAt)
      const created = await createLink(payload)
      setForm({ originalUrl: '', expiresAt: '' })
      setFormStatus({ type: 'success', message: 'Created', shortUrl: created.shortUrl })
      await loadLinks()
      setSelectedId(created.id)
    } catch (error) {
      if (!handleUnauthorized(error)) setFormStatus({ type: 'error', message: error.message })
    }
  }

  async function handleCreatedCopy() {
    if (!formStatus.shortUrl) return

    try {
      await copyText(formStatus.shortUrl)
      setCreatedCopyState('copied')
      setCreatedCopyError('')
      window.clearTimeout(createdCopyTimeoutRef.current)
      createdCopyTimeoutRef.current = window.setTimeout(() => setCreatedCopyState('idle'), 1800)
    } catch {
      setCreatedCopyError('The short URL could not be copied. Copy it directly from the link above.')
    }
  }

  async function handleCopy(link) {
    try {
      await copyText(link.shortUrl)
      setCopiedId(link.id)
      window.setTimeout(() => setCopiedId(''), 1800)
    } catch {
      setFormStatus({ type: 'error', message: 'The short link could not be copied. Copy it directly from the table.' })
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleteStatus('')
    try {
      await deleteLink(pendingDelete.id)
      if (selectedId === pendingDelete.id) setSelectedId('')
      setPendingDelete(null)
      await loadLinks()
    } catch (error) {
      if (!handleUnauthorized(error)) setDeleteStatus(error.message)
    }
  }

  if (authStatus === 'loading') {
    return <div className="app-shell auth-shell"><p className="loading-state" role="status">Checking your session…</p></div>
  }

  if (authStatus === 'error') {
    return authView === 'register'
      ? <RegisterPage error={sessionError} onSubmit={handleRegister} onBack={() => showAuthView('login')} />
      : <LoginPage error={sessionError} notice={authNotice} onSubmit={handleLogin} onRegister={() => showAuthView('register')} />
  }

  if (authStatus !== 'authenticated') {
    return authView === 'register'
      ? <RegisterPage error={authError} onSubmit={handleRegister} onBack={() => showAuthView('login')} />
      : <LoginPage error={authError} notice={authNotice} onSubmit={handleLogin} onRegister={() => showAuthView('register')} />
  }

  const totalClicks = sumClicks(links)
  const selectedListLink = links.find((link) => link.id === selectedId)
  const isAdmin = user.role === 'admin'

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="LinkVault home">
          <span className="wordmark-mark">LV</span>
          <span>LinkVault</span>
        </a>
        <div className="header-actions">
          <p className="header-note">Signed in as {user.username} / {CURRENT_YEAR}</p>
          <button className="text-button" type="button" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main>
        <section className="intro-grid" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">{isAdmin ? 'ADMIN WORKSPACE / OVERVIEW' : 'PERSONAL WORKSPACE / OVERVIEW'}</p>
            <h1 id="page-title">{isAdmin ? 'Short links, with a clear record.' : 'Your short links, with a clear record.'}</h1>
            <p className="lede">
              Create, share, and inspect redirects from one quiet workspace. Every click shown here is a stored event, not an estimate.
            </p>
          </div>
          <div className="metric-strip" aria-label="Link and click totals">
            <Metric label="Active links" value={pagination.total ?? links.length} />
            <Metric label="Recorded clicks" value={totalClicks} />
          </div>
        </section>

        <aside className="access-note" role="note">
          <span className="note-marker">Note</span>
          <p>This private workspace uses an HttpOnly session cookie. Redirects remain public; {isAdmin ? 'the admin session can manage all links.' : 'your links and analytics are private to your account.'}</p>
        </aside>

        <section className="workspace-grid" aria-label="Link workspace">
          <CreateLinkForm
            form={form}
            setForm={setForm}
            status={formStatus}
            onSubmit={handleCreate}
            copyState={createdCopyState}
            copyError={createdCopyError}
            onCopy={handleCreatedCopy}
          />
          <LinkLibrary
            links={links}
            loading={libraryLoading}
            error={libraryError}
            selectedId={selectedId}
            copiedId={copiedId}
            onRetry={loadLinks}
            onSelect={setSelectedId}
            onCopy={handleCopy}
            onDelete={setPendingDelete}
          />
        </section>

        {(selectedId || detail || selectedListLink) && (
          <AnalyticsPanel
            link={detail || selectedListLink}
            loading={detailLoading}
            error={detailError}
            analytics={analytics}
            analyticsLoading={analyticsLoading}
            analyticsError={analyticsError}
            range={range}
            setRange={setRange}
            onApply={() => setAppliedRange(range)}
            onClose={() => setSelectedId('')}
          />
        )}
      </main>

      {pendingDelete && (
        <DeleteDialog
          link={pendingDelete}
          status={deleteStatus}
          onCancel={() => { setPendingDelete(null); setDeleteStatus('') }}
          onConfirm={handleDelete}
        />
      )}

      <footer className="site-footer">
        <span>LinkVault</span>
        <span>Click totals represent recorded redirect events, not unique visitors.</span>
      </footer>
    </div>
  )
}

function LoginPage({ error, notice, onSubmit, onRegister }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit(credentials)
    } catch (submitError) {
      setSubmitError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell auth-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="LinkVault home">
          <span className="wordmark-mark">LV</span>
          <span>LinkVault</span>
        </a>
        <p className="header-note">A short link desk / {CURRENT_YEAR}</p>
      </header>
      <main className="auth-main">
        <section className="panel auth-panel" aria-labelledby="login-heading">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1 id="login-heading">Sign in to LinkVault.</h1>
          <p className="lede">Manage your redirects and inspect recorded click events from one quiet workspace.</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              name="username"
              autoComplete="username"
              required
              value={credentials.username}
              onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
            />
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
            />
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">↗</span>
            </button>
            <p className="auth-switch">New to LinkVault? <button className="text-button" type="button" onClick={onRegister}>Create an account</button></p>
            {notice && <p className="form-message success" role="status">{notice}</p>}
            {(error || submitError) && <p className="form-message error" role="alert">{error || submitError}</p>}
          </form>
        </section>
      </main>
    </div>
  )
}

function RegisterPage({ error, onSubmit, onBack }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit(credentials)
    } catch (registrationError) {
      setSubmitError(registrationError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell auth-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="LinkVault home">
          <span className="wordmark-mark">LV</span>
          <span>LinkVault</span>
        </a>
        <p className="header-note">A short link desk / {CURRENT_YEAR}</p>
      </header>
      <main className="auth-main">
        <section className="panel auth-panel" aria-labelledby="register-heading">
          <p className="eyebrow">PERSONAL WORKSPACE</p>
          <h1 id="register-heading">Create your account.</h1>
          <p className="lede">Keep your links and recorded click events in a private workspace.</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="register-username">Username</label>
            <input
              id="register-username"
              name="username"
              autoComplete="username"
              minLength="3"
              maxLength="32"
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]"
              required
              value={credentials.username}
              onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
            />
            <p className="field-help">Use 3–32 letters, numbers, dots, hyphens, or underscores.</p>
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength="12"
              maxLength="256"
              required
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
            />
            <p className="field-help">Use at least 12 characters.</p>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'} <span aria-hidden="true">↗</span>
            </button>
            <p className="auth-switch">Already registered? <button className="text-button" type="button" onClick={onBack}>Sign in</button></p>
            {(error || submitError) && <p className="form-message error" role="alert">{error || submitError}</p>}
          </form>
        </section>
      </main>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span className="metric-value">{value.toLocaleString()}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}

function CreateLinkForm({ form, setForm, status, onSubmit, copyState, copyError, onCopy }) {
  return (
    <section className="panel create-panel" aria-labelledby="create-heading">
      <div className="panel-heading">
        <p className="eyebrow">01 / CREATE</p>
        <h2 id="create-heading">Make a new short link.</h2>
      </div>
      <form onSubmit={onSubmit}>
        <label htmlFor="original-url">Destination URL</label>
        <input
          id="original-url"
          name="originalUrl"
          type="url"
          required
          placeholder="https://example.com/article"
          value={form.originalUrl}
          onChange={(event) => setForm({ ...form, originalUrl: event.target.value })}
        />
        <p className="field-help">Only HTTP and HTTPS destinations are accepted.</p>

        <label htmlFor="expires-at">Expires at <span>(optional)</span></label>
        <input
          id="expires-at"
          name="expiresAt"
          type="datetime-local"
          value={form.expiresAt}
          onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
        />
        <p className="field-help">Use your local time; it is stored and evaluated as UTC.</p>

        <button className="button button-primary" type="submit">Create short link <span aria-hidden="true">↗</span></button>
        {status.type === 'success' && status.shortUrl ? (
          <div className="create-success" role="status" aria-live="polite">
            <span className="create-success-label">{status.message}</span>
            <a className="created-short-url" href={status.shortUrl} target="_blank" rel="noreferrer">{status.shortUrl}</a>
            <button
              className={`copy-success-button ${copyState === 'copied' ? 'is-copied' : ''}`}
              type="button"
              onClick={onCopy}
              aria-label={copyState === 'copied' ? 'Copied generated short URL' : 'Copy generated short URL'}
            >
              <span className="copy-success-icon" aria-hidden="true">{copyState === 'copied' ? '✓' : '↗'}</span>
              {copyState === 'copied' ? 'Copied!' : 'Copy'}
            </button>
            {copyError && <span className="create-copy-error" role="alert">{copyError}</span>}
          </div>
        ) : status.message && <p className={`form-message ${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</p>}
      </form>
    </section>
  )
}

function LinkLibrary({ links, loading, error, selectedId, copiedId, onRetry, onSelect, onCopy, onDelete }) {
  return (
    <section className="panel library-panel" aria-labelledby="library-heading">
      <div className="panel-heading library-heading">
        <div>
          <p className="eyebrow">02 / LIBRARY</p>
          <h2 id="library-heading">Your links.</h2>
        </div>
        {!loading && !error && <span className="record-count">{links.length} {links.length === 1 ? 'record' : 'records'}</span>}
      </div>

      {loading && <LoadingState label="Loading your link library…" />}
      {error && <ErrorState message={error} onRetry={onRetry} />}
      {!loading && !error && links.length === 0 && (
        <div className="empty-state">
          <p className="empty-mark">—</p>
          <h3>No links yet.</h3>
          <p>Create your first short link to begin recording redirects.</p>
        </div>
      )}
      {!loading && !error && links.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Destination</th>
                <th scope="col">Short link</th>
                <th scope="col">Clicks</th>
                <th scope="col">Expiry</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const expired = isExpired(link.expiresAt)
                return (
                  <tr className={selectedId === link.id ? 'is-selected' : ''} key={link.id}>
                    <td>
                      <a className="destination" href={link.originalUrl} target="_blank" rel="noreferrer">
                        {link.originalUrl}
                      </a>
                      <span className="date-stamp">Created {formatDate(link.createdAt)}</span>
                    </td>
                    <td>
                      <div className="short-link-cell">
                        <a href={link.shortUrl} target="_blank" rel="noreferrer">/{link.shortCode}</a>
                        <button className="text-button" type="button" onClick={() => onCopy(link)} aria-label={`Copy short link for ${link.shortCode}`}>
                          {copiedId === link.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </td>
                    <td className="click-count">{link.clickCount.toLocaleString()}</td>
                    <td><span className={expired ? 'status status-expired' : 'status'}>{expired ? 'Expired' : link.expiresAt ? formatDate(link.expiresAt) : 'No expiry'}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="text-button" type="button" onClick={() => onSelect(link.id)}>{selectedId === link.id ? 'Viewing' : 'Details'}</button>
                        <button className="text-button danger-text" type="button" onClick={() => onDelete(link)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AnalyticsPanel({ link, loading, error, analytics, analyticsLoading, analyticsError, range, setRange, onApply, onClose }) {
  const rows = analytics?.byDate || []
  const maxClicks = Math.max(...rows.map((row) => row.clicks), 1)
  return (
    <section className="panel detail-panel" aria-labelledby="detail-heading">
      <div className="detail-header">
        <div>
          <p className="eyebrow">03 / DETAIL &amp; ANALYTICS</p>
          <h2 id="detail-heading">Link record.</h2>
        </div>
        <button className="text-button" type="button" onClick={onClose}>Close <span aria-hidden="true">×</span></button>
      </div>

      {loading && <LoadingState label="Loading link details…" />}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!loading && !error && link && (
        <>
          <div className="detail-summary">
            <div className="detail-destination">
              <span className="detail-label">Destination</span>
              <a href={link.originalUrl} target="_blank" rel="noreferrer">{link.originalUrl}</a>
            </div>
            <div><span className="detail-label">Short link</span><a href={link.shortUrl} target="_blank" rel="noreferrer">/{link.shortCode}</a></div>
            <div><span className="detail-label">Created</span><span>{formatDateTime(link.createdAt)}</span></div>
            <div><span className="detail-label">Recorded clicks</span><strong>{link.clickCount.toLocaleString()}</strong></div>
          </div>

          <div className="analytics-heading">
            <div>
              <p className="eyebrow">CLICK EVENTS</p>
              <h3>Activity by UTC day.</h3>
            </div>
            <form className="range-form" onSubmit={(event) => { event.preventDefault(); onApply() }}>
              <label>From <span>(UTC, inclusive)</span><input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
              <label>To <span>(UTC, exclusive)</span><input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
              <button className="button button-secondary" type="submit">Apply range</button>
            </form>
          </div>

          {analyticsLoading && <LoadingState label="Loading click events…" />}
          {analyticsError && <p className="inline-error" role="alert">{analyticsError}</p>}
          {!analyticsLoading && !analyticsError && analytics && (
            <div className="analytics-result">
              <div className="analytics-total"><span>Total in range</span><strong>{analytics.totalClicks.toLocaleString()}</strong><small>{formatDateTime(analytics.range.from)} — {formatDateTime(analytics.range.to)} / end excluded</small></div>
              {rows.length === 0 ? <p className="analytics-empty">No recorded clicks in this range.</p> : (
                <div className="bar-list" aria-label="Recorded clicks by UTC day">
                  {rows.map((row) => <div className="bar-row" key={row.date}><span>{row.date}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(row.clicks / maxClicks) * 100}%` }} /></div><strong>{row.clicks}</strong></div>)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function DeleteDialog({ link, status, onCancel, onConfirm }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-heading">
        <p className="eyebrow">DELETE LINK</p>
        <h2 id="delete-heading">Remove /{link.shortCode}?</h2>
        <p>This will stop future redirects while preserving its recorded click history. The action cannot be undone from this interface.</p>
        {status && <p className="inline-error" role="alert">{status}</p>}
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-danger" type="button" onClick={onConfirm}>Delete link</button></div>
      </section>
    </div>
  )
}

function LoadingState({ label }) {
  return <p className="loading-state" role="status"><span className="loading-dot" aria-hidden="true" />{label}</p>
}

function ErrorState({ message, onRetry }) {
  return <div className="error-state" role="alert"><p>{message}</p><button className="text-button" type="button" onClick={onRetry}>Try again</button></div>
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Copy failed')
}

export default App
