# ARCH-BOARD

> A real-time collaborative whiteboard for designing application architecture visually and generating boilerplate code from the architecture.

ARCH-BOARD helps developer teams sketch an application architecture using a drag-and-drop canvas. Developers can place frontend, backend, database, Redis, message queue, and storage components, connect them with edges, collaborate live, save boards to PostgreSQL, chat with collaborators, and generate downloadable project boilerplate from the architecture.

---

## ✨ Features

### 🧩 Visual Architecture Design
- Drag-and-drop architecture components onto a whiteboard.
- Connect components using edges to represent communication and dependencies.
- Edit and organize application architecture visually.

### 👥 Real-Time Collaboration
- Multiple users can work on the same board simultaneously.
- Real-time board updates are delivered using **WebSockets**.
- Redis stores the latest live board document for active collaboration, with a one-hour TTL.
- When a new client connects, it first receives Redis live state or falls back to the board saved in PostgreSQL.
- Presence updates show which board members are currently active.
- Redis Pub/Sub distributes live updates across FastAPI instances.
- Owners and editors can update the board; viewers have read-only access.
- A user's stale local state is not pushed automatically on reconnect, preventing an old client from overwriting another user's newer changes.
- Board members can use a real-time group chat; messages are saved in PostgreSQL and the latest 100 messages load when chat opens.

### 💾 Board Management
- Create new architecture boards.
- Load existing boards.
- Save board changes to PostgreSQL.
- Unsaved node and edge changes are kept temporarily in Redis and browser `sessionStorage` drafts.
- A successful save commits board data to PostgreSQL and clears the temporary Redis live document and browser draft.
- Switching boards preserves the current unsaved draft before opening another board.
- If Redis live state is unavailable or expired, reopening a board loads the last PostgreSQL saved version.
- Delete boards without requiring a page reload.
- The board dropdown updates immediately after deletion.


### 🔐 Authentication
- Registration and login with secure password hashing.
- JWT access tokens protect REST endpoints.
- JWT query-token authentication protects board WebSockets.
- Owner, editor, and viewer roles control board permissions.
- Owners can manage board membership and delete boards.

### ⚙️ Boilerplate Generation
- Generate basic project boilerplate from the architecture represented on the board.
- Generated files are based on technologies placed on the canvas, including FastAPI, Django, PostgreSQL, MySQL, MongoDB, Redis, and RabbitMQ.
- The generated-project preview shows included files and the project structure.
- Boilerplate can also be downloaded as an archive.

### 🎨 Interface
- Dedicated light and dark themes.
- React Flow canvas controls for editing and navigating architecture diagrams.
- Technology icons and labels for frontend, backend, database, cache, queue, and storage components.
- Board dialogs, member management, group chat, and generated-project preview panels.

## 📁 Project Structure

A typical project structure is:

```text
ARCH-BOARD/
│
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   ├── schemas/
│   │   ├── core/
│   │   ├── models/
│   │   ├── __init__.py
│   │   ├── boilerplate.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   └── realtime.py
│
├── frontend/
│   ├── dist/
│   ├── node_modules/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── catalog.js
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   └── vite.config.js
│
├── .venv/
├── .env
├── .gitignore
├── requirements.txt
├── architecture.md
└── README.md
```

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd ARCH-BOARD
```

### 2. Backend Setup

Create and activate a virtual environment:

```bash
python -m venv .venv
```

Windows:

```bash
.\.venv\Scripts\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file for the backend configuration.

Example:

```env
DATABASE_URL=postgresql+asyncpg://<username>:<password>@<host>:<port>/<database>
REDIS_HOST=<redis-host>
JWT_SECRET_KEY=<strong-random-secret>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://localhost:5173
```

Add any other environment variables required by your authentication/configuration setup.

### 4. Start the Backend

From the project root, enter the backend directory and run FastAPI:

```bash
cd backend
uvicorn app.main:app --reload
```

### 5. Start the Frontend

In a separate terminal, enter the frontend directory and install dependencies:

```bash
cd frontend
npm install
```

Start the development server:

```bash
npm run dev
```

Open the frontend URL shown by your development server.


---

## 📄 License

Add your preferred license here, such as MIT.

---

## 👨‍💻 Project

**ARCH-BOARD — Collaborative Architecture Whiteboard**

Built to make application architecture design more visual, collaborative, and developer-friendly.
