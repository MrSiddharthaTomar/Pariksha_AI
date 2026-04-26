import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";

const Index = lazy(() => import("./pages/Index"));
const StudentRegister = lazy(() => import("./pages/StudentRegister"));
const ExaminerRegister = lazy(() => import("./pages/ExaminerRegister"));
const StudentLogin = lazy(() => import("./pages/StudentLogin"));
const ExaminerLogin = lazy(() => import("./pages/ExaminerLogin"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const StudentRules = lazy(() => import("./pages/StudentRules"));
const StudentTestList = lazy(() => import("./pages/StudentTestList"));
const StudentTest = lazy(() => import("./pages/StudentTest"));
const ExaminerDashboard = lazy(() => import("./pages/ExaminerDashboard"));
const CreateTest = lazy(() => import("./pages/CreateTest"));
const ReviewViolations = lazy(() => import("./pages/ReviewViolations"));
const TestResults = lazy(() => import("./pages/TestResults"));
const StudentReport = lazy(() => import("./pages/StudentReport"));
const StudentProfile = lazy(() => import("./pages/StudentProfile"));
const ExaminerProfile = lazy(() => import("./pages/ExaminerProfile"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const AppShellLoader = () => (
  <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
    <div className="text-center">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">Loading Pariksha AI...</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<AppShellLoader />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/student/register" element={<StudentRegister />} />
            <Route path="/examiner/register" element={<ExaminerRegister />} />
            <Route path="/student/login" element={<StudentLogin />} />
            <Route path="/examiner/login" element={<ExaminerLogin />} />
            <Route path="/admin/login" element={<AdminLogin />} />
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
            <Route path="/admin/dashboard" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
