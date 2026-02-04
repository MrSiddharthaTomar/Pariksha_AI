import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Sparkles, Plus, Trash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, authFetch } from "@/lib/api-config";

interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
}

const CreateTest = () => {
  const navigate = useNavigate();
  const { testId } = useParams<{ testId?: string }>();
  const location = useLocation();
  const { toast } = useToast();
  const [creationMode, setCreationMode] = useState<'ai' | 'manual'>('ai');
  const [testName, setTestName] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [questions, setQuestions] = useState<Question[]>([
    { id: 1, question: '', options: ['', '', '', ''], correctAnswer: 0 }
  ]);
  const [duration, setDuration] = useState<number>(60);
  const [startTime, setStartTime] = useState<string>('');
  const [allowedStudentsInput, setAllowedStudentsInput] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Schedule modal state and students (open by default when creating a new test)
  const [isScheduleOpen, setIsScheduleOpen] = useState<boolean>(() => !testId);
  const [students, setStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [studentLoading, setStudentLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState<number>(60);
  const [scheduleStart, setScheduleStart] = useState<string>('');

  useEffect(() => {
    if (!testId) return;
    // Fetch test details for editing
    (async () => {
      try {
        const resp = await authFetch(getApiUrl(`/api/examiner/tests/${testId}`));
        if (resp.status === 401) {
          toast({ title: 'Unauthorized', description: 'Please login as an examiner to edit tests', variant: 'destructive' });
          navigate('/examiner/login');
          return;
        }
        if (!resp.ok) {
          let bodyText = '';
          try {
            const errBody = await resp.json();
            bodyText = errBody?.message || JSON.stringify(errBody);
          } catch (e) {
            bodyText = await resp.text().catch(() => '');
          }
          toast({ title: `Failed to load test (${resp.status})`, description: bodyText || 'Could not fetch test for editing', variant: 'destructive' });
          console.error('Fetch test failed', resp.status, bodyText);
          return;
        }
        const data = await resp.json();
        setIsEditing(true);
        setCreationMode('manual');
        setTestName(data.name || '');
        setDuration(data.duration || 60);
        if (data.startTime) {
          // convert to datetime-local value
          const dt = new Date(data.startTime);
          const isoLocal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
          setStartTime(isoLocal);
        }
        setAllowedStudentsInput((data.allowedStudents || []).join(', '));
        if (Array.isArray(data.questions)) {
          setQuestions(data.questions.map((q: any, idx: number) => ({ id: idx + 1, question: q.question || q.questionText || '', options: q.options || ['', '', '', ''], correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0 })));
        }
      } catch (err: any) {
        toast({ title: 'Error', description: (err && err.message) ? `Failed to fetch test: ${err.message}` : 'Failed to fetch test for editing', variant: 'destructive' });
        console.error('Fetch test error', err);
      }
    })();
  }, [testId]);

  // Accept prefill state when navigated from Schedule dialog using location.state.schedulePrefill
  useEffect(() => {
    const prefill: any = (location && (location as any).state && (location as any).state.schedulePrefill) ? (location as any).state.schedulePrefill : null;
    if (!prefill) return;
    if (testId) return; // don't override when editing existing test

    setCreationMode('manual');
    setTestName(prefill.testName || '');
    setDuration(prefill.duration || 60);
    if (prefill.startTime) {
      const dt = new Date(prefill.startTime);
      const isoLocal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
      setStartTime(isoLocal);
      setScheduleStart(isoLocal);
    }
    setAllowedStudentsInput((prefill.allowedStudents || []).join(', '));
    // show an empty question for the user to edit
    setQuestions([{ id: 1, question: '', options: ['', ''], correctAnswer: 0 }]);

    toast({ title: 'Prefill loaded', description: 'Schedule details were prefilled. Add questions and save to create the test.' });
  }, [location, testId]);

  const addQuestion = () => {
    setQuestions([...questions, { 
      id: questions.length + 1, 
      question: '', 
      options: ['', '', '', ''], 
      correctAnswer: 0 
    }]);
  };

  const fetchStudentsForSchedule = async () => {
    setStudentLoading(true);
    try {
      const res = await authFetch(getApiUrl('/api/examiner/students'));
      if (!res.ok) throw new Error('Failed to fetch students');
      const data = await res.json();
      setStudents(data.students || []);
      // initialize selection map only if empty
      setSelectedEmails(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const map: Record<string, boolean> = {};
        (data.students || []).forEach((s: any) => (map[s.email] = false));
        return map;
      });
    } catch (err: any) {
      console.error('Fetch students error:', err);
      toast({ title: 'Failed to load students', description: err?.message || 'Could not retrieve students', variant: 'destructive' });
    } finally {
      setStudentLoading(false);
    }
  };

  useEffect(() => {
    if (!isScheduleOpen) return;
    fetchStudentsForSchedule();
  }, [isScheduleOpen]);

  const filteredStudents = students.filter(s => !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.email.toLowerCase().includes(searchTerm.toLowerCase()));

  const toggleSelect = (email: string) => {
    setSelectedEmails(prev => ({ ...prev, [email]: !prev[email] }));
  };

  const selectAll = () => {
    const map: Record<string, boolean> = {};
    filteredStudents.forEach(s => map[s.email] = true);
    setSelectedEmails(prev => ({ ...prev, ...map }));
  };

  const clearSelection = () => {
    const map: Record<string, boolean> = {};
    Object.keys(selectedEmails).forEach(k => map[k] = false);
    setSelectedEmails(map);
  };

  const handleUseSelection = () => {
    const emails = Object.keys(selectedEmails).filter(e => selectedEmails[e]);
    if (!scheduleName.trim()) {
      toast({ title: 'Test name required', description: 'Please provide a name for the scheduled test', variant: 'destructive' });
      return;
    }
    if (emails.length === 0) {
      toast({ title: 'No students selected', description: 'Please select at least one student to invite', variant: 'destructive' });
      return;
    }

    setTestName(scheduleName);
    setDuration(scheduleDuration);
    setStartTime(scheduleStart);
    setAllowedStudentsInput(emails.join(', '));
    setIsScheduleOpen(false);
    setCreationMode('manual');
    toast({ title: 'Selection applied', description: 'You can now add questions and save the test.' });
  };

  const removeQuestion = (id: number) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  const handleGenerateWithAI = async () => {
    if (!aiPrompt.trim()) {
      toast({
        title: "Prompt Required",
        description: "Please describe the test you want to generate",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Generating Test",
      description: "AI is creating your test questions...",
    });
    
    try {
      const response = await authFetch(getApiUrl('/api/examiner/ai-generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiPrompt })
      });

      if (response.ok) {
        const data = await response.json();
        setQuestions(data.questions.map((q: Question, idx: number) => ({
          ...q,
          id: idx + 1
        })));
        // Switch to manual mode so generated questions are visible for review/editing
        setCreationMode('manual');
        toast({
          title: "Test Generated!",
          description: data.message || "Review and edit the generated questions",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Generation Failed",
          description: error.message || "Failed to generate questions. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to connect to AI service. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSaveTest = async () => {
    if (!testName.trim()) {
      toast({
        title: "Test Name Required",
        description: "Please enter a name for your test",
        variant: "destructive",
      });
      return;
    }

    // Validate questions (ensure question text and at least two non-empty options for MCQ)
    const sanitizedQuestions = questions.map((q) => ({
      ...q,
      question: (q.question || '').toString().trim(),
      options: Array.isArray(q.options) ? q.options.map((o: any) => (o || '').toString().trim()).filter(Boolean) : [],
    })).filter((q) => q.question && (q.options.length >= 2));

    if (sanitizedQuestions.length === 0) {
      toast({
        title: "Questions Required",
        description: "Please add at least one valid question with two or more options",
        variant: "destructive",
      });
      return;
    }

    try {
      const allowedStudents = allowedStudentsInput
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      const payload: any = {
        testName,
        questions: sanitizedQuestions,
        duration,
        allowedStudents,
      };

      if (startTime) {
        payload.startTime = new Date(startTime).toISOString();
        // also include endTime for clarity
        payload.endTime = new Date(new Date(startTime).getTime() + duration * 60 * 1000).toISOString();
      }

      // Decide whether to create or update
      const url = isEditing && testId ? getApiUrl(`/api/examiner/tests/${testId}`) : getApiUrl('/api/examiner/tests');
      const method = isEditing && testId ? 'PUT' : 'POST';

      const response = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: isEditing ? "Test Updated!" : "Test Created!",
          description: data.message || (isEditing ? "Your test has been updated successfully" : "Your test has been saved successfully"),
        });
        navigate('/examiner/dashboard');
      } else {
        const error = await response.json();
        // Show validation details if provided
        const details = error.details ? ` (${JSON.stringify(error.details)})` : '';
        toast({
          title: isEditing ? "Update Failed" : "Save Failed",
          description: (error.message || "Failed to save test. Please try again.") + details,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to save test. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate('/examiner/dashboard')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>

      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{isEditing ? 'Edit Test' : 'Create New Test'}</CardTitle>
            <CardDescription>Generate questions with AI or create manually</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="testName">Test Name</Label>
              <Input 
                id="testName"
                placeholder="e.g., Mathematics Final Exam"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>Creation Mode</Label>
              <RadioGroup value={creationMode} onValueChange={(value) => setCreationMode(value as 'ai' | 'manual')}>
                <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="ai" id="ai" />
                  <Label htmlFor="ai" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="font-semibold">Generate with AI</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Describe your test and let AI create questions
                    </p>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="manual" id="manual" />
                  <Label htmlFor="manual" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-secondary" />
                      <span className="font-semibold">Create Manually</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Add questions one-by-one yourself
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {creationMode === 'ai' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="aiPrompt">Describe Your Test</Label>
                  <Textarea 
                    id="aiPrompt"
                    placeholder="E.g., Create 10 multiple choice questions on calculus, focusing on derivatives and integrals. Include difficulty levels from easy to hard."
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    rows={5}
                  />
                </div>
                <Button onClick={handleGenerateWithAI} className="w-full">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate questions with AI
                </Button>

                {/* Quick preview of generated questions when in AI mode */}
                {questions && questions.length > 0 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle>Generated Questions Preview</CardTitle>
                      <CardDescription>Switching to manual mode will let you edit questions and save the test</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {questions.map((q) => (
                          <div key={q.id} className="p-3 border rounded">
                            <div className="font-semibold">{q.question}</div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {q.options?.map((opt, i) => (
                                <div key={i}>• {opt}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {questions.map((q, qIndex) => (
                  <Card key={q.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Question {qIndex + 1}</CardTitle>
                        {questions.length > 1 && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => removeQuestion(q.id)}
                          >
                            <Trash className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Question Text</Label>
                        <Textarea 
                          placeholder="Enter your question"
                          value={q.question}
                          onChange={(e) => {
                            const newQuestions = [...questions];
                            newQuestions[qIndex].question = e.target.value;
                            setQuestions(newQuestions);
                          }}
                        />
                      </div>

                      <div className="space-y-3">
                        <Label>Options (Select correct answer)</Label>
                        <RadioGroup 
                          value={q.correctAnswer.toString()}
                          onValueChange={(value) => {
                            const newQuestions = [...questions];
                            newQuestions[qIndex].correctAnswer = parseInt(value);
                            setQuestions(newQuestions);
                          }}
                        >
                          {q.options.map((option, optIndex) => (
                            <div key={optIndex} className="flex items-center gap-3">
                              <RadioGroupItem value={optIndex.toString()} id={`q${q.id}-opt${optIndex}`} />
                              <Input 
                                placeholder={`Option ${optIndex + 1}`}
                                value={option}
                                onChange={(e) => {
                                  const newQuestions = [...questions];
                                  newQuestions[qIndex].options[optIndex] = e.target.value;
                                  setQuestions(newQuestions);
                                }}
                                className="flex-1"
                              />
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <Label>Duration (minutes)</Label>
                    <Input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value || '60'))} />
                  </div>

                  <div>
                    <Label>Start Time (optional)</Label>
                    <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>

                  <div>
                    <Label>Allowed Students (comma-separated emails)</Label>
                    <Input placeholder="email1@example.com, email2@example.com" value={allowedStudentsInput} onChange={(e) => setAllowedStudentsInput(e.target.value)} />
                  </div>
                </div>

                <Button onClick={addQuestion} variant="outline" className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Question
                </Button>
              </div>


            )}

            {/* Schedule dialog moved into CreateTest so 'Create Test' opens the scheduling UI first */}
            <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Students / Schedule</DialogTitle>
                  <DialogDescription>Choose students to invite and set schedule details before creating your test</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="scheduleName">Test Name</Label>
                    <Input id="scheduleName" placeholder="e.g., Final Exam - Biology" value={scheduleName || testName} onChange={(e) => setScheduleName(e.target.value)} />
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="scheduleStart">Start Time</Label>
                      <Input id="scheduleStart" type="datetime-local" value={scheduleStart || startTime} onChange={(e) => setScheduleStart(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="scheduleDuration">Duration (minutes)</Label>
                      <Input id="scheduleDuration" type="number" value={scheduleDuration || duration} onChange={(e) => setScheduleDuration(parseInt(e.target.value || '60'))} />
                    </div>
                  </div>

                  <div>
                    <Label>Filter Students</Label>
                    <Input placeholder="Search by name or email" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={selectAll}>Select Visible</Button>
                    <Button variant="ghost" onClick={clearSelection}>Clear</Button>
                  </div>

                  <div className="max-h-64 overflow-auto border rounded p-2 space-y-2">
                    {studentLoading ? (
                      <div className="text-muted-foreground p-2">Loading students...</div>
                    ) : filteredStudents.length === 0 ? (
                      <div className="text-muted-foreground p-2">No students found.</div>
                    ) : (
                      filteredStudents.map(s => (
                        <div key={s.email} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Checkbox checked={!!selectedEmails[s.email]} onCheckedChange={() => toggleSelect(s.email)} />
                            <div>
                              <div className="font-medium">{s.name}</div>
                              <div className="text-sm text-muted-foreground">{s.email}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setIsScheduleOpen(false)}>Cancel</Button>
                    <Button variant="secondary" onClick={handleUseSelection}>Use Selection</Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => navigate('/examiner/dashboard')} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSaveTest} className="flex-1">
                {isEditing ? 'Update Test' : 'Save Test'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CreateTest;
