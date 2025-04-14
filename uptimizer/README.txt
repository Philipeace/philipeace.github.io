# Uptimizer - Uptime Monitoring Tool v1.9

A simple, self-hosted uptime monitoring tool built with Python (Flask), PostgreSQL, and designed for configurability. Keepin' Tabs on the Tabs. ✨ Vibe Coded ✨

## File Structure Overview

```text
uptimizer/
├── app/                    # Main Flask application code
│   ├── static/             # CSS, JavaScript files
│   │   └── style.css
│   ├── templates/          # HTML templates
│   │   └── index.html
│   ├── __init__.py         # Marks 'app' as a Python package
│   ├── main.py             # Flask application entry point, routes, scheduler
│   ├── config.json         # Endpoint configuration (initial load & persistence)
│   ├── database.py         # Database connection and interaction logic
│   └── requirements.txt    # Python dependencies for the app
├── test_server/            # Simple Flask server for testing checks
│   ├── server.py           # Test server code
│   ├── Dockerfile          # Dockerfile for the test server
│   └── requirements.txt    # Python dependencies for the test server
├── tests/                  # Application tests
│   ├── __init__.py         # Marks 'tests' as a Python package
│   └── test_app.py         # Basic test cases
├── .gitignore              # Specifies intentionally untracked files
├── Dockerfile              # Dockerfile for the main application
├── docker-compose.yml      # Docker Compose for local development setup
└── README.txt              # This file (YOU ARE HERE!)
Use code with caution.
Text
How to Run Locally (Using Docker)
Prerequisites:
Docker Desktop (or Docker Engine + Docker Compose) installed and running.
Get the Code:
Clone or download the project repository/files.
Navigate to Project Root:
Open a terminal or command prompt.
Change directory to the project's root folder (the one containing docker-compose.yml, e.g., cd /path/to/uptimizer).
Environment Variables (Optional but Recommended):
Create a file named .env in the project root directory.
Add environment variables here to override defaults, especially database credentials. Example .env file:
# .env
DB_PASSWORD=ChangeMePlease123!
POSTGRES_PASSWORD=ChangeMePlease123!
Use code with caution.
Dotenv
Build and Run Containers:
Execute the command:
docker-compose up --build -d
Use code with caution.
Bash
--build: Rebuilds the application image if needed.
-d: Runs containers in detached mode (in the background).
This starts uptimizer_app, uptimizer_db, and uptimizer_test_server.
You can view logs using: docker-compose logs -f uptimizer_app (or _db, _test_server).
Access the Application:
Open your web browser and navigate to: http://localhost:5000
Stopping the Application:
Run: docker-compose down (stops and removes containers)
To also remove the database volume (deleting all history!), run: docker-compose down -v
How to Use the Application
Dashboard Overview: Displays monitored endpoints grouped by category. Groups are collapsible.
Endpoint Information: Shows Name, URL, Status, Details (Response Time/Error), 24h Uptime %, and Actions (Delete).
Adding Endpoints:
Expand the "Add New Endpoint" section.
Fill in Name, URL, optional Group, and optional Timeout (seconds).
Click "Add Endpoint". The endpoint appears dynamically and is saved to app/config.json.
Deleting Endpoints:
Click the red '×' button in the Actions column.
Confirm deletion. The endpoint is removed dynamically and from app/config.json. History data remains in the DB.
Viewing History:
Click anywhere on an endpoint's row (except the Delete button).
A modal opens with a response time chart.
Use buttons (1h, 24h, 7d) to change the time period.
Close the modal via '×', Esc key, or clicking the background.
Visuals: Features a Wine/Dark Green theme with Cocoa/Vermilion accents and gradients. Numerous floating text elements and icons move randomly across the entire background.
Persistence: Added/deleted endpoints are saved to app/config.json.
Asset Instructions
app/config.json:
Defines the initial endpoints loaded on startup.
Acts as persistent storage for runtime changes (Add/Delete).
Structure: Allows global settings (like check_interval_seconds, check_timeout_seconds) and an endpoints array. Each endpoint object requires id, name, url, and can optionally have group and check_timeout_seconds (which overrides the global timeout). See example in project files.
Manual Edits: Best practice is to stop the application (docker-compose down), edit the file, then restart (docker-compose up --build). Editing while running might be overwritten by UI actions.
External Assets: None required.
Harmless Error Explanation
Browser Console: Ignore messages like Browsing Topics API removed. May show Failed to fetch briefly if the backend is restarting or under heavy load.
UI Display: "PENDING" status on new/restarted items; "--%" or "Stats Err" for stats; Modal errors if history fetch fails. Add form errors for invalid input/save failures.
Server Logs (Terminal): Warnings for IDs during initial load; DB connection retries on startup; Occasional scheduler skip messages if check cycle is slow (now less likely with coalesce=True); Errors during DB operations or config saving if issues occur (e.g., permissions).
Full Project Backlog
High Priority:
Edit Endpoint (API/UI): Add functionality to modify existing endpoints.
Database Abstraction/ORM: Refactor database.py using SQLAlchemy.
Database Migrations: Implement Alembic for schema management.
Improve Testing: Unit/integration tests (API, DB, Scheduler, Persistence).
Summary Statistics Page/Dashboard: A dedicated view for overall stats.
Medium Priority:
Per-Endpoint Settings UI: Add UI (modal/inline form) to edit per-endpoint settings (timeout).
Notifications: Implement alerting on status changes (e.g., email, webhooks).
Authentication: Add basic user authentication.
Chart Enhancements: Status indicators; Custom date ranges; Data downsampling.
Logging: Implement structured logging (logging module).
Data Retention/Archiving: Implement logic to prune old history or archive data.
Configuration Validation: Validate Add/Edit payload; JSON Schema for config.json.
Custom Delete Confirmation: Replace browser confirm() with styled modal.
Low Priority / Future:
Advanced Checks: HTTP methods, headers, content checks.
ConfigMap Configuration: Improve K8s ConfigMap integration.
Production WSGI: Gunicorn/uWSGI setup.
Concurrency: Improve background check concurrency (ThreadPoolExecutor).
Stats/History Performance: Optimize queries/calculations.
Floating Elements Randomness: Further refine JS movement if needed.
Group Settings: Allow configuring settings (interval/timeout) at the group level.
Requires User Input:
Specific endpoint configurations for default testing in config.json.
Mockups/requirements for dedicated summary statistics page/overlay.
Preferred notification channels/formats.
Detailed requirements/mockups for Edit Endpoint UI.
Requirements for Advanced Checks (methods, headers, content matching).
Implemented Features (Summary):
Background Endpoint Checking (HTTP GET)
PostgreSQL History Storage
Dynamic UI Updates (Status, Details, 24h Uptime %)
Collapsible Endpoint Groups
Runtime Add/Delete Endpoints (Persistent via config.json)
Detailed History Modal with Chart.js (1h/24h/7d)
Configurable Check Interval (Global) & Timeout (Global + Per-Endpoint)
Dockerized Setup (App, DB, Test Server)
Themed UI with Animated Background Elements
AI Instructions (Core Development Rules)
Overall Goal: Develop "uptimizer".
Methodology: Iterative backlog. Maintain README.txt.
Implementation: User selects/provides tasks. AI implements with full code.
Code Requirements: Full, clean, standard-compliant code. Appropriate tech. Modularity. No omissions. Copy-paste ready and syntactically correct.
Error Handling: Fix functional bugs first. Explain/document harmless errors.
Documentation: Maintain README.txt (Title, File Structure, Run Locally, Use App, Assets, Errors, Backlog, AI Instructions). Plain text file tree.
Response Format: Changelog, Acknowledgment, Implemented Items, Changed/New Files (w/ file changelogs), Full README.txt, Summary, Test Instructions, Next Steps.
Roles & Collaboration: AI=Developer, User=Director/Tester. Follow "Vibe Coding".