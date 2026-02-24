import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  FlaskConical, 
  Users, 
  ClipboardList, 
  CheckCircle, 
  Settings,
  LayoutDashboard,
  LogOut,
  Menu,
  Microscope,
  Bell
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Staff } from "@shared/schema";

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Patients', href: '/patients', icon: Users },
  { name: 'Accessioning', href: '/accessioning', icon: FlaskConical },
  { name: 'Worklist', href: '/worklist', icon: ClipboardList },
  { name: 'Verification', href: '/verification', icon: CheckCircle },
  { name: 'Technician Bench', href: '/technician', icon: Microscope },
  { name: 'Test Catalog', href: '/catalog', icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const { data: staffInfo } = useQuery<Staff>({
    queryKey: ["/api/staff/me"],
    enabled: !!user,
  });

  const displayName = staffInfo?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User";
  const displayRole = staffInfo?.role || "technician";

  const { data: notifCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/notifications/count"],
    enabled: !!user,
    refetchInterval: 15000,
  });

  const { data: notifications } = useQuery<Array<{ id: number; message: string; notificationType: string; isRead: boolean; createdAt: string }>>({
    queryKey: ["/api/notifications?unread=true&limit=10"],
    enabled: !!user,
    refetchInterval: 15000,
  });

  const unreadCount = notifCount?.unreadCount || 0;

  const handleMarkAllRead = async () => {
    await apiRequest("POST", "/api/notifications/read-all");
    queryClient.invalidateQueries({ queryKey: ["/api/notifications?unread=true&limit=10"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
  };

  const NavContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-lg">
            <FlaskConical className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold font-display tracking-tight text-white" data-testid="text-app-title">GovLab LIS</h1>
            <p className="text-xs text-slate-400 font-medium">System v2.4</p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors" data-testid="button-notifications">
                <Bell className="h-5 w-5 text-slate-400" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center" data-testid="badge-notification-count">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 bg-slate-900 border-slate-700" side="right" align="start" data-testid="popover-notifications">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <span className="text-sm font-semibold text-white">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs text-primary hover:text-primary/80 transition-colors" data-testid="button-mark-all-read">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {(!notifications || notifications.length === 0) ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-500" data-testid="text-no-notifications">No new notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={cn("px-4 py-3 border-b border-slate-800 last:border-0 text-sm", !n.isRead && "bg-slate-800/40")} data-testid={`notification-item-${n.id}`}>
                      <div className="flex items-start gap-2">
                        <div className={cn("mt-1 h-2 w-2 rounded-full flex-shrink-0", n.notificationType === "CRITICAL" ? "bg-red-500" : n.notificationType === "WARN" ? "bg-yellow-500" : "bg-blue-500")} />
                        <p className="text-slate-300 leading-snug">{n.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 py-6 px-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href} className={cn(
              "flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
              isActive 
                ? "bg-primary text-white shadow-lg shadow-primary/20" 
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            )} onClick={() => setOpen(false)} data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}>
              <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-slate-400")} />
              {item.name}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/50 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            {user?.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={displayName}
                className="h-8 w-8 rounded-full object-cover"
                data-testid="img-avatar"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary" data-testid="avatar-placeholder">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-white" data-testid="text-username">{displayName}</p>
              <p className="text-xs text-slate-400 uppercase tracking-wider" data-testid="text-role">{displayRole}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-950/30"
            asChild
            data-testid="button-logout"
          >
            <a href="/api/logout">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </a>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Trigger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b flex items-center px-4 z-40 justify-between">
        <div className="flex items-center gap-2">
           <FlaskConical className="h-6 w-6 text-primary" />
           <span className="font-bold text-lg text-slate-900">GovLab</span>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-menu">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-r-slate-800 bg-slate-900">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex w-72 flex-col fixed inset-y-0 z-50">
        <NavContent />
      </div>
    </>
  );
}
