import argparse
import json
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch

# ------------------ FIX: REMOVE UNICODE SYMBOLS ------------------
# Fix PyTorch 2.6+ weights_only issue BEFORE importing YOLO
try:
    from torch.serialization import add_safe_globals
    import torch.nn.modules
    from ultralytics.nn.tasks import DetectionModel

    add_safe_globals([
        DetectionModel,
        torch.nn.modules.container.Sequential,
        torch.nn.modules.activation.ReLU,
        torch.nn.modules.linear.Linear,
        torch.nn.modules.conv.Conv2d,
        torch.nn.modules.batchnorm.BatchNorm2d,
    ])
    print("PyTorch safe globals configured")
except Exception as e:
    print(f"Warning: Could not configure torch safe globals: {e}")
    try:
        _original_torch_load = torch.load
        def torch_load_with_weights_false(*args, **kwargs):
            kwargs['weights_only'] = False
            return _original_torch_load(*args, **kwargs)
        torch.load = torch_load_with_weights_false
        print("Fallback: Patched torch.load to use weights_only=False")
    except:
        print("Error: Failed to configure PyTorch safety patch")

from ultralytics import YOLO

# ------------------ CONFIG ------------------
VIDEO_SOURCE = 0
WIDTH = 640
MODEL_NAME = "yolov8n.pt"

import os
import sys

def get_model_path():
    """Resolve path to yolov8n.pt model file"""
    if os.path.exists(MODEL_NAME):
        return MODEL_NAME

    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, MODEL_NAME)
    if os.path.exists(model_path):
        return model_path

    for _ in range(3):
        script_dir = os.path.dirname(script_dir)
        model_path = os.path.join(script_dir, "server", MODEL_NAME)
        if os.path.exists(model_path):
            return model_path
        model_path = os.path.join(script_dir, MODEL_NAME)
        if os.path.exists(model_path):
            return model_path

    return MODEL_NAME

DEVICE_KEYWORDS = {
    "cell phone",
    "mobile phone",
    "phone",
    "laptop",
    "book",
    "tablet",
    "keyboard",
    "mouse",
}

PERSON_LABEL = "person"
MULTI_THRESHOLD = 1

MODEL: Optional[YOLO] = None
CLASS_NAMES: Optional[Dict[int, str]] = None
QUIET = False

# ------------------ HELPERS ------------------
def timestamp():
    return time.strftime("%H:%M:%S", time.localtime())

def log_event(event, details=""):
    if not QUIET:
        print(f"[LOG] {timestamp()} | {event} | {details}")

def resize_w(image, width):
    h, w = image.shape[:2]
    if w == width:
        return image
    scale = width / w
    return cv2.resize(image, (width, int(h * scale)))

# ------------------ MODEL LOADER ------------------
def ensure_model():
    global MODEL, CLASS_NAMES
    if MODEL is None:
        if not QUIET:
            print("Loading YOLO model...")
        try:
            model_path = get_model_path()
            if not QUIET:
                print(f"Using model path: {model_path}")
            MODEL = YOLO(model_path)
            CLASS_NAMES = MODEL.model.names
            if not QUIET:
                print("YOLO model loaded successfully")
        except Exception as e:
            print(f"Error loading YOLO model: {e}")
            raise
    return MODEL, CLASS_NAMES or {}

# ------------------ FRAME EVALUATION ------------------
def _evaluate_frame(frame):
    model, names = ensure_model()
    resized = resize_w(frame, WIDTH)
    # Lower confidence threshold to catch more detections (default is 0.25)
    results = model(resized, imgsz=WIDTH, conf=0.3, verbose=False)[0]

    events = []
    detections = []
    devices = set()
    person_count = 0

    print(f"DEBUG: Frame shape: {frame.shape}, Resized shape: {resized.shape}")

    boxes = results.boxes
    if boxes is not None:
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy()

        print(f"DEBUG: Detected {len(xyxy)} objects")

        for (x1, y1, x2, y2), conf, cls_idx in zip(xyxy, confs, clss):
            cls_name = names.get(int(cls_idx), str(cls_idx))
            
            print(f"DEBUG: Detected {cls_name} with confidence {conf:.2f}")

            if cls_name == PERSON_LABEL:
                person_count += 1

            if any(keyword in cls_name.lower() for keyword in DEVICE_KEYWORDS):
                devices.add(cls_name)

            detections.append(
                (int(x1), int(y1), int(x2), int(y2), cls_name, float(conf))
            )
    else:
        print("DEBUG: No boxes detected in results")

    print(f"DEBUG: Person count: {person_count}, Devices: {list(devices)}")

    if person_count == 0:
        events.append({
            "type": "No person detected",
            "severity": "medium",
            "details": "Student not visible"
        })
    elif person_count > MULTI_THRESHOLD:
        events.append({
            "type": "Multiple faces detected",
            "severity": "high",
            "details": f"{person_count} persons"
        })

    if devices:
        device_list = ", ".join(sorted(devices))
        label = "Phone detected" if any("phone" in d.lower() for d in devices) else "Device detected"
        events.append({
            "type": label,
            "severity": "high",
            "details": device_list
        })

    return {
        "events": events,
        "detections": detections,
        "person_count": person_count,
        "devices": list(devices),
    }

# ------------------ EVENT SUMMARY ------------------
def summarize_events(events):
    if not events:
        return {"hasViolation": False, "events": []}

    severity_rank = {"low": 0, "medium": 1, "high": 2}
    best = max(events, key=lambda e: severity_rank.get(e.get("severity", "low"), 0))

    return {
        "hasViolation": True,
        "violationType": best["type"],
        "severity": best["severity"],
        "details": best["details"],
        "events": events,
    }

# ------------------ VIDEO ANALYSIS ------------------
def analyze_video_file(path, max_frames=8):
    # Check file existence and size
    if not os.path.exists(path):
        error_msg = f"Video file does not exist: {path}"
        print(f"ERROR: {error_msg}")
        return {"hasViolation": False, "error": error_msg}
    
    file_size = os.path.getsize(path)
    print(f"DEBUG: Video file size: {file_size} bytes")
    
    # Check file magic bytes to identify format
    with open(path, 'rb') as f:
        magic = f.read(12)
        print(f"DEBUG: File magic bytes (hex): {magic.hex()}")
        # WebM starts with 0x1A45DFA3
        # MP4 has 'ftyp' at bytes 4-7
        if len(magic) >= 4:
            if magic[:4] == b'\x1a\x45\xdf\xa3':
                print("DEBUG: File format detected: WebM (Matroska-based)")
            elif b'ftyp' in magic:
                print("DEBUG: File format detected: MP4")
            elif magic[:3] == b'ID3' or magic[:2] == b'FF':
                print("DEBUG: File format detected: Audio format")
            else:
                print(f"DEBUG: Unknown format, first 4 bytes: {magic[:4]}")
    
    # Try to open the video file with default backend
    print("DEBUG: Attempting to open with default backend...")
    cap = cv2.VideoCapture(path)
    mp4_path = None  # Track if we create a converted MP4
    use_ffmpeg_extract = False  # Track if we need to use ffmpeg frame extraction
    
    if not cap.isOpened():
        error_msg = f"Unable to open video file with cv2: {path} (size: {file_size} bytes)"
        print(f"ERROR: {error_msg}")
        
        # Try with FFMPEG backend explicitly
        print("DEBUG: Trying with explicit FFMPEG backend (cv2.CAP_FFMPEG)...")
        cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print(f"ERROR: FFMPEG backend also failed")
            
            # Fall back to ffmpeg frame extraction
            print("DEBUG: Will use ffmpeg to extract individual frames instead...")
            use_ffmpeg_extract = True
            # Don't return error - we'll try ffmpeg extraction below

    # If cv2 couldn't open it, try ffmpeg frame extraction
    if use_ffmpeg_extract:
        print("DEBUG: Extracting frames using ffmpeg...")
        try:
            import subprocess
            # Create temp directory for frames
            frames_dir = path.replace('.webm', '_frames')
            os.makedirs(frames_dir, exist_ok=True)
            
            # Extract frames using ffmpeg with better error handling
            print(f"DEBUG: Extracting frames to {frames_dir}")
            
            # First try to get video info
            info_result = subprocess.run(
                ['ffmpeg', '-i', path],
                capture_output=True,
                timeout=10
            )
            
            if info_result.returncode != 0:
                print(f"DEBUG: FFmpeg info failed, trying alternative approach")
                # Try with different options for WebM
                result = subprocess.run(
                    [
                        'ffmpeg',
                        '-f', 'webm',
                        '-i', path,
                        '-vf', 'fps=1',
                        '-q:v', '2',  # Better quality
                        os.path.join(frames_dir, 'frame_%04d.png')
                    ],
                    capture_output=True,
                    timeout=30
                )
            else:
                # Standard extraction
                result = subprocess.run(
                    [
                        'ffmpeg',
                        '-i', path,
                        '-vf', 'fps=1',
                        '-q:v', '2',
                        os.path.join(frames_dir, 'frame_%04d.png')
                    ],
                    capture_output=True,
                    timeout=30
                )
            
            if result.returncode != 0:
                stderr_output = result.stderr.decode()[:500]
                print(f"ERROR: ffmpeg frame extraction failed: {stderr_output}")
                
                # Try one more time with different codec options
                print("DEBUG: Trying alternative FFmpeg command...")
                alt_result = subprocess.run(
                    [
                        'ffmpeg',
                        '-i', path,
                        '-c:v', 'libvpx-vp9',  # Force codec
                        '-vf', 'fps=1',
                        '-q:v', '2',
                        os.path.join(frames_dir, 'frame_%04d.png')
                    ],
                    capture_output=True,
                    timeout=30
                )
                
                if alt_result.returncode != 0:
                    print(f"ERROR: Alternative ffmpeg also failed")
                    return {"hasViolation": False, "error": "Could not extract frames from video"}
                else:
                    result = alt_result
            
            # Get list of extracted frames
            import glob
            frame_files = sorted(glob.glob(os.path.join(frames_dir, 'frame_*.png')))
            print(f"DEBUG: Extracted {len(frame_files)} frames")
            
            if not frame_files:
                print("ERROR: No frames extracted")
                return {"hasViolation": False, "error": "No frames could be extracted"}
            
            # Process frames
            aggregated = []
            stride = max(1, len(frame_files) // max_frames)
            print(f"DEBUG: Processing parameters - Stride: {stride}, Max frames: {max_frames}")
            
            processed = 0
            for idx, frame_file in enumerate(frame_files):
                if idx % stride != 0:
                    continue
                
                if processed >= max_frames:
                    break
                
                frame = cv2.imread(frame_file)
                if frame is None:
                    print(f"DEBUG: Could not read frame {frame_file}")
                    continue
                
                print(f"DEBUG: Processing frame {idx} from file {frame_file}")
                result = _evaluate_frame(frame)
                print(f"DEBUG: Frame {idx} events: {result['events']}")
                aggregated.extend(result["events"])
                processed += 1
                
                if any(evt.get("severity") == "high" for evt in aggregated):
                    print(f"DEBUG: High severity event detected, stopping early")
                    break
            
            # Clean up frames directory
            try:
                import shutil
                shutil.rmtree(frames_dir)
                print(f"DEBUG: Cleaned up frames directory")
            except:
                pass
            
            print(f"DEBUG: Video analysis complete - Processed {processed} frames, Total events: {len(aggregated)}")
            return summarize_events(aggregated)
            
        except Exception as e:
            print(f"ERROR: FFmpeg frame extraction failed: {e}")
            return {"hasViolation": False, "error": f"Video processing failed: {str(e)}"}

    # If we have a valid cv2 video capture, process it normally
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"DEBUG: Video metadata - Resolution: {width}x{height}, FPS: {fps}, Total frames: {total_frames}")
    
    # Sanity check
    if width == 0 or height == 0:
        error_msg = f"Invalid video dimensions: {width}x{height}"
        print(f"ERROR: {error_msg}")
        cap.release()
        return {"hasViolation": False, "error": error_msg}
    
    stride = max(1, total_frames // max_frames)
    
    print(f"DEBUG: Processing parameters - Stride: {stride}, Max frames: {max_frames}")
    
    idx = 0
    processed = 0
    aggregated = []

    while processed < max_frames:
        ret, frame = cap.read()
        if not ret:
            print(f"DEBUG: End of video reached at frame {idx}")
            break

        if frame is None:
            print(f"DEBUG: Frame {idx} is None, skipping")
            idx += 1
            continue

        if idx % stride == 0:
            print(f"DEBUG: Processing frame {idx} (processed count: {processed}, shape: {frame.shape})")
            result = _evaluate_frame(frame)
            print(f"DEBUG: Frame {idx} events: {result['events']}")
            aggregated.extend(result["events"])
            processed += 1
            if any(evt.get("severity") == "high" for evt in aggregated):
                print(f"DEBUG: High severity event detected, stopping early")
                break

        idx += 1

    cap.release()
    
    # Clean up converted MP4 file if we created one
    if mp4_path and os.path.exists(mp4_path):
        try:
            os.remove(mp4_path)
            print(f"DEBUG: Cleaned up converted MP4 file")
        except Exception as e:
            print(f"DEBUG: Could not delete MP4 file: {e}")
    
    print(f"DEBUG: Video analysis complete - Processed {processed} frames, Total events: {len(aggregated)}")
    
    return summarize_events(aggregated)

# ------------------ WEBCAM MODE ------------------
def run_stream_mode():
    cap = cv2.VideoCapture(VIDEO_SOURCE)
    if not cap.isOpened():
        print("Webcam not accessible")
        return

    prev = time.time()
    print("Running... Press Q to stop.")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        result = _evaluate_frame(frame)
        detections = result["detections"]

        for event in result["events"]:
            log_event(event["type"], event.get("details", ""))

        now = time.time()
        fps = 1 / (now - prev)
        prev = now

        for x1, y1, x2, y2, cls_name, conf in detections:
            color = (0, 255, 0) if cls_name != PERSON_LABEL else (0, 165, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                frame,
                f"{cls_name} {conf:.2f}",
                (x1, max(20, y1 - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )

        cv2.putText(
            frame,
            f"FPS: {int(fps)}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (200, 200, 200),
            2,
        )

        cv2.imshow("Cheating Detector", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()

# ------------------ MAIN ------------------
def main():
    global QUIET

    parser = argparse.ArgumentParser(description="Pariksha AI Proctoring Model")
    parser.add_argument("--mode", choices=["stream", "analyze-video"], default="stream")
    parser.add_argument("--video")
    parser.add_argument("--max-frames", type=int, default=8)
    parser.add_argument("--quiet", action="store_true")

    args = parser.parse_args()
    QUIET = bool(args.quiet)

    try:
        if args.mode == "analyze-video":
            if not args.video:
                print(json.dumps({"hasViolation": False, "error": "video path required"}))
                return

            result = analyze_video_file(args.video, max_frames=args.max_frames)
            print(json.dumps(result))
            return

        run_stream_mode()

    except Exception as e:
        error_msg = str(e)
        if not QUIET:
            print(f"Fatal error: {error_msg}", file=sys.stderr)

        if args.mode == "analyze-video":
            print(json.dumps({"hasViolation": False, "error": error_msg}))

        raise

if __name__ == "__main__":
    main()
