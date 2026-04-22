import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, FileText, Loader2, UserCircle, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, authFetch } from "@/lib/api-config";

interface Test {
  id: string;
  name: string;
  description?: string;
  duration: number;
  status: string;
  questionCount: number;
  startTime: string;
  endTime: string;
}

const StudentTestList = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tests, setTests] = useState<Test[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTests = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: "Error",
          description: "Session expired. Please login again.",
          variant: "destructive",
        });
        navigate('/student/login');
        return;
      }

      try {
        const response = await authFetch(getApiUrl('/api/student/tests'));

        if (response.ok) {
          const data = await response.json();
          setTests(data.tests || []);
        } else {
          const error = await response.json();
          toast({
            title: "Error",
            description: error.message || "Failed to load tests",
            variant: "destructive",
          });
        }
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to connect to server. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTests();
  }, [navigate, toast]);

  const handleStartTest = (test: Test) => {
    const now = new Date();
    const start = new Date(test.startTime);
    const end = new Date(test.endTime);

    if (now < start || now > end) {
      toast({
        title: "Test Unavailable",
        description: "This test is only active during its scheduled window.",
        variant: "destructive",
      });
      return;
    }

    if (test.status === 'submitted') {
      toast({
        title: "Already Submitted",
        description: "You have already submitted this test.",
      });
      return;
    }

    localStorage.setItem('testId', test.id);
    navigate('/student/rules');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-hero p-4">
      <div className="container max-w-6xl mx-auto py-6">
        <div className="mb-6 relative">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
          <h1 className="text-3xl font-bold mb-2">My Tests</h1>
          <p className="text-muted-foreground">
            Select a test to begin. Make sure you're ready before starting.
          </p>
          <div className="absolute top-6 right-0 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/student/profile')}
            >
              <UserCircle className="mr-2 h-4 w-4" />
              My Profile
            </Button>
            <Button
              variant="outline"
              className=" hover:bg-destructive hover:border-destructive"
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('studentId');
                localStorage.removeItem('studentEmail');
                navigate('/');
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-2">Loading tests...</span>
          </div>
        ) : tests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">No Tests Available</h3>
              <p className="text-muted-foreground">
                You don't have any scheduled tests at the moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tests.map((test) => {
              const now = new Date();
              const start = new Date(test.startTime);
              const end = new Date(test.endTime);
              const isActive = now >= start && now <= end;
              const isSubmitted = test.status === 'submitted';

              return (
                <Card key={test.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className="text-lg">{test.name}</CardTitle>
                      <Badge
                        variant={test.status === 'active' ? 'default' : 'outline'}
                      >
                        {test.status}
                      </Badge>
                    </div>
                    {test.description && (
                      <CardDescription>{test.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span>{test.duration} minutes</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <strong>Opens:</strong> {formatDate(test.startTime)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <strong>Closes:</strong> {formatDate(test.endTime)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <strong>Questions:</strong> {test.questionCount}
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => handleStartTest(test)}
                      disabled={isSubmitted || !isActive}
                    >
                      {isSubmitted ? 'Already Submitted' : isActive ? 'Start Test' : 'Not Active'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentTestList;

