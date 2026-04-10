"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processVideoChunkWithML = processVideoChunkWithML;
exports.extractFrameFromVideo = extractFrameFromVideo;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function resolvePythonBinary() {
    const candidates = [
        process.env.PROCTORING_PYTHON,
        process.env.PYTHON_PATH,
    ];
    const venvNames = ['.venv', 'venv'];
    const exeName = process.platform === 'win32' ? 'python.exe' : 'python';
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    for (const name of venvNames) {
        candidates.push(path.join(process.cwd(), name, binDir, exeName));
        candidates.push(path.join(__dirname, '..', '..', name, binDir, exeName));
    }
    candidates.push('python3', 'python');
    console.log('[ML] Python resolution candidates:', candidates.filter(c => c));
    for (const candidate of candidates) {
        if (!candidate)
            continue;
        // First check if file exists (for full paths)
        if (fs.existsSync(candidate)) {
            console.log(`[ML] ✓ Found Python binary: ${candidate}`);
            return candidate;
        }
        // Check if it's a command name (not a path)
        if (!candidate.includes(path.sep)) {
            console.log(`[ML] ✓ Using Python command: ${candidate}`);
            return candidate;
        }
    }
    console.log('[ML] ⚠️  No Python binary found, falling back to "python"');
    return 'python';
}
const PYTHON_BIN = resolvePythonBinary();
const MODEL_SCRIPT = path.join(__dirname, '../ml/procturingModel.py');
const TEMP_DIR = path.join(process.cwd(), 'temp');
function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
}
/**
 * Process video chunk with ML model to detect cheating/suspicious behavior
 * @param videoBuffer - Video chunk buffer (10 seconds)
 * @returns Promise with detection results
 */
async function processVideoChunkWithML(videoBuffer) {
    try {
        ensureTempDir();
        const chunkPath = path.join(TEMP_DIR, `chunk_${Date.now()}_${process.pid}.webm`);
        fs.writeFileSync(chunkPath, videoBuffer);
        // Verify the file was written
        const fileStats = fs.statSync(chunkPath);
        console.log(`[ML] Video chunk written: ${chunkPath} (${fileStats.size} bytes)`);
        const args = [
            MODEL_SCRIPT,
            '--mode',
            'analyze-video',
            '--video',
            chunkPath,
            '--max-frames',
            (process.env.PROCTORING_MAX_FRAMES || '8').toString(),
            '--quiet'
            // Removed --quiet to see debug output
        ];
        console.log(`[ML] Processing video chunk (${videoBuffer.length} bytes)...`);
        console.log(`[ML] Using Python: ${PYTHON_BIN}`);
        console.log(`[ML] Script: ${MODEL_SCRIPT}`);
        let stdout = '';
        let stderr = '';
        try {
            const result = await execFileAsync(PYTHON_BIN, args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
            stdout = result.stdout?.trim() || '';
            stderr = result.stderr?.trim() || '';
            console.log(`[ML] Python output: ${stdout}`);
        }
        catch (error) {
            stderr = error?.stderr?.toString() || error.message || '';
            stdout = error?.stdout?.toString() || '';
            console.error('[ML] Python execution error:', {
                code: error.code,
                signal: error.signal,
                stderr,
                stdout,
            });
        }
        let parsed = null;
        if (stdout) {
            try {
                const lines = stdout.split('\n').filter(Boolean);
                const jsonLine = lines.pop() || '{}';
                parsed = JSON.parse(jsonLine);
                console.log(`[ML] Parsed result:`, parsed);
            }
            catch (parseErr) {
                console.error('[ML] Failed to parse python model output:', parseErr);
                console.error('[ML] Stdout was:', stdout);
            }
        }
        // Clean up temp file
        try {
            fs.unlinkSync(chunkPath);
        }
        catch (e) {
            // Ignore cleanup errors
        }
        if (parsed && typeof parsed === 'object') {
            if (parsed.hasViolation) {
                console.log(`[ML] ⚠ Violation detected: ${parsed.violationType} (${parsed.severity})`);
            }
            return {
                hasViolation: !!parsed.hasViolation,
                violationType: parsed.violationType,
                severity: parsed.severity,
                description: parsed.details,
                details: stderr || parsed.error,
            };
        }
        if (stderr) {
            console.error('[ML] Python model stderr:', stderr);
        }
        console.log('[ML] No violation detected in chunk');
        return { hasViolation: false };
    }
    catch (error) {
        console.error('[ML] Error processing video chunk with ML:', error.message);
        return { hasViolation: false };
    }
}
/**
 * Extract a frame from video buffer for ML processing
 *
 * @param videoBuffer - Video chunk buffer
 * @returns Base64 encoded image of a frame
 */
async function extractFrameFromVideo(videoBuffer) {
    try {
        ensureTempDir();
        const tempVideoPath = path.join(TEMP_DIR, `chunk_${Date.now()}_${process.pid}.webm`);
        const tempImagePath = path.join(TEMP_DIR, `frame_${Date.now()}_${process.pid}.jpg`);
        fs.writeFileSync(tempVideoPath, videoBuffer);
        try {
            // Use ffmpeg to extract a frame (middle of video)
            // Install ffmpeg: https://ffmpeg.org/download.html
            await execAsync(`ffmpeg -i "${tempVideoPath}" -ss 00:00:05 -vframes 1 "${tempImagePath}" -y`);
            // Read the extracted frame
            const frameBuffer = fs.readFileSync(tempImagePath);
            const base64Image = frameBuffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64Image}`;
            // Cleanup temp files
            fs.unlinkSync(tempVideoPath);
            fs.unlinkSync(tempImagePath);
            return dataUrl;
        }
        catch (ffmpegError) {
            // If ffmpeg is not available, use a placeholder or return empty
            console.warn('FFmpeg not available, using placeholder frame');
            // Cleanup
            if (fs.existsSync(tempVideoPath))
                fs.unlinkSync(tempVideoPath);
            if (fs.existsSync(tempImagePath))
                fs.unlinkSync(tempImagePath);
            // Return a placeholder (you might want to handle this differently)
            return '';
        }
    }
    catch (error) {
        console.error('Error extracting frame from video:', error);
        return '';
    }
}
