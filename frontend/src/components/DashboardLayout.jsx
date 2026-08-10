import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Activity,
  BarChart3,
  Coins,
  Cpu,
  Database,
  FileCode2,
  KeyRound,
  Settings,
  User,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Zap
} from 'lucide-react';

const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'API Monitor', path: '/monitor', icon: Activity },
    { name: 'API Analytics', path: '/analytics', icon: BarChart3 },
    { name: 'Cost Analytics', path: '/cost', icon: Coins },
    { name: 'Cache Manager', path: '/cache', icon: Database },
    { name: 'Request Logs', path: '/logs', icon: FileCode2 },
    { name: 'Optimization Center', path: '/optimization', icon: Cpu },
    { name: 'API Providers', path: '/providers', icon: KeyRound },
    { name: 'Settings', path: '/settings', icon: Settings },
    { name: 'Profile', path: '/profile', icon: User },
  ];

  // Insert Admin Dashboard link if user is admin
  if (user && user.role === 'admin') {
    navigation.push({ name: 'Admin Hub', path: '/admin', icon: ShieldCheck });
  }

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <div className="flex min-h-screen bg-background text-zinc-100 overflow-hidden">
      {/* 1. Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md z-30">
        {/* Brand Logo */}
        <div className="flex items-center gap-2 px-6 h-16 border-b border-zinc-800/80">
          <Zap className="text-primary h-6 w-6 animate-pulse" />
          <span className="text-lg font-bold bg-glow-blue tracking-tight">OptiAPI <span className="text-primary-light">AI</span></span>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                  active
                    ? 'bg-primary/10 text-primary-light border-l-2 border-primary pl-2.5'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                }`}
              >
                <Icon size={18} className={active ? 'text-primary' : 'text-zinc-500 group-hover:text-zinc-300'} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer Profile Box */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/20">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg mb-2">
            <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-primary to-purple-600 flex items-center justify-center font-bold text-sm shadow-glow-blue">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-zinc-200">{user?.email}</p>
              <p className="text-[10px] text-zinc-500 truncate capitalize">{user?.role} Mode</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/5 transition-all group"
          >
            <LogOut size={18} className="text-rose-400 group-hover:text-rose-300" />
            Logout Session
          </button>
        </div>
      </aside>

      {/* 2. Mobile Nav Drawer Toggle Header */}
      <div className="flex flex-col flex-1 md:pl-64">
        <header className="flex items-center justify-between px-6 h-16 border-b border-zinc-800/80 bg-background/50 backdrop-blur-md md:backdrop-blur-none z-20">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 text-zinc-400 hover:text-zinc-200 focus:outline-none"
          >
            <Menu size={22} />
          </button>

          {/* Page breadcrumb header detail */}
          <div className="text-sm font-medium text-zinc-400">
            OptiAPI Portal &gt; <span className="text-zinc-100 capitalize">{location.pathname.substring(1)}</span>
          </div>

          <div className="flex items-center gap-4">
            {user?.organization && (
              <span className="hidden sm:inline-block px-3 py-1 rounded-full text-xs font-semibold border border-primary/20 bg-primary/5 text-primary-light">
                {user.organization}
              </span>
            )}
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-purple-600 flex items-center justify-center font-bold text-xs select-none">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        {/* 3. Main content body */}
        <main className="flex-1 p-6 overflow-y-auto max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* 4. Responsive Drawer Overlay for Mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-background/80 backdrop-blur-sm">
          <div className="relative flex flex-col w-72 max-w-xs bg-zinc-950 border-r border-zinc-850 h-full py-5 px-4">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-5 p-1 text-zinc-400 hover:text-zinc-200 focus:outline-none"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 mb-8 mt-2 px-2">
              <Zap className="text-primary h-6 w-6" />
              <span className="text-lg font-bold">OptiAPI <span className="text-primary">AI</span></span>
            </div>

            <nav className="flex-1 space-y-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-primary/10 text-primary-light border-l-2 border-primary pl-2.5'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                    }`}
                  >
                    <Icon size={18} />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-zinc-900 mt-auto">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-rose-400 hover:bg-rose-500/5 transition-all"
              >
                <LogOut size={18} />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;
