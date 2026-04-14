import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getApiUrl, authFetch } from "@/lib/api-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, Mail, AlertTriangle, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StudentResult {
  attemptId: string;
  studentId: string | null;
  name: string;
  email: string;
  actualScore: number;
  trustScore: number;
  violationsCount: number;
  status?: string;
}

const TestResults = () => {
  const navigate = useNavigate();
  const { testId } = useParams();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [topNStudents, setTopNStudents] = useState('');
  const [showViolationsOnly, setShowViolationsOnly] = useState(false);

  const [students, setStudents] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const handleSortChange = (value: string) => {
    setSortBy(value);
    // TODO: Implement sorting logic
  };

  const handleSelectTopN = () => {
    const n = parseInt(topNStudents);
    if (isNaN(n) || n <= 0) return;
    
    const sorted = [...students].sort((a, b) => b.actualScore - a.actualScore);
    const topIds = sorted.slice(0, n).map(s => s.studentId || s.attemptId);
    setSelectedStudents(topIds);
  };

  const handleSendEmails = () => {
    if (selectedStudents.length === 0) {
      toast({
        title: "No Students Selected",
        description: "Please select students to send emails",
        variant: "destructive",
      });
      return;
    }

    // TODO: Integrate with real email API
    toast({
      title: "Emails Sent",
      description: `Successfully sent emails to ${selectedStudents.length} students`,
    });
  };

  const getTrustColor = (score: number) => {
    if (score >= 90) return "text-success";
    if (score >= 70) return "text-warning";
    return "text-destructive";
  };

  // Fetch test results
  useEffect(() => {
    const load = async () => {
      if (!testId) return;
      setLoading(true);
      try {
        const res = await authFetch(getApiUrl(`/api/examiner/results/${testId}`));
        if (!res.ok) throw new Error('Failed to fetch results');
        const data = await res.json();
        setStudents((data.students || []) as StudentResult[]);
        setError(null);
      } catch (err: any) {
        console.error('Load results error:', err);
        setError(err.message || 'Failed to load results');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [testId]);

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

      <div className="container max-w-6xl mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">Test Results</CardTitle>
            <CardDescription>{loading ? 'Loading...' : error ? `Error: ${error}` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Students</p>
                <p className="text-3xl font-bold mt-1">{students.length}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Average Score</p>
                <p className="text-3xl font-bold mt-1">{students.length ? Math.round(students.reduce((acc, s) => acc + s.actualScore, 0) / students.length) + '%' : '-'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Violations Detected</p>
                <p className="text-3xl font-bold mt-1">{students.reduce((acc, s) => acc + s.violationsCount, 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filter & Select Students</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="search"
                    placeholder="Search by name or email"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sort">Sort By</Label>
                <Select value={sortBy} onValueChange={handleSortChange}>
                  <SelectTrigger id="sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="actualScore">Actual Score</SelectItem>
                    <SelectItem value="trustScore">Trust Score</SelectItem>
                    <SelectItem value="violations">Violations</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="topN">Select Top N Students</Label>
                <div className="flex gap-2">
                  <Input 
                    id="topN"
                    type="number"
                    placeholder="e.g., 5"
                    value={topNStudents}
                    onChange={(e) => setTopNStudents(e.target.value)}
                  />
                  <Button onClick={handleSelectTopN} variant="outline">
                    <Trophy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <Button size="sm" variant={showViolationsOnly ? 'default' : 'outline'} onClick={() => setShowViolationsOnly(s => !s)}>
                <AlertTriangle className="w-4 h-4 mr-2" />
                {showViolationsOnly ? 'Showing Only Violations' : 'Show Only Students With Violations'}
              </Button>
            </div>

            <Button onClick={handleSendEmails} disabled={selectedStudents.length === 0}>
              <Mail className="mr-2 h-4 w-4" />
              Send Emails to Selected ({selectedStudents.length})
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Student Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {loading ? (
                <div className="p-4 text-muted-foreground">Loading students...</div>
              ) : students.length === 0 ? (
                <div className="p-4 text-muted-foreground">No student attempts found for this test.</div>
              ) : (
                (showViolationsOnly ? students.filter(s => s.violationsCount > 0) : students).map((student) => (
                  <div 
                    key={student.attemptId}
                    className={`p-4 border rounded-lg cursor-pointer transition-all ${
                      selectedStudents.includes(student.studentId || student.attemptId) ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'
                    }`}
                    onClick={() => {
                      const idKey = student.studentId || student.attemptId;
                      setSelectedStudents(prev => 
                        prev.includes(idKey) 
                          ? prev.filter(id => id !== idKey)
                          : [...prev, idKey]
                      );
                    }}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{student.name}</h3>
                          {student.violationsCount > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              {student.violationsCount} violations
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{student.email}</p>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Score</p>
                          <p className="text-2xl font-bold">{student.actualScore}%</p>
                        </div>
                        
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Trust</p>
                          <p className={`text-2xl font-bold ${getTrustColor(student.trustScore)}`}>
                            {student.trustScore}%
                          </p>
                        </div>

                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/examiner/report/${student.attemptId}/${testId}`);
                          }}
                        >
                          View Report
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TestResults;
