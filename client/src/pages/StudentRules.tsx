import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CheckCircle2, ShieldAlert, LogOut } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const StudentRules = () => {
  const navigate = useNavigate();
  const [agreedToRules, setAgreedToRules] = useState(false);

  const rules = [
    "Ensure you are in a quiet, well-lit room with no other people present",
    "Keep your face clearly visible to the camera at all times",
    "Do not use any unauthorized materials, devices, or websites",
    "Keep your eyes on the screen - looking away frequently may be flagged",
    "Ensure stable internet connection throughout the exam",
    "Do not leave your seat during the exam",
    "Speaking or making unusual sounds may trigger alerts",
    "Multiple faces detected will result in immediate flagging",
    "Mobile phones and other devices must be kept away",
    "Any suspicious activity will be recorded and reviewed"
  ];

  const handleStartTest = () => {
    if (agreedToRules) {
      navigate('/student/test');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero p-4">
      <div className="container max-w-4xl mx-auto py-8">
        <Card className="animate-slide-up">
          <CardHeader>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-warning/10 rounded-lg">
                <ShieldAlert className="w-8 h-8 text-warning" />
              </div>
              <div>
                <CardTitle className="text-3xl">Exam Rules & Guidelines</CardTitle>
                <CardDescription className="text-base">
                  Please read carefully before starting your exam
                </CardDescription>
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>AI Proctoring Active</AlertTitle>
              <AlertDescription>
                This exam is monitored by AI. Any violation of rules will be automatically detected and recorded.
              </AlertDescription>
            </Alert>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-success" />
                Exam Rules
              </h3>
              
              <ul className="space-y-3">
                {rules.map((rule, index) => (
                  <li key={index} className="flex gap-3 items-start p-3 rounded-lg bg-muted/50">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-semibold text-primary">{index + 1}</span>
                    </div>
                    <span className="text-sm">{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t pt-6">
              <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-lg">
                <Checkbox 
                  id="agree"
                  checked={agreedToRules}
                  onCheckedChange={(checked) => setAgreedToRules(checked as boolean)}
                />
                <label 
                  htmlFor="agree" 
                  className="text-sm font-medium leading-relaxed cursor-pointer"
                >
                  I have read and understood all the rules. I agree to follow them and understand that any violation will be recorded and may result in exam disqualification.
                </label>
              </div>
            </div>

            <div className="flex gap-4">
              <Button 
                variant="outline" 
                onClick={() => navigate('/student/tests')}
                className="flex-1"
              >
                Go Back
              </Button>
              <Button 
                onClick={handleStartTest}
                disabled={!agreedToRules}
                className="flex-1"
                size="lg"
              >
                Start Exam
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default StudentRules;
