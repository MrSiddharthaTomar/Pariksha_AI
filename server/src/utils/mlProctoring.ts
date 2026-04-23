import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec, execFile } from 'child_process';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function resolvePythonBinary() {
  const candidates: (string | undefined)[] = [
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
    if (!candidate) continue;
    
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
const ENABLE_FFMPEG_FALLBACK = (process.env.PROCTORING_ENABLE_FFMPEG_FALLBACK || 'false').toLowerCase() === 'true';

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
export async function processVideoChunkWithML(
  videoBuffer: Buffer
): Promise<{
  hasViolation: boolean;
  violationType?: string;
  severity?: 'low' | 'medium' | 'high';
  confidence?: number;
  description?: string;
  details?: string;
}> {
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
    } catch (error: any) {
      stderr = error?.stderr?.toString() || error.message || '';
      stdout = error?.stdout?.toString() || '';
      console.error('[ML] Python execution error:', {
        code: error.code,
        signal: error.signal,
        stderr,
        stdout,
      });
    }

    let parsed: any = null;
    if (stdout) {
      try {
        const lines = stdout.split('\n').filter(Boolean);
        const jsonLine = lines.pop() || '{}';
        parsed = JSON.parse(jsonLine);
        console.log(`[ML] Parsed result:`, parsed);
      } catch (parseErr) {
        console.error('[ML] Failed to parse python model output:', parseErr);
        console.error('[ML] Stdout was:', stdout);
      }
    }

    // Clean up temp file
    try {
      fs.unlinkSync(chunkPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    if (parsed && typeof parsed === 'object') {
      const parsedConfidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : undefined;
      if (parsed.hasViolation) {
        console.log(
          `[ML] ⚠ Violation detected: ${parsed.violationType} (${parsed.severity}) confidence=${
            parsedConfidence ?? 'n/a'
          }`
        );
      }
      return {
        hasViolation: !!parsed.hasViolation,
        violationType: parsed.violationType,
        severity: parsed.severity,
        confidence: parsedConfidence,
        description: parsed.details,
        details: stderr || parsed.error,
      };
    }

    if (stderr) {
      console.error('[ML] Python model stderr:', stderr);
    }

    console.log('[ML] No violation detected in chunk');
    return { hasViolation: false };
  } catch (error: any) {
    console.error('[ML] Error processing video chunk with ML:', error.message);
    return { hasViolation: false };
  }
}

export async function processFrameImageWithML(
  frameDataUrl: string
): Promise<{
  hasViolation: boolean;
  violationType?: string;
  severity?: 'low' | 'medium' | 'high';
  confidence?: number;
  description?: string;
  details?: string;
}> {
  try {
    if (!frameDataUrl || !frameDataUrl.startsWith('data:image/')) {
      return { hasViolation: false, details: 'invalid frame image data' };
    }

    ensureTempDir();
    const imagePath = path.join(TEMP_DIR, `frame_${Date.now()}_${process.pid}.jpg`);
    const base64Data = frameDataUrl.includes(',')
      ? frameDataUrl.split(',')[1]
      : frameDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(imagePath, imageBuffer);

    const args = [MODEL_SCRIPT, '--mode', 'analyze-image', '--image', imagePath, '--quiet'];
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync(PYTHON_BIN, args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
      stdout = result.stdout?.trim() || '';
      stderr = result.stderr?.trim() || '';
    } catch (error: any) {
      stderr = error?.stderr?.toString() || error.message || '';
      stdout = error?.stdout?.toString() || '';
    }

    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    } catch {
      // ignore cleanup errors
    }

    let parsed: any = null;
    if (stdout) {
      try {
        const lines = stdout.split('\n').filter(Boolean);
        const jsonLine = lines.pop() || '{}';
        parsed = JSON.parse(jsonLine);
      } catch {
        parsed = null;
      }
    }

    if (parsed && typeof parsed === 'object') {
      const parsedConfidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : undefined;
      return {
        hasViolation: !!parsed.hasViolation,
        violationType: parsed.violationType,
        severity: parsed.severity,
        confidence: parsedConfidence,
        description: parsed.details,
        details: stderr || parsed.error,
      };
    }

    return { hasViolation: false, details: stderr || 'image analysis returned no parsable output' };
  } catch (error: any) {
    return { hasViolation: false, details: error?.message || 'image analysis failed' };
  }
}

/**
 * Extract a frame from video buffer for ML processing
 * 
 * @param videoBuffer - Video chunk buffer
 * @returns Base64 encoded image of a frame
 */
export async function extractFrameFromVideo(videoBuffer: Buffer): Promise<string> {
  try {
    ensureTempDir();
    const tempVideoPath = path.join(TEMP_DIR, `chunk_${Date.now()}_${process.pid}.webm`);
    const tempImagePath = path.join(TEMP_DIR, `frame_${Date.now()}_${process.pid}.jpg`);

    fs.writeFileSync(tempVideoPath, videoBuffer);
    
    try {
      if (!ENABLE_FFMPEG_FALLBACK) {
        console.log('[ML] FFmpeg fallback disabled; skipping server-side frame extraction');
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
        return '';
      }

      // Try multiple FFmpeg approaches for WebM files
      let ffmpegSuccess = false;
      
      // First attempt: standard extraction
      try {
        await execAsync(
          `ffmpeg -i "${tempVideoPath}" -ss 00:00:05 -vframes 1 "${tempImagePath}" -y`,
          { timeout: 10000 }
        );
        ffmpegSuccess = true;
      } catch (firstError) {
        console.warn('FFmpeg standard extraction failed, trying alternative...');
        
        // Second attempt: with explicit format
        try {
          await execAsync(
            `ffmpeg -f webm -i "${tempVideoPath}" -ss 00:00:05 -vframes 1 "${tempImagePath}" -y`,
            { timeout: 10000 }
          );
          ffmpegSuccess = true;
        } catch (secondError) {
          console.warn('FFmpeg alternative extraction failed, trying basic extraction...');
          
          // Third attempt: basic extraction without seeking
          try {
            await execAsync(
              `ffmpeg -i "${tempVideoPath}" -vframes 1 "${tempImagePath}" -y`,
              { timeout: 10000 }
            );
            ffmpegSuccess = true;
          } catch (thirdError) {
            console.error('All FFmpeg extraction attempts failed:', thirdError instanceof Error ? thirdError.message : String(thirdError));
          }
        }
      }
      
      if (ffmpegSuccess && fs.existsSync(tempImagePath)) {
        // Read the extracted frame
        const frameBuffer = fs.readFileSync(tempImagePath);
        const base64Image = frameBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;
        
        // Cleanup temp files
        fs.unlinkSync(tempVideoPath);
        fs.unlinkSync(tempImagePath);
        
        return dataUrl;
      } else {
        throw new Error('FFmpeg extraction failed');
      }
    } catch (ffmpegError) {
      console.warn('FFmpeg not available or failed; no fallback frame generated');

      // Cleanup
      if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);

      return '';
    }
  } catch (error: any) {
    console.error('Error extracting frame from video:', error);
    return '';
  }
}

