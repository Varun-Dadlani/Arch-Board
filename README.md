# ARCH-BOARD

> A real-time collaborative whiteboard for designing application architecture visually and generating boilerplate code from the architecture.

ARCH-BOARD helps developer teams sketch a basic system architecture using a drag-and-drop canvas. Developers can place components such as frontend services, backend services, databases, Redis, and other architecture nodes, connect them, collaborate in real time, save boards, and generate basic project boilerplate from the resulting architecture.

---

## ✨ Features

### 🧩 Visual Architecture Design
- Drag-and-drop architecture components onto a whiteboard.
- Connect components using edges to represent communication and dependencies.
- Edit and organize application architecture visually.

### 👥 Real-Time Collaboration
- Multiple users can work on the same board simultaneously.
- Real-time board updates are delivered using **WebSockets**.
- The backend maintains a live in-memory document for active boards.
- When a user joins or rejoins a board, the latest live document is sent immediately.
- A user's stale local state is not pushed automatically on reconnect, preventing an old client from overwriting another user's newer changes.
- Board members can use a real-time group chat; messages are saved in PostgreSQL and the latest 100 messages load when chat opens.

### 💾 Board Management
- Create new architecture boards.
- Load existing boards.
- Save board changes to PostgreSQL.
- Delete boards without requiring a page reload.
- The board dropdown updates immediately after deletion.


### 🔐 Authentication
- Secure user authentication.
- User-specific access to boards and application functionality.

### ⚙️ Boilerplate Generation
- Generate basic project boilerplate from the architecture represented on the board.
- Boilerplate can also be downloaded as an archive.

---

## 🏗️ Architecture

```text
                         ┌──────────────────────┐
                         │       React UI       │
                         │  Architecture Board  │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┴────────────────┐
                    │                                │
                  REST                            WebSocket
                    │                                │
                    ▼                                ▼
          ┌──────────────────┐            ┌──────────────────┐
          │  FastAPI Backend │            │ ConnectionManager│
          │                  │            │                  │
          │ Board CRUD       │            │ Rooms            │
          │ Authentication   │            │ Live documents   │
          │ Boilerplate      │            │ Chat broadcasts  │
          │ Board chat       │            │                  │
          └────────┬─────────┘            └────────┬─────────┘
                   │                               │
                   ▼                               ▼
          ┌──────────────────┐            ┌──────────────────┐
          │   PostgreSQL     │            │ Active Clients   │
          │                  │            │                  │
          │ Saved boards     │            │ User A           │
          │ JSON documents   │            │ User B           │
          │ Chat messages    │            │                  │
          └──────────────────┘            └──────────────────┘
```

---

## 📁 Project Structure

A typical project structure is:

```text
ARCH-BOARD/
│
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   ├── schemas/
│   │   ├── __init__.py
│   │   ├── boilerplate.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   └── realtime.py
│   │
│   └── requirements.txt
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
├── .env
├── .gitignore
└── README.md
```

> Adjust the directory names if your local repository uses a different structure.

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
python -m venv venv
```

Windows:

```bash
venv\Scripts\activate
```

macOS/Linux:

```bash
source venv/bin/activate
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
```

Add any other environment variables required by your authentication/configuration setup.

### 4. Start the Backend

Run the FastAPI application using your project's configured entry point, for example:

```bash
uvicorn app.main:app --reload
```

### 5. Start the Frontend

Install frontend dependencies:

```bash
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
