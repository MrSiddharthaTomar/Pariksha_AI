<div align="center">

# Pariksha AI

AI-proctored examination platform with biometric authentication, real-time violation logging, and multi-format assessments.

</div>

## Features
- **Face-authenticated onboarding** for both students and examiners.
- **Real-time AI proctoring** (YOLOv8) that ingests 6‑second webcam chunks, stores violations in MongoDB, and adjusts trust scores.
- **Flexible question bank** supporting MCQ, subjective, and coding items with reusable Question documents.
- **Targeted test delivery** via `allowedStudents` (email lists) and open tests (empty list).
- **Examiner tooling** for dashboard stats, manual test creation, AI-generated question drafts, and seeding utilities.

## Tech Stack
- **Frontend:** Vite + React + TypeScript + TailwindCSS/ShadCN.
- **Backend:** Node.js, Express, TypeScript, MongoDB/Mongoose.
- **Proctoring ML:** Python (YOLOv8 via Ultralytics) invoked per chunk.

---

## Prerequisites
| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | ≥ 18 | Needed for both client & server |
| npm | ≥ 9 | Ships with Node 18+ |
| Python | 3.10–3.12 | For the proctoring model (virtual env recommended) |
| MongoDB | 6.x+ | Local or Atlas cluster |
| FFmpeg | Latest | Required to extract frames from WebM chunks |

### Installing FFmpeg

**Windows** (Chocolatey):
```bash
choco install ffmpeg
```
Or download from [ffmpeg.org](https://ffmpeg.org/download.html)

**macOS**:
```bash
brew install ffmpeg
```

**Linux** (Debian/Ubuntu):
```bash
sudo apt-get update && sudo apt-get install ffmpeg
```

Verify installation:
```bash
ffmpeg -version
```

---

## Project Setup

```bash
git clone https://github.com/SanchitNegi177/Pariksha_AI.git
cd Pariksha_AI
```

### 1. Install Node dependencies
```bash
cd server
npm install

cd ../client
npm install
```

> **Important:** The backend now uses the CPU-only TensorFlow JS backend for Windows, so it avoids native `@tensorflow/tfjs-node` compilation and does not require Visual Studio C++ build tools.

### 2. Prepare the Python virtual environment

The ML proctoring model requires Python 3.10+ with specific packages. Choose one method:

#### Option A: Using Conda (Recommended)
```bash
# Create conda environment
conda create -n venv python=3.10
conda activate venv

# Install dependencies
pip install -r server/src/ml/requirements.txt

# Get the Python path (save this for .env)
python -c "import sys; print(sys.executable)"
```

#### Option B: Using venv
```bash
cd server/src/ml
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Get the Python path (save this for .env)
python -c "import sys; print(sys.executable)"
```

### 3. Configure environment variables
Create `server/.env` (see template below) and `client/.env`.

#### `server/.env`
```
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017/pariksha_ai
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
JWT_SECRET=
JWT_EXPIRES_IN=


# CRITICAL: Point to your Python environment with ML dependencies installed
# Windows (Conda):
# PROCTORING_PYTHON=C:\Users\your-username\anaconda3\envs\pariksha-ai\python.exe
# Windows (venv):
# PROCTORING_PYTHON=C:\full\path\to\Pariksha_AI\server\src\ml\venv\python.exe
# macOS/Linux (venv):
# PROCTORING_PYTHON=/full/path/to/server/src/ml/venv/bin/python

# If not set, Node.js will auto-detect from CONDA_PREFIX or PYTHON_PATH env vars
PROCTORING_PYTHON=
```
> **Important:** Set `PROCTORING_PYTHON` to the absolute path of the Python interpreter where you installed ML dependencies. Use the path from `python -c "import sys; print(sys.executable)"` above.

#### `client/.env`
```
VITE_API_BASE_URL=http://localhost:3000
VITE_PORT=5173
VITE_NODE_ENV=development
```

### 4. Optional: Seed data
After the server env is configured:
```bash
cd server
npx ts-node scripts/seedSampleTest.ts
```
This creates a sample “AI Fundamentals Practice Test” assigned to `sanchitnegi177@gmail.com`.

---

## Running the App

```bash
# Backend
cd server
npm run dev

# Frontend (new terminal)
cd client
npm run dev
```

The Vite dev server prints the local URL (default `http://localhost:5173`).

---

## Using the Platform
1. **Register** an examiner and/or student (face capture required).
2. **Create** a test manually or via AI generation (supports MCQ, coding, subjective).
3. **Assign** students by email using the `allowedStudents` field (leave empty to make the test visible to all authenticated students).
4. **Students** log in, review rules, and start their test. Webcam/audio streams are chunked every 6 seconds for proctoring.
5. **Violations** (multiple faces, devices, missing student, etc.) are logged to `ProctoringLog`, snapshots stored via GridFS, and `ExamAttempt.trustScore` is reduced automatically.
6. **Submissions** store responses, scoring, and trust summaries; no bulky recordings are persisted.

---

## Verifying Proctoring
1. Keep the backend terminal visible; you’ll see entries such as:
   ```
   ⚠ Violation detected for student 65f... : Multiple faces detected (high)
   ```
2. Inspect MongoDB:
   ```js
   use pariksha_ai
   db.proctoringlogs.find().sort({createdAt:-1}).limit(5)
   db.examattempts.find({}, {testId:1, studentId:1, trustScore:1, totalViolations:1})
   ```
3. Ensure FFmpeg is installed and the `PROCTORING_PYTHON` path is valid; errors print directly in the backend log.

---

## Troubleshooting
- **"Missing required fields" on submit:** restart the backend to load the latest server code (submission no longer uploads blobs).
- **No violations despite cheating:** 
  - Verify Python environment has `ultralytics opencv-python numpy torch torchvision` installed
  - Confirm FFmpeg is installed: `ffmpeg -version`
  - Check backend logs for "[ML]" and "[PROCTOR]" prefixes
  - Ensure video chunks are being received every 6 seconds
- **Client can't reach API:** confirm `VITE_API_BASE_URL` matches the running server and that `CORS_ORIGIN` allows the client URL.
- **Python binary not found:**
  - Check that `PROCTORING_PYTHON` env var points to correct Python executable
  - Verify the path exists: `Test-Path "C:\path\to\python.exe"` (Windows) or `test -f /path/to/python` (macOS/Linux)
  - If using conda, ensure environment is activated when setting `PROCTORING_PYTHON`
- **WebM video won't process:**
  - FFmpeg must be installed and accessible from PATH
  - Check FFmpeg installation: `ffmpeg -version`
  - On Windows, you may need to restart terminal after installing FFmpeg for PATH to update

---

## Useful Commands
| Action | Command |
|--------|---------|
| Start backend | `cd server ; npm run dev;` |
| Start frontend | `cd client; npm run dev;` |
| Build backend | `cd server; npm run build;` |
| Build frontend | `cd client; npm run build;` |
| Seed sample test | `cd server; npx ts-node scripts/seedSampleTest.ts;` |

---
## 📄 More Details
See full documentation here → [INFO.md](./INFO.md)

## License
No license has been applied to this project yet.
