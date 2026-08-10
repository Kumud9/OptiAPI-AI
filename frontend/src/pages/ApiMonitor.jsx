import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Activity, Clock, Zap, AlertTriangle, ShieldAlert, Database, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const ApiMonitor = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [latencyData, setLatencyData] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);

  const fetchMonitorData = async () => {
    try {
      const statsRes = await api.get('/analytics/stats');
      const logsRes = await api.get('/analytics/logs?limit=15');

      if (statsRes.data.success) {
        setMetrics(statsRes.data.data.metrics);
      }
      if (logsRes.data.success) {
        const logs = logsRes.data.data.data;
        setRecentLogs(logs);

        // Transform logs for latency chart (reverse order to display chronologically)
        const timeline = logs.slice(0, 10).reverse().map(l => ({
          time: new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          latency: l.responseTimeMs,
          provider: l.provider.toUpperCase()
        }));
        setLatencyData(timeline);
      }
    } catch (error) {
      console.error('Fetch monitoring data failed:', error);
      addToast('Failed to retrieve monitoring analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitorData();
    // Auto-poll every 10 seconds for real-time monitoring feel
    const interval = setInterval(fetchMonitorData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !metrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-48 bg-zinc-800 rounded-lg skeleton-shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-zinc-900 border border-zinc-850 rounded-2xl p-5 skeleton-shimmer" />
          ))}
        </div>
        <div className="h-72 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
      </div>
    );
  }

  // Calculate failed rate
  const failedRate = metrics.totalRequests > 0 
    ? ((metrics.failedRequests / metrics.totalRequests) * 100).toFixed(1) 
    : '0.0';

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="text-primary animate-pulse" /> Real-Time Gateway Monitor
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Live traffic telemetry and health status (updates every 10s)</p>
        </div>
        <button
          onClick={fetchMonitorData}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 text-xs font-semibold transition-all hover:border-zinc-700"
        >
          <RefreshCw size={14} className="text-zinc-400" /> Refetch
        </button>
      </div>

      {/* Monitor Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Latency */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Clock size={12} className="text-primary-light" /> Average Latency
          </span>
          <h3 className="text-2xl font-bold mt-2">{metrics.avgResponseTime}ms</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Middleware processing: &lt;5ms</span>
        </div>

        {/* Caches Saved */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Database size={12} className="text-cyan-400" /> Caching Savings
          </span>
          <h3 className="text-2xl font-bold mt-2">{(metrics.cacheHitRatio * 100).toFixed(1)}%</h3>
          <span className="text-[9px] text-cyan-400 mt-1 block">Free response delivery</span>
        </div>

        {/* Failed rate */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-rose-400" /> Router Failure Rate
          </span>
          <h3 className="text-2xl font-bold mt-2">{failedRate}%</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">{metrics.failedRequests} total exceptions</span>
        </div>

        {/* Rate Violations */}
        <div className="p-5 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <ShieldAlert size={12} className="text-amber-400" /> Rate Throttles
          </span>
          <h3 className="text-2xl font-bold mt-2">{metrics.rateLimitViolations}</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Active blocks (HTTP 429)</span>
        </div>
      </div>

      {/* Latency Timeline Chart */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold mb-4">Live Latency Waveforms (Recent Calls)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={latencyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.3} />
              <XAxis dataKey="time" stroke="#71717A" fontSize={8} />
              <YAxis stroke="#71717A" fontSize={9} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                labelStyle={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 'bold' }}
                itemStyle={{ fontSize: '11px', color: '#60A5FA' }}
              />
              <Area type="monotone" dataKey="latency" name="Latency (ms)" stroke="#3B82F6" fillOpacity={1} fill="url(#colorLatency)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Stream */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold mb-4">Transaction Stream Detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                <th className="py-2.5">Time</th>
                <th className="py-2.5">Provider</th>
                <th className="py-2.5">Endpoint</th>
                <th className="py-2.5">Method</th>
                <th className="py-2.5">Status</th>
                <th className="py-2.5 text-right">Latency</th>
                <th className="py-2.5 text-right">Cache</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {recentLogs.map((log) => (
                <tr key={log._id} className="hover:bg-zinc-900/10">
                  <td className="py-3 text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="py-3 font-semibold capitalize text-zinc-200">{log.provider.replace('_', ' ')}</td>
                  <td className="py-3 text-zinc-400 font-mono max-w-xs truncate">{log.endpoint}</td>
                  <td className="py-3 font-semibold text-zinc-400">{log.method}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      log.status === 200 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="py-3 text-right font-medium text-zinc-300">{log.responseTimeMs}ms</td>
                  <td className="py-3 text-right font-semibold">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      log.cacheStatus === 'HIT' 
                        ? 'bg-cyan-500/10 text-cyan-400' 
                        : log.cacheStatus === 'MISS'
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {log.cacheStatus}
                    </span>
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

export default ApiMonitor;
