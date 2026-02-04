import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogIn, Loader2 } from "lucide-react";
import WebcamCapture from "@/components/WebcamCapture";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { ensureSingleRole } from "@/lib/auth";

const StudentLogin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    photo: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.photo) {
      toast({
        title: "Photo Required",
        description: "Please capture your photo for face verification",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/auth/student/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const data = await response.json();

        // Enforce single role per browser
        if (!ensureSingleRole('student')) {
          setIsLoading(false);
          toast({ title: 'Aborted', description: 'Login cancelled to preserve existing role.' });
          return;
        }

        // Store token & user info
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        if (data.user?.id) {
          localStorage.setItem('studentId', data.user.id);
        }
        if (data.user?.email) {
          localStorage.setItem('studentEmail', data.user.email);
        }
        if (data.user) localStorage.setItem('user', JSON.stringify(data.user));

        toast({
          title: "Authentication Successful!",
          description: data.message || "Welcome back!",
        });
        navigate('/student/tests');
      } else {
        const error = await response.json();
        toast({
          title: "Login Failed",
          description: error.message || "Invalid credentials or face verification failed.",
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

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <Card className="w-full max-w-xl animate-slide-up">
        <CardHeader>
          <Button 
            variant="ghost" 
            className="w-fit mb-4"
            onClick={() => navigate('/')}
            disabled={isLoading}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <LogIn className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Student Login</CardTitle>
              <CardDescription>Access your exam portal</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email"
                type="email"
                placeholder="student@example.com"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label>Face Verification</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Take a photo for identity verification
              </p>
              <WebcamCapture 
                onCapture={(imageData) => setFormData({...formData, photo: imageData})}
                capturedImage={formData.photo}
                disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Login
                </>
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Button 
                variant="link" 
                className="p-0 h-auto"
                onClick={() => navigate('/student/register')}
                disabled={isLoading}
              >
                Register here
              </Button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentLogin;
