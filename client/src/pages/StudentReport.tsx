import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, CheckCircle, Camera, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getApiUrl, authFetch, getImageUrl } from "@/lib/api-config";

const StudentReport = () => {
  const navigate = useNavigate();
  const { studentId, testId } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [student, setStudent] = useState<any | null>(null);
  const [attempt, setAttempt] = useState<any | null>(null);
  const [logs, setLogs] = useState<Array<any>>([]);
  const [fullscreenSummary, setFullscreenSummary] = useState<any | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        if (!studentId || !testId) return;
        const res = await authFetch(getApiUrl(`/api/examiner/report/${studentId}/${testId}`));
        if (!res.ok) throw new Error('Failed to fetch report');
        const data = await res.json();
        setStudent(data.student);
        setAttempt(data.attempt);
        setLogs(data.logs || []);
        setFullscreenSummary(data.fullscreenSummary || null);
        setError(null);
      } catch (err: any) {
        console.error('Load report error:', err);
        setError(err.message || 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [studentId, testId]);

  // Review actions are handled on the Review Violations page and were removed from this report view.

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      default: return 'secondary';
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate(`/examiner/results/${testId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Results
          </Button>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl">{loading ? 'Loading...' : error ? 'Error' : student?.name}</CardTitle>
                <CardDescription>{loading ? '' : error ? error : student?.email}</CardDescription>
              </div>
              <div className="flex gap-4">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Actual Score</p>
                  <p className="text-3xl font-bold">{attempt ? `${attempt.scorePercent ?? attempt.totalScore}%` : '-'}</p>
                  {attempt?.totalPossibleMarks !== undefined && (
                    <p className="text-xs text-muted-foreground mt-1">{attempt.totalScore}/{attempt.totalPossibleMarks} points</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Trust Score</p>
                  <p className={`text-3xl font-bold ${attempt && attempt.trustScore >= 80 ? 'text-success' : 'text-warning'}`}>
                    {attempt ? attempt.trustScore + '%' : '-'}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Violations</p>
                <p className="text-2xl font-bold mt-1">{attempt ? Math.max(attempt.totalViolations ?? 0, logs.length) : 0}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Test Duration</p>
                <p className="text-2xl font-bold mt-1">{attempt?.duration ? `${attempt.duration} mins` : '-'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Questions Answered</p>
                <p className="text-2xl font-bold mt-1">
                  {attempt ? (attempt.questionsAttempted ?? attempt.answers?.length ?? 0) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {fullscreenSummary && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Fullscreen Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Fullscreen Exits</p>
                  <p className="text-2xl font-bold mt-1">{fullscreenSummary.exitCount ?? 0}</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Time Outside Fullscreen</p>
                  <p className="text-2xl font-bold mt-1">
                    {formatDuration(fullscreenSummary.totalOutsideSeconds ?? 0)}
                  </p>
                </div>
              </div>

              {(fullscreenSummary.sessions || []).length > 0 ? (
                <div className="space-y-3">
                  {(fullscreenSummary.sessions || []).map((session: any) => (
                    <div key={session.index} className="rounded-lg border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">Exit #{session.index}</p>
                          <p className="text-sm text-muted-foreground">
                            Left: {session.exitedAt ? new Date(session.exitedAt).toLocaleString() : 'N/A'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Returned: {session.returnedAt ? new Date(session.returnedAt).toLocaleString() : 'Not returned before test end'}
                          </p>
                        </div>
                        <Badge variant="secondary">
                          {formatDuration(session.durationSeconds ?? 0)} ({session.durationMinutes ?? 0} mins)
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No fullscreen exits were recorded for this attempt.</div>
              )}
            </CardContent>
          </Card>
        )}

        {attempt?.questionResults?.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Answer Review</CardTitle>
              <CardDescription>See each answer that the student submitted with correctness and scoring details.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Questions</p>
                  <p className="text-2xl font-bold mt-1">{attempt.questionResults.length}</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Correct</p>
                  <p className="text-2xl font-bold mt-1">{attempt.questionResults.filter((q: any) => q.status === 'correct').length}</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Incorrect</p>
                  <p className="text-2xl font-bold mt-1">{attempt.questionResults.filter((q: any) => q.status === 'incorrect').length}</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Needs Review</p>
                  <p className="text-2xl font-bold mt-1">{attempt.questionResults.filter((q: any) => q.status === 'needs review').length}</p>
                </div>
              </div>
              <div className="space-y-4">
                {attempt.questionResults.map((qr: any, index: number) => (
                  <div key={`${qr.questionId}-${index}`} className="rounded-lg border bg-background p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Question {index + 1}</p>
                        <p className="font-semibold">{qr.questionText}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={qr.status === 'correct' ? 'default' : qr.status === 'incorrect' ? 'destructive' : 'secondary'}>
                          {qr.status === 'correct' ? 'Correct' : qr.status === 'incorrect' ? 'Incorrect' : 'Needs Review'}
                        </Badge>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Marks</p>
                          <p className="font-semibold">{qr.marksObtained}/{qr.marks}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Student Answer</p>
                        <div className="rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap">{qr.studentAnswerText}</div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Correct Answer</p>
                        <div className="rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap">
                          {qr.correctAnswerText || 'N/A'}
                        </div>
                      </div>
                    </div>

                    {qr.type !== 'mcq' && qr.referenceAnswer && (
                      <div className="mt-4 rounded-lg border bg-muted p-3 text-sm">
                        <p className="text-sm text-muted-foreground">Reference Answer</p>
                        <div className="whitespace-pre-wrap">{qr.referenceAnswer}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <Card>
            <CardContent className="py-12">Loading report...</CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-destructive">{error}</CardContent>
          </Card>
        ) : logs.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Proctoring Violations
              </CardTitle>
              <CardDescription>
                Detected suspicious activities during the exam
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {logs.map((violation, index) => (
                <Alert key={index} variant={getSeverityColor(violation.severity) as any}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <AlertTitle className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {new Date(violation.timestamp).toLocaleString()}
                      </AlertTitle>
                      <AlertDescription className="mt-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getSeverityColor(violation.severity) as any}>
                            {violation.severity}
                          </Badge>
                          <span>{violation.label}</span>
                          {violation.reviewed && (
                            <span className="ml-3 text-sm text-muted-foreground">(Reviewed: {violation.verdict})</span>
                          )}
                        </div>
                      </AlertDescription>
                    </div>
                    
                    <div className="ml-4 bg-muted rounded-lg w-48 h-32 flex items-center justify-center flex-shrink-0">
                      {violation.imageId ? (
                        <a href={getImageUrl(violation.imageId)} target="_blank" rel="noreferrer">
                          <img src={getImageUrl(violation.imageId)} alt="evidence" className="w-full h-full object-cover rounded-md" />
                        </a>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <Camera className="w-6 h-6" />
                          <p className="text-xs mt-1">No image</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {violation.reviewed && (
                    <div className="mt-3 text-sm text-muted-foreground">
                      Reviewed: {violation.verdict} {violation.reviewedAt ? `on ${new Date(violation.reviewedAt).toLocaleString()}` : ''} {violation.reviewerNotes ? ` — Notes: ${violation.reviewerNotes}` : ''}
                    </div>
                  )}
                </Alert>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-success/10 rounded-full">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-2">No Violations Detected</h3>
                <p className="text-muted-foreground">
                  This student completed the exam without any suspicious activity
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default StudentReport;
