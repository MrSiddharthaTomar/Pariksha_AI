import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, User, Mail, ShieldCheck, GraduationCap, Camera, Loader2, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, authFetch } from "@/lib/api-config";

const StudentProfile = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [student, setStudent] = useState<any>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const storedUser = localStorage.getItem("user");
        const storedEmail = localStorage.getItem("studentEmail");

        if (storedUser) {
            setStudent(JSON.parse(storedUser));
        } else if (storedEmail) {
            setStudent({ email: storedEmail, name: "Student" });
        }
    }, []);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            toast({
                title: "File too large",
                description: "Image size must be less than 5MB",
                variant: "destructive",
            });
            return;
        }

        setIsUploading(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64String = reader.result as string;

            try {
                const res = await authFetch(getApiUrl('/api/auth/profile-image'), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ photo: base64String }),
                });

                if (res.ok) {
                    const data = await res.json();

                    // Update local state
                    const updatedStudent = { ...student, photo: data.user.photo };
                    setStudent(updatedStudent);

                    // Update localStorage
                    localStorage.setItem('user', JSON.stringify(updatedStudent));

                    toast({
                        title: "Success",
                        description: "Profile photo updated successfully",
                    });
                } else {
                    const error = await res.json();
                    throw new Error(error.message || "Failed to update photo");
                }
            } catch (error: any) {
                console.error("Upload error:", error);
                toast({
                    title: "Upload Failed",
                    description: error.message || "Failed to update profile photo",
                    variant: "destructive",
                });
            } finally {
                setIsUploading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    if (!student) {
        return (
            <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
                <p>Loading profile...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-hero p-4 lg:p-8 flex items-center justify-center overflow-hidden">
            <div className="w-full max-w-5xl">
                <div className="flex items-center justify-between mb-6">
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/student/tests')}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Dashboard
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

                <div className="grid lg:grid-cols-3 gap-6 h-[80vh] lg:h-auto">
                    {/* Left Column - Avatar & Basic Info */}
                    <Card className="lg:col-span-1 shadow-lg animate-slide-up flex flex-col justify-center items-center p-6 text-center">
                        <div className="relative group">
                            <Avatar className="w-40 h-40 border-4 border-primary/20 mb-4">
                                <AvatarImage src={student.photo || `https://api.dicebear.com/7.x/initials/svg?seed=${student.name || 'Student'}`} className="object-cover" />
                                <AvatarFallback><User className="w-16 h-16" /></AvatarFallback>
                            </Avatar>
                            <div
                                className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Camera className="w-8 h-8 text-white" />
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                                disabled={isUploading}
                            />
                        </div>

                        <h2 className="text-2xl font-bold mb-1">{student.name || "Student Profile"}</h2>
                        <p className="text-muted-foreground mb-4">Student Account</p>

                        {isUploading && (
                            <div className="flex items-center text-sm text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Updating photo...
                            </div>
                        )}
                    </Card>

                    {/* Right Column - Details Grid */}
                    <Card className="lg:col-span-2 shadow-lg animate-slide-up bg-card/50 backdrop-blur">
                        <CardHeader>
                            <CardTitle>Profile Details</CardTitle>
                            <CardDescription>Your personal information</CardDescription>
                        </CardHeader>
                        <CardContent className="grid sm:grid-cols-2 gap-4">
                            <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                <div className="p-3 bg-primary/10 rounded-full">
                                    <User className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Full Name</p>
                                    <p className="font-semibold">{student.name || "N/A"}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                <div className="p-3 bg-secondary/10 rounded-full">
                                    <Mail className="w-5 h-5 text-secondary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Email Address</p>
                                    <p className="font-semibold truncate max-w-[200px]" title={student.email}>{student.email || "N/A"}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                <div className="p-3 bg-success/10 rounded-full">
                                    <GraduationCap className="w-5 h-5 text-success" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Role</p>
                                    <p className="font-semibold capitalize">{student.role || "Student"}</p>
                                </div>
                            </div>

                            {student.id && (
                                <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                    <div className="p-3 bg-warning/10 rounded-full">
                                        <ShieldCheck className="w-5 h-5 text-warning" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Student ID</p>
                                        <p className="font-semibold font-mono text-sm">{student.id}</p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default StudentProfile;
