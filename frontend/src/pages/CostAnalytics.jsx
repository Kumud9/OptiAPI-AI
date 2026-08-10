import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Coins, TrendingDown, Landmark, Sparkles } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const CostAnalytics = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [dailyData, setDailyData] = useState([]);

  useEffect(() => {
    const fetchCostData = async () => {
      try {
        const response = await api.get('/analytics/stats');
        if (response.data.success) {
          setMetrics(response.data.data.metrics);
          setDailyData(response.data.data.charts.dailyTrends);
        }
      } catch (error) {
        console.error('Fetch cost analytics failed:', error);
        addToast('Failed to retrieve cost analytics datasets', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchCostData();
  }, []);

  if (loading || !metrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-48 bg-zinc-800 rounded-lg skeleton-shimmer" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-zinc-900 border border-zinc-850 rounded-2xl p-6 skeleton-shimmer" />
          ))}
        </div>
        <div className="h-80 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
      </div>
    );
  }

  // Transform dailyTrends for cost projection chart
  const costTrendData = dailyData.map(day => ({
    date: day._id,
    'Spent ($)': parseFloat(day.cost.toFixed(4)),
    'Cached Saved ($)': parseFloat((day.hits * 0.003).toFixed(4)) // approximate saved cost
  }));

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Coins className="text-primary" /> Cost Analytics &amp; Projections
        </h1>
        <p className="text-xs text-zinc-400 mt-1">Audit operational overhead, compute saving forecasts, and compare model billing</p>
      </div>

      {/* Cost Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Total Cost */}
        <div className="p-6 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Landmark size={12} className="text-primary-light" /> System Total Spend
          </span>
          <h3 className="text-2xl font-bold mt-2">${metrics.totalCost.toFixed(2)}</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Cumulative billing since activation</span>
        </div>

        {/* Monthly Cost */}
        <div className="p-6 rounded-2xl glass-card">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-1.5">
            <Coins size={12} className="text-purple-400" /> Current Month Billing
          </span>
          <h3 className="text-2xl font-bold mt-2">${metrics.monthlyCost.toFixed(2)}</h3>
          <span className="text-[9px] text-zinc-500 mt-1 block">Forecast billing: ${(metrics.monthlyCost * 1.1).toFixed(2)}</span>
        </div>

        {/* Estimated Savings */}
        <div className="p-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 shadow-glow-blue">
          <span className="text-[10px] font-semibold text-emerald-400 uppercase flex items-center gap-1.5">
            <TrendingDown size={12} /> Optimization savings
          </span>
          <h3 className="text-2xl font-bold text-emerald-400 mt-2">₹{metrics.estimatedMonthlySavings.toLocaleString('en-IN')}</h3>
          <span className="text-[9px] text-emerald-500 mt-1 block">Active one-click tweaks available</span>
        </div>

      </div>

      {/* Cost Trend Chart */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold mb-6">Daily Spend Timeline ($ USD)</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costTrendData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorSaved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.3} />
              <XAxis dataKey="date" stroke="#71717A" fontSize={9} />
              <YAxis stroke="#71717A" fontSize={9} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                labelStyle={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 'bold' }}
              />
              <Area type="monotone" dataKey="Spent ($)" stroke="#8B5CF6" fillOpacity={1} fill="url(#colorSpent)" strokeWidth={2} />
              <Area type="monotone" dataKey="Cached Saved ($)" stroke="#10B981" fillOpacity={1} fill="url(#colorSaved)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};

export default CostAnalytics;
