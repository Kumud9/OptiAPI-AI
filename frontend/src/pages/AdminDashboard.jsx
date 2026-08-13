import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { ShieldCheck, Users, Activity, Landmark, RefreshCw, KeyRound } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const AdminDashboard = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [usersList, setUsersList] = useState([]);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users')
      ]);

      if (statsRes.data.success) {
        setStats(statsRes.data.data);
      }
      if (usersRes.data.success) {
        setUsersList(usersRes.data.data);
      }
    } catch (error) {
      console.error('Fetch admin panel details failed:', error);
      addToast('Access denied or admin metrics load failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  if (loading || !stats) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-48 bg-zinc-800 rounded-lg skeleton-shimmer" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
          ))}
        </div>
        <div className="h-64 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
      </div>
    );
  }

  // Transform growth statistics for charting
  const growthChartData = stats.userGrowth?.map(item => ({
    name: item._id,
    'Registrations': item.registrations
  })) || [];

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-primary-light">
            <ShieldCheck className="text-primary animate-pulse" /> Admin Operations Hub
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Global system diagnostics, tenant accounts auditing, and request logs metrics</p>
        </div>
        <button
          onClick={fetchAdminData}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 text-xs font-semibold transition-all hover:border-zinc-700"
        >
          <RefreshCw size={14} className="text-zinc-400" /> Refresh Admin Panel
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Users count */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Users size={12} className="text-primary-light" /> Registered Tenants
          </span>
          <h3 className="text-2xl font-bold mt-2">{stats.totalUsers} users</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Multi-tenant scaling active</span>
        </div>

        {/* Global Queries */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Activity size={12} className="text-cyan-400" /> Global Middleware Hits
          </span>
          <h3 className="text-2xl font-bold mt-2">{stats.totalRequests.toLocaleString()}</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Total system-wide throughput</span>
        </div>

        {/* System Costs */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Landmark size={12} className="text-purple-400" /> Cumulative System Spend
          </span>
          <h3 className="text-2xl font-bold mt-2">${stats.totalSystemCost.toFixed(2)}</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Routed query billing totals</span>
        </div>

        {/* Gateway active keys */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <KeyRound size={12} className="text-emerald-400" /> Active Gateway Keys
          </span>
          <h3 className="text-2xl font-bold mt-2">{stats.activeKeysCount} keys</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Client authentications issued</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Growth timeline chart */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
          <h3 className="text-sm font-bold mb-6">User Registrations Growth</h3>
          <div className="h-64">
            {growthChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growthChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.3} />
                  <XAxis dataKey="name" stroke="#71717A" fontSize={9} />
                  <YAxis stroke="#71717A" fontSize={9} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                    labelStyle={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 'bold' }}
                    itemStyle={{ color: '#E4E4E7', fontSize: '10px' }}
                  />
                  <Bar dataKey="Registrations" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-20">No timeline data available</p>
            )}
          </div>
        </div>

        {/* Users listing Table */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
          <h3 className="text-sm font-bold mb-4">Tenant Directory</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                  <th className="py-2.5">Email</th>
                  <th className="py-2.5">Organization</th>
                  <th className="py-2.5">Role</th>
                  <th className="py-2.5">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/30">
                {usersList.map((usr) => (
                  <tr key={usr._id} className="hover:bg-zinc-900/10">
                    <td className="py-3 font-semibold text-zinc-200">{usr.email}</td>
                    <td className="py-3 text-zinc-400">{usr.organization || '—'}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        usr.role === 'admin' ? 'bg-primary/10 text-primary-light border border-primary/20' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {usr.role}
                      </span>
                    </td>
                    <td className="py-3 text-zinc-500">{new Date(usr.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  );
};

export default AdminDashboard;
