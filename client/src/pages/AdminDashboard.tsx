import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiUrl, getAuthHeaders } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";

type AdminData = {
  stats: {
    pendingExaminerApprovals: number;
    totalStudents: number;
    pendingViolations: number;
    activeAdminSessions: number;
  };
  pendingExaminers: Array<{ _id: string; fullName: string; email: string; status: string }>;
  students: Array<{ _id: string; fullName: string; email: string; status: string }>;
  auditLogs: Array<{ _id: string; action: string; targetType: string; targetId?: string; createdAt: string }>;
};

const AdminDashboard = () => {
  const { toast } = useToast();
  const [data, setData] = useState<AdminData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(getApiUrl("/api/admin/dashboard"), { headers: getAuthHeaders() });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || "Failed to fetch admin dashboard");
    setData(body);
  };

  useEffect(() => {
    load().catch((error) => toast({ title: "Error", description: error.message, variant: "destructive" }));
  }, []);

  const updateExaminer = async (id: string, action: "approve" | "reject") => {
    setBusyId(id + action);
    try {
      let payload: Record<string, string> = {};
      if (action === "reject") {
        const reason = window.prompt("Enter rejection reason:");
        if (!reason || !reason.trim()) {
          toast({ title: "Reason Required", description: "Please provide a rejection reason.", variant: "destructive" });
          return;
        }
        payload = { reason: reason.trim() };
      }

      const res = await fetch(getApiUrl(`/api/admin/examiners/${id}/${action}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const responseBody = await res.json();
      if (!res.ok) throw new Error(responseBody.message || "Action failed");
      await load();
    } catch (error: any) {
      toast({ title: "Action Failed", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const logout = async () => {
    await fetch(getApiUrl("/api/admin/logout"), { method: "POST", headers: getAuthHeaders() });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/admin/login";
  };

  const stats = useMemo(() => data?.stats || {
    pendingExaminerApprovals: 0,
    totalStudents: 0,
    pendingViolations: 0,
    activeAdminSessions: 0,
  }, [data]);

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <Button variant="outline" onClick={logout}>Logout</Button>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card><CardHeader><CardTitle>Pending Examiners</CardTitle></CardHeader><CardContent>{stats.pendingExaminerApprovals}</CardContent></Card>
          <Card><CardHeader><CardTitle>Students</CardTitle></CardHeader><CardContent>{stats.totalStudents}</CardContent></Card>
          <Card><CardHeader><CardTitle>Pending Violations</CardTitle></CardHeader><CardContent>{stats.pendingViolations}</CardContent></Card>
          <Card><CardHeader><CardTitle>Admin Sessions</CardTitle></CardHeader><CardContent>{stats.activeAdminSessions}</CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Examiner Approvals</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(data?.pendingExaminers || []).map((examiner) => (
              <div key={examiner._id} className="border rounded p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{examiner.fullName}</div>
                  <div className="text-sm text-muted-foreground">{examiner.email}</div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={busyId === examiner._id + "approve"} onClick={() => updateExaminer(examiner._id, "approve")}>Approve</Button>
                  <Button variant="destructive" disabled={busyId === examiner._id + "reject"} onClick={() => updateExaminer(examiner._id, "reject")}>Reject</Button>
                </div>
              </div>
            ))}
            {(data?.pendingExaminers || []).length === 0 && <p className="text-sm text-muted-foreground">No pending examiner registrations.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Student Registrations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data?.students || []).slice(0, 20).map((student) => (
              <div key={student._id} className="flex items-center justify-between border rounded p-2">
                <div>
                  <div>{student.fullName}</div>
                  <div className="text-xs text-muted-foreground">{student.email}</div>
                </div>
                <Badge>{student.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data?.auditLogs || []).slice(0, 30).map((log) => (
              <div key={log._id} className="text-sm border rounded p-2 flex justify-between gap-2">
                <span>{log.action} ({log.targetType})</span>
                <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;

