import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WebcamCaptureProps {
  onCapture: (imageData: string) => void;
  capturedImage?: string;
  disabled?: boolean;
}

const WebcamCapture = ({ onCapture, capturedImage, disabled = false }: WebcamCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMountedRef = useRef(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'user' // Use front camera
        } 
      });
      
      // Check if component is still mounted before proceeding
      if (!isMountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        setIsLoading(false);
        
        // Ensure video plays immediately
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
        });
      } else {
        // If video element not ready, stop the stream
        stream.getTracks().forEach(track => track.stop());
        setIsLoading(false);
        // Only show toast if component is still mounted
        if (isMountedRef.current) {
          toast({
            title: "Camera Error",
            description: "Video element not ready. Please refresh the page.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsStreaming(false);
        console.error('Camera error:', error);
        toast({
          title: "Camera Error",
          description: "Unable to access camera. Please check permissions.",
          variant: "destructive",
        });
      }
    }
  }, [toast]);

  // Auto-start camera when component mounts or when captured image is cleared
  useEffect(() => {
    isMountedRef.current = true;
    
    if (!capturedImage) {
      startCamera();
    }

    // Cleanup: stop camera when component unmounts
    return () => {
      isMountedRef.current = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
        setIsStreaming(false);
      }
    };
  }, [capturedImage, startCamera]);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && isMountedRef.current) {
      const canvas = document.createElement('canvas');
      const width = videoRef.current.videoWidth;
      const height = videoRef.current.videoHeight;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Flip the image horizontally to un-mirror it
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, 0, 0);
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(imageData);
        // Stop camera after capture to save resources
        stopCamera();
      }
    }
  }, [onCapture, stopCamera]);

  const retakePhoto = useCallback(() => {
    onCapture('');
    // Camera should already be streaming if we just captured
    // If not, restart it
    if (!isStreaming && isMountedRef.current) {
      startCamera();
    }
  }, [onCapture, isStreaming, startCamera]);

  return (
    <div className="space-y-4">
      <div className="relative bg-muted rounded-lg overflow-hidden aspect-video flex items-center justify-center">
        {/* Video element - always rendered but hidden when not needed */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline
          className={`w-full h-full object-cover ${isStreaming && !capturedImage ? 'block' : 'hidden'}`}
          muted
          style={{ transform: 'scaleX(-1)' }} // Mirror the video for better UX
          onLoadedMetadata={() => {
            if (videoRef.current) {
              videoRef.current.play().catch(console.error);
            }
          }}
        />
        
        {/* Captured image */}
        {capturedImage && (
          <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
        )}
        
        {/* Loading state */}
        {!capturedImage && isLoading && (
          <div className="absolute inset-0 text-center p-8 flex flex-col items-center justify-center">
            <Camera className="w-16 h-16 mb-4 text-muted-foreground animate-pulse" />
            <p className="text-muted-foreground">Requesting camera permission...</p>
          </div>
        )}
        
        {/* Error state */}
        {!capturedImage && !isStreaming && !isLoading && (
          <div className="absolute inset-0 text-center p-8 flex flex-col items-center justify-center">
            <Camera className="w-16 h-16 mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Camera not available</p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {!capturedImage && isStreaming && (
          <Button onClick={capturePhoto} className="flex-1" disabled={isLoading || disabled}>
            <Camera className="mr-2 h-4 w-4" />
            Capture
          </Button>
        )}
        
        {!capturedImage && !isStreaming && !isLoading && (
          <Button onClick={startCamera} className="flex-1" disabled={disabled}>
            <Camera className="mr-2 h-4 w-4" />
            Start Camera
          </Button>
        )}

        {capturedImage && (
          <Button onClick={retakePhoto} variant="outline" className="flex-1" disabled={disabled}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Retake Photo
          </Button>
        )}
      </div>
    </div>
  );
};

export default WebcamCapture;
