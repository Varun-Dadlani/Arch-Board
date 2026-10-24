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

function mergeChatMessages(current, incoming) {
  const messagesById = new Map(current.map(message => [message.id, message]))
  incoming.forEach(message => messagesById.set(message.id, message))
  return [...messagesById.values()].sort((left, right) =>
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  )
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
  const [name, setName] = useState('')
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false)
  const [createBoardName, setCreateBoardName] = useState('')
  const [createBoardError, setCreateBoardError] = useState('')
  const [isCreatingBoard, setIsCreatingBoard] = useState(false)
  const [isEmptyBoardDialogOpen, setIsEmptyBoardDialogOpen] = useState(false)
  const [status, setStatus] = useState('Create a board to start collaborating.')
  const [boilerplate, setBoilerplate] = useState(null)
  const [boilerplateCollapsed, setBoilerplateCollapsed] = useState(false)
  const [boardRole, setBoardRole] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark')

  const [members, setMembers] = useState([])
  const [activeMemberIds, setActiveMemberIds] = useState(new Set())
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('editor')
  const [memberLoading, setMemberLoading] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState(null)
  const [memberMenuUserId, setMemberMenuUserId] = useState(null)
  const [memberMenuPosition, setMemberMenuPosition] = useState(null)
  const [editingMemberRoleId, setEditingMemberRoleId] = useState(null)
  const [selectedMemberRole, setSelectedMemberRole] = useState('editor')
  const [updatingMemberRoleId, setUpdatingMemberRoleId] = useState(null)
  const [memberError, setMemberError] = useState('')
  const [memberSuccess, setMemberSuccess] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isChatSending, setIsChatSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [chatReloadKey, setChatReloadKey] = useState(0)
  const isViewer = boardRole === 'viewer'
  const isOwner = boardRole === 'owner'
  const editingMember = members.find(member => member.user_id === editingMemberRoleId)

  const socketRef = useRef(null)
  const documentRef = useRef(emptyDocument)
  const boardCacheRef = useRef({})
  const deletedBoardIdsRef = useRef(new Set())
  const boardListRequestRef = useRef(0)
  const boardLoadRef = useRef(0)
  const hydratedBoardRef = useRef(null)
  const dirtyRef = useRef(false)
  const chatMessagesEndRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!memberSuccess) return undefined
    const timeoutId = window.setTimeout(() => setMemberSuccess(''), 3000)
    return () => window.clearTimeout(timeoutId)
  }, [memberSuccess])

  useEffect(() => {
    setIsChatOpen(false)
    setChatMessages([])
    setChatDraft('')
    setChatError('')
    setChatReloadKey(0)
  }, [board?.id])

  useEffect(() => {
    if (!isChatOpen) return
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatMessages, isChatOpen])

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
    setBoardRole(null)
    setIsCreateBoardOpen(false)
    setBoards([])
    setMembers([])
    setActiveMemberIds(new Set())
    setIsChatOpen(false)
    setChatMessages([])
    setChatError('')
    setNodes([])
    setEdges([])
    setBoilerplate(null)
    setBoilerplateCollapsed(false)
    hydratedBoardRef.current = null
    setStatus('Signed out.')
  }, [setEdges, setNodes])

  const loadMembers = useCallback(async boardId => {
    if (!boardId) {
      setMembers([])
      setActiveMemberIds(new Set())
      return
    }

    setMembersLoading(true)
    try {
      const response = await fetch(`${API_URL}/boards/${boardId}/members`, { headers: authHeaders() })
      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) throw new Error('Could not load board members')
      setMembers(await response.json())
      setMemberError('')
    } catch (error) {
      console.error('Could not load board members:', error)
      setMemberError(error.message || 'Could not load board members.')
    } finally {
      setMembersLoading(false)
    }
  }, [logout])

  useEffect(() => {
    const activeBoardId = board?.id
    if (!isChatOpen || !activeBoardId) return undefined

    const controller = new AbortController()
    setIsChatLoading(true)
    setChatError('')

    fetch(`${API_URL}/boards/${activeBoardId}/chat`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async response => {
        if (response.status === 401) {
          logout()
          return null
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}))
          throw new Error(detail.detail || 'Could not load chat history.')
        }
        return response.json()
      })
      .then(messages => {
        if (messages) setChatMessages(current => mergeChatMessages(current, messages))
      })
      .catch(error => {
        if (error.name === 'AbortError') return
        console.error('Could not load board chat:', error)
        setChatError(error.message || 'Could not load chat history.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsChatLoading(false)
      })

    return () => controller.abort()
  }, [isChatOpen, board?.id, chatReloadKey, logout])

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

      await loadMembers(board.id)
      setMemberSuccess('Member added successfully.')
      setMemberUserId('')
    } catch (error) {
      console.error('Failed to add board member:', error)
      setMemberError(error.message || 'Could not add member.')
    } finally {
      setMemberLoading(false)
    }
  }

  const removeBoardMember = async member => {
    if (!board || !isOwner || member.role === 'owner') return
    if (!window.confirm(`Remove ${member.username} from this board?`)) return

    setMemberMenuUserId(null)
    setEditingMemberRoleId(null)
    setRemovingMemberId(member.user_id)
    setMemberError('')
    setMemberSuccess('')
    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/members/${member.user_id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('Only the board owner can remove members.')
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Could not remove member.')
      }
      setMembers(current => current.filter(currentMember => currentMember.user_id !== member.user_id))
      setActiveMemberIds(current => {
        const next = new Set(current)
        next.delete(member.user_id)
        return next
      })
      setMemberSuccess(`${member.username} was removed.`)
    } catch (error) {
      console.error('Failed to remove board member:', error)
      setMemberError(error.message || 'Could not remove member.')
    } finally {
      setRemovingMemberId(null)
    }
  }

  const updateBoardMemberRole = async member => {
    if (!board || !isOwner || member.role === 'owner') return
    if (selectedMemberRole === member.role) {
      setMemberMenuUserId(null)
      setEditingMemberRoleId(null)
      return
    }

    setUpdatingMemberRoleId(member.user_id)
    setMemberError('')
    setMemberSuccess('')
    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/members/${member.user_id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ role: selectedMemberRole }),
      })
      if (response.status === 401) {
        logout()
        return
      }
      if (response.status === 403) throw new Error('Only the board owner can change member roles.')
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Could not change member role.')
      }

      setMembers(current => current.map(currentMember =>
        currentMember.user_id === member.user_id
          ? { ...currentMember, role: selectedMemberRole }
          : currentMember
      ))
      setMemberMenuUserId(null)
      setEditingMemberRoleId(null)
      setMemberSuccess(`${member.username}'s role changed to ${selectedMemberRole}.`)
    } catch (error) {
      console.error('Failed to update board member role:', error)
      setMemberError(error.message || 'Could not change member role.')
    } finally {
      setUpdatingMemberRoleId(null)
    }
  }

  const sendChatMessage = async event => {
    event.preventDefault()
    if (!board || !chatDraft.trim() || isChatSending) return

    setIsChatSending(true)
    setChatError('')
    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/chat`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ content: chatDraft.trim() }),
      })
      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Could not send message.')
      }

      const message = await response.json()
      setChatMessages(current => mergeChatMessages(current, [message]))
      setChatDraft('')
    } catch (error) {
      console.error('Could not send board chat message:', error)
      setChatError(error.message || 'Could not send message.')
    } finally {
      setIsChatSending(false)
    }
  }

  const onConnect = useCallback((connection) => {
    if (boardRole === 'viewer') return
    dirtyRef.current = true
    setEdges(current => {
      const next = addEdge({ ...connection, animated: true }, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: documentRef.current.nodes, edges: next },
      })
      return next
    })
  }, [boardRole, setEdges])

  const handleNodesChange = useCallback((changes) => {
    if (boardRole === 'viewer') return
    dirtyRef.current = true
    setNodes(current => {
      const next = applyNodeChanges(changes, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: next, edges: documentRef.current.edges },
      })
      return next
    })
  }, [boardRole, setNodes])

  const handleEdgesChange = useCallback((changes) => {
    if (boardRole === 'viewer') return
    dirtyRef.current = true
    setEdges(current => {
      const next = applyEdgeChanges(changes, current)
      sendSocketMessage(socketRef, {
        type: 'document:update',
        document: { nodes: documentRef.current.nodes, edges: next },
      })
      return next
    })
  }, [boardRole, setEdges])

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

  const openCreateBoard = () => {
    setCreateBoardName('')
    setCreateBoardError('')
    setIsCreateBoardOpen(true)
  }

  const createBoard = async boardName => {
    const freshBoardName = boardName.trim()
    if (!freshBoardName) {
      setCreateBoardError('Please enter a board name.')
      return
    }

    setIsCreatingBoard(true)
    setCreateBoardError('')
    try {
      dirtyRef.current = false
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
      setBoardRole(created.member_role)
      setBoards(current => [created, ...current.filter(item => item.id !== created.id)])
      setNodes([])
      setEdges([])
      documentRef.current = emptyDocument
      setName(freshBoardName)
      setBoilerplate(null)
      setBoilerplateCollapsed(false)
      hydratedBoardRef.current = created.id
      window.history.replaceState({}, '', `?board=${created.id}`)
      setIsCreateBoardOpen(false)
      setStatus('Board created. Live collaboration connected.')
    } catch (error) {
      console.error('Could not create board:', error)
      setCreateBoardError(error.message || 'Could not create a new board.')
    } finally {
      setIsCreatingBoard(false)
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
      const draft = loadedBoard.member_role === 'viewer' ? null : cachedDraft || storedDraft
      const initialDocument = draft?.document || normalizeDocument(loadedBoard.document)
      const initialName = draft?.name ?? loadedBoard.name

      dirtyRef.current = Boolean(draft)
      setBoard(loadedBoard)
      setBoardRole(loadedBoard.member_role)
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
      setBoardRole(null)
      setBoilerplate(null)
      setName('')
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
    if (!board || documentRef.current.nodes.length === 0) {
      setIsEmptyBoardDialogOpen(true)
      return
    }

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ name, document: documentRef.current }),
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
    if (!board || (!boilerplate && !isViewer)) return

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/boilerplate/download`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ name, document: documentRef.current }),
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
      link.download = `${name.trim() || board.name}-boilerplate.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Boilerplate download failed:', error)
      setStatus(error.message || 'Could not download boiler code.')
    }
  }

  const addNode = item => {
    if (isViewer) return
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

        if (message.type === 'presence:snapshot') {
          setActiveMemberIds(new Set(message.users.map(activeUser => activeUser.user_id)))
          return
        }

        if (message.type === 'presence') {
          setActiveMemberIds(current => {
            const next = new Set(current)
            if (message.event === 'joined') next.add(message.user_id)
            if (message.event === 'left') next.delete(message.user_id)
            return next
          })
          return
        }

        if (message.type === 'members:changed') {
          loadMembers(boardId)
          return
        }

        if (message.type === 'chat:message' && message.message) {
          setChatMessages(current => mergeChatMessages(current, [message.message]))
          return
        }

        if (message.type === 'member:role_changed' && message.user_id === authUser.id) {
          openBoard(boardId)
          return
        }

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
      if (event.code === 1008) {
        dirtyRef.current = false
        hydratedBoardRef.current = null
        setBoard(null)
        setBoardRole(null)
        setMembers([])
        setActiveMemberIds(new Set())
        setNodes([])
        setEdges([])
        documentRef.current = emptyDocument
        window.history.replaceState({}, '', window.location.pathname)
        setStatus('You do not have access to this board.')
      }
      if (socketRef.current === socket) socketRef.current = null
    }

    return () => {
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
  }, [authReady, authUser, board, loadMembers, setEdges, setNodes])

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

  useEffect(() => {
    setActiveMemberIds(new Set())
    if (!board) {
      setMembers([])
      return
    }
    loadMembers(board.id)
  }, [board?.id, loadMembers])

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

        {board && (
          <section className="members-panel" aria-labelledby="members-heading">
            <div className="members-panel-heading">
              <h2 id="members-heading">Board members</h2>
              <button className="members-refresh" onClick={() => loadMembers(board.id)} disabled={membersLoading}>
                {membersLoading ? 'Loading' : 'Refresh'}
              </button>
            </div>
            <p className="members-summary">
              {members.length} {members.length === 1 ? 'member' : 'members'}
              {activeMemberIds.size > 0 && ` · ${activeMemberIds.size} active`}
            </p>

            {members.length > 0 ? (
              <ul className="member-list">
                {members.map(member => {
                  const isActive = activeMemberIds.has(member.user_id)
                  return (
                    <li className="member-row" key={member.user_id}>
                      <span className="member-avatar" aria-hidden="true">{member.username.slice(0, 1).toUpperCase()}</span>
                      <div className="member-details">
                        <strong title={member.username}>{member.username}</strong>
                        <span className="member-role">{member.role}</span>
                        <span className="member-presence">
                          <i className={isActive ? 'presence-dot is-active' : 'presence-dot'} />
                          {isActive ? 'Active now' : 'Offline'}
                        </span>
                      </div>
                      {isOwner && member.role !== 'owner' && (
                        <div className="member-actions">
                          <button
                            className="member-menu-trigger"
                            type="button"
                            onClick={event => {
                              if (memberMenuUserId === member.user_id) {
                                setMemberMenuUserId(null)
                                setMemberMenuPosition(null)
                                return
                              }
                              const bounds = event.currentTarget.getBoundingClientRect()
                              setMemberMenuPosition({
                                top: Math.min(bounds.bottom + 4, window.innerHeight - 88),
                                right: Math.max(8, window.innerWidth - bounds.right),
                              })
                              setMemberMenuUserId(member.user_id)
                            }}
                            disabled={removingMemberId === member.user_id || updatingMemberRoleId === member.user_id}
                            aria-label={`Actions for ${member.username}`}
                            aria-expanded={memberMenuUserId === member.user_id}
                            title={`Actions for ${member.username}`}
                          >
                            ···
                          </button>
                          {memberMenuUserId === member.user_id && (
                            <div
                              className="member-action-menu"
                              style={{ top: memberMenuPosition?.top, right: memberMenuPosition?.right }}
                            >
                              <button
                                className="member-action-option"
                                type="button"
                                onClick={() => {
                                  setSelectedMemberRole(member.role)
                                  setMemberMenuUserId(null)
                                  setMemberMenuPosition(null)
                                  setEditingMemberRoleId(member.user_id)
                                }}
                              >
                                Change role
                              </button>
                              <button
                                className="member-action-option is-danger"
                                type="button"
                                onClick={() => removeBoardMember(member)}
                                disabled={removingMemberId === member.user_id}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="members-empty">{membersLoading ? 'Loading members...' : 'No members found.'}</p>
            )}

            {isOwner && (
              <form
                className="member-add-form"
                onSubmit={event => { event.preventDefault(); addBoardMember() }}
              >
                <label htmlFor="member-user-id">Add a member</label>
                <input
                  id="member-user-id"
                  value={memberUserId}
                  onChange={event => { setMemberUserId(event.target.value); setMemberError(''); setMemberSuccess('') }}
                  placeholder="User UUID"
                  disabled={memberLoading}
                  required
                />
                <select value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={memberLoading}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="primary" type="submit" disabled={memberLoading || !memberUserId.trim()}>
                  {memberLoading ? 'Adding...' : 'Add member'}
                </button>
              </form>
            )}

            {memberError && <p className="member-feedback is-error">{memberError}</p>}
            {memberSuccess && <p className="member-feedback is-success">{memberSuccess}</p>}
          </section>
        )}

        <div className="catalog-heading">
          <span>Component library</span>
          <small>{nodeCatalog.reduce((total, section) => total + section.items.length, 0)} components</small>
        </div>

        {nodeCatalog.map(section => (
          <section key={section.group}>
            <h2>{section.group}</h2>
            {section.items.map(item => (
              <button className="node-button" key={item.technology} onClick={() => addNode(item)} disabled={!board || isViewer}>
                <span>{item.label}</span>
                <small>{item.kind}</small>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          {board && (
            <div className="board-title">
              <span className="eyebrow">CURRENT BOARD</span>
              <input
                value={name}
                readOnly={isViewer}
                onChange={event => { dirtyRef.current = true; setName(event.target.value) }}
                aria-label="Board name"
              />
            </div>
          )}

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
              value={board?.id || ''}
              onChange={event => {
                const nextSelection = event.target.value
                if (nextSelection === 'new-board') {
                  openCreateBoard()
                  return
                }
                handleBoardSelection(nextSelection)
              }}
              aria-label="Select a board or create a new one"
            >
              <option value="" disabled>Select a board</option>
              <option value="new-board">+ New board</option>
              {boards.map(savedBoard => (
                <option key={savedBoard.id} value={savedBoard.id}>{savedBoard.name}</option>
              ))}
            </select>

            {board && (
              <button
                className={`secondary chat-toggle ${isChatOpen ? 'is-active' : ''}`}
                type="button"
                onClick={() => setIsChatOpen(open => !open)}
                aria-expanded={isChatOpen}
                aria-controls="board-chat-panel"
              >
                <span aria-hidden="true">▱</span>
                Group chat
              </button>
            )}

            {board && isOwner && <button className="secondary danger-button" onClick={deleteBoard}>Delete board</button>}

            {board && !isViewer && <button className="secondary" onClick={createBoilerplate}>Generate code</button>}
            {board && isViewer && <button className="secondary" onClick={downloadBoilerplate}>Download boilerplate</button>}
            {board && !isViewer && <button className="primary" onClick={saveBoard}>Save changes</button>}
          </div>
        </header>

        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodesDraggable={!isViewer}
            nodesConnectable={!isViewer}
            elementsSelectable={!isViewer}
            fitView
          >
            <Background gap={20} size={1} />
            <Controls showFitView={false} showInteractive={false} />
          </ReactFlow>

          {!board && (
            <div className="canvas-empty">
              <h1>Start with a new board</h1>
              <p>Create a board to begin mapping your system architecture.</p>
              <button className="primary empty-create-button" onClick={openCreateBoard}>
                <span className="empty-icon" aria-hidden="true">+</span>
                <span>Create a new board</span>
              </button>
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

        {board && isChatOpen && (
          <section
            className="chat-panel"
            id="board-chat-panel"
            role="dialog"
            aria-label={`${board.name} group chat`}
          >
            <header className="chat-header">
              <div>
                <span className="chat-eyebrow">BOARD CONVERSATION</span>
                <h2>Group chat</h2>
                <p>{board.name} · {members.length} {members.length === 1 ? 'member' : 'members'}</p>
              </div>
              <button
                className="chat-close"
                type="button"
                onClick={() => setIsChatOpen(false)}
                aria-label="Close group chat"
              >
                ×
              </button>
            </header>

            <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
              {isChatLoading && chatMessages.length === 0 && (
                <p className="chat-state">Loading conversation...</p>
              )}
              {chatError && (
                <div className="chat-load-error" role="alert">
                  <span>{chatError}</span>
                  <button type="button" onClick={() => setChatReloadKey(current => current + 1)}>
                    Retry
                  </button>
                </div>
              )}
              {!isChatLoading && !chatError && chatMessages.length === 0 && (
                <div className="chat-empty">
                  <span aria-hidden="true">✦</span>
                  <strong>Start the conversation</strong>
                  <p>Messages here are shared with everyone on this board.</p>
                </div>
              )}
              {chatMessages.map(message => {
                const isOwnMessage = message.user_id === authUser.id
                return (
                  <article
                    className={`chat-message ${isOwnMessage ? 'is-own-message' : ''}`}
                    key={message.id}
                  >
                    {!isOwnMessage && (
                      <span className="chat-message-avatar" aria-hidden="true">
                        {message.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="chat-message-content">
                      <div className="chat-message-meta">
                        <strong>{isOwnMessage ? 'You' : message.username}</strong>
                        <time dateTime={message.created_at}>
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                      <p>{message.content}</p>
                    </div>
                  </article>
                )
              })}
              <div ref={chatMessagesEndRef} />
            </div>

            <form className="chat-composer" onSubmit={sendChatMessage}>
              <label className="visually-hidden" htmlFor="chat-message-input">Write a message</label>
              <textarea
                id="chat-message-input"
                value={chatDraft}
                onChange={event => {
                  setChatDraft(event.target.value)
                  if (chatError) setChatError('')
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form.requestSubmit()
                  }
                }}
                placeholder="Message board members..."
                maxLength={2000}
                rows={2}
                disabled={isChatSending}
              />
              <button
                className="primary chat-send"
                type="submit"
                disabled={isChatSending || !chatDraft.trim()}
                aria-label="Send message"
              >
                {isChatSending ? 'Sending...' : 'Send'}
              </button>
            </form>
            <p className="chat-hint">Enter to send · Shift + Enter for a new line</p>
          </section>
        )}
      </section>

      {isCreateBoardOpen && (
        <div className="create-board-backdrop">
          <section
            className="create-board-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-board-title"
          >
            <h2 id="create-board-title">Create a new board</h2>
            <p>Choose a name for your architecture board.</p>
            <form onSubmit={event => { event.preventDefault(); createBoard(createBoardName) }}>
              <label htmlFor="create-board-name">Board name</label>
              <input
                id="create-board-name"
                autoFocus
                maxLength={160}
                value={createBoardName}
                onChange={event => { setCreateBoardName(event.target.value); setCreateBoardError('') }}
                placeholder="e.g. Customer platform"
                disabled={isCreatingBoard}
                required
              />
              {createBoardError && <p className="create-board-error" role="alert">{createBoardError}</p>}
              <div className="create-board-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setIsCreateBoardOpen(false)}
                  disabled={isCreatingBoard}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={isCreatingBoard}>
                  {isCreatingBoard ? 'Creating...' : 'Create board'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isEmptyBoardDialogOpen && (
        <div className="create-board-backdrop">
          <section
            className="create-board-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="empty-board-title"
            aria-describedby="empty-board-message"
          >
            <h2 id="empty-board-title">Board is empty</h2>
            <p id="empty-board-message">Add at least one component to this board before generating boilerplate.</p>
            <div className="create-board-actions">
              <button
                className="primary"
                type="button"
                autoFocus
                onClick={() => setIsEmptyBoardDialogOpen(false)}
              >
                Got it
              </button>
            </div>
          </section>
        </div>
      )}

      {editingMember && (
        <div
          className="member-modal-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget && updatingMemberRoleId !== editingMember.user_id) {
              setEditingMemberRoleId(null)
            }
          }}
        >
          <section
            className="member-modal member-role-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-member-role-title"
          >
            <div className="member-modal-header">
              <div>
                <span className="eyebrow">BOARD ACCESS</span>
                <h2 id="change-member-role-title">Change member role</h2>
                <p>Update access for <strong>{editingMember.username}</strong>.</p>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setEditingMemberRoleId(null)}
                disabled={updatingMemberRoleId === editingMember.user_id}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form
              className="member-form"
              onSubmit={event => {
                event.preventDefault()
                updateBoardMemberRole(editingMember)
              }}
            >
              <label htmlFor="change-member-role">
                Role
                <select
                  id="change-member-role"
                  value={selectedMemberRole}
                  onChange={event => setSelectedMemberRole(event.target.value)}
                  disabled={updatingMemberRoleId === editingMember.user_id}
                >
                  <option value="editor">Editor — can edit the board</option>
                  <option value="viewer">Viewer — can view the board</option>
                </select>
              </label>
              {memberError && <p className="member-error" role="alert">{memberError}</p>}
              <div className="member-modal-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setEditingMemberRoleId(null)}
                  disabled={updatingMemberRoleId === editingMember.user_id}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={updatingMemberRoleId === editingMember.user_id}>
                  {updatingMemberRoleId === editingMember.user_id ? 'Saving...' : 'Save role'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  )
}
