import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, Coins, Database, Activity, Sparkles, TrendingUp } from 'lucide-react';

const DashboardPreview = () => {
  // Tilt States
  const [rotate, setRotate] = useState({ x: 0, y: 0 });

  // Live Metrics States
  const [metrics, setMetrics] = useState({
    requests: 124020,
    cost: 480.20,
    cacheRatio: 38.2,
    latency: 124,
    optScore: 84,
    savings: 12400
  });

  const handleMouseMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to percentage offsets (-10 to 10 degrees)
    const rotateX = ((y / rect.height) - 0.5) * -12;
    const rotateY = ((x / rect.width) - 0.5) * 12;
    
    setRotate({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
  };

  // Numbers incrementation and live updates
  useEffect(() => {
    // Staggered counting up on boot
    const timer = setTimeout(() => {
      setMetrics({
        requests: 842100,
        cost: 1284.50,
        cacheRatio: 42.6,
        latency: 32,
        optScore: 92,
        savings: 15400
      });
    }, 800);

    // Live oscillation interval
    const interval = setInterval(() => {
      setMetrics(prev => ({
        requests: prev.requests + Math.floor(Math.random() * 5) + 1,
        cost: prev.cost + (Math.random() * 0.05),
        cacheRatio: parseFloat((prev.cacheRatio + (Math.random() - 0.5) * 0.2).toFixed(1)),
        latency: Math.max(12, Math.min(220, prev.latency + Math.floor((Math.random() - 0.5) * 4))),
        optScore: Math.min(100, Math.max(80, prev.optScore + (Math.random() > 0.8 ? 1 : Math.random() > 0.8 ? -1 : 0))),
        savings: prev.savings
      }));
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex justify-center items-center w-full max-w-lg select-none perspective-[1000px] pointer-events-auto">
      <motion.div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        animate={{
          rotateX: rotate.x,
          rotateY: rotate.y,
        }}
        transition={{
          type: 'spring',
          damping: 25,
          stiffness: 120
        }}
        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-xl shadow-glow-blue p-6 relative overflow-hidden"
      >
        {/* Glow backdrop inside dashboard */}
        <div className="absolute -top-10 -right-10 w-44 h-44 bg-primary/10 rounded-full blur-2xl pointer-events-none" />

        {/* Dashboard Header Mock */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-zinc-500 font-mono ml-2">portal.optiapi.ai/live</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-[9px] text-emerald-400 font-bold border border-emerald-500/20 animate-pulse">
            GATEWAY ONLINE
          </span>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {/* Requests */}
          <div className="p-3.5 rounded-xl bg-zinc-900/30 border border-zinc-900">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="text-[8px] font-bold uppercase tracking-wider">Traffic Hits</span>
              <Zap size={10} className="text-primary-light" />
            </div>
            <h4 className="text-xs font-bold text-zinc-200 mt-1 transition-all duration-700">
              {metrics.requests.toLocaleString()}
            </h4>
          </div>

          {/* Cost */}
          <div className="p-3.5 rounded-xl bg-zinc-900/30 border border-zinc-900">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="text-[8px] font-bold uppercase tracking-wider">API Cost</span>
              <Coins size={10} className="text-purple-400" />
            </div>
            <h4 className="text-xs font-bold text-zinc-200 mt-1">
              ${metrics.cost.toFixed(2)}
            </h4>
          </div>

          {/* Hit Ratio */}
          <div className="p-3.5 rounded-xl bg-zinc-900/30 border border-zinc-900">
            <div className="flex items-center justify-between text-zinc-500">
              <span className="text-[8px] font-bold uppercase tracking-wider">Cache Hits</span>
              <Database size={10} className="text-cyan-400" />
            </div>
            <h4 className="text-xs font-bold text-zinc-200 mt-1">
              {metrics.cacheRatio}%
            </h4>
          </div>
        </div>

        {/* Dynamic Charts row */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Animated Line Chart (SVG) */}
          <div className="p-4 rounded-xl border border-zinc-900 bg-zinc-900/20">
            <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider block mb-3">Latency timelines (ms)</span>
            <div className="h-16 flex items-end">
              <svg className="w-full h-full" viewBox="0 0 100 40">
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <path
                  d={`M 0,30 Q 20,${metrics.latency / 4} 40,32 T 80,18 T 100,10`}
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth="1.5"
                  className="transition-all duration-1000"
                />
                <path
                  d={`M 0,30 Q 20,${metrics.latency / 4} 40,32 T 80,18 T 100,10 L 100,40 L 0,40 Z`}
                  fill="url(#chartGlow)"
                  className="transition-all duration-1000"
                />
              </svg>
            </div>
            <div className="flex justify-between items-center text-[9px] text-zinc-500 mt-2">
              <span>Avg Latency</span>
              <span className="font-semibold text-zinc-300">{metrics.latency}ms</span>
            </div>
          </div>

          {/* Animated Bar Chart (SVG) */}
          <div className="p-4 rounded-xl border border-zinc-900 bg-zinc-900/20">
            <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider block mb-3">Daily Savings Splits</span>
            <div className="h-16 flex items-end justify-between px-2 gap-1.5">
              {[50, 80, 45, 90, 75].map((val, i) => (
                <div key={i} className="flex-1 bg-zinc-800 rounded-t-sm h-full flex items-end">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${val}%` }}
                    transition={{ duration: 1.2, delay: i * 0.1 }}
                    className="w-full bg-gradient-to-t from-primary to-purple-600 rounded-t-sm"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center text-[9px] text-zinc-500 mt-2">
              <span>Est. Savings</span>
              <span className="font-semibold text-emerald-400">₹{metrics.savings.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Footer Score stats */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-900 bg-zinc-900/10">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-400 animate-spin" style={{ animationDuration: '6s' }} />
            <div>
              <h5 className="text-[9px] font-bold text-zinc-300">Optimization Efficiency Score</h5>
              <p className="text-[8px] text-zinc-500 mt-0.5">Calculated based on caching ratios and code debouncing</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-sm font-bold text-emerald-400">{metrics.optScore}/100</span>
          </div>
        </div>

      </motion.div>
    </div>
  );
};

export default DashboardPreview;
