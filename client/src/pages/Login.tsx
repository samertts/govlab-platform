import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { FlaskConical, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoggingIn } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
      {/* Abstract Background Shapes */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-br from-primary/20 to-transparent skew-y-6 transform origin-top-left" />
      <div className="absolute bottom-0 right-0 w-full h-96 bg-gradient-to-tl from-accent/10 to-transparent -skew-y-6 transform origin-bottom-right" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-4 relative z-10"
      >
        <div className="flex justify-center mb-8">
          <div className="bg-white p-4 rounded-2xl shadow-xl shadow-primary/10">
            <FlaskConical className="h-10 w-10 text-primary" />
          </div>
        </div>
        
        <Card className="border-0 shadow-2xl shadow-slate-200/50 backdrop-blur-sm bg-white/80">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold font-display text-slate-900">Welcome Back</CardTitle>
            <CardDescription>Enter your credentials to access the LIS</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input 
                  id="username" 
                  type="text" 
                  placeholder="jdoe" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-11 bg-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 bg-white"
                  required
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-11 text-base mt-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Sign In"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="text-center justify-center text-xs text-muted-foreground">
            Protected Government System. Authorized Access Only.
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
