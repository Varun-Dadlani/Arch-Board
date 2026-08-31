# ARCH-BOARD

ARCH-BOARD is a real-time collaborative architecture whiteboard. Teams design a system with technology-aware nodes and edges, then generate stack-specific starter projects.

## Initial stack

- Frontend: React, Vite, React Flow
- Backend: FastAPI and WebSockets
- Data: PostgreSQL
- Local development: FastAPI, PostgreSQL, and Vite

## Run locally

1. Set your local PostgreSQL password in `.env`.
2. Create the `archboard` PostgreSQL database.
3. Start the FastAPI backend from `backend/`.
4. Start the Vite frontend from `frontend/`.

The first vertical slice persists boards as structured JSON and broadcasts board edits to every collaborator connected to the same board room.

See the complete diagrammatic workflow in [docs/workflow.md](docs/workflow.md).
