import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Clock, Eye, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, authFetch } from "@/lib/api-config";

// Helper function to convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Best-effort multiple-display detection using Screen Enumeration API when available.
// Best-effort multiple-display detection using Screen Enumeration API when available.
// Returns: 'multiple' | 'single' | 'unsupported' | 'permission_denied'
const detectMultipleDisplays = async (): Promise<'multiple' | 'single' | 'unsupported' | 'permission_denied'> => {
  try {
    const anyWin: any = window as any;
    // Most modern Chromium exposes getScreenDetails
    if (typeof anyWin.getScreenDetails === 'function') {
      try {
        const details = await anyWin.getScreenDetails();
        const screens = details?.screens || [];
        if (Array.isArray(screens) && screens.length > 1) return 'multiple';
        return 'single';
      } catch (err) {
        // If the API exists but fails, it's widely due to user denying permission
        return 'permission_denied';
      }
    }

    // Some browsers may expose window.getScreens (experimental) — try it
    if (typeof anyWin.getScreens === 'function') {
      try {
        const details = await anyWin.getScreens();
        const screens = details?.screens || details || [];
        if (Array.isArray(screens) && screens.length > 1) return 'multiple';
        return 'single';
      } catch (err) {
        // Treat as unsupported or permission denied? 
        // For experimental API, we might be safer treating as unsupported to avoid false positives,
        // but consistent strictness suggests permission_denied if we want to be robust. 
        // Let's stick effectively to unsupported for the experimental one unless we are sure.
        // Actually, let's treat it as permission_denied if it fails too, to be consistent.
        return 'permission_denied';
      }
    }

    // Not supported
    return 'unsupported';
  } catch (err) {
    return 'unsupported';
  }
};

interface TestQuestion {
  id: number;
  question: string;
  options: string[];
}

interface StudentTestData {
  id: string;
  name: string;
  duration: number;
  questions: TestQuestion[];
}

const StudentTest = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLiveFeed, setShowLiveFeed] = useState(true);
  const [test, setTest] = useState<StudentTestData | null>(null);
  const [isLoadingTest, setIsLoadingTest] = useState(true);
  
  // Refs for recording
  const liveFeedRef = useRef<HTMLVideoElement>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const violationsRef = useRef<Array<{ timestamp: Date; type: string; severity: 'low' | 'medium' | 'high' }>>([]);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const displayCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [blockedByMultiDisplay, setBlockedByMultiDisplay] = useState(false);
  const [multiDisplayMessage, setMultiDisplayMessage] = useState<string | null>(null);
  
  const questions = test?.questions || [];

  // Fetch test data
  useEffect(() => {
    const fetchTest = async () => {
      const testId = localStorage.getItem('testId');
      const studentId = localStorage.getItem('studentId');
      const studentEmail = localStorage.getItem('studentEmail');

      if (!testId || (!studentId && !studentEmail)) {
        toast({
          title: "Missing Test",
          description: "Test information not found. Please select a test again.",
          variant: "destructive",
        });
        navigate('/student/tests');
        return;
      }

      try {
        const queryParams = new URLSearchParams();
        if (studentId) queryParams.append('studentId', studentId);
        if (studentEmail) queryParams.append('email', studentEmail);

        const response = await authFetch(getApiUrl(`/api/student/test/${testId}?${queryParams.toString()}`));

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to load test data');
        }

        const data = await response.json();
        setTest({
          id: data.id,
          name: data.name,
          duration: data.duration,
          questions: data.questions || [],
        });
        setTimeLeft((data.duration || 60) * 60);
        setCurrentQuestion(0);
        setAnswers({});

        // Before starting, attempt to detect multiple displays (best-effort). If multiple displays are detected, block attempt
        const detectResult = await detectMultipleDisplays();
        if (detectResult === 'multiple') {
          // Log to server and block
          try {
            await authFetch(getApiUrl('/api/student/multi-monitor-detected'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId: studentId || undefined, testId }),
            });
          } catch (err) {
            console.warn('Failed to record multi-display event:', err);
          }

          setBlockedByMultiDisplay(true);
          setMultiDisplayMessage('Multiple displays detected. Your exam has been blocked. Please disconnect external monitors and contact your examiner.');
          setIsLoadingTest(false);
          return;
        } else if (detectResult === 'permission_denied') {
           setBlockedByMultiDisplay(true);
           setMultiDisplayMessage('Permission Denied: To ensure a secure exam environment, you must allow "Window Management" or "screen details" permission. Please enable this permission in your browser settings (look for a lock/icon in the address bar) and refresh the page.');
           setIsLoadingTest(false);
           return;
        } else if (detectResult === 'unsupported') {
          toast({
            title: 'Display Detection Unavailable',
            description: 'Your browser does not support automatic multiple-display detection. Please ensure you are using a single display during the exam.',
            variant: 'warning',
          });
        }

        // Mark student's attempt as started (so examiner's monitor sees in-progress attempts)
        (async () => {
          try {
            await authFetch(getApiUrl('/api/student/start-attempt'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId: studentId || undefined, testId }),
            });
          } catch (err) {
            console.warn('Failed to start attempt (non-critical):', err);
          }
        })();
      } catch (error: any) {
        console.error('Failed to fetch test:', error);
        toast({
          title: "Error",
          description: error.message || "Unable to load test. Please try again.",
          variant: "destructive",
        });
        navigate('/student/tests');
      } finally {
        setIsLoadingTest(false);
      }
    };

    fetchTest();
  }, [navigate, toast]);

  // Initialize camera and recording
  useEffect(() => {
    let isMounted = true;

    const startRecording = async () => {
      try {
        // Request camera and microphone access together
        const combinedStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        if (!isMounted) {
          combinedStream.getTracks().forEach(track => track.stop());
          return;
        }

        combinedStreamRef.current = combinedStream;

        // Set up live feed (top right corner)
        if (liveFeedRef.current) {
          liveFeedRef.current.srcObject = combinedStream;
          liveFeedRef.current.play().catch(console.error);
        }

        // Get video and audio tracks separately for recording
        const videoTracks = combinedStream.getVideoTracks();
        const audioTracks = combinedStream.getAudioTracks();

        // Create video-only stream for video recording
        const videoStream = new MediaStream(videoTracks);
        const videoRecorder = new MediaRecorder(videoStream, {
          mimeType: 'video/webm;codecs=vp8'
        });

        // Store chunks temporarily for 10-second intervals (outside async function)
        let tempVideoChunks: Blob[] = [];

        videoRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            tempVideoChunks.push(event.data);
          }
        };

        // Create audio-only stream for audio recording
        const audioStream = new MediaStream(audioTracks);
        const audioRecorder = new MediaRecorder(audioStream, {
          mimeType: 'audio/webm;codecs=opus'
        });

        audioRecorder.ondataavailable = () => {
          // Audio handled within combined stream; final submission no longer uploads blobs
        };

        // Function to send 10-second chunk to server
        const sendChunkToServer = async () => {
          if (tempVideoChunks.length === 0) return;

          try {
            // Combine chunks into a single blob
            const chunkBlob = new Blob(tempVideoChunks, { type: 'video/webm' });
            
            // Convert to base64
            const chunkBase64 = await blobToBase64(chunkBlob);
            
            // Get student ID and test ID
            const studentId = localStorage.getItem('studentId') || 'unknown';
            const testId = localStorage.getItem('testId') || 'unknown';

            // Send chunk to server for ML processing
            const response = await authFetch(getApiUrl('/api/student/proctor-chunk'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentId,
                testId,
                videoChunk: chunkBase64,
                timestamp: new Date().toISOString(),
              }),
            });

            if (response.ok) {
              const data = await response.json();
              if (data.violationDetected) {
                // Log violation locally (for final submission)
                violationsRef.current.push({
                  timestamp: new Date(),
                  type: data.violationType || 'Suspicious behavior detected',
                  severity: data.severity || 'medium',
                });
              }
            }

            // Clear temp chunks after sending (discard)
            tempVideoChunks.length = 0;
          } catch (error) {
            console.error('Error sending chunk to server:', error);
            // Continue recording even if chunk send fails
          }
        };

        // Start both recorders with 10-second timeslice
        videoRecorder.start(1000); // Collect data every second
        audioRecorder.start(1000);
        
        videoRecorderRef.current = videoRecorder;
        audioRecorderRef.current = audioRecorder;

        // Send chunks every 6 seconds
        chunkIntervalRef.current = setInterval(() => {
          sendChunkToServer();
        }, 6000); // 6 seconds

        setIsRecording(true);
        startTimeRef.current = new Date();

        // Monitor for violations (silently, no alerts to student)
        const violationInterval = setInterval(() => {
          // Simulate proctoring checks (in production, use face-api.js)
          const events = [
            { type: "Looking away from screen", severity: 'low' as const },
            { type: "Multiple faces detected", severity: 'high' as const },
            { type: "Unauthorized device detected", severity: 'medium' as const },
            { type: "Audio detected", severity: 'low' as const },
          ];
          
          if (Math.random() > 0.85) {
            const event = events[Math.floor(Math.random() * events.length)];
            violationsRef.current.push({
              timestamp: new Date(),
              type: event.type,
              severity: event.severity
            });
          }
        }, 6000); // Check every 6 seconds

        // Periodically check for multiple displays (best-effort). If detected, block the exam immediately.
        displayCheckIntervalRef.current = setInterval(async () => {
          try {
            const result = await detectMultipleDisplays();
            if (result === 'multiple' || result === 'permission_denied') {
              // Inform server and block locally
              const studentId = localStorage.getItem('studentId');
              const testId = localStorage.getItem('testId') || (test?.id);
              
              const isPermissionError = result === 'permission_denied';
              
              try {
                // We only log to server if it's a confirmed multiple display detection, 
                // or optionally we could log permission denial too. For now let's reuse api but maybe with different flag?
                // The API call below is generic 'multi-monitor-detected', we might want to distinguish later but for now this is fine or we skip logging denied permission to avoid noise if user just misclicked.
                // Let's Log it anyway so proctor knows why they got blocked.
                 await authFetch(getApiUrl('/api/student/multi-monitor-detected'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ studentId: studentId || undefined, testId, reason: result }),
                });
              } catch (err) {
                console.warn('Failed to report blocking event:', err);
              }

              setBlockedByMultiDisplay(true);
              setMultiDisplayMessage(isPermissionError 
                ? 'Permission Revoked: You must allow "Window Management" permission to continue. Please check your browser settings.' 
                : 'Multiple displays detected during the exam. Your attempt has been blocked.');

              // Stop recording and timers
              if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
              if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') videoRecorderRef.current.stop();
              if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') audioRecorderRef.current.stop();

              // Stop display check interval
              if (displayCheckIntervalRef.current) clearInterval(displayCheckIntervalRef.current);
            }
          } catch (err) {
            // ignore detection errors silently
          }
        }, 15000); // every 15s

        return () => {
          clearInterval(violationInterval);
          if (displayCheckIntervalRef.current) clearInterval(displayCheckIntervalRef.current);
        };
      } catch (error) {
        console.error('Error accessing media devices:', error);
        toast({
          title: "Camera/Microphone Error",
          description: "Unable to access camera or microphone. Please check permissions.",
          variant: "destructive",
        });
      }
    };

    startRecording();

    return () => {
      isMounted = false;
      // Cleanup
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
      }
      if (displayCheckIntervalRef.current) {
        clearInterval(displayCheckIntervalRef.current);
      }
      if (combinedStreamRef.current) {
        combinedStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
        videoRecorderRef.current.stop();
      }
      if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
        audioRecorderRef.current.stop();
      }
    };
  }, []); // Only run once on mount

  // Timer
  useEffect(() => {
    if (!test) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmitTest();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test]);

  // Ensure video stream is properly set when live feed becomes visible
  useEffect(() => {
    if (showLiveFeed && liveFeedRef.current && combinedStreamRef.current) {
      // Re-initialize video stream when feed becomes visible
      if (liveFeedRef.current.srcObject !== combinedStreamRef.current) {
        liveFeedRef.current.srcObject = combinedStreamRef.current;
      }
      liveFeedRef.current.play().catch((error) => {
        console.error('Error playing video:', error);
      });
    }
  }, [showLiveFeed]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSubmitTest = async () => {
    if (isSubmitting || !test) return;
    
    setIsSubmitting(true);

    try {
      // Create promises to wait for recorders to stop
      const videoStopPromise = new Promise<void>((resolve) => {
        if (videoRecorderRef.current) {
          if (videoRecorderRef.current.state !== 'inactive') {
            videoRecorderRef.current.onstop = () => resolve();
            videoRecorderRef.current.stop();
          } else {
            resolve();
          }
        } else {
          resolve();
        }
      });

      const audioStopPromise = new Promise<void>((resolve) => {
        if (audioRecorderRef.current) {
          if (audioRecorderRef.current.state !== 'inactive') {
            audioRecorderRef.current.onstop = () => resolve();
            audioRecorderRef.current.stop();
          } else {
            resolve();
          }
        } else {
          resolve();
        }
      });

      // Wait for both recorders to stop
      await Promise.all([videoStopPromise, audioStopPromise]);

      // Stop camera/microphone streams
      if (combinedStreamRef.current) {
        combinedStreamRef.current.getTracks().forEach(track => track.stop());
      }

      // Get student ID and test ID (you may need to get these from context/params)
      const studentId = localStorage.getItem('studentId') || 'unknown';
      const testId = localStorage.getItem('testId') || test.id;

      // Submit test with recording
      const response = await authFetch(getApiUrl('/api/student/submit-test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          testId,
          answers,
          startTime: startTimeRef.current?.toISOString(),
          endTime: new Date().toISOString(),
          violations: violationsRef.current
        })
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: "Test Submitted",
          description: "Your exam has been submitted successfully",
        });
        navigate('/');
      } else {
        const error = await response.json();
        toast({
          title: "Submission Failed",
          description: error.message || "Failed to submit test. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Test submission error:', error);
      toast({
        title: "Error",
        description: "Failed to submit test. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingTest) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-lg font-semibold text-primary">Loading test...</p>
        </div>
      </div>
    );
  }

  // If blocked due to multiple displays being detected, show a blocking overlay
  if (blockedByMultiDisplay) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
        <Card className="max-w-xl w-full text-center">
          <CardHeader>
            <CardTitle className="text-xl">Exam Blocked</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{multiDisplayMessage || 'Multiple displays detected. Your exam has been blocked.'}</p>
            <p className="text-sm">Please disconnect any external monitors and contact your examiner to continue.</p>
            <div className="flex justify-center gap-2 mt-4">
              <Button onClick={() => navigate('/student/tests')}>Return to Tests</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!test || questions.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <Card className="max-w-lg w-full text-center">
          <CardHeader>
            <CardTitle>No Questions Available</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              We couldn't load the questions for this test. Please go back and try selecting the test again.
            </p>
            <Button onClick={() => navigate('/student/tests')}>Back to Tests</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQuestionData = questions[currentQuestion];

  return (
    <div className="min-h-screen bg-gradient-hero p-4 relative">
      {/* Live Camera Feed - Top Right Corner (Toggleable) */}
      {showLiveFeed && (
        <div className="fixed top-16 right-4 z-50 w-64 h-48 bg-black rounded-lg overflow-hidden shadow-2xl border-2 border-primary">
          <video
            ref={liveFeedRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover bg-black"
            style={{ transform: 'scaleX(-1)' }} // Mirror for better UX
            onLoadedMetadata={() => {
              if (liveFeedRef.current) {
                liveFeedRef.current.play().catch(console.error);
              }
            }}
          />
          <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            REC
          </div>
        </div>
      )}

      {/* Proctoring Header */}
      <div className="bg-card border-b sticky top-0 z-40 shadow-md">
        <div className="container max-w-7xl mx-auto py-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Left side: Pariksha AI and Proctoring Active */}
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-primary">Pariksha AI</h1>
              <Badge variant="outline" className="bg-success/10">
                <Eye className="w-3 h-3 mr-1" />
                Proctoring Active
              </Badge>
            </div>
            
            {/* Right side: Timer and Proctoring Logo */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-destructive font-semibold">
                <Clock className="w-5 h-5" />
                {formatTime(timeLeft)}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLiveFeed(!showLiveFeed)}
                className="relative"
                title={showLiveFeed ? "Hide Live Feed" : "Show Live Feed"}
              >
                <ShieldCheck className="w-5 h-5 text-primary" />
                {isRecording && (
                  <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-7xl mx-auto py-6">
        <div className="grid lg:grid-cols-10 gap-6">
          {/* Main Test Area - 70% width */}
          <div className="lg:col-span-7 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Question {currentQuestion + 1} of {questions.length}</CardTitle>
                  <Badge>{Math.round(((currentQuestion + 1) / questions.length) * 100)}% Complete</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="text-lg font-medium">
                  {currentQuestionData.question}
                </div>

                <RadioGroup 
                  value={answers[currentQuestionData.id]?.toString() ?? ''} 
                  onValueChange={(value) => {
                    const selectedIndex = parseInt(value, 10);
                    setAnswers(prev => ({
                      ...prev,
                      [currentQuestionData.id]: selectedIndex,
                    }));
                  }}
                >
                  {currentQuestionData.options.map((option, index) => (
                    <div 
                      key={index} 
                      className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => {
                        setAnswers(prev => ({
                          ...prev,
                          [currentQuestionData.id]: index,
                        }));
                      }}
                    >
                      <RadioGroupItem value={index.toString()} id={`q${currentQuestionData.id}-${index}`} />
                      <Label htmlFor={`q${currentQuestionData.id}-${index}`} className="flex-1 cursor-pointer">
                        {option}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                <div className="flex gap-3 pt-4">
                  <Button 
                    variant="outline" 
                    onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
                    disabled={currentQuestion === 0 || isSubmitting}
                    size="lg"
                    className="flex-1"
                  >
                    Previous
                  </Button>
                  {currentQuestion < questions.length - 1 ? (
                    <Button 
                      onClick={() => setCurrentQuestion(currentQuestion + 1)}
                      className="flex-1"
                      size="sm"
                      disabled={isSubmitting}
                    >
                      Next Question
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleSubmitTest} 
                      className="flex-1"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit Test'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Question Navigator - 30% width */}
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Question Navigator</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2">
                  {questions.map((questionItem, index) => (
                    <Button
                      key={questionItem.id}
                      variant={currentQuestion === index ? "default" : answers[questionItem.id] !== undefined ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setCurrentQuestion(index)}
                      className={`w-full border-2 aspect-square font-semibold transition-colors ${
                        answers[questionItem.id] !== undefined && currentQuestion !== index 
                          ? 'bg-green-500 hover:bg-green-600 text-white border-green-600' 
                          : ''
                      }`}
                      disabled={isSubmitting}
                    >
                      {index + 1}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

    </div>
  );
};

export default StudentTest;
