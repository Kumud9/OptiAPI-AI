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
  AlertTriangle,
  Settings,
  Globe,
  Sliders,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

const OptimizationCenter = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState([]);
  const [applyingId, setApplyingId] = useState(null);

  // Settings State
  const [optimizationMode, setOptimizationMode] = useState('recommendation');
  const [optimizationEnabled, setOptimizationEnabled] = useState(true);
  const [defaultStrategy, setDefaultStrategy] = useState('balanced');
  const [automaticRoutingAllowed, setAutomaticRoutingAllowed] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Optimization Decision State
  const [decision, setDecision] = useState(null);
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [showWhyDetails, setShowWhyDetails] = useState(false);

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

  const fetchDecision = async (strategy) => {
    setLoadingDecision(true);
    try {
      const response = await api.get(`/optimization/decision?mode=${strategy}`);
      setDecision(response.data);
    } catch (error) {
      console.error('Fetch decision failed:', error);
    } finally {
      setLoadingDecision(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await api.get('/optimization/settings');
      if (response.data.success) {
        setOptimizationMode(response.data.data.optimizationMode);
        setOptimizationEnabled(response.data.data.optimizationEnabled);
        setDefaultStrategy(response.data.data.defaultStrategy);
        setAutomaticRoutingAllowed(response.data.data.automaticRoutingAllowed);
      }
    } catch (error) {
      console.error('Fetch settings failed:', error);
    }
  };

  useEffect(() => {
    fetchRecommendations();
    fetchSettings();
  }, []);

  useEffect(() => {
    if (defaultStrategy) {
      fetchDecision(defaultStrategy);
    }
  }, [defaultStrategy]);

  const handleUpdateSettings = async (updates) => {
    setSettingsSaving(true);
    try {
      const response = await api.post('/optimization/settings', updates);
      if (response.data.success) {
        setOptimizationMode(response.data.data.optimizationMode);
        setOptimizationEnabled(response.data.data.optimizationEnabled);
        setDefaultStrategy(response.data.data.defaultStrategy);
        setAutomaticRoutingAllowed(response.data.data.automaticRoutingAllowed);
        addToast('Global optimization configurations saved', 'success');
      }
    } catch (error) {
      console.error('Update settings failed:', error);
      addToast('Failed to update global configurations', 'error');
    } finally {
      setSettingsSaving(false);
    }
  };

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
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Cpu size={24} className="text-primary" /> Optimization Center
          </h1>
          <p className="text-sm text-zinc-450 mt-1">Telemetry-based suggestions to decrease gateway cost, response latency, and security surface</p>
        </div>

        {totalPotentialSavings > 0 && (
          <div className="px-4 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
            <TrendingDown size={16} className="text-emerald-400" />
            <div>
              <p className="text-xs text-zinc-500 uppercase font-semibold">Est. Monthly Savings</p>
              <h3 className="text-base font-bold text-emerald-400">₹{totalPotentialSavings.toLocaleString('en-IN')}</h3>
            </div>
          </div>
        )}
      </div>

      {/* Primary Optimization Recommendation Panel */}
      {loadingDecision ? (
        <div className="h-64 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
      ) : decision ? (
        decision.success && decision.decision ? (
          <div className="bg-gradient-to-br from-emerald-500/10 via-zinc-950 to-zinc-950 border border-emerald-500/20 rounded-2xl p-6 shadow-glow-green relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
            
            <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
              <div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                  ⭐ Optimization Recommendation
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-zinc-500 block font-semibold uppercase">Recommendation Score</span>
                <span className="text-3xl font-black text-emerald-400">{decision.decision.score}</span>
              </div>
            </div>

            {/* Recommended Highlight Card */}
            <div className="my-8 flex flex-col items-center justify-center p-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-glow-green relative">
              <span className="text-3xl font-bold text-emerald-400 tracking-tight mb-2">
                {formatProvider(decision.decision.provider)}
              </span>
              <span className="text-lg text-emerald-400/70 font-mono">
                {decision.decision.model}
              </span>
            </div>

            {/* Explanation text */}
            <div className="mt-4 text-sm text-zinc-400">
              <span className="font-semibold text-zinc-355 block mb-1">Why this was recommended:</span>
              <p className="leading-relaxed">
                OptiAPI evaluated available candidates. Based on {decision.metrics?.successfulRequests || 0} successful calls, {formatProvider(decision.decision.provider)} is recommended to optimize {defaultStrategy} performance.
              </p>
            </div>

            {/* Expandable "Why this recommendation?" details */}
            <div className="mt-4 pt-3 border-t border-zinc-900">
              <button
                type="button"
                onClick={() => setShowWhyDetails(!showWhyDetails)}
                className="text-xs font-semibold text-primary-light hover:underline flex items-center gap-1.5 focus:outline-none"
              >
                {showWhyDetails ? 'Hide Recommendation Metrics ▲' : 'Why this recommendation? (Show Metrics) ▼'}
              </button>
              
              {showWhyDetails && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 p-3 bg-zinc-900/50 rounded-xl border border-zinc-850 animate-fadeIn">
                  <div>
                    <span className="text-[11px] text-zinc-500 block font-semibold uppercase">Average Cost</span>
                    <span className="text-sm font-bold text-zinc-200">{decision.decision.reason?.cost || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-zinc-500 block font-semibold uppercase">Average Latency</span>
                    <span className="text-sm font-bold text-zinc-200">{decision.decision.reason?.latency || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-zinc-500 block font-semibold uppercase">Reliability Rate</span>
                    <span className="text-sm font-bold text-emerald-400">{decision.decision.reason?.reliability || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-zinc-500 block font-semibold uppercase">Historical Telemetry</span>
                    <span className="text-sm font-bold text-zinc-200">{decision.metrics?.successfulRequests || 0} calls</span>
                  </div>
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950/20 space-y-4">
            <div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wider">
                Optimization Status
              </span>
              <h2 className="text-base font-bold text-zinc-350 mt-2 flex items-center gap-1.5">
                <AlertTriangle size={17} className="text-amber-500" /> OPTIMIZATION UNAVAILABLE
              </h2>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                {decision.message || 'Not enough successful historical requests.'}
              </p>
            </div>

            {decision.explanations && decision.explanations.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-4 pt-2">
                {decision.explanations.map((exp, idx) => {
                  const isQuota = /quota/i.test(exp.reason || '') || /RESOURCE_EXHAUSTED/i.test(exp.reason || '');
                  const isHealth = /validation/i.test(exp.reason || '') || /credentials/i.test(exp.reason || '') || /connection/i.test(exp.reason || '') || /unauthorized/i.test(exp.reason || '');
                  const isData = /insufficient/i.test(exp.reason || '') || /data/i.test(exp.reason || '');
                  
                  let badgeColor = "bg-zinc-800/40 text-zinc-450 border-zinc-700/50";
                  let statusText = "Excluded";

                  if (isQuota) {
                    badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                    statusText = "Quota Exhausted";
                  } else if (isHealth) {
                    badgeColor = "bg-rose-500/10 text-rose-450 border-rose-500/20";
                    statusText = "Authentication Failed";
                  } else if (isData) {
                    badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                    statusText = "Insufficient historical data";
                  }

                  return (
                    <div key={idx} className="p-3 bg-zinc-900/10 rounded-xl border border-zinc-850 flex items-start justify-between gap-4">
                      <div>
                        <span className="text-sm font-bold text-zinc-200 block">{formatProvider(exp.provider)}</span>
                        <p className="text-xs text-zinc-500 leading-normal mt-1">{exp.reason}</p>
                      </div>
                      <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-bold border ${badgeColor}`}>
                        {statusText}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )
      ) : null}

      {/* Global Optimization Settings Section */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 space-y-4">
        <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Settings size={16} className="text-primary" /> Global Optimization Settings
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">Configure system-wide routing rules. Changes affect all API execution models globally.</p>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
            <Globe size={12} /> System-Wide Config
          </span>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 pt-2">
          
          {/* Column 1: Execution Mode */}
          <div className="space-y-3 border-r border-zinc-800/60 pr-0 lg:pr-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400">Execution Mode</label>
              <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">Determine if routing changes are manual or automatic.</p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleUpdateSettings({ optimizationMode: 'recommendation' })}
                className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col justify-between ${
                  optimizationMode === 'recommendation'
                    ? 'border-primary bg-primary/5 shadow-glow-blue'
                    : 'border-zinc-850 bg-zinc-900/10 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex justify-between items-center w-full">
                  <span className="text-sm font-bold text-zinc-200">Recommendation</span>
                  {optimizationMode === 'recommendation' && <span className="h-1.5 w-1.5 rounded-full bg-primary-light"></span>}
                </div>
                <span className="text-xs text-zinc-400 mt-1 leading-normal">
                  OptiAPI analyzes provider performance and recommends options. You stay in control.
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdateSettings({ optimizationMode: 'automatic' })}
                className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col justify-between ${
                  optimizationMode === 'automatic'
                    ? 'border-emerald-500 bg-emerald-500/5 shadow-glow-green'
                    : 'border-zinc-850 bg-zinc-900/10 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex justify-between items-center w-full">
                  <span className="text-sm font-bold text-zinc-200">Automatic Execution</span>
                  {optimizationMode === 'automatic' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>}
                </div>
                <span className="text-xs text-zinc-400 mt-1 leading-normal">
                  OptiAPI automatically routes eligible requests to the recommended provider.
                </span>
              </button>
            </div>
          </div>

          {/* Column 2: Automatic Routing Allowed */}
          <div className="space-y-3 border-r border-zinc-800/60 pr-0 lg:pr-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400">Automatic Routing Control</label>
              <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">Control whether requests can be routed automatically.</p>
            </div>
            <div className="p-4 rounded-xl border border-zinc-850 bg-zinc-900/10 flex items-center justify-between gap-4">
              <div>
                <span className="text-sm font-bold text-zinc-200 block">Allow Automatic Routing</span>
                <span className="text-xs text-zinc-450 leading-relaxed mt-0.5 block">
                  Permit active gateway queries to automatically change provider targets.
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleUpdateSettings({ automaticRoutingAllowed: !automaticRoutingAllowed })}
                className="focus:outline-none shrink-0"
              >
                {automaticRoutingAllowed ? (
                  <ToggleRight size={26} className="text-emerald-400" />
                ) : (
                  <ToggleLeft size={26} className="text-zinc-600" />
                )}
              </button>
            </div>
          </div>

          {/* Column 3: Optimization Strategy */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-zinc-400">Optimization Strategy</label>
              <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">Primary performance scoring metric applied to models.</p>
            </div>
            <div className="space-y-2">
              {['balanced', 'cost', 'latency'].map((strat) => (
                <button
                  key={strat}
                  type="button"
                  onClick={() => handleUpdateSettings({ defaultStrategy: strat })}
                  className={`w-full p-2.5 rounded-xl border text-xs font-semibold text-left transition-all flex items-center justify-between capitalize ${
                    defaultStrategy === strat
                      ? 'border-primary/50 bg-primary/5 text-primary-light'
                      : 'border-zinc-850 bg-zinc-900/10 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{strat} Mode</span>
                  {defaultStrategy === strat && <Check size={14} className="text-primary-light" />}
                </button>
              ))}
            </div>
          </div>

        </div>
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
