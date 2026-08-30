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
  const socketRef = useRef(null)
  const documentRef = useRef({ nodes: [], edges: [] })
  const boardCacheRef = useRef({}) // Cache for unsaved state per board

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    documentRef.current = { nodes, edges }
  }, [nodes, edges])

  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthError('')
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
    const payload = authMode === 'login'
      ? { email: authForm.email, password: authForm.password }
      : authForm
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
    setAuthUser(await userResponse.json())
    setAuthForm({ username: '', email: '', password: '' })
    setStatus('Signed in.')
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setAuthUser(null)
    setBoard(null)
    setBoards([])
    setNodes([])
    setEdges([])
    setBoilerplate(null)
    setBoilerplateCollapsed(false)
    setStatus('Signed out.')
  }

  const onConnect = useCallback((connection) => {
    setEdges((current) => {
      const next = addEdge({ ...connection, animated: true }, current)
      sendSocketMessage(socketRef, { type: 'document:update', document: { nodes: documentRef.current.nodes, edges: next } })
      return next
    })
  }, [])

  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current)
      sendSocketMessage(socketRef, { type: 'document:update', document: { nodes: next, edges: documentRef.current.edges } })
      return next
    })
  }, [])

  const handleEdgesChange = useCallback((changes) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current)
      sendSocketMessage(socketRef, { type: 'document:update', document: { nodes: documentRef.current.nodes, edges: next } })
      return next
    })
  }, [])

  const createBoard = async () => {
    const freshBoardName = 'Untitled architecture'
    setName(freshBoardName)
    setNodes([])
    setEdges([])
    documentRef.current = emptyDocument

    const response = await fetch(`${API_URL}/boards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: freshBoardName, document: emptyDocument }),
    })
    if (!response.ok) throw new Error('Could not create board')
    const created = await response.json()
    setBoard(created)
    setBoards((current) => [created, ...current])
    setBoilerplate(null)
    setBoilerplateCollapsed(false)
    setName(freshBoardName)
    window.history.replaceState({}, '', `?board=${created.id}`)
    setStatus('Board created. Live collaboration connected.')
  }

  const copyBoardLink = async () => {
    if (!board) return
    const link = `${window.location.origin}${window.location.pathname}?board=${board.id}`
    await navigator.clipboard.writeText(link)
    setStatus('Share link copied.')
  }

  const openBoard = useCallback(async (boardId) => {
    if (!boardId) return
    const response = await fetch(`${API_URL}/boards/${boardId}`)
    if (!response.ok) throw new Error('Board not found')
    const loadedBoard = await response.json()
    let document = normalizeDocument(loadedBoard.document)
    
    // Check if we have cached unsaved state for this board
    if (boardCacheRef.current[boardId]) {
      document = boardCacheRef.current[boardId]
    }
    
    setBoard(loadedBoard)
    setBoilerplate(null)
    setName(loadedBoard.name)
    setNodes(document.nodes)
    setEdges(document.edges)
    documentRef.current = document
    window.history.replaceState({}, '', `?board=${loadedBoard.id}`)
    setStatus('Board loaded. Live collaboration connected.')
  }, [setEdges, setNodes])

  const saveBoard = async () => {
    if (!board) return
    const response = await fetch(`${API_URL}/boards/${board.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, document: { nodes, edges } }),
    })
    if (!response.ok) throw new Error('Could not save board')
    const updatedBoard = await response.json()
    setBoard(updatedBoard)
    setBoards((current) => current.map((currentBoard) => currentBoard.id === updatedBoard.id ? updatedBoard : currentBoard))
    // Clear cache when saved
    delete boardCacheRef.current[board.id]
    setStatus('Saved.')
  }

  const handleBoardSelection = async (nextBoardId) => {
    if (!nextBoardId || nextBoardId === board?.id) return
    // Cache current unsaved state before leaving
    if (board) {
      boardCacheRef.current[board.id] = { ...documentRef.current }
    }
    await openBoard(nextBoardId)
  }

  const deleteBoard = async () => {
    if (!board) return
    const confirmed = window.confirm(`Delete "${board.name}"? This action cannot be undone.`)
    if (!confirmed) return

    const response = await fetch(`${API_URL}/boards/${board.id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Could not delete board')

    setBoards((current) => current.filter((savedBoard) => savedBoard.id !== board.id))
    delete boardCacheRef.current[board.id]
    setBoard(null)
    setBoilerplate(null)
    setName('Untitled architecture')
    setNodes([])
    setEdges([])
    window.history.replaceState({}, '', window.location.pathname)
    setStatus('Board deleted.')
  }

  const createBoilerplate = async () => {
    if (!board) return
    const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: { nodes, edges } }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Could not generate boiler code (${response.status}): ${detail}`)
    }
    setBoilerplate(await response.json())
    setStatus('Boiler code generated.')
  }

  const downloadBoilerplate = async () => {
    if (!boilerplate || !board) return
    const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: { nodes, edges } }),
    })
    if (!response.ok) throw new Error(`Could not download boiler code (${response.status})`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${boilerplate.project_name}-boilerplate.zip`
    link.click()
    URL.revokeObjectURL(url)
  }

  const addNode = (item) => {
    const next = makeNode(item, nodes.length)
    setNodes((current) => {
      const updated = [...current, next]
      sendSocketMessage(socketRef, { type: 'document:update', document: { nodes: updated, edges: documentRef.current.edges } })
      return updated
    })
  }

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setAuthReady(true)
      return
    }
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('Session expired')
        return response.json()
      })
      .then(setAuthUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setAuthReady(true))
  }, [])

  useEffect(() => {
    if (!board) return undefined
    if (!authReady || !authUser) return undefined
    const socketUrl = `${WS_URL}/ws/boards/${board.id}`
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket
    
    socket.onopen = () => {
      // When reconnecting, sync current state with other users
      sendSocketMessage(socketRef, { type: 'document:update', document: documentRef.current })
    }
    
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      console.log('WebSocket message:', message)
      if (message.type === 'presence') {
        console.log(`User ${message.event} the board`)
      }
      if (message.type === 'document:update' && message.document) {
        const document = normalizeDocument(message.document)
        setNodes(document.nodes)
        setEdges(document.edges)
        setStatus('Board updated by a teammate.')
      }
    }
    socket.onerror = () => setStatus('Live connection unavailable; changes can still be saved.')
    return () => {
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
  }, [authReady, authUser, board, setEdges, setNodes])

  useEffect(() => {
    const boardId = new URLSearchParams(window.location.search).get('board')
    if (!boardId) return

    openBoard(boardId)
      .catch(() => setStatus('Could not load this board link.'))
  }, [authReady, authUser, openBoard])

  useEffect(() => {
    if (!authReady || !authUser) return
    fetch(`${API_URL}/boards`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load boards')
        return response.json()
      })
      .then(setBoards)
      .catch(() => setStatus('Could not load your saved boards.'))
  }, [authReady, authUser])

  if (!authReady) {
    return <main className="auth-page"><div className="auth-card loading-card"><div className="brand"><span>ARCH</span>-BOARD</div><p>Loading your workspace...</p></div></main>
  }

  if (!authUser) {
    return <main className="auth-page">
      <section className="auth-card">
        <div className="auth-kicker">Workspace for system thinkers</div>
        <div className="brand"><span>ARCH</span>-BOARD</div>
        <p className="auth-lead">Map your architecture, align your team, and leave with a working starting point.</p>
        <div className="auth-tabs">
          <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError('') }}>Sign in</button>
          <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError('') }}>Register</button>
        </div>
        <form onSubmit={(event) => submitAuth(event).catch((error) => setAuthError(error.message))}>
          {authMode === 'register' && <label>Username<input value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} placeholder="Your name" minLength="1" maxLength="160" required /></label>}
          <label>Email<input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="you@company.com" maxLength="320" required /></label>
          <label>Password<input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="8 or more characters" minLength="8" maxLength="128" required /></label>
          <button className="primary auth-submit" type="submit">{authMode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        {authError && <p className="auth-error">{authError}</p>}
      </section>
    </main>
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">A</div><div><div className="brand"><span>ARCH</span>-BOARD</div><div className="workspace-label">ARCHITECTURE WORKSPACE</div></div></div>
        <p className="subtitle">Design the system. Generate the starting point.</p>
        <div className="catalog-heading"><span>Component library</span><small>{nodeCatalog.reduce((total, section) => total + section.items.length, 0)} components</small></div>
        {nodeCatalog.map((section) => (
          <section key={section.group}>
            <h2>{section.group}</h2>
            {section.items.map((item) => (
              <button className="node-button" key={item.technology} onClick={() => addNode(item)} disabled={!board}>
                <span>{item.label}</span><small>{item.kind}</small>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="board-title"><span className="eyebrow">CURRENT BOARD</span><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Board name" /></div>
          <div className="actions">
            <div className="account-chip"><span className="avatar">{authUser.username.slice(0, 1).toUpperCase()}</span><div><strong>{authUser.username}</strong><small>Architect</small></div><button className="text-button" onClick={logout}>Sign out</button></div>
            <button className="theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <select
              className="board-picker"
              value={board?.id || 'new-board'}
              onChange={(event) => {
                const nextSelection = event.target.value
                if (nextSelection === 'new-board') {
                  createBoard().catch(() => setStatus('Could not create a new board.'))
                  return
                }

                handleBoardSelection(nextSelection)
                  .catch(() => setStatus('Could not load this board.'))
              }}
              aria-label="Select a board or create a new one"
            >
              <option value="new-board">+ New board</option>
              {boards.map((savedBoard) => (
                <option key={savedBoard.id} value={savedBoard.id}>
                  {savedBoard.name}
                </option>
              ))}
            </select>
            {board && <button className="secondary danger-button" onClick={() => deleteBoard().catch((error) => setStatus(error.message))}>Delete board</button>}
            {!board && <button className="primary" onClick={createBoard}>+ Create board</button>}
            {board && <button className="secondary" onClick={copyBoardLink}>Share board</button>}
            {board && <button className="secondary" onClick={() => createBoilerplate().catch((error) => {
              console.error('Boilerplate generation failed:', error)
              setStatus(error.message)
            })}>Generate code</button>}
            {board && <button className="primary" onClick={saveBoard}>Save changes</button>}
          </div>
        </header>
        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
            onConnect={onConnect} fitView
          >
            <Background gap={20} size={1} />
            <Controls showFitView={false} showInteractive={false} />
          </ReactFlow>
          {!board && <div className="canvas-empty"><div className="empty-icon">+</div><h1>Start with a new board</h1><p>Create a board to begin mapping your system architecture.</p><button className="primary" onClick={createBoard}>Create your first board</button></div>}
        </div>
        {boilerplate && <section className={`boilerplate-panel ${boilerplateCollapsed ? 'is-collapsed' : ''}`}>
          <div className="boilerplate-heading"><div><span className="eyebrow">GENERATED STARTER</span><strong>{boilerplate.project_name}</strong><span>{boilerplate.technologies.join(', ') || 'No technologies selected'}</span></div>
          <button className="panel-toggle" onClick={() => setBoilerplateCollapsed((current) => !current)} aria-expanded={!boilerplateCollapsed} aria-label={boilerplateCollapsed ? 'Expand generated starter' : 'Minimize generated starter'} title={boilerplateCollapsed ? 'Expand panel' : 'Minimize panel'}>{boilerplateCollapsed ? 'Expand' : 'Minimize'} <span aria-hidden="true">{boilerplateCollapsed ? '⌃' : '⌄'}</span></button>
          <button className="secondary" onClick={() => downloadBoilerplate().catch((error) => {
            console.error('Boilerplate download failed:', error)
            setStatus(error.message)
          })}>Download bundle</button></div>
          {!boilerplateCollapsed && <ul>{Object.keys(boilerplate.files).map((file) => <li key={file}>{file}</li>)}</ul>}
        </section>}
        <footer className="status"><span className={board ? 'online-dot' : 'offline-dot'} />{status}</footer>
      </section>
    </main>
  )
}
