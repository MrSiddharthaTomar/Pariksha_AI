import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import StudentRegister from "./pages/StudentRegister";
import ExaminerRegister from "./pages/ExaminerRegister";
import StudentLogin from "./pages/StudentLogin";
import ExaminerLogin from "./pages/ExaminerLogin";
import StudentRules from "./pages/StudentRules";
import StudentTestList from "./pages/StudentTestList";
import StudentTest from "./pages/StudentTest";
import ExaminerDashboard from "./pages/ExaminerDashboard";
import CreateTest from "./pages/CreateTest";
import ReviewViolations from "./pages/ReviewViolations";
import TestResults from "./pages/TestResults";
import StudentReport from "./pages/StudentReport";
import StudentProfile from "./pages/StudentProfile";
import ExaminerProfile from "./pages/ExaminerProfile";
import RequireAuth from "./components/RequireAuth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/student/register" element={<StudentRegister />} />
          <Route path="/examiner/register" element={<ExaminerRegister />} />
          <Route path="/student/login" element={<StudentLogin />} />
          <Route path="/examiner/login" element={<ExaminerLogin />} />
          <Route path="/student/tests" element={<RequireAuth role="student"><StudentTestList /></RequireAuth>} />
          <Route path="/student/rules" element={<RequireAuth role="student"><StudentRules /></RequireAuth>} />
          <Route path="/student/test" element={<RequireAuth role="student"><StudentTest /></RequireAuth>} />
          <Route path="/examiner/dashboard" element={<RequireAuth role="examiner"><ExaminerDashboard /></RequireAuth>} />
          <Route path="/examiner/create-test" element={<RequireAuth role="examiner"><CreateTest /></RequireAuth>} />
          <Route path="/examiner/create-test/:testId" element={<RequireAuth role="examiner"><CreateTest /></RequireAuth>} />
          <Route path="/examiner/ReviewViolations" element={<RequireAuth role="examiner"><ReviewViolations /></RequireAuth>} />
          <Route path="/examiner/ReviewViolations/:testId" element={<RequireAuth role="examiner"><ReviewViolations /></RequireAuth>} />
          <Route path="/examiner/results/:testId" element={<RequireAuth role="examiner"><TestResults /></RequireAuth>} />
          <Route path="/examiner/report/:studentId/:testId" element={<RequireAuth role="examiner"><StudentReport /></RequireAuth>} />
          <Route path="/student/profile" element={<RequireAuth role="student"><StudentProfile /></RequireAuth>} />
          <Route path="/examiner/profile" element={<RequireAuth role="examiner"><ExaminerProfile /></RequireAuth>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
