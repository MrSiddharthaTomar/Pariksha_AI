import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, User, Mail, ShieldCheck, UserCheck, Camera, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl, authFetch } from "@/lib/api-config";

const ExaminerProfile = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [examiner, setExaminer] = useState<any>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const storedUser = localStorage.getItem("user");

        if (storedUser) {
            setExaminer(JSON.parse(storedUser));
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
                    const updatedExaminer = { ...examiner, photo: data.user.photo };
                    setExaminer(updatedExaminer);

                    // Update localStorage
                    localStorage.setItem('user', JSON.stringify(updatedExaminer));

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

    if (!examiner) {
        return (
            <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
                <p>Loading profile...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-hero p-4 lg:p-8 flex items-center justify-center overflow-hidden">
            <div className="w-full max-w-5xl">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/examiner/dashboard')}
                    className="mb-6"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Dashboard
                </Button>

                <div className="grid lg:grid-cols-3 gap-6 h-[80vh] lg:h-auto">
                    {/* Left Column - Avatar & Basic Info */}
                    <Card className="lg:col-span-1 shadow-lg animate-slide-up flex flex-col justify-center items-center p-6 text-center">
                        <div className="relative group">
                            <Avatar className="w-40 h-40 border-4 border-secondary/20 mb-4">
                                <AvatarImage src={examiner.photo || `https://api.dicebear.com/7.x/initials/svg?seed=${examiner.name || 'Examiner'}`} className="object-cover" />
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

                        <h2 className="text-2xl font-bold mb-1">{examiner.name || "Examiner Profile"}</h2>
                        <p className="text-muted-foreground mb-4">Examiner Account</p>

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
                                    <p className="font-semibold">{examiner.name || "N/A"}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                <div className="p-3 bg-secondary/10 rounded-full">
                                    <Mail className="w-5 h-5 text-secondary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Email Address</p>
                                    <p className="font-semibold truncate max-w-[200px]" title={examiner.email}>{examiner.email || "N/A"}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                <div className="p-3 bg-success/10 rounded-full">
                                    <UserCheck className="w-5 h-5 text-success" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Role</p>
                                    <p className="font-semibold capitalize">{examiner.role || "Examiner"}</p>
                                </div>
                            </div>

                            {examiner.id && (
                                <div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
                                    <div className="p-3 bg-warning/10 rounded-full">
                                        <ShieldCheck className="w-5 h-5 text-warning" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Examiner ID</p>
                                        <p className="font-semibold font-mono text-sm">{examiner.id}</p>
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

export default ExaminerProfile;
