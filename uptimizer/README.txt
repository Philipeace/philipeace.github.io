# Uptimizer - Uptime Monitoring Tool v1.12.5

A simple, self-hosted uptime monitoring tool built with Python (Flask), PostgreSQL (via SQLAlchemy), and designed for configurability. Keepin' Tabs on the Tabs. ✨ Vibe Coded ✨

## File Structure Overview

uptimizer/
|-- app/                    # Main Flask application code
|   |-- static/             # CSS, JavaScript files
|   |   |-- script.js       # Main frontend JavaScript
|   |   `-- style.css
|   |-- templates/          # HTML templates
|   |   `-- index.html
|   |-- __init__.py         # Marks 'app' as a Python package
|   |-- main.py             # Flask app setup, init, run, state
|   |-- config.json         # Endpoint configuration (initial load & persistence)
|   |-- database.py         # SQLAlchemy DB interaction functions
|   |-- models.py           # SQLAlchemy ORM models, engine, session, table create
|   |-- routes.py           # Flask routes (Blueprint)
|   |-- checker.py          # Background check task logic
|   |-- config_manager.py   # Config file load/save logic
|   `-- requirements.txt    # Python dependencies
|-- test_server/            # Simple Flask server for testing checks
|   |-- server.py
|   |-- Dockerfile
|   `-- requirements.txt
|-- tests/                  # Application tests
|   |-- __init__.py
|   `-- test_app.py
|-- alembic/                # Alembic migration scripts (To be initialized)
|   |-- versions/
|   `-- env.py
|-- alembic.ini             # Alembic configuration (To be initialized)
|-- .env.example            # Example environment file (copy to .env)
|-- .gitignore              # Specifies intentionally untracked files
|-- Dockerfile              # Dockerfile for the main application
|-- docker-compose.yml      # Docker Compose for local development setup
`-- README.txt              # This file (YOU ARE HERE!)


## How to Run Locally (Using Docker)

1.  **Prerequisites:** Docker Desktop (or Engine + Compose) installed and running.
2.  **Get Code:** Clone or download the project.
3.  **Navigate:** Open terminal to project root.
4.  **Environment Variables:** Copy `.env.example` to `.env` and edit DB passwords. Optionally set `APP_BASE_PATH=/yourpath`.
5.  **Build & Run:** `docker-compose up --build -d`
6.  **Access App:** `http://localhost:5000` (or `http://localhost:5000/your_base_path`).
7.  **Stopping:** `docker-compose down` (add `-v` to remove DB volume).

## How to Use the Application

*   **Dashboard:** Displays monitored endpoints grouped by category (collapsible).
*   **Endpoint Info:** Columns: Name, URL, Interval(s), Timeout(s), Status, Details, 24h Uptime %, Actions (Edit/Delete). Shows global or per-endpoint interval/timeout.
*   **Adding Endpoints:** Click "+ Add New Endpoint". Fill form (Name, URL required; Group, Interval, Timeout optional). URL scheme (`https://`) auto-prefixed if missing. Warning if URL lacks ".". Saved to `app/config.json`.
*   **Editing Endpoints:** Click '✎'. Modal opens pre-filled. Modify fields and save. Saved to `app/config.json`. Group changes move item dynamically.
*   **Deleting Endpoints:** Click '×'. Confirm via modal. Removed from UI and `app/config.json`. History data remains in DB.
*   **Viewing History:** Click row (not buttons). Modal opens with response time chart (1h/24h/7d). Close via '×', Esc, or background click.
*   **Floating Elements:** Animated text/icons move randomly. Click "Toggle Floating Elements" button in footer to disable/enable (setting saved to `config.json`).
*   **Configuration Sync:**
    *   UI changes (Add/Edit/Delete/Toggle Floats) save to `app/config.json` and are live.
    *   Manual edits to `app/config.json` require clicking "Refresh Config from File" in the footer or restarting the app (`docker-compose restart uptimizer_app`) to take effect. Refreshing overwrites any unsaved UI state with the file content.

## Asset Instructions

*   **`app/config.json`:** Defines initial endpoints/settings and is the persistent store. Allows global `settings` (e.g., `check_interval_seconds`, `check_timeout_seconds`, `disable_floating_elements`) and per-endpoint `check_interval_seconds`, `check_timeout_seconds`.
*   **`.env` file:** For sensitive configuration like DB passwords and optional `APP_BASE_PATH`.

## Harmless Error Explanation

*   **Browser Console:** Ignore `Browsing Topics API removed`. May show `Failed to fetch` temporarily. URL dot warning is informational. 404 for `favicon.ico`.
*   **UI Display:** "PENDING" status; "--%" or "Stats Err"; Modal errors; Add/Edit form errors.
*   **Server Logs (Terminal):** Warnings for IDs; DB connection retries/errors (especially on first start if volume empty); Scheduler messages; Config save errors; DB operation errors.

## Full Project Backlog

**High Priority:**
*   [ ] **Database Migrations:** Implement Alembic workflow (`alembic init`, configure `env.py`, generate initial migration).
*   [ ] **Improve Testing:** Unit/integration tests (API, DB, Scheduler, Persistence, Edit, SQLAlchemy models).
*   [ ] **Summary Statistics Page/Dashboard:** A dedicated view for overall stats.
*   [ ] **Data Retention/Archiving:** Implement logic to prune old history or archive data for deleted endpoints.

**Medium Priority:**
*   [ ] **Per-Endpoint Settings UI:** Improve UI for editing settings.
*   [ ] **Notifications:** Implement alerting on status changes.
*   [ ] **Authentication:** Add basic user authentication.
*   [ ] **Chart Enhancements:** Status indicators; Custom date ranges; Data downsampling.
*   [ ] **Logging:** Implement structured logging (`logging` module).
*   [ ] **Configuration Validation:** Validate Edit payload; JSON Schema for `config.json`.
*   [ ] **Multi-Client Support:** UI/Backend changes for client separation.

**Low Priority / Future:**
*   [ ] **Advanced Checks:** HTTP methods, headers, content checks.
*   [ ] **ConfigMap Configuration:** Improve K8s ConfigMap integration (currently relies on file save/reload).
*   [ ] **Production WSGI:** Gunicorn/uWSGI setup.
*   [ ] **Concurrency:** Improve background check concurrency.
*   [ ] **Stats/History Performance:** Optimize queries/calculations.
*   [ ] **Floating Elements:** Collision detection, more pathing variety.
*   [ ] **Group Settings:** Allow configuring settings at the group level.
*   [ ] **Config API:** Add API endpoints to upload/download `config.json`.
*   [ ] **Storage Backends:** Add support for S3/Azure Blob/MinIO for config storage. *(Requires Ask)*
*   [ ] **Identity/Auth Integrations:** Keycloak OIDC, Azure Managed Identity. *(Requires Ask)*

**Requires User Input:**
*   [ ] Specific endpoint configurations for default testing in `config.json`.
*   [ ] Mockups/requirements for dedicated *summary* statistics page/overlay.
*   [ ] Preferred notification channels/formats.
*   [ ] Requirements for Advanced Checks.
*   [ ] Requirements/Prioritization for Multi-Client support.
*   [Confirm] **Proceed with Storage Backend Integration (S3/Azure/MinIO)?**
*   [Confirm] **Proceed with Identity/Auth Integration (Keycloak/Azure)?**

**Implemented Features (Summary):**
*   [X] Background Endpoint Checking (HTTP GET) w/ Per-Endpoint Intervals
*   [X] PostgreSQL History Storage (via SQLAlchemy ORM)
*   [X] Dynamic UI Updates (Status, Details, 24h Uptime %, Interval, Timeout)
*   [X] Collapsible Endpoint Groups
*   [X] Runtime Add/Delete/Edit Endpoints (Persistent via `config.json`)
*   [X] Detailed History Modal with Chart.js (1h/24h/7d)
*   [X] Configurable Check Interval (Global + Per-Endpoint) & Timeout (Global + Per-Endpoint)
*   [X] Dockerized Setup (App, DB, Test Server)
*   [X] Themed UI with JS-Animated Background Elements (Toggleable)
*   [X] Custom Delete Confirmation Modal
*   [X] Add/Edit Form Consolidation & Dynamic Group Moves
*   [X] Base Path Deployment Support
*   [X] Alembic Dependency Added
*   [X] Manual Config Reload Button/API
*   [X] Code Refactored into Modules (routes, checker, config_manager, models, database)

## AI Instructions (Core Development Rules, refactor but keep all messages individually still intact)

Overall Goal & Starting Point
User Provides:
Option A (New Project): Description of the web application or game (e.g., "a simple website hosting a game like X with theme Y").
Option B (Existing Project): Existing codebase (e.g., zipped, link to repo) OR set of refined requirements/tickets.
AI Delivers (New Project): Initial, simple, functional base version using standard web technologies (HTML, CSS, JavaScript, unless otherwise specified).
AI Delivers (Existing Project): Analysis of code/tickets and readiness for tasks or first backlog item.
Development Methodology: Iterative Backlog
Base Version / Initial State: Establish a working starting point.
Backlog Management (within README.txt):
AI maintains a categorized backlog (Features, UI/UX, Backend/Tech Debt, Requires User Input, etc.) within README.txt.
Prioritization: AI initially prioritizes features implementable without external user assets (unless readily generatable). Tasks needing user input are marked.
AI Proactivity: AI actively brainstorms and adds unique, relevant, creative features fitting the project's theme to the backlog.
Iterative Implementation:
User selects backlog item(s) or provides a new task.
AI implements selected features/tasks.
Cycle: Implement -> Present -> User Selects/Provides Task -> Implement...
Code Requirements
Full Code for Changes: Provide complete source code for all changed/new files in each iteration.
No Omissions: Do not use comments like // no changes here or omit code sections. Ensure full copy-paste readiness.
Clean Code & Standards: Adhere to Clean Code principles, professional standards. Use best practices, avoid deprecated features, prefer well-maintained libraries (confirm with user before adding).
Modularity: Structure code logically (separate files, modules, classes) as complexity grows.
Technology: Use appropriate standard tech (HTML, CSS, JS, Python, etc.) unless specified otherwise. Prefer native features.
Error Handling Policy
Bug Fixing Priority: Functional bugs reported by the user take absolute priority.
Harmless Error Explanation: If expected, non-breaking errors occur (e.g., 404s for optional assets), confirm functionality, explain the cause, and document in README.txt.
Documentation Requirements (Maintained within README.txt)
README.txt (Single Source of Truth - Maintain Continuously):
Project Title & Brief Description.
File Structure Overview: Maintain an up-to-date file tree (using plain text formatting).
How to Run Locally: Clear steps for various common setups (Simple Web, Docker, Python/Poetry, Node.js, etc. as relevant).
How to Play / Use the Application (updated with features).
Asset Instructions: Explain optional assets (location, naming).
Harmless Error Explanation: Detail any expected, non-breaking errors.
Full Project Backlog: Maintain the categorized backlog here.
AI Instructions (Embed This Section): Include these core development rules.
AI Response Format (Per Iteration)
Project Changelog (Cumulative): Full version history (v[Current]: ..., v[Previous]: ..., v1: Base version created.).
(Optional) Acknowledgment/Clarification: Address user feedback/bugs. Explain harmless errors if relevant.
Implemented Backlog Items: Briefly list items addressed.
Changed/New Files: For each modified/new file:
Provide the full, copy-paste ready code block.
Immediately after the code block, add a short, file-specific changelog as an HTML comment (<!-- File-Specific Changelog -->).
README.txt: Provide the complete, updated README.txt file.
Summary of Changes: Briefly summarize main functional changes delivered.
Next Steps / Backlog Suggestions: Suggest 2-3 relevant backlog items.
Roles & Collaboration ("Vibe Coding")
AI Role: Collaborative Developer. Implement tasks, suggest improvements, write clean code, maintain docs, ensure transparency.
User Role: Define goal, select tasks, test code, report bugs clearly, provide feedback/assets.