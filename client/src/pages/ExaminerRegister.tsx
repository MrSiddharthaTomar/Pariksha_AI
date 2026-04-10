import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
import WebcamCapture from "@/components/WebcamCapture";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, getToken } from "@/lib/api-config";
import { ensureSingleRole, isTokenValid, getUserFromToken } from "@/lib/auth";

const ExaminerRegister = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    const token = getToken();
    if (token && isTokenValid(token)) {
      const user = getUserFromToken(token);
      if (user && user.role === 'examiner') {
        toast({
          title: "Already Logged In",
          description: "Please logout first before creating a new account.",
          variant: "destructive",
        });
        navigate('/examiner/dashboard', { replace: true });
      }
    }
  }, [navigate, toast]);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    photo: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.photo) {
      toast({
        title: "Photo Required",
        description: "Please capture your photo to complete registration",
        variant: "destructive",
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/auth/examiner/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName,
          email: formData.email,
          password: formData.password,
          photo: formData.photo
        })
      });

      if (response.ok) {
        const data = await response.json();

        // Enforce single role per browser
        if (!ensureSingleRole('examiner')) {
          setIsLoading(false);
          toast({ title: 'Aborted', description: 'Registration cancelled to preserve existing role.' });
          return;
        }

        // If registration returns a token, store it and navigate to dashboard
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        toast({
          title: "Registration Successful!",
          description: data.message || "Your examiner account has been created.",
        });
        if (data.token) navigate('/examiner/dashboard'); else navigate('/examiner/login');
      } else {
        const error = await response.json();
        toast({
          title: "Registration Failed",
          description: error.message || "Failed to create account. Please try again.",
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
      <Card className="w-full max-w-2xl animate-slide-up">
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
            <div className="p-2 bg-secondary/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-secondary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Examiner Registration</CardTitle>
              <CardDescription>Create your examiner account</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input 
                id="fullName"
                placeholder="Dr. Jane Smith"
                value={formData.fullName}
                onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email"
                type="email"
                placeholder="examiner@example.com"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
                disabled={isLoading}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
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
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input 
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Profile Photo</Label>
              <WebcamCapture 
                onCapture={(imageData) => setFormData({...formData, photo: imageData})}
                capturedImage={formData.photo}
                disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90" size="lg" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Register as Examiner
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ExaminerRegister;
