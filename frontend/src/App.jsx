import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoMdRefresh } from 'react-icons/io'
import {
  FiBox,
  FiChevronDown,
  FiChevronUp,
  FiCode,
  FiDownload,
  FiFile,
  FiHardDrive,
  FiLogOut,
  FiMessageCircle,
  FiMoon,
  FiSun,
  FiTrash2,
} from 'react-icons/fi'
import {
  SiAngular,
  SiDjango,
  SiExpress,
  SiFastapi,
  SiMongodb,
  SiMysql,
  SiPostgresql,
  SiRabbitmq,
  SiReact,
  SiRedis,
  SiSpringboot,
  SiVuedotjs,
} from 'react-icons/si'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { nodeCatalog } from './catalog.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = import.meta.env.VITE_WS_URL || API_URL.replace(/^http/, 'ws')
const TOKEN_KEY = 'archboard_access_token'
const THEME_KEY = 'archboard_theme'
const emptyDocument = { nodes: [], edges: [] }
const technologyIcons = {
  react: { Icon: SiReact, color: '#61dafb' },
  angular: { Icon: SiAngular, color: '#dd0031' },
  vue: { Icon: SiVuedotjs, color: '#42b883' },
  fastapi: { Icon: SiFastapi, color: '#009688' },
  django: { Icon: SiDjango, color: '#44b78b' },
  express: { Icon: SiExpress, color: '#9ba8bf' },
  'spring-boot': { Icon: SiSpringboot, color: '#6db33f' },
  postgresql: { Icon: SiPostgresql, color: '#4169e1' },
  mongodb: { Icon: SiMongodb, color: '#47a248' },
  mysql: { Icon: SiMysql, color: '#4479a1' },
  redis: { Icon: SiRedis, color: '#ff4438' },
  rabbitmq: { Icon: SiRabbitmq, color: '#ff6600' },
  'object-storage': { Icon: FiHardDrive, color: '#a78bfa' },
}

function ArchitectureNode({ data, selected }) {
  const { Icon, color } = technologyIcons[data.technology] || { Icon: FiBox, color: 'var(--blue)' }
  const connectedHandles = data.connectedHandles || []

  return (
    <div className={`architecture-node${selected ? ' is-selected' : ''}`}>
      <Handle id="top-target" className={connectedHandles.includes('top-target') ? 'is-connected' : ''} type="source" position={Position.Top} />
      <Handle id="right-source" className={connectedHandles.includes('right-source') ? 'is-connected' : ''} type="source" position={Position.Right} />
      <Handle id="bottom-source" className={connectedHandles.includes('bottom-source') ? 'is-connected' : ''} type="source" position={Position.Bottom} />
      <Handle id="left-target" className={connectedHandles.includes('left-target') ? 'is-connected' : ''} type="source" position={Position.Left} />
      <span className="architecture-node-icon" aria-hidden="true">
        <Icon style={{ color }} />
      </span>
      <span className="architecture-node-label" title={data.label}>{data.label}</span>
    </div>
  )
}

const nodeTypes = {
  architecture: ArchitectureNode,
  default: ArchitectureNode,
}

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
    type: 'architecture',
    position: { x: 120 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 140 },
    data: { label: item.label, kind: item.kind, technology: item.technology },
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

function getChatDateKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatChatDate(value) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (getChatDateKey(date) === getChatDateKey(today)) return 'Today'
  if (getChatDateKey(date) === getChatDateKey(yesterday)) return 'Yesterday'

  return date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function AppDialog({ dialog, onClose }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const element = dialogRef.current
    if (!element) return

    if (dialog && !element.open) element.showModal()
    if (!dialog && element.open) element.close()
  }, [dialog])

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby={dialog ? 'app-dialog-title' : undefined}
      aria-describedby={dialog ? 'app-dialog-message' : undefined}
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
    >
      {dialog && (
        <>
          <div className="app-dialog-main">
            <div className={`app-dialog-icon ${dialog.isDanger ? 'is-danger' : ''}`} aria-hidden="true">
              {dialog.isDanger ? '!' : 'i'}
            </div>
            <div className="app-dialog-copy">
              <h2 id="app-dialog-title">{dialog.title}</h2>
              <p id="app-dialog-message">{dialog.message}</p>
            </div>
          </div>
          <div className="app-dialog-actions">
            {dialog.onConfirm && (
              <button className="secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            )}
            <button
              className={dialog.isDanger && dialog.onConfirm ? 'danger-button' : 'primary'}
              type="button"
              autoFocus
              onClick={() => {
                const confirm = dialog.onConfirm
                onClose()
                confirm?.()
              }}
            >
              {dialog.confirmLabel || (dialog.onConfirm ? 'Confirm' : 'Got it')}
            </button>
          </div>
        </>
      )}
    </dialog>
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

function AppContent() {
  const { screenToFlowPosition } = useReactFlow()
  const [board, setBoard] = useState(null)
  const [boards, setBoards] = useState([])
  const [nodes, setNodes] = useNodesState([])
  const [edges, setEdges] = useEdgesState([])
  const nodesWithConnectedHandles = useMemo(() => {
    const connectedHandlesByNode = new Map()
    edges.forEach(edge => {
      if (edge.sourceHandle) {
        const handles = connectedHandlesByNode.get(edge.source) || []
        handles.push(edge.sourceHandle)
        connectedHandlesByNode.set(edge.source, handles)
      }
      if (edge.targetHandle) {
        const handles = connectedHandlesByNode.get(edge.target) || []
        handles.push(edge.targetHandle)
        connectedHandlesByNode.set(edge.target, handles)
      }
    })

    return nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        connectedHandles: connectedHandlesByNode.get(node.id) || [],
      },
    }))
  }, [edges, nodes])
  const [name, setName] = useState('')
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false)
  const [createBoardName, setCreateBoardName] = useState('')
  const [createBoardError, setCreateBoardError] = useState('')
  const [isCreatingBoard, setIsCreatingBoard] = useState(false)
  const [isEmptyBoardDialogOpen, setIsEmptyBoardDialogOpen] = useState(false)
  const [appDialog, setAppDialog] = useState(null)
  const [status, setStatus] = useState('Create a board to start collaborating.')
  const [boilerplate, setBoilerplate] = useState(null)
  const [boilerplateCollapsed, setBoilerplateCollapsed] = useState(false)
  const [boardRole, setBoardRole] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark')

  const [members, setMembers] = useState([])
  const [activeMemberIds, setActiveMemberIds] = useState(new Set())
  const [memberEmail, setMemberEmail] = useState('')
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
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
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
  const chatShouldAutoScrollRef = useRef(true)

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
    setChatUnreadCount(0)
    chatShouldAutoScrollRef.current = true
  }, [board?.id])

  useEffect(() => {
    if (!isChatOpen || !chatShouldAutoScrollRef.current) return

    const container = chatMessagesEndRef.current?.parentElement
    if (!container) return

    container.scrollTop = container.scrollHeight
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
    window.history.replaceState({}, '', window.location.pathname)
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
    setAuthSuccess('')

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
        setAuthSuccess('Account created successfully. Please sign in with your email and password.')
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

    const email = memberEmail.trim()
    if (!email) {
      setMemberError('Please enter the member email.')
      return
    }

    setMemberLoading(true)
    setMemberError('')
    setMemberSuccess('')

    try {
      const response = await fetch(`${API_URL}/boards/${board.id}/members`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ email, role: memberRole }),
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
      if (response.status === 404) throw new Error('No user found with this email address.')
      if (response.status === 422) throw new Error('Please enter a valid email address.')
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || 'Could not add member.')
      }

      await loadMembers(board.id)
      setMemberSuccess('Member added successfully.')
      setMemberEmail('')
    } catch (error) {
      console.error('Failed to add board member:', error)
      setMemberError(error.message || 'Could not add member.')
    } finally {
      setMemberLoading(false)
    }
  }

  const removeBoardMember = async member => {
    if (!board || !isOwner || member.role === 'owner') return

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

  const requestRemoveBoardMember = member => {
    if (!board || !isOwner || member.role === 'owner') return
    setAppDialog({
      title: 'Remove board member?',
      message: `${member.username} will lose access to this board and its group chat.`,
      confirmLabel: 'Remove member',
      isDanger: true,
      onConfirm: () => removeBoardMember(member),
    })
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
      if (response.status === 403 || response.status === 404) {
        if (loadId === boardLoadRef.current) {
          hydratedBoardRef.current = null
          window.history.replaceState({}, '', window.location.pathname)
          setStatus('Create a board to start collaborating.')
        }
        return
      }
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
      setAppDialog({
        title: 'Could not delete board',
        message: error.message || 'Please try again.',
      })
      setStatus(error.message || 'Could not delete board.')
    }
  }

  const requestDeleteBoard = () => {
    if (!board) return
    setAppDialog({
      title: 'Delete this board?',
      message: `"${board.name}" and its architecture will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete board',
      isDanger: true,
      onConfirm: deleteBoard,
    })
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

  const addNode = (item, position) => {
    if (isViewer) return
    dirtyRef.current = true
    const next = makeNode(item, nodes.length)
    if (position) next.position = position

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
          const nextMessage = message.message
          const isOwnMessage = nextMessage.user_id === authUser.id
          setChatMessages(current => mergeChatMessages(current, [nextMessage]))
          if (!isOwnMessage && !isChatOpen) {
            setChatUnreadCount(current => current + 1)
          }
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
      if (socketRef.current !== socket) return
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
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess('') }}>Sign in</button>
            <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError(''); setAuthSuccess('') }}>Register</button>
          </div>

          {authSuccess && <p className="auth-success" role="status">{authSuccess}</p>}

          <form onSubmit={submitAuth}>
            {authMode === 'register' && (
              <label>
                Username
                <input
                  value={authForm.username}
                  onChange={event => { setAuthForm({ ...authForm, username: event.target.value }); setAuthSuccess('') }}
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
                onChange={event => { setAuthForm({ ...authForm, email: event.target.value }); setAuthSuccess('') }}
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
                onChange={event => { setAuthForm({ ...authForm, password: event.target.value }); setAuthSuccess('') }}
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
              <button
                type="button"
                className="members-refresh"
                onClick={() => loadMembers(board.id)}
                disabled={membersLoading}
                aria-label={membersLoading ? 'Refreshing members' : 'Refresh members'}
                title={membersLoading ? 'Refreshing members' : 'Refresh members'}
              >
                <IoMdRefresh aria-hidden="true" />
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
                                onClick={() => requestRemoveBoardMember(member)}
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
                <label htmlFor="member-email">Add a member</label>
                <input
                  id="member-email"
                  type="email"
                  value={memberEmail}
                  onChange={event => { setMemberEmail(event.target.value); setMemberError(''); setMemberSuccess('') }}
                  placeholder="Member email"
                  disabled={memberLoading}
                  required
                />
                <select value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={memberLoading}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="primary" type="submit" disabled={memberLoading || !memberEmail.trim()}>
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
        </div>

        <div className="component-categories">
          {nodeCatalog.map(section => (
            <details className="component-category" key={section.group}>
              <summary>
                <span>{section.group}</span>
                <span className="component-category-chevron" aria-hidden="true" />
              </summary>
              <div className="component-category-items">
                {section.items.map(item => (
                  <button
                    className="node-button"
                    key={item.technology}
                    onClick={() => addNode(item)}
                    onDragStart={event => {
                      event.dataTransfer.setData('application/archboard-component', JSON.stringify(item))
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    draggable={Boolean(board) && !isViewer}
                    disabled={!board || isViewer}
                    title={isViewer ? 'Viewers cannot add components' : 'Click or drag onto the board'}
                  >
                    <span>{item.label}</span>
                    <small>{item.kind}</small>
                  </button>
                ))}
              </div>
            </details>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
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

            <div className="topbar-board-actions">
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

              {board && isOwner && <button className="secondary danger-button" onClick={requestDeleteBoard}><FiTrash2 aria-hidden="true" /><span>Delete board</span></button>}
              {board && !isViewer && <button className="secondary generate-button" onClick={createBoilerplate}><FiCode aria-hidden="true" /><span>Generate code</span></button>}
              {board && isViewer && <button className="secondary generate-button" onClick={downloadBoilerplate}><FiDownload aria-hidden="true" /><span>Download boilerplate</span></button>}
              {board && !isViewer && <button className="primary" onClick={saveBoard}>Save changes</button>}
            </div>
          </div>

          <div className="topbar-account-actions">
            <details
              className="profile-menu"
              onKeyDown={event => {
                if (event.key === 'Escape') event.currentTarget.open = false
              }}
            >
              <summary className="profile-trigger" aria-label="Open profile menu">
                <span className="avatar">{authUser.username.slice(0, 1).toUpperCase()}</span>
                <span className="profile-trigger-copy">
                  <strong>{authUser.username}</strong>
                  <small>Account</small>
                </span>
                <FiChevronDown aria-hidden="true" />
              </summary>
              <div className="profile-dropdown">
                <div className="profile-dropdown-heading">
                  <span className="avatar profile-avatar" aria-hidden="true">
                    {authUser.username.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{authUser.username}</strong>
                    <span>{authUser.email}</span>
                  </div>
                </div>
                <button className="profile-signout" type="button" onClick={logout}>
                  <FiLogOut aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>
            </details>

            <button
              className="theme-toggle"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
            </button>
          </div>
        </header>

        <div
          className="canvas-wrap"
          onDragOver={event => {
            if (event.dataTransfer.types.includes('application/archboard-component')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={event => {
            const itemData = event.dataTransfer.getData('application/archboard-component')
            if (!itemData || !board || isViewer) return
            event.preventDefault()
            try {
              const item = JSON.parse(itemData)
              if (!nodeCatalog.some(section => section.items.some(catalogItem =>
                catalogItem.technology === item.technology &&
                catalogItem.label === item.label &&
                catalogItem.kind === item.kind
              ))) return
              addNode(item, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
            } catch (error) {
              console.error('Could not add dropped component:', error)
            }
          }}
        >
          <ReactFlow
            proOptions={{ hideAttribution: true }}
            connectionMode={ConnectionMode.Loose}
            nodeTypes={nodeTypes}
            nodes={nodesWithConnectedHandles}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodesDraggable={!isViewer}
            nodesConnectable={!isViewer}
            elementsSelectable={!isViewer}
            fitView
          >
            <Background gap={24} size={1.5} />
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
          {board && (
            <button
              className={`secondary chat-toggle ${isChatOpen ? 'is-active' : ''} ${chatUnreadCount > 0 ? 'has-unread' : ''}`}
              type="button"
              onClick={() => {
                setIsChatOpen(open => {
                  const nextOpen = !open
                  if (nextOpen) {
                    setChatUnreadCount(0)
                    chatShouldAutoScrollRef.current = true
                  }
                  return nextOpen
                })
              }}
              aria-label={`Group chat${chatUnreadCount > 0 ? `, ${chatUnreadCount} unread messages` : ''}`}
              aria-expanded={isChatOpen}
              aria-controls="board-chat-panel"
            >
              <FiMessageCircle className="chat-toggle-icon" aria-hidden="true" />
              <span>Group chat</span>
              {chatUnreadCount > 0 && (
                <span className="chat-unread-count" aria-label={`${chatUnreadCount} unread messages`}>
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </button>
          )}
          {board && isChatOpen && (
            <section
              className="chat-panel"
              id="board-chat-panel"
              role="dialog"
              aria-label={`${board.name} group chat`}
            >
              <header className="chat-header">
                <h2>Group chat</h2>
                <button
                  className="chat-close"
                  type="button"
                  onClick={() => setIsChatOpen(false)}
                  aria-label="Close group chat"
                >
                  ×
                </button>
              </header>

              <div
                className="chat-messages"
                role="log"
                aria-live="polite"
                aria-relevant="additions"
                onScroll={event => {
                  const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
                  chatShouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 48
                }}
              >
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
                {chatMessages.map((message, index) => {
                  const isOwnMessage = message.user_id === authUser.id
                  const showDateDivider = index === 0 ||
                    getChatDateKey(chatMessages[index - 1].created_at) !== getChatDateKey(message.created_at)
                  const dateLabel = formatChatDate(message.created_at)
                  return (
                    <div className="chat-message-group" key={message.id}>
                      {showDateDivider && (
                        <div className="chat-date-divider" role="separator" aria-label={dateLabel}>
                          <span>{dateLabel}</span>
                        </div>
                      )}
                      <article className={`chat-message ${isOwnMessage ? 'is-own-message' : ''}`}>
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
                    </div>
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
        </div>

        {boilerplate && (
          <section className={`boilerplate-panel ${boilerplateCollapsed ? 'is-collapsed' : ''}`}>
            <div className="boilerplate-heading">
              <div className="boilerplate-summary">
                <span className="eyebrow">GENERATED STARTER</span>
                <strong className="boilerplate-project-name">{boilerplate.project_name}</strong>
                <span className="boilerplate-file-count">
                  {Object.keys(boilerplate.files).length} starter files
                </span>
                <div className="boilerplate-technologies" aria-label="Selected technologies">
                  {boilerplate.technologies.length > 0
                    ? boilerplate.technologies.map(technology => (
                      <span className="technology-tag" key={technology}>{technology}</span>
                    ))
                    : <span className="technology-tag">No technologies selected</span>}
                </div>
              </div>

              <div className="boilerplate-actions">
                <button
                  className="panel-toggle"
                  onClick={() => setBoilerplateCollapsed(current => !current)}
                  aria-expanded={!boilerplateCollapsed}
                  aria-label={boilerplateCollapsed ? 'Expand generated starter' : 'Hide starter files'}
                  title={boilerplateCollapsed ? 'Expand starter files' : 'Hide starter files'}
                >
                  {boilerplateCollapsed ? <FiChevronDown aria-hidden="true" /> : <FiChevronUp aria-hidden="true" />}
                  <span>{boilerplateCollapsed ? 'Show files' : 'Hide files'}</span>
                </button>

                <button className="primary boilerplate-download" onClick={downloadBoilerplate}>
                  <FiDownload aria-hidden="true" />
                  <span>Download project</span>
                </button>
              </div>
            </div>

            {!boilerplateCollapsed && (
              <div className="boilerplate-files">
                <div className="boilerplate-files-heading">
                  <span>Included in your starter</span>
                  <span>Project structure preview</span>
                </div>
                <ul>
                  {Object.keys(boilerplate.files).map(file => (
                    <li className="boilerplate-file" key={file} title={file}>
                      <FiFile aria-hidden="true" />
                      <span>{file}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <footer className="status">
          <span className={board ? 'online-dot' : 'offline-dot'} />
          {status}
        </footer>
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

      <AppDialog
        dialog={appDialog}
        onClose={() => setAppDialog(null)}
      />
    </main>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  )
}
