import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, getToken } from "@/lib/api-config";
import { ensureSingleRole, getUserFromToken, isTokenValid } from "@/lib/auth";

const AdminLogin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    accessKey: "",
  });

  useEffect(() => {
    const token = getToken();
    if (token && isTokenValid(token)) {
      const user = getUserFromToken(token);
      if (user?.role === "admin") navigate("/admin/dashboard", { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ title: "Login Failed", description: data.message || "Unable to authenticate admin.", variant: "destructive" });
        return;
      }

      if (!ensureSingleRole("admin")) return;
      if (data.token) localStorage.setItem("token", data.token);
      if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
      toast({ title: "Authenticated", description: data.message || "Admin login successful." });
      navigate("/admin/dashboard");
    } catch (error) {
      toast({ title: "Error", description: "Could not connect to server.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Admin Login</CardTitle>
              <CardDescription>Restricted access</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accessKey">Admin Access Key</Label>
              <Input id="accessKey" type="password" required value={formData.accessKey} onChange={(e) => setFormData({ ...formData, accessKey: e.target.value })} />
            </div>
            <Button className="w-full" type="submit" disabled={isLoading}>
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logging in...</> : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminLogin;

