import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getApiUrl, authFetch, getImageUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Users, Eye, Home } from "lucide-react";

const ReviewViolations = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Array<any>>([]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { testId } = useParams();

  const fetchLiveTests = async () => {
    setLoading(true);
    try {
      const res = await authFetch(getApiUrl('/api/examiner/live-tests'));
      if (!res.ok) throw new Error('Failed to fetch violations');
      const data = await res.json();
      setTests(data.tests || []);
      setError(null);
    } catch (err: any) {
      console.error('Live tests fetch error:', err);
      setError(err?.message || 'Failed to load live tests');
      toast({ title: 'Error', description: err?.message || 'Failed to load live tests', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!testId) {
      fetchLiveTests();
      const timer = setInterval(fetchLiveTests, 15000); // refresh every 15s
      return () => clearInterval(timer);
    }
  }, [testId]);

  if (testId) {
    return <MonitorDetail testId={testId} onBack={() => navigate('/examiner/ReviewViolations')} />;
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/examiner/dashboard')}
              title="Back to Dashboard"
            >
              <Home className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Violation Review</h1>
              <p className="text-muted-foreground">Open tests to review detected violations and attempts</p>
            </div>
            <div>
              <Button variant="outline" onClick={() => fetchLiveTests()}>Refresh</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="p-4 text-muted-foreground">Loading live tests...</div>
        ) : error ? (
          <div className="p-4 text-destructive">{error}</div>
        ) : tests.length === 0 ? (
          <div className="p-4 text-muted-foreground">No pending violations for review.</div>
        ) : (
          <div className="space-y-4">
            {tests.map((t) => (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted/10 rounded-lg">
                        <Eye className="w-6 h-6" />
                      </div>
                      <div>
                        <CardTitle>{t.name}</CardTitle>
                        <CardDescription>{t.startTime ? new Date(t.startTime).toLocaleString() : 'No start time'}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" />{t.students} students</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2">Attempts: <strong>{t.activeAttempts ?? 0}</strong></div>
                      {t.unreviewedViolations > 0 && (
                        <div className="px-2 py-1 rounded-full text-sm bg-red-100 text-red-700">{t.unreviewedViolations} pending</div>
                      )}
                      <Button size="sm" variant="outline" onClick={() => navigate(`/examiner/ReviewViolations/${t.id}`)}>Open Review</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">Status: {t.status}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function MonitorDetail({ testId, onBack }: { testId: string; onBack: () => void }) {
  const [events, setEvents] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const pollingRef = useRef<number | null>(null);

  const [attemptsList, setAttemptsList] = useState<Array<any>>([]);

  const fetchEvents = async () => {
    try {
      const res = await authFetch(getApiUrl(`/api/examiner/monitor/${testId}/events`));
      if (!res.ok) throw new Error('Failed to fetch events');
      const data = await res.json();
      setEvents(data.events || []);
      setError(null);
    } catch (err: any) {
      console.error('Monitor events fetch error:', err);
      setError(err?.message || 'Failed to load events');
      toast({ title: 'Error', description: err?.message || 'Failed to load events', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchAttempts = async () => {
    try {
      const res = await authFetch(getApiUrl(`/api/examiner/monitor/${testId}/attempts`));
      if (!res.ok) throw new Error('Failed to fetch attempts');
      const data = await res.json();
      setAttemptsList(data.attempts || []);
    } catch (err: any) {
      console.error('Monitor attempts fetch error:', err);
    }
  };

  const [reviewingLogs, setReviewingLogs] = useState<string[]>([]);

  const applyReview = async (logId: string, verdict: 'valid' | 'invalid') => {
    setReviewingLogs(prev => [...prev, logId]);
    try {
      const res = await authFetch(getApiUrl(`/api/examiner/proctoring/${logId}/review`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) throw new Error('Failed to apply review');
      const data = await res.json();

      if (verdict === 'invalid') {
        setEvents(prev => prev.filter(ev => ev.id !== logId));
      } else {
        setEvents(prev => prev.map(ev => ev.id === logId ? { ...ev, reviewed: true, verdict: data?.log?.verdict || verdict, reviewedAt: data?.log?.reviewedAt, reviewedBy: data?.log?.reviewedBy, reviewerNotes: data?.log?.reviewerNotes } : ev));
      }

      if (data?.attempt) {
        setAttemptsList(prev => prev.map(a => a.attemptId === data.attempt.attemptId ? { ...a, trustScore: data.attempt.trustScore, totalViolations: data.attempt.totalViolations } : a));
      }

      toast({ title: 'Review saved', description: `Marked as ${verdict}` });
    } catch (err: any) {
      console.error('Review apply error:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to apply review', variant: 'destructive' });
    } finally {
      setReviewingLogs(prev => prev.filter(id => id !== logId));
    }
  };

  useEffect(() => {
    fetchEvents();
    fetchAttempts();
    pollingRef.current = window.setInterval(() => {
      if (!paused) {
        fetchEvents();
        fetchAttempts();
      }
    }, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [testId, paused]);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Violation Review</h1>
              <p className="text-muted-foreground">Proctoring events and violations for this test</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onBack}>Back</Button>
              <Button variant="ghost" onClick={() => navigate('/examiner/dashboard')}>Home</Button>
              <Button variant="outline" onClick={() => fetchEvents()}>Refresh</Button>
              <Button variant="secondary" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="p-4 text-muted-foreground">Loading events...</div>
        ) : error ? (
          <div className="p-4 text-destructive">{error}</div>
        ) : events.length === 0 && attemptsList.length === 0 ? (
          <div className="p-4 text-muted-foreground">No proctoring events or active attempts found for this test yet.</div>
        ) : (
          <div className="space-y-6">
            {/* Active attempts (live thumbnails) */}
            {attemptsList.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Active Attempts</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {attemptsList.map((a) => (
                    <Card key={a.attemptId} className="overflow-hidden">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-muted-foreground">{a.student ? a.student.name : 'Unknown student'}</div>
                            <CardTitle className="mt-1 text-sm">{a.student ? a.student.email : ''}</CardTitle>
                            <CardDescription className="text-xs">Started: {a.startedAt ? new Date(a.startedAt).toLocaleTimeString() : '—'}</CardDescription>
                            {a.latestFrameAt && (new Date().getTime() - new Date(a.latestFrameAt).getTime() < 15000) && (
                              <div className="inline-block mt-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Live</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={`px-2 py-1 rounded-full text-sm ${a.totalViolations > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{a.totalViolations} violations</div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {a.latestFrame ? (
                          <div>
                            <img src={a.latestFrame} alt="live preview" className="w-full h-40 object-cover rounded-md" />
                            <div className="mt-2 text-xs text-muted-foreground">
                              Live feed view is temporarily unavailable.
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-40 bg-muted rounded-md flex items-center justify-center text-sm text-muted-foreground">No live frame yet</div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Proctoring event list */}
            {events.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Recent Proctoring Events</h2>
                <div className="space-y-4">
                  {events.map((e) => (
                    <Card key={e.id}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
                            <CardTitle className="mt-1">{e.label}</CardTitle>
                            <CardDescription className="text-sm">{e.student ? `${e.student.name} (${e.student.email})` : 'Unknown student'}</CardDescription>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className={`px-3 py-1 rounded-full text-sm ${e.severity === 'high' ? 'bg-red-100 text-red-700' : e.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{e.severity}</div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {e.imageId ? (
                          <a href={getImageUrl(e.imageId)} target="_blank" rel="noreferrer">
                            <img src={getImageUrl(e.imageId)} alt="evidence" className="w-48 h-32 object-cover rounded-md" />
                          </a>
                        ) : (
                          <div className="text-sm text-muted-foreground">No image</div>
                        )}

                        <div className="mt-3 flex gap-2 items-center">
                          <Button size="sm" variant={e.reviewed && e.verdict === 'valid' ? 'default' : 'outline'} disabled={reviewingLogs.includes(e.id)} onClick={() => applyReview(e.id, 'valid')}>Mark Valid</Button>
                          <Button size="sm" variant={e.reviewed && e.verdict === 'invalid' ? 'destructive' : 'ghost'} className={!e.reviewed || e.verdict !== 'invalid' ? 'hover:bg-red-50 hover:text-red-700' : ''} disabled={reviewingLogs.includes(e.id)} onClick={() => applyReview(e.id, 'invalid')}>Mark Invalid</Button>
                          {e.reviewed && (
                            <div className="text-sm text-muted-foreground ml-3">
                              Reviewed: {e.verdict} {e.reviewedAt ? `on ${new Date(e.reviewedAt).toLocaleString()}` : ''} {e.reviewerNotes ? ` — Notes: ${e.reviewerNotes}` : ''}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewViolations;
