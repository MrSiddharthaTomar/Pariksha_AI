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
import CodeEditor from "@/components/CodeEditor";
import { Play, Loader2, CheckCircle, XCircle, Terminal, ListChecks } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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

type DisplayCheckResult = 'multiple' | 'single' | 'unsupported' | 'permission_denied' | 'timeout';

// Best-effort monitor detection for logging only (never blocks student UI).
const detectDisplayRisk = async (): Promise<DisplayCheckResult> => {
  const win = window as any;
  const timeoutMs = 1500;
  const timeoutPromise = new Promise<DisplayCheckResult>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs)
  );

  try {
    if (typeof win.getScreenDetails === 'function') {
      const result = await Promise.race([
        (async () => {
          try {
            const details = await win.getScreenDetails();
            const screens = details?.screens || [];
            return Array.isArray(screens) && screens.length > 1 ? 'multiple' : 'single';
          } catch {
            return 'permission_denied';
          }
        })(),
        timeoutPromise,
      ]);
      return result as DisplayCheckResult;
    }

    if (typeof win.getScreens === 'function') {
      const result = await Promise.race([
        (async () => {
          try {
            const details = await win.getScreens();
            const screens = details?.screens || details || [];
            return Array.isArray(screens) && screens.length > 1 ? 'multiple' : 'single';
          } catch {
            return 'permission_denied';
          }
        })(),
        timeoutPromise,
      ]);
      return result as DisplayCheckResult;
    }

    return 'unsupported';
  } catch {
    return 'unsupported';
  }
};

interface TestQuestion {
  id: number;
  questionId?: string;
  type?: 'mcq' | 'coding';
  question: string;
  options: string[];
  codingStarterCode?: string;
  codingTestCases?: { input: string; output: string; hidden?: boolean }[];
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
  const [answers, setAnswers] = useState<Record<number, number | string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunningCode, setIsRunningCode] = useState(false);

  // Coding state
  const [selectedLanguage, setSelectedLanguage] = useState<string>('python');
  const [customInput, setCustomInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('testcases');
  const [batchResults, setBatchResults] = useState<{ passedCount: number, total: number, results: any[] } | null>(null);
  const [customOutput, setCustomOutput] = useState<{ output: string, error?: string } | null>(null);

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
  const monitorRiskIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMonitorRiskReportRef = useRef<{ reason: string; at: number } | null>(null);
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);

  const questions = test?.questions || [];

  // Fetch test data
  useEffect(() => {
    const fetchTest = async () => {
      const testId = localStorage.getItem('testId');
      const studentId = localStorage.getItem('studentId');

      if (!testId) {
        toast({
          title: "Missing Test",
          description: "Test information not found. Please select a test again.",
          variant: "destructive",
        });
        navigate('/student/tests');
        return;
      }

      // Enforce SEB context
      const isSEB = navigator.userAgent.includes('SEB') || navigator.userAgent.includes('SafeExamBrowser');
      if (!isSEB) {
        toast({
          title: "SEB Required",
          description: "You must use Safe Exam Browser to take this test. Please launch it from the exam rules page.",
          variant: "destructive",
        });
        navigate('/student/tests');
        return;
      }

      try {
        const response = await authFetch(getApiUrl(`/api/student/test/${testId}`));

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to load test data');
        }

        const data = await response.json();
        setTest({
          id: data.id,
          name: data.name,
          duration: data.duration,
          questions: (data.questions || []).map((q: any) => ({
            ...q,
            type: q.type || 'mcq', // Ensure type fallback
            codingStarterCode: q.codingStarterCode,
            codingTestCases: q.codingTestCases
          })),
        });

        // Load existing progress if available
        if (data.progress) {
          setCurrentQuestion(data.progress.currentQuestionIndex || 0);
          setAnswers(data.progress.answers || {});
          if (data.progress.timeRemaining !== undefined) {
            setTimeLeft(data.progress.timeRemaining);
          } else {
            setTimeLeft((data.duration || 60) * 60);
          }
          if (data.progress.showLogoutWarning) {
            setShowLogoutWarning(true);
          }
        } else {
          setTimeLeft((data.duration || 60) * 60);
          setCurrentQuestion(0);
          setAnswers({});
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



        return () => {
          clearInterval(violationInterval);
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

  // Non-blocking monitor risk logging for examiner visibility
  useEffect(() => {
    if (!test) return;

    const reportMonitorRisk = async (reason: 'multiple_detected' | 'permission_denied') => {
      const now = Date.now();
      const last = lastMonitorRiskReportRef.current;
      if (last && last.reason === reason && now - last.at < 120000) {
        return; // avoid spamming same reason repeatedly
      }

      try {
        const studentId = localStorage.getItem('studentId');
        const testId = localStorage.getItem('testId') || test.id;
        if (!studentId || !testId) return;

        await authFetch(getApiUrl('/api/student/monitor-risk'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, testId, reason }),
        });
        lastMonitorRiskReportRef.current = { reason, at: now };
      } catch (error) {
        console.warn('Failed to report monitor risk:', error);
      }
    };

    const checkAndReport = async () => {
      const result = await detectDisplayRisk();
      if (result === 'multiple') {
        await reportMonitorRisk('multiple_detected');
      } else if (result === 'permission_denied') {
        await reportMonitorRisk('permission_denied');
      }
    };

    checkAndReport();
    monitorRiskIntervalRef.current = setInterval(checkAndReport, 60000);

    return () => {
      if (monitorRiskIntervalRef.current) {
        clearInterval(monitorRiskIntervalRef.current);
      }
    };
  }, [test]);

  // Handle logout/session end recording
  useEffect(() => {
    const handleBeforeUnload = async () => {
      try {
        const testId = localStorage.getItem('testId');
        const studentId = localStorage.getItem('studentId');
        if (testId && studentId) {
          await authFetch(getApiUrl('/api/student/record-logout'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, testId }),
          });
        }
      } catch (error) {
        console.warn('Failed to record logout:', error);
      }
    };

    // Record logout on page unload (logout/close tab)
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also record logout on component unmount
      handleBeforeUnload();
    };
  }, []);

  // Save progress to server
  const saveProgress = async () => {
    try {
      const testId = localStorage.getItem('testId');
      const studentId = localStorage.getItem('studentId');

      if (!testId || !studentId) return;

      await authFetch(getApiUrl('/api/student/save-progress'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          testId,
          currentQuestionIndex: currentQuestion,
          timeRemaining: timeLeft,
          answers,
        }),
      });
    } catch (error) {
      console.warn('Failed to save progress:', error);
    }
  };

  // Save progress on unmount or when answers change
  useEffect(() => {
    return () => {
      // Save progress when component unmounts
      saveProgress();
    };
  }, []);

  useEffect(() => {
    // Save progress when answers change (immediately)
    saveProgress();
  }, [answers, currentQuestion, timeLeft]);

  // Show logout warning
  useEffect(() => {
    if (showLogoutWarning) {
      toast({
        title: "Session Resumed",
        description: "Warning: Do not close/refresh the tab or your exam might get cancelled. The timer has been running in the background.",
        variant: "destructive",
        duration: 10000, // Show for 10 seconds
      });
      setShowLogoutWarning(false); // Reset so it doesn't show again
    }
  }, [showLogoutWarning, toast]);

  // Timer
  useEffect(() => {
    if (!test) return;

    // If time has already run out, submit immediately
    if (timeLeft <= 0) {
      handleSubmitTest();
      return;
    }

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

    // Save progress every 30 seconds
    const progressTimer = setInterval(() => {
      saveProgress();
    }, 30000);

    return () => {
      clearInterval(timer);
      clearInterval(progressTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      // Save progress when component unmounts
      saveProgress();
    };
  }, []);

  useEffect(() => {
    // Save progress when answers change (debounced)
    const timeoutId = setTimeout(() => {
      saveProgress();
    }, 2000); // Save 2 seconds after answer changes

    return () => clearTimeout(timeoutId);
  }, [answers, currentQuestion, timeLeft]);

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

  const handleRunBatch = async () => {
    const code = answers[currentQuestionData.id] || currentQuestionData.codingStarterCode || '';
    if (!code) return;

    setIsRunningCode(true);
    setBatchResults(null);
    setActiveTab('testcases');

    try {
      const response = await authFetch(getApiUrl('/api/student/run-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: selectedLanguage,
          code: code,
          mode: 'batch',
          testCases: currentQuestionData.codingTestCases || [],
          questionId: currentQuestionData.questionId
        })
      });

      const data = await response.json();
      setBatchResults(data);

    } catch (err: any) {
      toast({
        title: "Execution Error",
        description: err.message || "Failed to run test cases",
        variant: "destructive"
      });
    } finally {
      setIsRunningCode(false);
    }
  };

  const handleRunCustom = async () => {
    const code = answers[currentQuestionData.id] || currentQuestionData.codingStarterCode || '';
    if (!code) return;

    setIsRunningCode(true);
    setCustomOutput(null);

    try {
      const response = await authFetch(getApiUrl('/api/student/run-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: selectedLanguage,
          code: code,
          mode: 'custom',
          stdin: customInput
        })
      });

      const data = await response.json();
      if (data.run) {
        setCustomOutput({
          output: data.run.output,
          error: data.run.code !== 0 ? 'Runtime Error' : undefined
        });
      }

    } catch (err: any) {
      setCustomOutput({
        output: err.message || 'Failed to execute code',
        error: 'System Error'
      });
    } finally {
      setIsRunningCode(false);
    }
  };

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

                {currentQuestionData.type === 'coding' ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                      <div className="flex items-center gap-2">
                        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue placeholder="Language" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="python">Python 3</SelectItem>
                            <SelectItem value="javascript">JavaScript</SelectItem>
                            <SelectItem value="java">Java</SelectItem>
                            <SelectItem value="cpp">C++</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={handleRunCustom} disabled={isRunningCode}>
                          {isRunningCode ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Terminal className="w-3 h-3 mr-1" />}
                          Run Custom
                        </Button>
                        <Button size="sm" onClick={handleRunBatch} disabled={isRunningCode}>
                          {isRunningCode ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1 fill-current" />}
                          Run All Tests
                        </Button>
                      </div>
                    </div>

                    <CodeEditor
                      language={selectedLanguage}
                      value={(answers[currentQuestionData.id] as string) || currentQuestionData.codingStarterCode || ''}
                      onChange={(val) => {
                        setAnswers(prev => ({
                          ...prev,
                          [currentQuestionData.id]: val || ''
                        }));
                      }}
                    />

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full border rounded-md">
                      <TabsList className="w-full justify-start rounded-b-none border-b bg-muted/20 p-0 h-10">
                        <TabsTrigger value="testcases" className="data-[state=active]:bg-background rounded-none h-full border-b-2 border-transparent data-[state=active]:border-primary px-4">
                          <ListChecks className="w-3 h-3 mr-2" />
                          Test Cases
                        </TabsTrigger>
                        <TabsTrigger value="custom" className="data-[state=active]:bg-background rounded-none h-full border-b-2 border-transparent data-[state=active]:border-primary px-4">
                          <Terminal className="w-3 h-3 mr-2" />
                          Custom Input
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="testcases" className="p-4 m-0">
                        {/* Summary Header */}
                        {batchResults && (
                          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                            <span className={batchResults.passedCount === batchResults.total ? "text-green-600" : "text-amber-600"}>
                              Passed {batchResults.passedCount}/{batchResults.total} Test Cases
                            </span>
                          </div>
                        )}

                        <ScrollArea className="h-[200px] pr-4">
                          <div className="space-y-3">
                            {(currentQuestionData.codingTestCases || []).map((tc, idx) => {
                              const result = batchResults?.results?.find((r: any) => r.id === idx);
                              const status = result ? (result.passed ? 'success' : 'error') : 'pending';
                              const isHidden = tc.hidden || (result && result.hidden);

                              return (
                                <div key={idx} className="border rounded-md p-3 text-sm">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-muted-foreground">{isHidden ? `Test Case #${idx + 1} (Hidden)` : `Test Case #${idx + 1}`}</span>
                                    {status === 'success' && <div className="flex items-center text-green-600 text-xs font-bold"><CheckCircle className="w-3 h-3 mr-1" /> Passed</div>}
                                    {status === 'error' && <div className="flex items-center text-red-600 text-xs font-bold"><XCircle className="w-3 h-3 mr-1" /> Failed</div>}
                                  </div>
                                  {!isHidden ? (
                                    <>
                                      <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                                        <div>
                                          <div className="text-muted-foreground mb-1">Input:</div>
                                          <div className="bg-muted p-2 rounded">{tc.input}</div>
                                        </div>
                                        <div>
                                          <div className="text-muted-foreground mb-1">Expected Output:</div>
                                          <div className="bg-muted p-2 rounded">{tc.output}</div>
                                        </div>
                                      </div>
                                      {status === 'error' && (
                                        <div className="mt-2 text-xs font-mono bg-red-50 p-2 rounded border border-red-100 text-red-800">
                                          <div className="font-semibold mb-1">Your Output:</div>
                                          <div className="whitespace-pre-wrap">{result.actualOutput || (result.error ? `Error: ${result.error}` : '(No output)')}</div>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-xs text-muted-foreground italic bg-muted/30 p-2 rounded">
                                      Hidden test cases are used for evaluation only. Input and output details are hidden.
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {(!currentQuestionData.codingTestCases || currentQuestionData.codingTestCases.length === 0) && (
                              <div className="text-muted-foreground text-center py-4">No test cases available for this question.</div>
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent value="custom" className="p-4 m-0 space-y-4">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Custom Input (Stdin)</Label>
                          <textarea
                            className="w-full min-h-[80px] p-3 rounded-md border text-sm font-mono bg-background resize-y"
                            placeholder="Enter input here..."
                            value={customInput}
                            onChange={(e) => setCustomInput(e.target.value)}
                          />
                        </div>

                        {customOutput && (
                          <div className={`p-3 rounded-md text-sm font-mono whitespace-pre-wrap border ${customOutput.error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-muted border-transparent'}`}>
                            <div className="font-semibold text-xs mb-1 opacity-70">Output:</div>
                            {customOutput.output}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>

                  </div>
                ) : (
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
                )}

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
                      className={`w-full border-2 aspect-square font-semibold transition-colors ${answers[questionItem.id] !== undefined && currentQuestion !== index
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
