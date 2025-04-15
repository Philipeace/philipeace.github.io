# Uptimizer - Uptime Monitoring Tool v1.13.0

A simple, self-hosted uptime monitoring tool built with Python (Flask), PostgreSQL (via SQLAlchemy + Alembic), and designed for configurability and multi-client support (future). Keepin' Tabs on the Tabs. ✨ Vibe Coded ✨

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
|   |-- config.json         # Endpoint/Client configuration (load & persistence)
|   |-- database.py         # SQLAlchemy DB interaction functions
|   |-- models.py           # SQLAlchemy ORM models, engine, session, table create
|   |-- routes.py           # Flask routes (Blueprint)
|   |-- checker.py          # Background check task logic
|   |-- config_manager.py   # Config file load/save logic
|   |-- state.py            # Shared application state and constants
|   `-- requirements.txt    # Python dependencies
|-- test_server/            # Simple Flask server for testing checks
|   |-- server.py
|   |-- Dockerfile
|   `-- requirements.txt
|-- tests/                  # Application tests
|   |-- __init__.py
|   `-- test_app.py
|-- alembic/                # Alembic migration scripts
|   |-- versions/           # Migration files (e.g., ..._initial_schema.py)
|   `-- env.py              # Alembic environment setup
|-- alembic.ini             # Alembic configuration
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
6.  **Database Migrations (First Run/Updates):**
    *   After the containers are up, run Alembic migrations *from your host machine* (ensure Python environment has dependencies from `app/requirements.txt` installed: `pip install -r app/requirements.txt`):
    *   `alembic -c alembic.ini upgrade head`
    *   This applies necessary database schema changes. You only need to run this when the database schema changes (check changelogs).
7.  **Access App:** `http://localhost:5000` (or `http://localhost:5000/your_base_path`). Allow a few moments after migration for the app to fully connect.
8.  **Stopping:** `docker-compose down` (add `-v` to remove DB volume - **WARNING:** This deletes DB data).

## How to Use the Application

*   **Dashboard:** Displays global settings (Interval, Timeout). Endpoints are grouped by Client (currently only "Default Client" shown), then by internal Group (collapsible). Statuses update automatically.
*   **Endpoint Info:** Columns: Name, URL, Status, Details, 24h Uptime %, Actions (Edit/Delete).
*   **Adding/Editing/Deleting Endpoints:** Buttons currently operate on the "Default Client". Saved to `app/config.json`.
*   **Viewing History:** Click endpoint row. Modal opens with response time line and status visualized as colored dots along the x-axis (Green=UP, Red=DOWN, Orange=ERROR).
*   **Floating Elements:** Toggle applies to the "Default Client" for now (setting saved to `app/config.json` under the client).
*   **Configuration Sync:** UI changes save to `config.json`. Manual edits require clicking "Refresh Config from File" (prompts page refresh via modal) or app restart.

## Asset Instructions

*   **`app/config.json`:** Defines `global_settings` and nested `clients` data (including client `settings` and `endpoints`). See example in file.
*   **`.env` file:** For DB credentials and optional `APP_BASE_PATH`. Used by both app and Alembic.
*   **`alembic/versions/`:** Contains database migration scripts.

## Harmless Error Explanation

*   **Browser Console:** Ignore `Browsing Topics API removed`. May show `Failed to fetch` temporarily. URL dot warning is informational. 404 for `favicon.ico`.
*   **UI Display:** "PENDING" status briefly; "--%" or "Stats Err" before first stats calculation; Modal errors; Add/Edit form errors.
*   **Server Logs (Terminal):** Warnings for IDs; DB connection retries/errors; `DB INFO: Attempting table creation...`; Scheduler messages; Config save errors; DB operation errors; `API WARN: ... returning DB N/A` if requests hit before DB/tables ready. Alembic logs during migration runs.

## Full Project Backlog

**High Priority:**
*   [ ] **Multi-Client UI:** Implement UI for selecting/managing clients. Update Add/Edit/Delete/Toggle actions to target the selected client.
*   [ ] **Improve Testing:** Unit/integration tests (API, DB, Scheduler, Persistence, Edit, Models, Alembic migrations).
*   [ ] **Summary Statistics Page/Dashboard:** A dedicated view for overall stats (potentially per-client).
*   [ ] **Data Retention/Archiving:** Implement logic to prune old history.

**Medium Priority:**
*   [ ] **Global/Client Settings UI:** Allow editing global and client settings via the UI. Update scheduler dynamically on interval change.
*   [ ] **Notifications:** Implement alerting on status changes (per client?).
*   [ ] **Authentication/RBAC:** Add basic user auth. Integrate Keycloak/OIDC for client separation/RBAC based on groups. *(Requires User Input)*
*   [ ] **Chart Enhancements:** Status indicators (beyond points); Custom date ranges; Data downsampling for large history.
*   [ ] **Logging:** Implement structured logging (`logging` module).
*   [ ] **Configuration Validation:** JSON Schema for `config.json`.

**Low Priority / Future:**
*   **Kubernetes Operator:**
    *   [ ] Define Custom Resource Definition (CRD) for Uptimizer clients/endpoints.
    *   [ ] Implement Kubernetes Operator logic (using Kopf or similar) to manage Uptimizer based on CRDs.
    *   [ ] Package operator for deployment (Helm chart?).
    *   [ ] Setup local Minikube/Kind testing environment for operator development.
*   **Uptimizer K8s Client:**
    *   [ ] Add mode to Uptimizer app (`--client-mode`?) that disables UI/DB/checking.
    *   [ ] Implement logic to discover services/ingresses in a K8s cluster based on annotations/labels.
    *   [ ] Expose an API endpoint (`/cluster-status`?) reporting discovered healthy endpoints.
    *   [ ] Allow central Uptimizer instance to register these clients via `uptimize://cluster-endpoint` URL (parsed to HTTPS).
    *   [ ] Allow registering cluster endpoints directly into an existing client view in the central instance.
*   **Advanced Checks:** HTTP methods, headers, content checks.
*   **Production WSGI:** Gunicorn/uWSGI setup.
*   **Concurrency:** Improve background check concurrency.
*   **Stats/History Performance:** Optimize queries/calculations for many endpoints/clients.
*   **Group Settings:** Allow configuring settings at the group level within a client.
*   **Config API:** Add API endpoints to upload/download `config.json`.
*   **Storage Backends:** Add support for S3/Azure Blob/MinIO for config storage. *(Requires Ask)*
*   **Identity/Auth Integrations:** Azure Managed Identity support. *(Requires Ask)*

**Requires User Input:**
*   [ ] Client management UI requirements.
*   [ ] Requirements for Summary Statistics page.
*   [ ] Preferred notification channels/formats.
*   [ ] Requirements for Advanced Checks.
*   [ ] Requirements/Prioritization for Multi-Client Auth/RBAC (Keycloak details?).
*   [Confirm] **Proceed with Storage Backend Integration (S3/Azure/MinIO)?**
*   [Confirm] **Proceed with other Identity/Auth Integration (Azure Managed Identity)?**

**Implemented Features (Summary):**
*   [X] Background Endpoint Checking (HTTP GET) w/ Per-Endpoint Overrides
*   [X] PostgreSQL History Storage (via SQLAlchemy ORM)
*   [X] Alembic Database Migrations Initialized
*   [X] Multi-Client Data Structure (Backend) w/ Default Client
*   [X] Dynamic UI Updates (Status, Details, 24h Uptime %)
*   [X] Collapsible Endpoint Groups (per Client)
*   [X] Runtime Add/Delete/Edit Endpoints (Default Client only via UI) (Persistent via `config.json`)
*   [X] Detailed History Modal with Chart.js (Response Time + Status Visualization)
*   [X] Configurable Check Interval & Timeout (Global + Per-Endpoint)
*   [X] Global Settings Display (Read-Only)
*   [X] Dockerized Setup (App, DB, Test Server)
*   [X] Themed UI with JS-Animated Background Elements (Toggleable per Client)
*   [X] Custom Delete/Reload Confirmation Modals
*   [X] Base Path Deployment Support
*   [X] Code Refactored into Modules
*   [X] Robust DB/Table Initialization & Config Loading

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