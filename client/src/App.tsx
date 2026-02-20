import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Landing from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import Accessioning from "@/pages/Accessioning";
import Worklist from "@/pages/Worklist";
import Verification from "@/pages/Verification";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/Sidebar";

function PrivateRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Sidebar />
      <main className="lg:pl-72 pt-16 lg:pt-0 min-h-screen transition-all duration-300">
        <div className="container max-w-7xl mx-auto p-4 md:p-8">
          <Component />
        </div>
      </main>
    </div>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        {user ? <Redirect to="/" /> : <Landing />}
      </Route>
      
      {/* Private Routes */}
      <Route path="/">
        <PrivateRoute component={Dashboard} />
      </Route>
      <Route path="/patients">
        <PrivateRoute component={Patients} />
      </Route>
      <Route path="/accessioning">
        <PrivateRoute component={Accessioning} />
      </Route>
      <Route path="/worklist">
        <PrivateRoute component={Worklist} />
      </Route>
      <Route path="/verification">
        <PrivateRoute component={Verification} />
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
