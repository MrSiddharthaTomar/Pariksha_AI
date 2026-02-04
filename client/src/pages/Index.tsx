import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, ShieldCheck, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getApiUrl } from "@/lib/api-config";

const Index = () => {
  const navigate = useNavigate();

  // Load face recognition models when homepage loads
  useEffect(() => {
    const loadModels = async () => {
      try {
        await fetch(getApiUrl('/api/load-models'));
        console.log('✓ Face recognition models loading initiated');
      } catch (error) {
        console.warn('⚠ Could not trigger model loading:', error);
      }
    };
    loadModels();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12 animate-fade-in">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-gradient-primary rounded-full">
              <ShieldCheck className="w-16 h-16 text-white" />
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Pariksha AI
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Advanced AI-powered exam proctoring platform ensuring academic integrity
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto animate-slide-up">
          <Card className="hover:shadow-xl transition-all duration-smooth cursor-pointer" onClick={() => navigate('/student/login')}>
            <CardHeader>
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <GraduationCap className="w-12 h-12 text-primary" />
                </div>
              </div>
              <CardTitle className="text-center text-2xl">Student Portal</CardTitle>
              <CardDescription className="text-center">
                Take secure, proctored exams with AI monitoring
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full" 
                size="lg"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/student/login');
                }}
              >
                Login as Student
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/student/register');
                }}
              >
                Register as Student
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-xl transition-all duration-smooth cursor-pointer" onClick={() => navigate('/examiner/login')}>
            <CardHeader>
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-secondary/10 rounded-full">
                  <UserCheck className="w-12 h-12 text-secondary" />
                </div>
              </div>
              <CardTitle className="text-center text-2xl">Examiner Portal</CardTitle>
              <CardDescription className="text-center">
                Create tests, monitor students, and analyze results
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full bg-secondary hover:bg-secondary/90" 
                size="lg"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/examiner/login');
                }}
              >
                Login as Examiner
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/examiner/register');
                }}
              >
                Register as Examiner
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <div className="text-center p-6">
            <div className="bg-success/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-success" />
            </div>
            <h3 className="font-semibold mb-2">AI Proctoring</h3>
            <p className="text-sm text-muted-foreground">Real-time monitoring with advanced object and face detection</p>
          </div>
          <div className="text-center p-6">
            <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <GraduationCap className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Secure Testing</h3>
            <p className="text-sm text-muted-foreground">Browser lockdown and comprehensive integrity checks</p>
          </div>
          <div className="text-center p-6">
            <div className="bg-secondary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-8 h-8 text-secondary" />
            </div>
            <h3 className="font-semibold mb-2">Detailed Analytics</h3>
            <p className="text-sm text-muted-foreground">Trust scores and comprehensive cheating reports</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
