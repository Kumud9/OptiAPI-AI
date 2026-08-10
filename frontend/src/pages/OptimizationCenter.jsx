import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { 
  Cpu, 
  TrendingUp, 
  Check, 
  Activity, 
  ShieldAlert, 
  Trash2, 
  Database, 
  Coins, 
  ArrowRight,
  Loader2,
  Sparkles
} from 'lucide-react';

const OptimizationCenter = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState([]);
  const [applyingId, setApplyingId] = useState(null);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const response = await api.get('/optimization/recommendations');
      if (response.data.success) {
        setRecommendations(response.data.data);
      }
    } catch (error) {
      console.error('Fetch recommendations failed:', error);
      addToast('Failed to load optimization recommendations', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const handleApply = async (id) => {
    setApplyingId(id);
    try {
      const response = await api.post(`/optimization/recommendations/${id}/apply`);
      if (response.data.success) {
        addToast('Optimization recommendation applied successfully! Cache rules configured.', 'success');
        // Filter out the applied recommendation
        setRecommendations((prev) => prev.filter((rec) => rec._id !== id));
      }
    } catch (error) {
      console.error('Apply recommendation failed:', error);
      addToast('Failed to apply optimization recommendations', 'error');
    } finally {
      setApplyingId(null);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    }
  };

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'text-emerald-400 font-bold';
      case 'medium': return 'text-zinc-300 font-semibold';
      default: return 'text-zinc-500';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 w-56 bg-zinc-800 rounded-lg skeleton-shimmer" />
        <div className="grid md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-zinc-900 border border-zinc-850 rounded-2xl p-6 skeleton-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  // Calculate potential savings summary
  const totalPotentialSavings = recommendations.reduce((acc, rec) => acc + rec.savingsInr, 0);

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="text-primary animate-pulse" /> Optimization Center
          </h1>
          <p className="text-xs text-zinc-400 mt-1">AI-driven cost analysis recommendations based on your API routing history</p>
        </div>

        {totalPotentialSavings > 0 && (
          <div className="px-5 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-4 shadow-glow-purple">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <Coins size={16} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-semibold">Total Monthly Saving</p>
              <h3 className="text-lg font-bold text-emerald-400">₹{totalPotentialSavings.toLocaleString('en-IN')}</h3>
            </div>
          </div>
        )}
      </div>

      {/* Main recommendations grid */}
      {recommendations.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-6">
          {recommendations.map((rec) => (
            <div
              key={rec._id}
              className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card glass-card-hover flex flex-col justify-between"
            >
              <div>
                {/* Header Tag indicators */}
                <div className="flex justify-between items-center mb-4">
                  <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold border capitalize ${getPriorityColor(rec.priority)}`}>
                    {rec.priority} Priority
                  </span>
                  
                  {rec.savingsInr > 0 && (
                    <span className="text-xs font-semibold text-emerald-400">
                      Save ₹{rec.savingsInr.toLocaleString('en-IN')}/mo
                    </span>
                  )}
                </div>

                {/* Suggestion text */}
                <h3 className="text-sm font-bold text-zinc-100 leading-relaxed mb-3">
                  {rec.message}
                </h3>

                {/* Target endpoint tag */}
                {rec.targetEndpoint && (
                  <div className="inline-block px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 mb-4">
                    Target: {rec.targetEndpoint}
                  </div>
                )}

                {/* Technical diagnostics logs details */}
                {rec.details && Object.keys(rec.details).length > 0 && (
                  <div className="p-3.5 rounded-xl border border-zinc-800/40 bg-zinc-950/50 text-[10px] space-y-1.5 mb-6 text-zinc-400">
                    <div className="font-semibold text-zinc-300 flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} className="text-primary-light" /> Diagnostic Logs
                    </div>
                    {rec.details.avgLatency && (
                      <div className="flex justify-between">
                        <span>Avg Latency:</span>
                        <span className="font-semibold text-zinc-300">{rec.details.avgLatency}ms</span>
                      </div>
                    )}
                    {rec.details.count && (
                      <div className="flex justify-between">
                        <span>Requests Volume:</span>
                        <span className="font-semibold text-zinc-300">{rec.details.count} calls</span>
                      </div>
                    )}
                    {rec.details.duplicateCount && (
                      <div className="flex justify-between">
                        <span>Duplicates Found:</span>
                        <span className="font-semibold text-zinc-300">{rec.details.duplicateCount}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action row */}
              <div className="flex justify-between items-center pt-4 border-t border-zinc-900/60 mt-4">
                <div className="text-xs">
                  <span className="text-zinc-500">Impact Level: </span>
                  <span className={`capitalize ${getImpactColor(rec.impactLevel)}`}>{rec.impactLevel}</span>
                </div>

                {rec.type === 'unused_keys' ? (
                  <a
                    href="/providers"
                    className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
                  >
                    Manage API Vault <ArrowRight size={14} />
                  </a>
                ) : (
                  <button
                    onClick={() => handleApply(rec._id)}
                    disabled={applyingId === rec._id}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-dark text-white font-semibold text-xs transition-all shadow-glow-blue disabled:opacity-50"
                  >
                    {applyingId === rec._id ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Applying...
                      </>
                    ) : (
                      <>
                        Apply Optimization
                      </>
                    )}
                  </button>
                )}
              </div>

            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-zinc-800 bg-zinc-950/20">
          <Check className="mx-auto text-emerald-400 h-10 w-10 mb-4 bg-emerald-500/10 p-2 rounded-full border border-emerald-500/20" />
          <h3 className="text-base font-bold mb-1">Your APIs are fully optimized</h3>
          <p className="text-xs text-zinc-500 leading-relaxed max-w-sm mx-auto">
            Our AI Cost Analyzer hasn't flagged any latency anomalies, duplicate queries, or unconfigured cache endpoints in your request records.
          </p>
        </div>
      )}

    </div>
  );
};

export default OptimizationCenter;
