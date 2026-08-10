import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { BarChart3, TrendingUp, Cpu, Compass, Layers } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const ApiAnalytics = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [charts, setCharts] = useState(null);
  const [logsSummary, setLogsSummary] = useState([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const response = await api.get('/analytics/stats');
        const logsRes = await api.get('/analytics/logs?limit=50');
        
        if (response.data.success) {
          setMetrics(response.data.data.metrics);
          setCharts(response.data.data.charts);
        }
        if (logsRes.data.success) {
          // Group logs by endpoint to create endpoint summaries
          const summary = {};
          logsRes.data.data.data.forEach(log => {
            const key = `${log.provider}#${log.endpoint}`;
            if (!summary[key]) {
              summary[key] = { provider: log.provider, endpoint: log.endpoint, count: 0, cost: 0, latencies: [] };
            }
            summary[key].count++;
            summary[key].cost += log.costUsd;
            summary[key].latencies.push(log.responseTimeMs);
          });
          
          const summaryList = Object.values(summary).map(s => ({
            ...s,
            avgLatency: Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.count)
          })).sort((a, b) => b.count - a.count);
          
          setLogsSummary(summaryList);
        }
      } catch (error) {
        console.error('Fetch analytics failed:', error);
        addToast('Failed to retrieve analytics metrics', 'error');
      } finally {
        setLoading(false);
      }
    };
    
    fetchAnalytics();
  }, []);

  if (loading || !metrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-48 bg-zinc-800 rounded-lg skeleton-shimmer" />
        <div className="h-64 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
        <div className="h-64 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
      </div>
    );
  }

  // Transform daily trends for multi-bar chart
  const barChartData = charts?.dailyTrends?.map(day => ({
    name: day._id,
    'Total Hits': day.requests,
    'Cache Saved': day.hits
  })) || [];

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="text-primary" /> Advanced API Analytics
        </h1>
        <p className="text-xs text-zinc-400 mt-1">Deep analysis of routing hits, cache ratios, and provider breakdowns</p>
      </div>

      {/* Main Bar Chart */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold mb-6">Daily Caching Savings Comparison</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.3} />
              <XAxis dataKey="name" stroke="#71717A" fontSize={9} />
              <YAxis stroke="#71717A" fontSize={9} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                labelStyle={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 'bold' }}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Bar dataKey="Total Hits" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Cache Saved" fill="#06B6D4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Endpoint Table Summaries */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
          <Compass size={16} className="text-primary-light" /> Endpoint Performance Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                <th className="py-2.5">Provider</th>
                <th className="py-2.5">Endpoint</th>
                <th className="py-2.5 text-center">Requests Volume</th>
                <th className="py-2.5 text-right">Avg Latency</th>
                <th className="py-2.5 text-right">Approx Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {logsSummary.map((row, i) => (
                <tr key={i} className="hover:bg-zinc-900/10">
                  <td className="py-3 font-semibold capitalize text-zinc-200">{row.provider.replace('_', ' ')}</td>
                  <td className="py-3 text-zinc-400 font-mono">{row.endpoint}</td>
                  <td className="py-3 text-center text-zinc-300 font-semibold">{row.count} calls</td>
                  <td className="py-3 text-right font-medium text-zinc-300">{row.avgLatency}ms</td>
                  <td className="py-3 text-right font-mono font-semibold text-emerald-400">${row.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default ApiAnalytics;
