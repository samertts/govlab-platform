import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { FlaskConical, Shield, Activity, Users } from "lucide-react";
import { motion } from "framer-motion";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-primary/30 text-white flex flex-col justify-between p-8 lg:p-12 min-h-[40vh] lg:min-h-screen">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-lg" data-testid="logo-icon">
            <FlaskConical className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">GovLab LIS</h1>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex-1 flex flex-col justify-center py-12"
        >
          <h2 className="text-3xl lg:text-4xl font-serif font-bold leading-tight mb-4">
            Government-Grade Laboratory Information System
          </h2>
          <p className="text-slate-300 text-lg max-w-md">
            Manage patient samples, track test results, and maintain full audit trails with role-based access control.
          </p>

          <div className="flex flex-wrap gap-4 mt-8">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Shield className="h-4 w-4 text-primary" />
              <span>Audit Compliant</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Activity className="h-4 w-4 text-primary" />
              <span>QC Flagging</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Users className="h-4 w-4 text-primary" />
              <span>Role-Based Access</span>
            </div>
          </div>
        </motion.div>

        <p className="text-xs text-slate-500">&copy; {new Date().getFullYear()} GovLab LIS. All rights reserved.</p>
      </div>

      <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-12 bg-slate-50">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-md"
        >
          <Card className="border-0 shadow-2xl shadow-slate-200/50 bg-white" data-testid="login-card">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold text-slate-900" data-testid="text-welcome">Welcome</CardTitle>
              <CardDescription>Sign in to access the Laboratory Information System</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Button
                asChild
                className="w-full h-12 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5"
                data-testid="button-login"
              >
                <a href="/api/login">Sign In with Replit</a>
              </Button>
            </CardContent>
            <CardFooter className="text-center justify-center text-xs text-muted-foreground" data-testid="text-footer">
              Protected Government System. Authorized Access Only.
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
