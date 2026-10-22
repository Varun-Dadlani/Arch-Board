import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { nodeCatalog } from './catalog.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = import.meta.env.VITE_WS_URL || API_URL.replace(/^http/, 'ws')
const TOKEN_KEY = 'archboard_access_token'
const THEME_KEY = 'archboard_theme'
const emptyDocument = { nodes: [], edges: [] }

function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function authHeaders(includeJson = false) {
  const token = getAccessToken()
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function makeNode(item, index) {
  return {
    id: crypto.randomUUID(),
    type: 'default',
    position: { x: 120 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 140 },
    data: { label: item.label, kind: item.kind, technology: item.technology },
    style: { borderRadius: 10, border: '1px solid #52627a', padding: 10 },
  }
}

function normalizeDocument(document) {
  return {
    nodes: Array.isArray(document?.nodes) ? document.nodes : [],
    edges: Array.isArray(document?.edges) ? document.edges : [],
  }
}

function sendSocketMessage(socketRef, message) {
  if (socketRef.current?.readyState === WebSocket.OPEN) {
    socketRef.current.send(JSON.stringify(message))
  }
}

function draftStorageKey(boardId) {
  return `archboard_draft_${boardId}`
}

function readStoredDraft(boardId) {
  try {
    const raw = sessionStorage.getItem(draftStorageKey(boardId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.document) return null
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      document: normalizeDocument(parsed.document),
    }
  } catch {
    return null
  }
}

function writeStoredDraft(boardId, draft) {
  try {
    sessionStorage.setItem(draftStorageKey(boardId), JSON.stringify(draft))
  } catch {}
}

function clearStoredDraft(boardId) {
  try {
    sessionStorage.removeItem(draftStorageKey(boardId))
  } catch {}
}

export default function App() {
  const [board, setBoard] = useState(null)
  const [boards, setBoards] = useState([])
  const [nodes, setNodes] = useNodesState([])
  const [edges, setEdges] = useEdgesState([])
  const [name, setName] = useState('Untitled architecture')
  const [status, setStatus] = useState('Create a board to start collaborating.')
  const [boilerplate, setBoilerplate] = useState(null)
  const [boilerplateCollapsed, setBoilerplateCollapsed] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark')

  const [showMemberModal, setShowMemberModal] = useState(false)
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('editor')
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [memberSuccess, setMemberSuccess] = useState('')

  const socketRef = useRef(null)
  const documentRef = useRef(emptyDocument)
  const boardCacheRef = useRef({})
  const deletedBoardIdsRef = useRef(new Set())
  const boardListRequestRef = useRef(0)
  const boardLoadRef = useRef(0)
  const hydratedBoardRef = useRef(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    documentRef.current = { nodes, edges }
  }, [nodes, edges])

  useEffect(() => {
    if (!board || hydratedBoardRef.current !== board.id || !dirtyRef.current) return
    writeStoredDraft(board.id, { name, document: { nodes, edges } })
  }, [board, name, nodes, edges])

  const logout = useCallback(() => {
    dirtyRef.current = false
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    localStorage.removeItem(TOKEN_KEY)
    setAuthUser(null)
    setBoard(null)
    setBoards([])
    setNodes([])
    setEdges([])
    setBoilerplate(null)
    setBoilerplateCollapsed(false)
    hydratedBoardRef.current = null
    setStatus('Signed out.')
  }, [setEdges, setNodes])

  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthError('')

    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
    const payload = authMode === 'login'
      ? { email: authForm.email, password: authForm.password }
      : authForm

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Authentication failed')
      }

      if (authMode === 'register') {
        setAuthMode('login')
        setAuthForm({ username: '', email: authForm.email, password: '' })
        setStatus('Account created. Sign in to continue.')
        return
      }

      const token = await response.json()
      localStorage.setItem(TOKEN_KEY, token.access_token)

      const userResponse = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (!userResponse.ok) throw new Error('Could not load your account')

      const user = await userResponse.json()
      setAuthUser(user)
      setAuthForm({ username: '', email: '', password: '' })
      setStatus('Signed in.')
    } catch (error) {
      setAuthError(error.message || 'Authentication failed')
    }
  }

  const addBoardMember = async () => {
    if (!board) return

    const userId = memberUserId.trim()
    if (!userId) {
      setMemberError('Please enter the user ID.')
      return
    }

    setMemberLoading(true)
    setMemberError('')
    setMemberSuccess('')

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/members`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ user_id: userId, role: memberRole }),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('Only the board owner can add members.')
      if (response.status === 400) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'User is already a member of this board.')
      }
      if (response.status === 422) throw new Error('Invalid user ID. Please enter a valid UUID.')
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Could not add member.')
      }

      setMemberSuccess('Member added successfully.')
      setMemberUserId('')
    } catch (error) {
      console.error('Failed to add board member:', error)
      setMemberError(error.message || 'Could not add member.')
    } finally {
      setMemberLoading(false)
    }
  }

  const closeMemberModal = () => {
    if (memberLoading) return
    setShowMemberModal(false)
    setMemberUserId('')
    setMemberRole('editor')
    setMemberError('')
    setMemberSuccess('')
  }

  const onConnect = useCallback((connection) => {
    dirtyRef.current = true
    setEdges(current => {
      const next = addEdge({ ...connection, animated: true }, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: documentRef.current.nodes, edges: next },
      })
      return next
    })
  }, [setEdges])

  const handleNodesChange = useCallback((changes) => {
    dirtyRef.current = true
    setNodes(current => {
      const next = applyNodeChanges(changes, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: next, edges: documentRef.current.edges },
      })
      return next
    })
  }, [setNodes])

  const handleEdgesChange = useCallback((changes) => {
    dirtyRef.current = true
    setEdges(current => {
      const next = applyEdgeChanges(changes, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: documentRef.current.nodes, edges: next },
      })
      return next
    })
  }, [setEdges])

  const loadBoards = useCallback(async () => {
    const requestId = ++boardListRequestRef.current

    try {
      const response = await fetch(`${API_URL}/boards`, { headers: authHeaders() })
      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) throw new Error('Could not load boards')

      const loadedBoards = await response.json()
      if (requestId !== boardListRequestRef.current) return

      const filteredBoards = loadedBoards.filter(
        savedBoard => !deletedBoardIdsRef.current.has(savedBoard.id)
      )

      setBoards(filteredBoards)
      filteredBoards.forEach(savedBoard => {
        boardCacheRef.current[savedBoard.id] = savedBoard
      })
    } catch (error) {
      console.error('Could not load boards:', error)
      if (requestId === boardListRequestRef.current) {
        setStatus('Could not load your saved boards.')
      }
    }
  }, [logout])

  const createBoard = async () => {
    try {
      dirtyRef.current = false
      const freshBoardName = 'Untitled architecture'
      const response = await fetch(`${API_URL}/boards`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ name: freshBoardName, document: emptyDocument }),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) throw new Error('Could not create board')

      const created = await response.json()
      deletedBoardIdsRef.current.delete(created.id)
      clearStoredDraft(created.id)
      delete boardCacheRef.current[created.id]

      setBoard(created)
      setBoards(current => [created, ...current.filter(item => item.id !== created.id)])
      setNodes([])
      setEdges([])
      documentRef.current = emptyDocument
      setName(freshBoardName)
      setBoilerplate(null)
      setBoilerplateCollapsed(false)
      hydratedBoardRef.current = created.id
      window.history.replaceState({}, '', `?board=${created.id}`)
      setStatus('Board created. Live collaboration connected.')
    } catch (error) {
      console.error('Could not create board:', error)
      setStatus(error.message || 'Could not create a new board.')
    }
  }

  const openBoard = useCallback(async boardId => {
    if (!boardId) return

    const loadId = ++boardLoadRef.current

    try {
      const response = await fetch(`${API_URL}/boards/${boardId}`, { headers: authHeaders() })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('You do not have access to this board')
      if (response.status === 404) throw new Error('Board not found')
      if (!response.ok) throw new Error('Could not load board')

      const loadedBoard = await response.json()
      if (loadId !== boardLoadRef.current) return

      const cachedDraft = boardCacheRef.current[boardId]
      const storedDraft = readStoredDraft(boardId)
      const draft = cachedDraft || storedDraft
      const initialDocument = draft?.document || normalizeDocument(loadedBoard.document)
      const initialName = draft?.name ?? loadedBoard.name

      dirtyRef.current = Boolean(draft)
      setBoard(loadedBoard)
      setBoilerplate(null)
      setName(initialName)
      setNodes(initialDocument.nodes)
      setEdges(initialDocument.edges)
      documentRef.current = initialDocument
      hydratedBoardRef.current = boardId
      window.history.replaceState({}, '', `?board=${loadedBoard.id}`)
      setStatus(draft ? 'Restoring board. Connecting to live state...' : 'Connecting to live board...')
    } catch (error) {
      console.error('Could not open board:', error)
      setStatus(error.message || 'Could not load board.')
    }
  }, [logout, setEdges, setNodes])

  const saveBoard = async () => {
    if (!board) return

    try {
      const boardId = board.id
      const response = await fetch(`${API_URL}/boards/${boardId}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ name, document: documentRef.current }),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('You do not have permission to save this board')
      if (!response.ok) throw new Error('Could not save board')

      const updatedBoard = await response.json()
      setBoard(updatedBoard)
      setBoards(current => current.map(currentBoard =>
        currentBoard.id === updatedBoard.id ? updatedBoard : currentBoard
      ))
      delete boardCacheRef.current[boardId]
      clearStoredDraft(boardId)
      dirtyRef.current = false
      setStatus('Saved.')
    } catch (error) {
      console.error('Could not save board:', error)
      setStatus(error.message || 'Could not save board.')
    }
  }

  const handleBoardSelection = async nextBoardId => {
    if (!nextBoardId || nextBoardId === board?.id) return

    if (board && dirtyRef.current) {
      const draft = { name, document: normalizeDocument(documentRef.current) }
      boardCacheRef.current[board.id] = draft
      writeStoredDraft(board.id, draft)
    }

    await openBoard(nextBoardId)
  }

  const deleteBoard = async () => {
    if (!board) return

    const confirmed = window.confirm(`Delete "${board.name}"? This action cannot be undone.`)
    if (!confirmed) return

    try {
      const boardId = board.id
      boardListRequestRef.current += 1

      const response = await fetch(`${API_URL}/boards/${boardId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('Only the board owner can delete this board')
      if (!response.ok) throw new Error('Could not delete board')

      deletedBoardIdsRef.current.add(boardId)
      delete boardCacheRef.current[boardId]
      clearStoredDraft(boardId)
      setBoards(current => current.filter(savedBoard => savedBoard.id !== boardId))

      dirtyRef.current = false
      boardLoadRef.current += 1
      hydratedBoardRef.current = null

      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }

      setBoard(null)
      setBoilerplate(null)
      setName('Untitled architecture')
      setNodes([])
      setEdges([])
      documentRef.current = emptyDocument
      window.history.replaceState({}, '', window.location.pathname)
      setStatus('Board deleted.')
    } catch (error) {
      console.error('Could not delete board:', error)
      alert(error.message || 'Could not delete board.')
      setStatus(error.message || 'Could not delete board.')
    }
  }

  const createBoilerplate = async () => {
    if (!board) return

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ document: documentRef.current }),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('You do not have permission to generate boilerplate')
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Could not generate boiler code (${response.status}): ${detail}`)
      }

      setBoilerplate(await response.json())
      setStatus('Boiler code generated.')
    } catch (error) {
      console.error('Boilerplate generation failed:', error)
      setStatus(error.message || 'Could not generate boiler code.')
    }
  }

  const downloadBoilerplate = async () => {
    if (!boilerplate || !board) return

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate/download`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ document: documentRef.current }),
      })

      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('You do not have permission to download boilerplate')
      if (!response.ok) throw new Error(`Could not download boiler code (${response.status})`)

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${boilerplate.project_name}-boilerplate.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Boilerplate download failed:', error)
      setStatus(error.message || 'Could not download boiler code.')
    }
  }

  const addNode = item => {
    dirtyRef.current = true
    const next = makeNode(item, nodes.length)

    setNodes(current => {
      const updated = [...current, next]
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: updated, edges: documentRef.current.edges },
      })
      return updated
    })
  }

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setAuthReady(true)
      return
    }

    fetch(`${API_URL}/auth/me`, { headers: authHeaders() })
      .then(response => {
        if (!response.ok) throw new Error('Session expired')
        return response.json()
      })
      .then(setAuthUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setAuthReady(true))
  }, [])

  useEffect(() => {
    if (!board || !authReady || !authUser) return undefined

    const boardId = board.id
    const token = getAccessToken()

    if (!token) {
      setStatus('Authentication required for live collaboration.')
      return undefined
    }

    const socketUrl = `${WS_URL}/ws/boards/${boardId}?token=${encodeURIComponent(token)}`
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket

    socket.onopen = () => {
      console.log(`WebSocket connected for board ${boardId}`)
    }

    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'presence') return

        if (message.type === 'document:load' && message.document) {
          const document = normalizeDocument(message.document)
          setNodes(document.nodes)
          setEdges(document.edges)
          documentRef.current = document
          dirtyRef.current = false
          setStatus('Board loaded successfully.')
          return
        }

        if (message.type === 'document:update' && message.document) {
          const document = normalizeDocument(message.document)
          setNodes(document.nodes)
          setEdges(document.edges)
          documentRef.current = document
          setStatus('Board updated by a teammate.')
        }
      } catch (error) {
        console.error('Invalid WebSocket message:', error)
      }
    }

    socket.onerror = () => {
      setStatus('Live connection unavailable; changes can still be saved.')
    }

    socket.onclose = event => {
      console.log(`WebSocket disconnected for board ${boardId}`, event.code)
      if (event.code === 1008) setStatus('You do not have access to this board.')
      if (socketRef.current === socket) socketRef.current = null
    }

    return () => {
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
  }, [authReady, authUser, board, setEdges, setNodes])

  useEffect(() => {
    if (!authReady || !authUser) return

    const boardId = new URLSearchParams(window.location.search).get('board')
    if (!boardId || hydratedBoardRef.current === boardId) return

    openBoard(boardId)
  }, [authReady, authUser, openBoard])

  useEffect(() => {
    if (!authReady || !authUser) return
    loadBoards()
  }, [authReady, authUser, loadBoards])

  if (!authReady) {
    return (
      <main className="auth-page">
        <div className="auth-card loading-card">
          <div className="brand"><span>ARCH</span>-BOARD</div>
          <p>Loading your workspace...</p>
        </div>
      </main>
    )
  }

  if (!authUser) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-kicker">Workspace for system thinkers</div>
          <div className="brand"><span>ARCH</span>-BOARD</div>
          <p className="auth-lead">Map your architecture, align your team, and leave with a working starting point.</p>

          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError('') }}>Sign in</button>
            <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError('') }}>Register</button>
          </div>

          <form onSubmit={submitAuth}>
            {authMode === 'register' && (
              <label>
                Username
                <input
                  value={authForm.username}
                  onChange={event => setAuthForm({ ...authForm, username: event.target.value })}
                  placeholder="Your name"
                  minLength="1"
                  maxLength="160"
                  required
                />
              </label>
            )}

            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={event => setAuthForm({ ...authForm, email: event.target.value })}
                placeholder="you@company.com"
                maxLength="320"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={event => setAuthForm({ ...authForm, password: event.target.value })}
                placeholder="8 or more characters"
                minLength="8"
                maxLength="128"
                required
              />
            </label>

            <button className="primary auth-submit" type="submit">
              {authMode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {authError && <p className="auth-error">{authError}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand"><span>ARCH</span>-BOARD</div>
            <div className="workspace-label">ARCHITECTURE WORKSPACE</div>
          </div>
        </div>

        <p className="subtitle">Design the system. Generate the starting point.</p>

        <div className="catalog-heading">
          <span>Component library</span>
          <small>{nodeCatalog.reduce((total, section) => total + section.items.length, 0)} components</small>
        </div>

        {nodeCatalog.map(section => (
          <section key={section.group}>
            <h2>{section.group}</h2>
            {section.items.map(item => (
              <button className="node-button" key={item.technology} onClick={() => addNode(item)} disabled={!board}>
                <span>{item.label}</span>
                <small>{item.kind}</small>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="board-title">
            <span className="eyebrow">CURRENT BOARD</span>
            <input
              value={name}
              onChange={event => { dirtyRef.current = true; setName(event.target.value) }}
              aria-label="Board name"
            />
          </div>

          <div className="actions">
            <div className="account-chip">
              <span className="avatar">{authUser.username.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{authUser.username}</strong>
                <small>Architect</small>
              </div>
              <button className="text-button" onClick={logout}>Sign out</button>
            </div>

            <button
              className="theme-toggle"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>

            <select
              className="board-picker"
              value={board?.id || 'new-board'}
              onChange={event => {
                const nextSelection = event.target.value
                if (nextSelection === 'new-board') {
                  createBoard()
                  return
                }
                handleBoardSelection(nextSelection)
              }}
              aria-label="Select a board or create a new one"
            >
              <option value="new-board">+ New board</option>
              {boards.map(savedBoard => (
                <option key={savedBoard.id} value={savedBoard.id}>{savedBoard.name}</option>
              ))}
            </select>

            {board && <button className="secondary danger-button" onClick={deleteBoard}>Delete board</button>}
            {!board && <button className="primary" onClick={createBoard}>+ Create board</button>}

            {board && (
              <button
                className="secondary"
                onClick={() => { setMemberError(''); setMemberSuccess(''); setShowMemberModal(true) }}
              >
                Add members
              </button>
            )}

            {board && <button className="secondary" onClick={createBoilerplate}>Generate code</button>}
            {board && <button className="primary" onClick={saveBoard}>Save changes</button>}
          </div>
        </header>

        {showMemberModal && (
          <div
            className="member-modal-overlay"
            onMouseDown={event => { if (event.target === event.currentTarget) closeMemberModal() }}
          >
            <section className="member-modal" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
              <div className="member-modal-header">
                <div>
                  <span className="eyebrow">BOARD ACCESS</span>
                  <h2 id="member-modal-title">Add members</h2>
                  <p>Add a user to <strong>{board?.name}</strong>.</p>
                </div>
                <button className="modal-close" onClick={closeMemberModal} disabled={memberLoading} aria-label="Close">×</button>
              </div>

              <div className="member-form">
                <label>
                  User ID
                  <input
                    value={memberUserId}
                    onChange={event => { setMemberUserId(event.target.value); setMemberError(''); setMemberSuccess('') }}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    disabled={memberLoading}
                    autoFocus
                  />
                  <small>Enter the user's UUID.</small>
                </label>

                <label>
                  Role
                  <select value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={memberLoading}>
                    <option value="editor">Editor</option>
                  </select>
                </label>

                {memberError && <div className="member-error">{memberError}</div>}
                {memberSuccess && <div className="member-success">{memberSuccess}</div>}

                <div className="member-modal-actions">
                  <button className="primary" onClick={addBoardMember} disabled={memberLoading || !memberUserId.trim()}>
                    {memberLoading ? 'Adding...' : 'Add member'}
                  </button>
                  <button className="secondary" onClick={closeMemberModal} disabled={memberLoading}>Close</button>
                </div>
              </div>
            </section>
          </div>
        )}

        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            fitView
          >
            <Background gap={20} size={1} />
            <Controls showFitView={false} showInteractive={false} />
          </ReactFlow>

          {!board && (
            <div className="canvas-empty">
              <div className="empty-icon">+</div>
              <h1>Start with a new board</h1>
              <p>Create a board to begin mapping your system architecture.</p>
              <button className="primary" onClick={createBoard}>Create your first board</button>
            </div>
          )}
        </div>

        {boilerplate && (
          <section className={`boilerplate-panel ${boilerplateCollapsed ? 'is-collapsed' : ''}`}>
            <div className="boilerplate-heading">
              <div>
                <span className="eyebrow">GENERATED STARTER</span>
                <strong>{boilerplate.project_name}</strong>
                <span>{boilerplate.technologies.join(', ') || 'No technologies selected'}</span>
              </div>

              <button
                className="panel-toggle"
                onClick={() => setBoilerplateCollapsed(current => !current)}
                aria-expanded={!boilerplateCollapsed}
                aria-label={boilerplateCollapsed ? 'Expand generated starter' : 'Minimize generated starter'}
                title={boilerplateCollapsed ? 'Expand panel' : 'Minimize panel'}
              >
                {boilerplateCollapsed ? 'Expand' : 'Minimize'}
                <span aria-hidden="true">{boilerplateCollapsed ? '⌃' : '⌄'}</span>
              </button>

              <button className="secondary" onClick={downloadBoilerplate}>Download bundle</button>
            </div>

            {!boilerplateCollapsed && (
              <ul>
                {Object.keys(boilerplate.files).map(file => <li key={file}>{file}</li>)}
              </ul>
            )}
          </section>
        )}

        <footer className="status">
          <span className={board ? 'online-dot' : 'offline-dot'} />
          {status}
        </footer>
      </section>
    </main>
  )
}
