import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Database, Plus, Trash2, ShieldAlert, Sparkles, Loader2, Info } from 'lucide-react';
import { GATEWAY_INTEGRATIONS, DEFAULT_GEMINI_MODELS } from '../utils/gatewaySpecs';

const CacheManager = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState([]);
  const [purging, setPurging] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form states
  const [provider, setProvider] = useState('openai');
  const [selectedGeminiModel, setSelectedGeminiModel] = useState(DEFAULT_GEMINI_MODELS[0]);
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState(3600);

  const fetchCacheRules = async () => {
    setLoading(true);
    try {
      const response = await api.get('/cache/rules');
      if (response.data.success) {
        setRules(response.data.data);
      }
    } catch (error) {
      console.error('Fetch cache rules failed:', error);
      addToast('Failed to load caching rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCacheRules();
  }, []);

  // Sync mode settings when provider changes
  useEffect(() => {
    if (provider === 'custom') {
      setIsCustomMode(true);
    } else {
      setIsCustomMode(false);
    }
  }, [provider]);

  // Compute endpoint dynamically from specs
  const getSelectedEndpointPath = () => {
    if (isCustomMode) {
      return customEndpoint;
    }
    const spec = GATEWAY_INTEGRATIONS[provider];
    if (!spec) return '';
    if (provider === 'gemini') {
      return spec.endpoint.replace('{model}', selectedGeminiModel);
    }
    return spec.endpoint;
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    const finalEndpointPath = getSelectedEndpointPath();

    if (!finalEndpointPath) {
      addToast('Please provide an endpoint path', 'warning');
      return;
    }

    setCreating(true);
    try {
      const response = await api.post('/cache/rules', {
        provider,
        endpoint: finalEndpointPath,
        ttlSeconds: parseInt(ttlSeconds, 10)
      });

      if (response.data.success) {
        addToast('Cache rule configured successfully!', 'success');
        if (isCustomMode) {
          setCustomEndpoint('');
        }
        fetchCacheRules();
      }
    } catch (error) {
      console.error('Create cache rule failed:', error);
      addToast(error.response?.data?.error || 'Failed to create cache rule', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm('Are you sure you want to delete this cache rule?')) return;
    try {
      const response = await api.delete(`/cache/rules/${id}`);
      if (response.data.success) {
        addToast('Cache rule deleted.', 'success');
        setRules((prev) => prev.filter((r) => r._id !== id));
      }
    } catch (error) {
      console.error('Delete cache rule failed:', error);
      addToast('Failed to delete cache rule', 'error');
    }
  };

  const handlePurgeCache = async () => {
    if (!window.confirm('This will immediately invalidate all active cached endpoints inside Redis. Continue?')) return;
    setPurging(true);
    try {
      const response = await api.post('/cache/clear');
      if (response.data.success) {
        addToast(response.data.message || 'Cache store flushed successfully!', 'success');
      }
    } catch (error) {
      console.error('Purge cache failed:', error);
      addToast('Failed to purge Redis cache', 'error');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="text-primary animate-pulse" /> Cache Manager
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Configure Cache rules mapping endpoints to TTL expirations</p>
        </div>
        <button
          onClick={handlePurgeCache}
          disabled={purging}
          className="px-4 py-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10 font-semibold text-xs transition-all flex items-center gap-2"
        >
          {purging ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
          Flush Cache Store
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Left: Create Rule Form */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card h-fit">
          <h3 className="text-sm font-bold mb-4 flex items-center gap-1.5">
            <Plus size={16} className="text-primary-light" /> Configure Cache Rule
          </h3>
          <form onSubmit={handleCreateRule} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-300 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="stripe">Stripe</option>
                <option value="google_maps">Google Maps</option>
                <option value="twilio">Twilio</option>
                <option value="weather">Weather API</option>
                <option value="custom">Custom REST API</option>
              </select>
            </div>

            {/* Selector or custom text field */}
            {!isCustomMode ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-zinc-400">Endpoint Path</label>
                    <button
                      type="button"
                      onClick={() => setIsCustomMode(true)}
                      className="text-[10px] text-primary-light hover:underline font-semibold"
                    >
                      Custom Path
                    </button>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono break-all">
                    {GATEWAY_INTEGRATIONS[provider]?.endpoint.replace('{model}', GATEWAY_INTEGRATIONS[provider]?.requiresModel ? selectedGeminiModel : '')}
                  </div>
                </div>

                {GATEWAY_INTEGRATIONS[provider]?.requiresModel && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">{GATEWAY_INTEGRATIONS[provider]?.name} Target Model</label>
                    <select
                      value={selectedGeminiModel}
                      onChange={(e) => setSelectedGeminiModel(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-350 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      {DEFAULT_GEMINI_MODELS.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-zinc-400">Endpoint Path</label>
                  {provider !== 'custom' && (
                    <button
                      type="button"
                      onClick={() => setIsCustomMode(false)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-350 hover:underline"
                    >
                      Preset Path
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  placeholder="/v1/chat/completions"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono"
                  required
                />
              </div>
            )}

            <div className="p-3 rounded-lg bg-zinc-900/30 border border-zinc-850 flex gap-2 text-[10px] text-zinc-450 leading-relaxed">
              <Info size={14} className="text-primary-light shrink-0 mt-0.5" />
              <span>
                Caching is active for the target gateway route: `/api/v1/gateway${getSelectedEndpointPath()}`. Make sure client requests match this path.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">TTL (Seconds)</label>
              <input
                type="number"
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                required
                min="1"
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full bg-primary hover:bg-primary-dark text-white rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-glow-blue transition-all mt-6"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
              Add Cache Rule
            </button>
          </form>
        </div>

        {/* Right: Rules List table */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
          <h3 className="text-sm font-bold mb-4">Configured Caching Policies</h3>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-zinc-900 rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : rules.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                    <th className="py-2.5">Provider</th>
                    <th className="py-2.5">Endpoint</th>
                    <th className="py-2.5 text-center">TTL Expiry</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {rules.map((rule) => (
                    <tr key={rule._id} className="hover:bg-zinc-900/10">
                      <td className="py-3 font-semibold capitalize text-zinc-200">{rule.provider === 'anthropic' || rule.provider === 'claude' ? 'Claude' : rule.provider.replace('_', ' ')}</td>
                      <td className="py-3 text-zinc-400 font-mono">{rule.endpoint}</td>
                      <td className="py-3 text-center text-zinc-300">
                        {rule.ttlSeconds >= 86400 
                          ? `${rule.ttlSeconds / 86400} days` 
                          : rule.ttlSeconds >= 3600 
                          ? `${rule.ttlSeconds / 3600} hrs` 
                          : `${rule.ttlSeconds} secs`}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteRule(rule._id)}
                          className="p-1.5 rounded-lg border border-zinc-850 hover:border-rose-500/20 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10">
              <Database className="mx-auto text-zinc-600 h-10 w-10 mb-2" />
              <p className="text-xs text-zinc-500">No active caching policies established</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};

export default CacheManager;
