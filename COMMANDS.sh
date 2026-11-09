# AquaSense Server Startup Commands

# ============================================================
# TERMINAL 1: Start Backend Server
# ============================================================
# Copy and paste this into PowerShell/Terminal 1:

cd Backend
npm run dev

# Expected output:
# Server is running on http://localhost:5001
# ✓ Database connected: AquaSense on localhost:5432
# ✓ Backend is connected to PostgreSQL database


# ============================================================
# TERMINAL 2: Start Frontend Server (DIFFERENT TERMINAL!)
# ============================================================
# Open a NEW terminal/PowerShell window and paste this:

cd Frontend
npm run dev

# Expected output:
# ➜  Local:   http://localhost:3000/


# ============================================================
# Then open in your browser:
# http://localhost:3000
# ============================================================
