import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { 
  Cpu, 
  Check, 
  ArrowRight,
  Loader2,
  Shield,
  Zap,
  TrendingDown,
  AlertTriangle
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
        setRecommendations((prev) => prev.filter((rec) => rec._id !== id));
      }
    } catch (error) {
      console.error('Apply recommendation failed:', error);
      addToast('Failed to apply optimization recommendations', 'error');
    } finally {
      setApplyingId(null);
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">High Priority</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Medium Priority</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">Low Priority</span>;
    }
  };

  const formatProvider = (prov) => {
    if (!prov) return '';
    const lower = prov.toLowerCase();
    if (lower === 'anthropic' || lower === 'claude') return 'Claude';
    if (lower === 'openai') return 'OpenAI';
    if (lower === 'gemini') return 'Gemini';
    return prov.replace('_', ' ');
  };

  // Helper to structure recommendation texts dynamically
  const parseRecommendation = (rec) => {
    const providerDisplay = formatProvider(rec.targetEndpoint || '');
    const cleanMessage = rec.message.replace(/\bclaude\b/gi, 'Claude').replace(/\banthropic\b/gi, 'Claude');

    switch (rec.type) {
      case 'unused_keys':
        return {
          title: 'Unused Provider Credential',
          detected: `${providerDisplay || 'A provider'} has a stored API credential but no recent matching gateway usage was detected.`,
          whyItMatters: 'Unused credentials increase credential-management and security overhead.',
          recommendation: `Deactivate or remove this credential if you no longer use ${providerDisplay || 'this provider'}.`,
          impacts: { security: 'Low' }
        };
      case 'cache_endpoint':
        return {
          title: 'High Latency / Caching Opportunity',
          detected: cleanMessage,
          whyItMatters: 'Uncached high-latency endpoints slow down applications and consume duplicate provider query costs.',
          recommendation: 'Enable caching on this endpoint to serve responses directly from Redis with ~2ms latency.',
          impacts: { 
            latency: 'Highly Improved (~2ms)',
            cost: rec.savingsInr > 0 ? `Save up to ₹${rec.savingsInr.toLocaleString('en-IN')}/mo` : 'Reduced'
          }
        };
      case 'duplicate_requests':
        return {
          title: 'Duplicate Requests Detected',
          detected: cleanMessage,
          whyItMatters: 'Exact matching payloads sent in close succession waste developer API budget and increase server processing load.',
          recommendation: 'Implement client-side debouncing or establish a short TTL cache rule for this endpoint.',
          impacts: {
            cost: rec.savingsInr > 0 ? `Save up to ₹${rec.savingsInr.toLocaleString('en-IN')}/mo` : 'Reduced',
            reliability: 'Optimized'
          }
        };
      case 'switch_batch':
        return {
          title: 'High Transactional API Volume',
          detected: cleanMessage,
          whyItMatters: 'High frequency transactional requests to external endpoints significantly increase latency overhead and cost accrual.',
          recommendation: 'Switch to batch routing operations or bulk caching rules to pool queries.',
          impacts: {
            cost: rec.savingsInr > 0 ? `Save up to ₹${rec.savingsInr.toLocaleString('en-IN')}/mo` : 'Reduced',
            latency: 'Improved'
          }
        };
      default:
        return {
          title: 'Optimization Recommendation',
          detected: cleanMessage,
          whyItMatters: 'Suboptimal routing configuration increases latency, costs, and management overhead.',
          recommendation: 'Apply the recommended configuration changes to secure and accelerate gateway queries.',
          impacts: { cost: rec.savingsInr > 0 ? `Save up to ₹${rec.savingsInr.toLocaleString('en-IN')}/mo` : 'Reduced' }
        };
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

  const totalPotentialSavings = recommendations.reduce((acc, rec) => acc + rec.savingsInr, 0);

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <Cpu size={20} className="text-primary" /> Optimization Center
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Telemetry-based suggestions to decrease gateway cost, response latency, and security surface</p>
        </div>

        {totalPotentialSavings > 0 && (
          <div className="px-4 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
            <TrendingDown size={14} className="text-emerald-400" />
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-semibold">Est. Monthly Savings</p>
              <h3 className="text-sm font-bold text-emerald-400">₹{totalPotentialSavings.toLocaleString('en-IN')}</h3>
            </div>
          </div>
        )}
      </div>

      {/* Main recommendations list */}
      {recommendations.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-6">
          {recommendations.map((rec) => {
            const detail = parseRecommendation(rec);
            return (
              <div
                key={rec._id}
                className="p-5 rounded-xl border border-zinc-850 bg-zinc-900/40 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  {/* Priority & Savings Header */}
                  <div className="flex justify-between items-center">
                    {getPriorityBadge(rec.priority)}
                    {rec.savingsInr > 0 && (
                      <span className="text-[11px] font-semibold text-emerald-400">
                        Est. Savings: ₹{rec.savingsInr.toLocaleString('en-IN')}/mo
                      </span>
                    )}
                  </div>

                  {/* Recommendation Title */}
                  <h3 className="text-sm font-semibold text-zinc-200">
                    {detail.title}
                  </h3>

                  {/* 1. What was detected */}
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold text-zinc-400 block mb-0.5">What was detected</span>
                    <p className="text-zinc-350">{detail.detected}</p>
                  </div>

                  {/* 2. Why it matters */}
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold text-zinc-400 block mb-0.5">Why it matters</span>
                    <p className="text-zinc-350">{detail.whyItMatters}</p>
                  </div>

                  {/* 3. Recommendation */}
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold text-zinc-400 block mb-0.5">Recommendation</span>
                    <p className="text-zinc-350">{detail.recommendation}</p>
                  </div>

                  {/* Evidence/Diagnostic Section */}
                  {rec.details && Object.keys(rec.details).length > 0 && (
                    <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-850/50 text-[11px] font-mono space-y-1 text-zinc-400">
                      <div className="font-sans font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                        Diagnostic Logs
                      </div>
                      {rec.details.avgLatency && (
                        <div className="flex justify-between">
                          <span>Avg Latency:</span>
                          <span className="text-zinc-200">{rec.details.avgLatency}ms</span>
                        </div>
                      )}
                      {rec.details.count && (
                        <div className="flex justify-between">
                          <span>Volume:</span>
                          <span className="text-zinc-200">{rec.details.count} calls</span>
                        </div>
                      )}
                      {rec.details.duplicateCount && (
                        <div className="flex justify-between">
                          <span>Duplicates:</span>
                          <span className="text-zinc-200">{rec.details.duplicateCount}</span>
                        </div>
                      )}
                      {rec.details.keyName && (
                        <div className="flex justify-between">
                          <span>Key Tag:</span>
                          <span className="text-zinc-200">{rec.details.keyName}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Expected Impact Section */}
                  <div className="text-xs pt-2 border-t border-zinc-850/60">
                    <span className="font-semibold text-zinc-400 block mb-1">Expected Impact</span>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {Object.entries(detail.impacts).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-1.5 capitalize">
                          <span className="text-zinc-500">{key}:</span>
                          <span className="font-medium text-zinc-300">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 5. Recommended Action Buttons */}
                <div className="mt-6 pt-3 border-t border-zinc-850/60 flex justify-end">
                  {rec.type === 'unused_keys' ? (
                    <a
                      href="/providers"
                      className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                    >
                      Manage API Providers <ArrowRight size={13} />
                    </a>
                  ) : (
                    <button
                      onClick={() => handleApply(rec._id)}
                      disabled={applyingId === rec._id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary hover:bg-primary-dark text-white font-medium text-xs transition-all disabled:opacity-50"
                    >
                      {applyingId === rec._id ? (
                        <>
                          <Loader2 size={12} className="animate-spin" /> Applying...
                        </>
                      ) : (
                        <>
                          Apply Recommendation
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center rounded-xl border border-zinc-850 bg-zinc-900/20">
          <Check className="mx-auto text-emerald-400 h-8 w-8 mb-3 bg-emerald-500/10 p-1.5 rounded-full border border-emerald-500/20" />
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">Everything looks healthy</h3>
          <p className="text-xs text-zinc-500 leading-relaxed max-w-sm mx-auto">
            Not enough usage data to make a recommendation. OptiAPI will surface performance recommendations when enough usage records are gathered.
          </p>
        </div>
      )}

    </div>
  );
};

export default OptimizationCenter;
