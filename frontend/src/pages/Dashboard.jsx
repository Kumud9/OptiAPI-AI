import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import {
  Zap,
  Coins,
  Activity,
  Database,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
  RefreshCw,
  Layers,
  ArrowDownRight
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

const Dashboard = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [charts, setCharts] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, logsRes] = await Promise.all([
        api.get('/analytics/stats'),
        api.get('/analytics/logs?limit=5')
      ]);

      if (statsRes.data.success) {
        setMetrics(statsRes.data.data.metrics);
        setCharts(statsRes.data.data.charts);
      }
      if (logsRes.data.success) {
        setRecentLogs(logsRes.data.data.data);
      }
    } catch (error) {
      console.error('Fetch dashboard metrics failed:', error);
      addToast('Failed to load dashboard metrics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading || !metrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex justify-between items-center">
          <div className="h-7 w-48 bg-zinc-800 rounded-lg skeleton-shimmer" />
          <div className="h-10 w-24 bg-zinc-800 rounded-lg skeleton-shimmer" />
        </div>
        
        {/* Metric Cards Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-zinc-900 border border-zinc-850 rounded-2xl p-6 skeleton-shimmer" />
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
          <div className="h-96 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
        </div>
      </div>
    );
  }

  // Cell Colors for Provider Pie Chart
  const COLORS = ['#a62828', '#b83c32', '#427175', '#e27e77', '#bda25c', '#1c474a'];

  const providerPieData = charts?.providerTrends?.map(item => ({
    name: item._id.toUpperCase(),
    value: item.requests,
    cost: item.cost
  })) || [];

  return (
    <div className="space-y-6">
      
      {/* 1. Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Cost Control Console</h1>
          <p className="text-xs text-zinc-400 mt-1">Real-time status updates from OptiAPI middleware gateway</p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 text-xs font-semibold transition-all hover:border-zinc-700"
        >
          <RefreshCw size={14} className="text-zinc-400" />
          Refresh Stats
        </button>
      </div>

      {/* 2. Optimization Alerts Banner */}
      {metrics.estimatedMonthlySavings > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-between gap-4 shadow-glow-blue animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 border border-primary/20 text-primary-light rounded-lg">
              <Sparkles size={16} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-primary-light">Cost Savings Recommendations Ready</h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                We identified optimization recommendations that can save you up to <span className="text-emerald-400 font-bold">₹{metrics.estimatedMonthlySavings.toLocaleString('en-IN')}</span> per month.
              </p>
            </div>
          </div>
          <a href="/optimization" className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-white font-semibold text-xs transition-all">
            Open Center
          </a>
        </div>
      )}

      {/* 3. Performance Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Requests */}
        <div className="p-5 rounded-2xl glass-card glass-card-hover">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase">Total Proxy Traffic</span>
            <span className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg"><Zap size={14} /></span>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tracking-tight">{metrics.totalRequests.toLocaleString()}</h3>
            <p className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-0.5 font-medium">
              <TrendingUp size={12} /> +12% vs last week
            </p>
          </div>
        </div>

        {/* Total Cost */}
        <div className="p-5 rounded-2xl glass-card glass-card-hover">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase">Monthly API Spend</span>
            <span className="p-1.5 bg-purple-500/10 text-purple-400 rounded-lg"><Coins size={14} /></span>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tracking-tight">${metrics.monthlyCost.toFixed(2)}</h3>
            <p className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-0.5 font-medium">
              <ArrowDownRight size={12} className="text-emerald-400" /> Save ₹{metrics.estimatedMonthlySavings.toLocaleString('en-IN')}/mo
            </p>
          </div>
        </div>

        {/* Cache Hit Ratio */}
        <div className="p-5 rounded-2xl glass-card glass-card-hover">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase">Cache Hit Ratio</span>
            <span className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg"><Database size={14} /></span>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tracking-tight">{(metrics.cacheHitRatio * 100).toFixed(1)}%</h3>
            <p className="text-[10px] text-zinc-400 mt-0.5 font-medium">
              Miss Ratio: {(metrics.cacheMissRatio * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Avg Latency */}
        <div className="p-5 rounded-2xl glass-card glass-card-hover">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase">Avg Response Latency</span>
            <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg"><Activity size={14} /></span>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tracking-tight">{metrics.avgResponseTime}ms</h3>
            <p className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-0.5 font-medium">
              Cache latency: ~2ms
            </p>
          </div>
        </div>
      </div>

      {/* 4. Secondary Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl border border-zinc-800/80 bg-zinc-950/20">
        <div className="text-center border-r border-zinc-800/60 last:border-none">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase">Rate Limit Violations</p>
          <h4 className="text-lg font-bold text-amber-500 mt-1">{metrics.rateLimitViolations}</h4>
        </div>
        <div className="text-center border-r border-zinc-800/60 last:border-none">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase">Failed Requests</p>
          <h4 className="text-lg font-bold text-rose-500 mt-1">{metrics.failedRequests}</h4>
        </div>
        <div className="text-center border-r border-zinc-800/60 last:border-none">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase">Active API Stacks</p>
          <h4 className="text-lg font-bold text-primary-light mt-1">{metrics.activeApis}</h4>
        </div>
        <div className="text-center last:border-none">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase">Optimization Score</p>
          <h4 className="text-lg font-bold text-emerald-400 mt-1">{metrics.optimizationScore}/100</h4>
        </div>
      </div>

      {/* 5. Chart Visualization Panels */}
      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Left: Volume & Cost Trend line */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-bold">API Traffic &amp; Cost Trend</h3>
              <p className="text-[10px] text-zinc-500 mt-0.5">Aggregated requests and billing details over past 7 days</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-primary-light">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Requests
              </span>
              <span className="flex items-center gap-1.5 text-purple-400">
                <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> Cost ($)
              </span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.dailyTrends} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.3} />
                <XAxis dataKey="_id" stroke="#71717A" fontSize={9} />
                <YAxis stroke="#71717A" fontSize={9} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                  labelStyle={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="requests" stroke="#3B82F6" fillOpacity={1} fill="url(#colorRequests)" strokeWidth={2} />
                <Area type="monotone" dataKey="cost" stroke="#8B5CF6" fillOpacity={1} fill="url(#colorCost)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Pie Distribution Chart */}
        <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold">API Provider Split</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Distribution of requests routed to cloud providers</p>
          </div>

          <div className="h-52 flex justify-center items-center">
            {providerPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={providerPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {providerPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                    itemStyle={{ fontSize: '10px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-zinc-500">No active integrations mapped</p>
            )}
          </div>

          <div className="space-y-1.5">
            {providerPieData.map((item, index) => (
              <div key={item.name} className="flex justify-between items-center text-xs">
                <span className="flex items-center gap-2 text-zinc-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  {item.name}
                </span>
                <span className="font-semibold text-zinc-200">{item.value.toLocaleString()} calls</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 6. Recent Logs table preview */}
      <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-sm font-bold">Live Request Stream</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Most recent API gateway proxy logs</p>
          </div>
          <a href="/logs" className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">
            View full log <ArrowUpRight size={14} />
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                <th className="py-2.5">Timestamp</th>
                <th className="py-2.5">Provider</th>
                <th className="py-2.5">Endpoint</th>
                <th className="py-2.5">Status</th>
                <th className="py-2.5 text-right">Latency</th>
                <th className="py-2.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {recentLogs.map((log) => (
                <tr key={log._id} className="hover:bg-zinc-900/10">
                  <td className="py-3 text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="py-3 font-semibold capitalize text-zinc-200">{log.provider.replace('_', ' ')}</td>
                  <td className="py-3 text-zinc-400 truncate max-w-[200px] font-mono">{log.endpoint}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      log.status === 200 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="py-3 text-right font-medium text-zinc-300">{log.responseTimeMs}ms</td>
                  <td className="py-3 text-right font-mono font-semibold text-zinc-200">
                    {log.cacheStatus === 'HIT' ? (
                      <span className="text-cyan-400">FREE (HIT)</span>
                    ) : (
                      `$${log.costUsd.toFixed(4)}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
