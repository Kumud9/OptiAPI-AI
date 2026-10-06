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
  ArrowDownRight,
  ShieldCheck,
  ShieldAlert,
  Cpu,
  Clock,
  CheckCircle2,
  XCircle,
  Sliders,
  Server,
  Shuffle
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
  Cell
} from 'recharts';

const Dashboard = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [analyticsStats, setAnalyticsStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [gatewayMetrics, setGatewayMetrics] = useState(null);
  const [activePolicy, setActivePolicy] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchDashboardData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [statsRes, logsRes, metricsRes, policyRes] = await Promise.allSettled([
        api.get('/analytics/stats'),
        api.get('/analytics/logs?limit=5'),
        api.get('/metrics'),
        api.get('/optimization/settings')
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value?.data?.success) {
        setAnalyticsStats(statsRes.value.data.data.metrics);
        setCharts(statsRes.value.data.data.charts);
      }
      if (logsRes.status === 'fulfilled' && logsRes.value?.data?.success) {
        setRecentLogs(logsRes.value.data.data.data || []);
      }
      if (metricsRes.status === 'fulfilled' && metricsRes.value?.data?.success) {
        setGatewayMetrics(metricsRes.value.data);
      }
      if (policyRes.status === 'fulfilled' && policyRes.value?.data?.success) {
        setActivePolicy(policyRes.value.data.data.activePolicy || null);
      }
      setLastUpdated(new Date());
      setFetchError(null);
    } catch (error) {
      console.error('Fetch dashboard metrics failed:', error);
      setFetchError('Failed to load real-time gateway telemetry.');
      addToast('Failed to load dashboard metrics', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading && !analyticsStats && !gatewayMetrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex justify-between items-center">
          <div className="h-7 w-64 bg-zinc-800 rounded-lg skeleton-shimmer" />
          <div className="h-10 w-32 bg-zinc-800 rounded-lg skeleton-shimmer" />
        </div>
        
        {/* KPI Cards Skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-28 bg-zinc-900 border border-zinc-850 rounded-2xl p-4 skeleton-shimmer" />
          ))}
        </div>

        {/* Panels Skeleton */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
          <div className="h-80 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
        </div>
      </div>
    );
  }

  // 1. Overview Calculations
  const totalRequests = gatewayMetrics?.totalRequests ?? analyticsStats?.totalRequests ?? 0;
  const upstreamRequests = gatewayMetrics?.upstreamRequests ?? (totalRequests - (gatewayMetrics?.cacheHits ?? 0));
  const p50 = gatewayMetrics?.p50Latency ?? analyticsStats?.avgResponseTime ?? 0;
  const p95 = gatewayMetrics?.p95Latency ?? 0;
  const p99 = gatewayMetrics?.p99Latency ?? 0;
  const errorCount = gatewayMetrics?.errors ?? analyticsStats?.failedRequests ?? 0;
  const errorRate = totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(1) : '0.0';

  const totalCacheHits = gatewayMetrics?.cacheHits ?? 0;
  const exactHits = gatewayMetrics?.cache?.exactHits ?? Math.max(0, totalCacheHits - (gatewayMetrics?.semanticCacheHits ?? 0));
  const semanticHits = gatewayMetrics?.semanticCacheHits ?? gatewayMetrics?.cache?.semanticHits ?? 0;
  const cacheMisses = gatewayMetrics?.cacheMisses ?? gatewayMetrics?.cache?.misses ?? 0;
  const cacheChecks = totalCacheHits + cacheMisses;
  const cacheHitRate = gatewayMetrics?.cacheHitRate ?? (cacheChecks > 0 ? `${((totalCacheHits / cacheChecks) * 100).toFixed(1)}%` : '0.0%');
  const semanticHitRate = cacheChecks > 0 ? `${((semanticHits / cacheChecks) * 100).toFixed(1)}%` : '0.0%';
  const dedupHits = gatewayMetrics?.deduplicationHits ?? 0;

  // Pie chart colors
  const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

  const providerPieData = charts?.providerTrends?.map(item => ({
    name: item._id.toUpperCase(),
    value: item.requests,
    cost: item.cost
  })) || [];

  // Provider health helpers
  const supportedProviders = ['openai', 'gemini', 'anthropic'];
  const circuitStates = gatewayMetrics?.circuits || {};
  const providerStats = gatewayMetrics?.providers || {};

  return (
    <div className="space-y-6">
      
      {/* 1. Header with Controls & Status */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">OptiAPI Gateway Observability</h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE TELEMETRY
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time proxy metrics, L1/L2 semantic cache intelligence, circuit resilience, and AI policies
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              autoRefresh 
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' 
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
            }`}
            title="Toggle 5s automatic polling"
          >
            Auto-Refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 text-xs font-semibold transition-all hover:border-zinc-700 disabled:opacity-50"
          >
            <RefreshCw size={13} className={`text-zinc-400 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} />
            <span>{fetchError}</span>
          </div>
          <button onClick={() => fetchDashboardData(true)} className="underline hover:text-white font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* 2. Optimization Alerts Banner */}
      {analyticsStats?.estimatedMonthlySavings > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-between gap-4 shadow-glow-blue">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 border border-primary/20 text-primary-light rounded-lg">
              <Sparkles size={16} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-primary-light">Cost Savings Recommendations Ready</h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                We identified optimization recommendations that can save you up to <span className="text-emerald-400 font-bold">₹{analyticsStats.estimatedMonthlySavings.toLocaleString('en-IN')}</span> per month.
              </p>
            </div>
          </div>
          <a href="/optimization" className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-white font-semibold text-xs transition-all">
            Open Center
          </a>
        </div>
      )}

      {/* 3. SECTION 1: OVERVIEW KPI CARDS (7 CARDS) */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
          <Activity size={14} className="text-primary-light" /> Gateway Overview KPIs
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          
          {/* Card 1: Total Requests */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">Total Traffic</span>
              <span className="p-1 bg-blue-500/10 text-blue-400 rounded-md"><Zap size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-zinc-100">{totalRequests.toLocaleString()}</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                Upstream: {upstreamRequests.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Card 2: P50/P95/P99 Latency */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">P50 / P95 Latency</span>
              <span className="p-1 bg-emerald-500/10 text-emerald-400 rounded-md"><Clock size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-emerald-400">{p50}ms</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                P95: {p95}ms | P99: {p99}ms
              </p>
            </div>
          </div>

          {/* Card 3: Error Rate */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">Error Rate</span>
              <span className={`p-1 rounded-md ${errorCount > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-zinc-800 text-zinc-500'}`}>
                <AlertTriangle size={13} />
              </span>
            </div>
            <div className="mt-2">
              <h3 className={`text-xl font-bold tracking-tight ${errorCount > 0 ? 'text-rose-400' : 'text-zinc-100'}`}>
                {errorRate}%
              </h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                {errorCount} total failure{errorCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {/* Card 4: Overall Cache Hit Rate */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">Cache Hit Rate</span>
              <span className="p-1 bg-cyan-500/10 text-cyan-400 rounded-md"><Database size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-cyan-400">{cacheHitRate}</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                {totalCacheHits} hits / {cacheMisses} misses
              </p>
            </div>
          </div>

          {/* Card 5: Semantic Cache Hit Rate */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">L2 Semantic Hit</span>
              <span className="p-1 bg-purple-500/10 text-purple-400 rounded-md"><Sparkles size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-purple-400">{semanticHitRate}</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                {semanticHits} vector hits
              </p>
            </div>
          </div>

          {/* Card 6: Deduplication Hits */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">Dedup Hits</span>
              <span className="p-1 bg-amber-500/10 text-amber-400 rounded-md"><Layers size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-amber-400">{dedupHits}</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                Singleflight coalesced
              </p>
            </div>
          </div>

          {/* Card 7: Upstream Requests */}
          <div className="p-4 rounded-xl glass-card glass-card-hover">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">Upstream Traffic</span>
              <span className="p-1 bg-indigo-500/10 text-indigo-400 rounded-md"><Server size={13} /></span>
            </div>
            <div className="mt-2">
              <h3 className="text-xl font-bold tracking-tight text-indigo-300">{upstreamRequests.toLocaleString()}</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                Direct API invocations
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* 4. SECTION 2: PERFORMANCE CHARTS & LATENCY BREAKDOWN */}
      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Left: Traffic & Cost Trend Area Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-6">
            <div>
              <h3 className="text-sm font-bold text-zinc-100">API Traffic &amp; Cost Trend</h3>
              <p className="text-[10px] text-zinc-500 mt-0.5">Historical request throughput and cost aggregation</p>
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
          
          <div className="h-64">
            {charts?.dailyTrends && charts.dailyTrends.length > 0 ? (
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
                    itemStyle={{ color: '#E4E4E7', fontSize: '10px' }}
                  />
                  <Area type="monotone" dataKey="requests" stroke="#3B82F6" fillOpacity={1} fill="url(#colorRequests)" strokeWidth={2} />
                  <Area type="monotone" dataKey="cost" stroke="#8B5CF6" fillOpacity={1} fill="url(#colorCost)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                No historical trend data recorded yet.
              </div>
            )}
          </div>

          {/* Latency Percentile Summary Bar */}
          <div className="mt-4 pt-4 border-t border-zinc-850 grid grid-cols-4 gap-2 text-center">
            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
              <span className="text-[9px] uppercase font-bold text-zinc-400 block">Average Latency</span>
              <span className="text-sm font-bold text-zinc-200">{gatewayMetrics?.latency?.avg ?? p50}ms</span>
            </div>
            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
              <span className="text-[9px] uppercase font-bold text-emerald-400 block">P50 (Median)</span>
              <span className="text-sm font-bold text-emerald-300">{p50}ms</span>
            </div>
            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
              <span className="text-[9px] uppercase font-bold text-amber-400 block">P95 Latency</span>
              <span className="text-sm font-bold text-amber-300">{p95}ms</span>
            </div>
            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
              <span className="text-[9px] uppercase font-bold text-rose-400 block">P99 Latency</span>
              <span className="text-sm font-bold text-rose-300">{p99}ms</span>
            </div>
          </div>
        </div>

        {/* Right: Provider Distribution Pie Chart */}
        <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">API Provider Split</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Distribution of requests routed to cloud providers</p>
          </div>

          <div className="h-48 flex justify-center items-center my-2">
            {providerPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={providerPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {providerPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090B', borderColor: '#27272A', borderRadius: '10px' }}
                    itemStyle={{ fontSize: '10px', color: '#E4E4E7' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-zinc-500">No active integrations mapped</p>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-zinc-850">
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

      {/* 5. SECTION 3: CACHE INTELLIGENCE (L1 EXACT VS L2 SEMANTIC) */}
      <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-5">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Database size={16} className="text-cyan-400" /> Cache Intelligence Hierarchy
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Two-tiered caching: L1 Exact Match (Redis) &rarr; L2 Semantic Vector Match (Cosine Similarity) &rarr; Upstream API
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              L1 Exact: {exactHits} hits
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              L2 Semantic: {semanticHits} hits
            </span>
          </div>
        </div>

        {/* Cache Flow Visual Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-[10px] font-semibold text-zinc-400 mb-1.5">
            <span>Cache Verification Distribution</span>
            <span>Total Checked: {cacheChecks.toLocaleString()}</span>
          </div>
          <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden flex border border-zinc-800">
            <div 
              style={{ width: `${cacheChecks > 0 ? (exactHits / cacheChecks) * 100 : 0}%` }} 
              className="bg-cyan-500 h-full transition-all"
              title={`L1 Exact: ${exactHits}`}
            />
            <div 
              style={{ width: `${cacheChecks > 0 ? (semanticHits / cacheChecks) * 100 : 0}%` }} 
              className="bg-purple-500 h-full transition-all"
              title={`L2 Semantic: ${semanticHits}`}
            />
            <div 
              style={{ width: `${cacheChecks > 0 ? (cacheMisses / cacheChecks) * 100 : 100}%` }} 
              className="bg-zinc-700 h-full transition-all"
              title={`Misses: ${cacheMisses}`}
            />
          </div>
          <div className="flex items-center gap-4 text-[10px] text-zinc-400 mt-2 font-medium">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-500" /> L1 Exact ({cacheChecks > 0 ? ((exactHits / cacheChecks) * 100).toFixed(1) : 0}%)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-500" /> L2 Semantic ({cacheChecks > 0 ? ((semanticHits / cacheChecks) * 100).toFixed(1) : 0}%)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-700" /> Upstream Bypass ({cacheChecks > 0 ? ((cacheMisses / cacheChecks) * 100).toFixed(1) : 100}%)</span>
          </div>
        </div>

        {/* L1 vs L2 Detailed Comparison Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          
          {/* L1 Exact Cache Card */}
          <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500 text-zinc-950">L1 TIER</span>
                <h4 className="text-xs font-bold text-cyan-300">Exact Redis Cache</h4>
              </div>
              <span className="text-[10px] text-cyan-400 font-semibold">Instant Hash Match</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-cyan-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Exact Hits</span>
                <span className="text-base font-bold text-cyan-300">{exactHits}</span>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-cyan-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Latency</span>
                <span className="text-base font-bold text-emerald-400">~1-2ms</span>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-cyan-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Algorithm</span>
                <span className="text-xs font-bold text-zinc-200">SHA-256</span>
              </div>
            </div>

            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Deterministic string hashing on sanitized method, endpoint, and payload. Bypasses upstream LLMs with zero computation cost.
            </p>
          </div>

          {/* L2 Semantic Vector Cache Card */}
          <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500 text-zinc-950">L2 TIER</span>
                <h4 className="text-xs font-bold text-purple-300">Semantic Vector Cache</h4>
              </div>
              <span className="text-[10px] text-purple-400 font-semibold">
                Threshold: {((activePolicy?.semanticCacheThreshold ?? 0.90) * 100).toFixed(0)}%
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center mb-3">
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-purple-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Semantic Hits</span>
                <span className="text-base font-bold text-purple-300">{semanticHits}</span>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-purple-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Lookup Latency</span>
                <span className="text-base font-bold text-purple-300">{gatewayMetrics?.semanticCacheLookupLatency ?? 0}ms</span>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-purple-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Embed Latency</span>
                <span className="text-base font-bold text-purple-300">{gatewayMetrics?.semanticCacheEmbeddingLatency ?? 0}ms</span>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded-lg border border-purple-500/10">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Cache Writes</span>
                <span className="text-base font-bold text-zinc-200">{gatewayMetrics?.cache?.writes ?? 0}</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-[10px] text-zinc-400 pt-1 border-t border-purple-500/10">
              <span>Embedding Failures: <strong className="text-zinc-200">{gatewayMetrics?.cache?.embeddingFailures ?? 0}</strong> (Fail-Open Protected)</span>
              <span>Metric: <strong className="text-purple-300">Cosine Similarity</strong></span>
            </div>
          </div>

        </div>
      </div>

      {/* 6. SECTION 4: PROVIDER HEALTH & CIRCUIT BREAKERS */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
          <Server size={14} className="text-primary-light" /> Provider Health &amp; Circuit Breakers
        </h2>

        <div className="grid md:grid-cols-3 gap-4">
          {supportedProviders.map((prov) => {
            const circuit = circuitStates[prov] || { state: 'CLOSED', failureCount: 0, successCount: 0 };
            const stats = providerStats[prov] || { requests: 0, errors: 0, latency: 0, failovers: 0, quotaRejections: 0 };
            const isClosed = circuit.state === 'CLOSED';
            const isHalfOpen = circuit.state === 'HALF_OPEN';
            const isOpen = circuit.state === 'OPEN';

            return (
              <div key={prov} className="p-5 rounded-2xl glass-card border border-zinc-800/80">
                {/* Provider Header */}
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-sm font-bold capitalize text-zinc-100">{prov}</h3>
                    <span className="text-[10px] text-zinc-500">Tier 1 Cloud LLM</span>
                  </div>

                  {/* Circuit Badge */}
                  {isClosed && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      CIRCUIT CLOSED
                    </span>
                  )}
                  {isHalfOpen && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      HALF-OPEN (PROBING)
                    </span>
                  )}
                  {isOpen && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                      CIRCUIT OPEN (TRIPPED)
                    </span>
                  )}
                </div>

                {/* Provider Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                    <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Requests</span>
                    <span className="text-base font-bold text-zinc-100">{stats.requests}</span>
                  </div>
                  <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                    <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Avg Latency</span>
                    <span className="text-base font-bold text-zinc-100">{stats.latency}ms</span>
                  </div>
                  <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                    <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Failures</span>
                    <span className={`text-base font-bold ${circuit.failureCount > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
                      {circuit.failureCount}
                    </span>
                  </div>
                  <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                    <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Failovers</span>
                    <span className="text-base font-bold text-amber-400">{stats.failovers}</span>
                  </div>
                </div>

                {/* Quota Events */}
                <div className="mt-3 pt-3 border-t border-zinc-850 flex justify-between text-[10px] text-zinc-400">
                  <span>Quota Rejections: <strong className="text-zinc-200">{stats.quotaRejections}</strong></span>
                  <span>Health: <strong className={isClosed ? 'text-emerald-400' : (isHalfOpen ? 'text-amber-400' : 'text-rose-400')}>
                    {isClosed ? 'Optimal' : (isHalfOpen ? 'Testing' : 'Degraded')}
                  </strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 7. SECTION 5: RELIABILITY & TRAFFIC PROTECTION */}
      <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
        <h3 className="text-sm font-bold text-zinc-100 mb-4 flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-400" /> Gateway Reliability &amp; Resilience Telemetry
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          
          {/* Circuit Breaker Stats */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-850">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase block">Circuit Breaker</span>
            <h4 className="text-lg font-bold text-zinc-100 mt-1">
              {gatewayMetrics?.circuitBreaker?.opened ?? 0} <span className="text-xs font-normal text-zinc-500">trips</span>
            </h4>
            <div className="mt-2 space-y-0.5 text-[10px] text-zinc-400">
              <div className="flex justify-between">
                <span>Fast-fail rejections:</span>
                <span className="font-semibold text-zinc-200">{gatewayMetrics?.circuitBreaker?.rejected ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Half-open recovery:</span>
                <span className="font-semibold text-emerald-400">
                  {gatewayMetrics?.circuitBreaker?.recoverySuccess ?? 0} OK / {gatewayMetrics?.circuitBreaker?.recoveryFailed ?? 0} Fail
                </span>
              </div>
            </div>
          </div>

          {/* Failover Count */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-850">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase block">Multi-Provider Failover</span>
            <h4 className="text-lg font-bold text-amber-400 mt-1">
              {gatewayMetrics?.failover?.attempts ?? 0} <span className="text-xs font-normal text-zinc-500">attempts</span>
            </h4>
            <div className="mt-2 space-y-0.5 text-[10px] text-zinc-400">
              <div className="flex justify-between">
                <span>Successful failovers:</span>
                <span className="font-semibold text-emerald-400">{gatewayMetrics?.failover?.successes ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Success rate:</span>
                <span className="font-semibold text-zinc-200">
                  {gatewayMetrics?.failover?.attempts > 0 
                    ? `${((gatewayMetrics.failover.successes / gatewayMetrics.failover.attempts) * 100).toFixed(0)}%` 
                    : '100%'}
                </span>
              </div>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-850">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase block">Distributed Rate Limiting</span>
            <h4 className="text-lg font-bold text-zinc-100 mt-1">
              {gatewayMetrics?.rateLimit?.rejections ?? analyticsStats?.rateLimitViolations ?? 0} <span className="text-xs font-normal text-zinc-500">429 events</span>
            </h4>
            <div className="mt-2 space-y-0.5 text-[10px] text-zinc-400">
              <div className="flex justify-between">
                <span>Window checks:</span>
                <span className="font-semibold text-zinc-200">{gatewayMetrics?.rateLimit?.hits ?? totalRequests}</span>
              </div>
              <div className="flex justify-between">
                <span>Protection policy:</span>
                <span className="font-semibold text-cyan-400">Sliding Window</span>
              </div>
            </div>
          </div>

          {/* Quota & Deduplication */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-850">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase block">Traffic Protection</span>
            <h4 className="text-lg font-bold text-emerald-400 mt-1">
              {dedupHits} <span className="text-xs font-normal text-zinc-500">dedup saved</span>
            </h4>
            <div className="mt-2 space-y-0.5 text-[10px] text-zinc-400">
              <div className="flex justify-between">
                <span>Provider quota checks:</span>
                <span className="font-semibold text-zinc-200">{gatewayMetrics?.providerQuota?.checks ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Quota rejections:</span>
                <span className="font-semibold text-rose-400">{gatewayMetrics?.providerQuota?.rejections ?? 0}</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 8. SECTION 6: AI OPTIMIZATION & POLICY STATUS */}
      <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" /> Active AI Routing Policy &amp; Optimization
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Autonomous routing decisions generated from telemetry analytics and policy constraints
            </p>
          </div>
          <a 
            href="/optimization"
            className="flex items-center gap-1.5 text-xs font-semibold text-primary-light hover:underline"
          >
            Configure Rules <ArrowUpRight size={13} />
          </a>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          
          {/* Active Policy Details */}
          <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-purple-300">Active Routing Policy</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Version {activePolicy?.policyVersion ?? 1}
              </span>
            </div>

            {activePolicy ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-purple-500/10">
                  <span className="text-zinc-400">Target Provider / Model:</span>
                  <span className="font-bold text-zinc-100 capitalize">{activePolicy.provider} / {activePolicy.model || 'auto'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-purple-500/10">
                  <span className="text-zinc-400">Routing Strategy:</span>
                  <span className="font-semibold text-emerald-400 uppercase">{activePolicy.strategy || 'balanced'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-purple-500/10">
                  <span className="text-zinc-400">Timeout / Retries:</span>
                  <span className="font-semibold text-zinc-200">{activePolicy.timeoutMs || 15000}ms / {activePolicy.maxRetries || 2} retries</span>
                </div>
                <div className="flex justify-between py-1 border-b border-purple-500/10">
                  <span className="text-zinc-400">Semantic Cache:</span>
                  <span className="font-semibold text-purple-300">
                    {activePolicy.semanticCacheEnabled !== false ? `Enabled (${((activePolicy.semanticCacheThreshold ?? 0.90) * 100).toFixed(0)}%)` : 'Disabled'}
                  </span>
                </div>
                {activePolicy.reasoning && (
                  <p className="text-[10px] text-zinc-400 italic pt-1">
                    "{activePolicy.reasoning}"
                  </p>
                )}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-zinc-400">
                <p>Default gateway policy active (Balanced strategy).</p>
                <p className="text-[10px] text-zinc-500 mt-1">Trigger an AI optimization cycle to generate a dynamic policy.</p>
              </div>
            )}
          </div>

          {/* Optimization Engine Stats */}
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <span className="text-xs font-bold text-zinc-200 block mb-3">Optimization Engine Metrics</span>

            <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
              <div className="bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Total Runs</span>
                <span className="text-base font-bold text-zinc-100">{gatewayMetrics?.optimization?.runs ?? 0}</span>
              </div>
              <div className="bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Successes</span>
                <span className="text-base font-bold text-emerald-400">{gatewayMetrics?.optimization?.successes ?? 0}</span>
              </div>
              <div className="bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850">
                <span className="text-[9px] text-zinc-400 uppercase block font-semibold">Guardrail Rejections</span>
                <span className="text-base font-bold text-amber-400">{gatewayMetrics?.optimization?.policiesRejected ?? 0}</span>
              </div>
            </div>

            <div className="space-y-1 text-[11px] text-zinc-400 pt-1">
              <div className="flex justify-between">
                <span>Engine Latency:</span>
                <span className="font-semibold text-zinc-200">{gatewayMetrics?.optimization?.avgLatencyMs ?? 0}ms</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Monthly Savings:</span>
                <span className="font-semibold text-emerald-400">
                  ₹{analyticsStats?.estimatedMonthlySavings?.toLocaleString('en-IN') ?? 0}/mo
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 9. SECTION 7: LIVE REQUEST STREAM PREVIEW */}
      <div className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 glass-card">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">Live Request Stream</h3>
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
                <th className="py-2.5">Cache Mode</th>
                <th className="py-2.5 text-right">Latency</th>
                <th className="py-2.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {recentLogs.length > 0 ? (
                recentLogs.map((log) => (
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
                    <td className="py-3">
                      {log.cacheStatus === 'HIT' && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          L1 EXACT HIT
                        </span>
                      )}
                      {log.cacheStatus === 'SEMANTIC_HIT' && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          L2 SEMANTIC HIT
                        </span>
                      )}
                      {log.cacheStatus === 'MISS' && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-zinc-400">
                          UPSTREAM MISS
                        </span>
                      )}
                      {(!log.cacheStatus || log.cacheStatus === 'BYPASS') && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-zinc-500">
                          BYPASS
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right font-medium text-zinc-300">{log.responseTimeMs}ms</td>
                    <td className="py-3 text-right font-mono font-semibold text-zinc-200">
                      {log.cacheStatus === 'HIT' || log.cacheStatus === 'SEMANTIC_HIT' ? (
                        <span className="text-cyan-400 font-bold">FREE ($0.00)</span>
                      ) : (
                        `$${log.costUsd?.toFixed(4) ?? '0.0000'}`
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">
                    No recent API proxy calls recorded yet. Gateway requests will appear here in real time.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
