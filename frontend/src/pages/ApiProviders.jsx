import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { 
  KeyRound, 
  Plus, 
  Trash2, 
  Key, 
  Loader2, 
  Terminal, 
  Copy, 
  Check, 
  Code, 
  Globe, 
  HelpCircle, 
  Activity, 
  Settings,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  X
} from 'lucide-react';

const ApiProviders = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  // Modal / Drawer state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedProviderDetails, setSelectedProviderDetails] = useState(null);
  const [providerModels, setProviderModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Form states for adding provider
  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

  // Integration helper tab
  const [selectedIntProvider, setSelectedIntProvider] = useState('openai');
  const [copiedText, setCopiedText] = useState('');

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const response = await api.get('/users/providers');
      if (response.data.success) {
        // Filter keys to only show OpenAI, Gemini, Anthropic/Claude for "AI Providers" focus
        const aiKeys = response.data.data.filter(k => 
          ['openai', 'gemini', 'anthropic', 'claude'].includes(k.provider.toLowerCase())
        );
        setKeys(aiKeys);
      }
    } catch (error) {
      console.error('Fetch keys failed:', error);
      addToast('Failed to load credentials vault', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchGatewayKeys = async () => {
    try {
      const response = await api.get('/users/keys');
      if (response.data.success) {
        setApiKeys(response.data.data);
      }
    } catch (error) {
      console.error('Fetch gateway keys failed:', error);
    }
  };

  useEffect(() => {
    fetchKeys();
    fetchGatewayKeys();
  }, []);

  useEffect(() => {
    if (selectedProviderDetails) {
      const fetchModels = async () => {
        setLoadingModels(true);
        try {
          const res = await api.get(`/users/providers/${selectedProviderDetails._id}/models`);
          if (res.data.success) {
            setProviderModels(res.data.data);
          }
        } catch (error) {
          console.error('Fetch provider models failed:', error);
        } finally {
          setLoadingModels(false);
        }
      };
      fetchModels();
    } else {
      setProviderModels([]);
    }
  }, [selectedProviderDetails]);

  const handleSaveKey = async (e) => {
    if (e) e.preventDefault();
    if (!name || !value) {
      addToast('Please fill out all fields', 'warning');
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/users/providers', { provider, name, value });
      if (response.data.success) {
        addToast('Provider credential connected successfully!', 'success');
        setName('');
        setValue('');
        setIsAddOpen(false);
        fetchKeys();
      }
    } catch (error) {
      console.error('Save key failed:', error);
      addToast('Failed to connect provider', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    setTogglingId(id);
    try {
      const response = await api.patch(`/users/providers/${id}`, { isActive: !currentStatus });
      if (response.data.success) {
        addToast(`Provider ${!currentStatus ? 'enabled' : 'disabled'} successfully`, 'success');
        setKeys(prev => prev.map(k => k._id === id ? { ...k, isActive: !currentStatus } : k));
        if (selectedProviderDetails && selectedProviderDetails._id === id) {
          setSelectedProviderDetails(prev => ({ ...prev, isActive: !currentStatus }));
        }
      }
    } catch (error) {
      console.error('Toggle status failed:', error);
      addToast('Failed to change status', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!window.confirm('Are you sure you want to remove this provider? OptiAPI will no longer route requests to it.')) return;
    try {
      const response = await api.delete(`/users/providers/${id}`);
      if (response.data.success) {
        addToast('Provider removed.', 'success');
        setKeys((prev) => prev.filter((k) => k._id !== id));
        setSelectedProviderDetails(null);
      }
    } catch (error) {
      console.error('Delete key failed:', error);
      addToast('Failed to remove provider credentials', 'error');
    }
  };

  const handleTestConnection = async () => {
    if (selectedProviderDetails) {
      setTestingConnection(true);
      try {
        const res = await api.post(`/users/providers/${selectedProviderDetails._id}/validate`);
        if (res.data.success) {
          addToast('Connection validation successful!', 'success');
          fetchKeys();
          setSelectedProviderDetails(prev => ({
            ...prev,
            validationStatus: 'connected',
            lastValidatedAt: res.data.validatedAt,
            modelsDiscovered: res.data.modelsDiscovered
          }));
        } else {
          addToast(`Validation failed: ${res.data.errorCode || 'unauthorized'}`, 'error');
          fetchKeys();
          setSelectedProviderDetails(prev => ({
            ...prev,
            validationStatus: res.data.status,
            lastValidatedAt: res.data.validatedAt,
            validationErrorCode: res.data.errorCode
          }));
        }
      } catch (error) {
        console.error('Validation request failed:', error);
        addToast('Connection validation failed. Provider might be unavailable.', 'error');
        fetchKeys();
      } finally {
        setTestingConnection(false);
      }
      return;
    }

    if (!name || !value) {
      addToast('Please fill out Name and API Key fields first', 'warning');
      return;
    }

    setTestingConnection(true);
    try {
      const saveRes = await api.post('/users/providers', { provider, name, value });
      if (saveRes.data.success) {
        const newKey = saveRes.data.data;
        const valRes = await api.post(`/users/providers/${newKey._id}/validate`);
        if (valRes.data.success) {
          addToast('Credential connected and validated successfully!', 'success');
          setIsAddOpen(false);
          setName('');
          setValue('');
          fetchKeys();
        } else {
          addToast(`Credential connected but validation failed: ${valRes.data.errorCode}`, 'warning');
          setIsAddOpen(false);
          setName('');
          setValue('');
          fetchKeys();
        }
      }
    } catch (error) {
      console.error('Test connection failed during creation:', error);
      addToast('Failed to save or validate provider credential', 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCopyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    addToast(`${type} copied to clipboard!`, 'info');
    setTimeout(() => setCopiedText(''), 2000);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'connected':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Connected</span>;
      case 'healthy':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Healthy</span>;
      case 'rate_limited':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Rate Limited</span>;
      case 'quota_exhausted':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Quota Exhausted</span>;
      case 'authentication_failed':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Authentication Failed</span>;
      case 'validation_failed':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Connection Failed</span>;
      case 'unavailable':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Temporarily Unavailable</span>;
      case 'validating':
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-yellow-500/10 text-yellow-450 border border-yellow-500/20 animate-pulse">Validating...</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[8.5px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700/50">Not Configured</span>;
    }
  };

  const renderCapability = (label, val) => {
    if (val === true) {
      return <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-semibold">✓ {label}</span>;
    }
    if (val === false) {
      return null;
    }
    return <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-550 border border-zinc-850 text-[9px]">Unknown {label}</span>;
  };

  const GATEWAY_INTEGRATIONS = {
    openai: {
      name: 'OpenAI Chat',
      method: 'POST',
      endpoint: '/openai/v1/chat/completions',
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }]
      }
    },
    gemini: {
      name: 'Google Gemini',
      method: 'POST',
      endpoint: '/gemini/v1/models/{model}:generateContent',
      body: {
        contents: [{ parts: [{ text: 'Explain quantum computing in one sentence.' }] }]
      }
    },
    anthropic: {
      name: 'Anthropic Claude',
      method: 'POST',
      endpoint: '/anthropic/v1/messages',
      body: {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }]
      }
    }
  };

  const DEFAULT_GEMINI_MODELS = ['gemini-1.5-pro', 'gemini-1.5-flash'];
  const backendBaseUrl = api.defaults.baseURL || 'http://localhost:5000/api/v1';
  const productionGatewayRoot = `${backendBaseUrl}/gateway`;
  const activeGatewayKey = apiKeys.find(k => k.isActive)?.key || 'YOUR_OPTI_API_KEY';
  const activeGatewayKeyName = apiKeys.find(k => k.isActive)?.name || 'default';

  const selectedIntegration = GATEWAY_INTEGRATIONS[selectedIntProvider];
  const resolvedEndpoint = selectedIntProvider === 'gemini' 
    ? selectedIntegration.endpoint.replace('{model}', DEFAULT_GEMINI_MODELS[0])
    : selectedIntegration.endpoint;

  const fullGatewayUrl = `${productionGatewayRoot}${resolvedEndpoint}`;

  const curlSnippet = `curl -X ${selectedIntegration.method} "${fullGatewayUrl}" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeGatewayKey}" ${selectedIntegration.body ? `\\
  -d '${JSON.stringify(selectedIntegration.body, null, 2)}'` : ''}`;

  const jsSnippet = `fetch("${fullGatewayUrl}", {
  method: "${selectedIntegration.method}",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${activeGatewayKey}"
  }${selectedIntegration.body ? `,
  body: JSON.stringify(${JSON.stringify(selectedIntegration.body, null, 2).replace(/\n/g, '\n  ')})` : ''}
})
.then(res => res.json())
.then(data => console.log(data));`;

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="text-primary" /> API Providers
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Connect, monitor, and configure third-party provider credentials for routing optimization.</p>
        </div>
        {keys.length > 0 && (
          <button
            onClick={() => setIsAddOpen(true)}
            className="bg-primary hover:bg-primary-dark text-white rounded-xl py-2 px-4 text-xs font-semibold flex items-center gap-1.5 shadow-glow-blue transition-all"
          >
            <Plus size={14} /> Connect Provider
          </button>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-44 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
          ))}
        </div>
      ) : keys.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {keys.map((k) => {
            const providerClean = k.provider === 'anthropic' || k.provider === 'claude' ? 'Anthropic Claude' : k.provider === 'openai' ? 'OpenAI' : 'Google Gemini';
            const logoColor = k.provider === 'openai' ? 'text-emerald-400' : k.provider === 'gemini' ? 'text-blue-400' : 'text-amber-500';
            return (
              <div
                key={k._id}
                className={`p-5 rounded-2xl border bg-zinc-950/40 glass-card flex flex-col justify-between transition-all ${
                  k.isActive ? 'border-zinc-800' : 'border-zinc-900 opacity-60'
                }`}
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${logoColor}`}>
                        {providerClean}
                      </span>
                      <h3 className="text-sm font-bold text-zinc-200 mt-0.5 truncate">{k.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(k.validationStatus)}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs border-t border-zinc-900 pt-3">
                    <div className="flex justify-between items-center text-zinc-500">
                      <span>API Key:</span>
                      <span className="font-mono text-zinc-300">{k.value}</span>
                    </div>
                    <div className="flex justify-between items-center text-zinc-500">
                      <span>Discovered Models:</span>
                      <span className="text-[10px] text-zinc-300 font-bold bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-850">
                        {k.modelsDiscovered || 0}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-zinc-500">
                      <span>Last Validated:</span>
                      <span className="text-[10px] text-zinc-400">
                        {k.lastValidatedAt ? new Date(k.lastValidatedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-zinc-900">
                  <button
                    onClick={() => setSelectedProviderDetails(k)}
                    className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all"
                  >
                    Manage
                  </button>
                  <button
                    onClick={() => handleToggleActive(k._id, k.isActive)}
                    disabled={togglingId === k._id}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition-all"
                    title={k.isActive ? 'Disable Provider' : 'Enable Provider'}
                  >
                    {k.isActive ? <ToggleRight size={18} className="text-primary-light" /> : <ToggleLeft size={18} />}
                  </button>
                  <button
                    onClick={() => handleDeleteKey(k._id)}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 transition-all"
                    title="Remove Provider"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-16 px-4 rounded-2xl border border-zinc-800 bg-zinc-950/20 max-w-xl mx-auto mt-6">
          <KeyRound className="mx-auto text-zinc-600 h-12 w-12 mb-4 animate-pulse" />
          <h2 className="text-lg font-bold text-zinc-200 mb-1">Connect your first provider</h2>
          <p className="text-xs text-zinc-500 leading-relaxed mb-6">
            Add your provider credentials once. OptiAPI handles validation, models, health, telemetry, and optimization.
          </p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white font-semibold text-xs transition-all shadow-glow-blue"
          >
            <Plus size={14} /> + Add Provider
          </button>
        </div>
      )}

      {/* Add Provider Flow Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <button
              onClick={() => setIsAddOpen(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-200"
            >
              <X size={18} />
            </button>

            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 text-zinc-200">
                <Plus size={16} className="text-primary" /> Connect Provider
              </h3>
              <p className="text-[11px] text-zinc-500 mt-1">Configure your API credentials. Secrets will be encrypted in MongoDB vault.</p>
            </div>

            <form onSubmit={handleSaveKey} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Provider *</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-250 focus:outline-none focus:border-primary"
                >
                  <option value="openai">OpenAI (GPT-4o, GPT-4, etc.)</option>
                  <option value="gemini">Google Gemini (Gemini 1.5 Pro/Flash)</option>
                  <option value="anthropic">Anthropic Claude (Claude 3.5 Sonnet)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Key Description Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Production OpenAI Key"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">API Key Value *</label>
                <input
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 text-zinc-300 rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                >
                  {testingConnection ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Test Connection
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-primary hover:bg-primary-dark text-white rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-glow-blue transition-all"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  Save Credentials
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Provider Details Modal */}
      {selectedProviderDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedProviderDetails(null)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-200"
            >
              <X size={18} />
            </button>

            <div>
              <h3 className="text-base font-bold text-zinc-200 flex items-center gap-2">
                <Settings size={18} className="text-primary-light" /> Provider Management Console
              </h3>
              <p className="text-[11px] text-zinc-500 mt-1">Configure status, view discovered models, and validate connection parameters.</p>
            </div>

            <div className="space-y-3.5 bg-zinc-900/30 p-4 rounded-xl border border-zinc-900">
              <div className="grid grid-cols-3 text-xs leading-relaxed">
                <span className="text-zinc-500">Provider:</span>
                <span className="col-span-2 text-zinc-200 font-semibold capitalize">{selectedProviderDetails.provider}</span>
              </div>
              <div className="grid grid-cols-3 text-xs leading-relaxed">
                <span className="text-zinc-500">Connection Status:</span>
                <span className="col-span-2 flex items-center gap-1.5">
                  {getStatusBadge(selectedProviderDetails.validationStatus)}
                </span>
              </div>
              <div className="grid grid-cols-3 text-xs leading-relaxed">
                <span className="text-zinc-500">Credential:</span>
                <span className="col-span-2 font-mono text-zinc-350">{selectedProviderDetails.value}</span>
              </div>
              <div className="grid grid-cols-3 text-xs leading-relaxed">
                <span className="text-zinc-500">Active Routing:</span>
                <span className="col-span-2">
                  <span className={`px-2 py-0.5 rounded text-[9px] ${selectedProviderDetails.isActive ? 'bg-primary/20 text-primary-light border border-primary/30' : 'bg-zinc-800 text-zinc-400'}`}>
                    {selectedProviderDetails.isActive ? 'Allowed for optimization' : 'Suspended'}
                  </span>
                </span>
              </div>
            </div>

            {/* Model Registry Display */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-zinc-300 block">Discovered Models ({providerModels.length})</span>
              
              {loadingModels ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500 py-3">
                  <Loader2 size={12} className="animate-spin" /> Querying model registry...
                </div>
              ) : providerModels.length > 0 ? (
                <div className="max-h-40 overflow-y-auto border border-zinc-850 rounded-xl bg-zinc-950 p-2 divide-y divide-zinc-900 text-xs">
                  {providerModels.map(m => (
                    <div key={m._id} className="py-2 px-1 flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
                      <span className="font-semibold text-zinc-300 font-mono text-[11px] truncate" title={m.externalModelId}>
                        {m.externalModelId}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {renderCapability('text', m.capabilities?.text)}
                        {renderCapability('stream', m.capabilities?.streaming)}
                        {renderCapability('vision', m.capabilities?.vision)}
                        {renderCapability('audio', m.capabilities?.audio)}
                        {renderCapability('tools', m.capabilities?.tools)}
                        {renderCapability('struct', m.capabilities?.structuredOutput)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 border border-zinc-850 rounded-xl bg-zinc-900/10 text-xs text-zinc-500">
                  No discovered models in registry. Run "Revalidate Connection" to discover.
                </div>
              )}
            </div>

            <div className="flex justify-between gap-3 pt-3 border-t border-zinc-900">
              <button
                onClick={() => handleDeleteKey(selectedProviderDetails._id)}
                className="bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 rounded-xl px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <Trash2 size={13} /> Remove Provider
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 text-zinc-300 rounded-xl px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  {testingConnection ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Revalidate Connection
                </button>
                <button
                  onClick={() => handleToggleActive(selectedProviderDetails._id, selectedProviderDetails.isActive)}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    selectedProviderDetails.isActive 
                      ? 'bg-zinc-900 border border-zinc-800 text-zinc-400' 
                      : 'bg-primary text-white shadow-glow-blue'
                  }`}
                >
                  {selectedProviderDetails.isActive ? 'Disable' : 'Enable'} Provider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Gateway Integration Panel */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <div className="flex items-center gap-2 mb-4">
          <Terminal size={18} className="text-primary-light" />
          <h2 className="text-base font-bold text-zinc-200">How to use OptiAPI Gateway</h2>
        </div>
        <p className="text-xs text-zinc-400 mb-6">
          OptiAPI provides a single control endpoint for all your integrations. Select a provider below to generate your production URL, headers, and code samples automatically.
        </p>

        {/* Tab Headers */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-zinc-800/60 pb-3">
          {Object.keys(GATEWAY_INTEGRATIONS).map((provKey) => (
            <button
              key={provKey}
              onClick={() => setSelectedIntProvider(provKey)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedIntProvider === provKey
                  ? 'bg-primary text-white shadow-glow-blue'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {GATEWAY_INTEGRATIONS[provKey].name}
            </button>
          ))}
        </div>

        {/* Dynamic Integration Spec */}
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-850 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-zinc-400">Gateway URL:</span>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-primary/10 text-primary-light border border-primary/20">
                  {selectedIntegration.method}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-900 flex items-center justify-between gap-3">
                <code className="text-xs font-mono text-zinc-300 break-all select-all">{fullGatewayUrl}</code>
                <button
                  onClick={() => handleCopyToClipboard(fullGatewayUrl, 'URL')}
                  className="p-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all shrink-0"
                >
                  {copiedText === 'URL' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>

              <div className="text-xs space-y-1.5 pt-2">
                <div className="flex justify-between">
                  <span className="text-zinc-500">HTTP Method:</span>
                  <span className="font-mono text-zinc-300">{selectedIntegration.method}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">CORS Policy:</span>
                  <span className="text-zinc-300">Origin-checked (Default allowed)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Telemetry Status:</span>
                  <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                    <Globe size={12} /> Active Analytics
                  </span>
                </div>
              </div>
            </div>

            {/* Gateway Key Header Panel */}
            <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-850">
              <span className="block text-xs font-semibold text-zinc-400 mb-2">Required Headers:</span>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between p-2 rounded bg-zinc-950 border border-zinc-900 font-mono">
                  <span className="text-zinc-500">Content-Type</span>
                  <span className="text-zinc-300">application/json</span>
                </div>
                <div className="p-2 rounded bg-zinc-950 border border-zinc-900 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-zinc-500">x-api-key</span>
                    <button
                      onClick={() => handleCopyToClipboard(activeGatewayKey, 'Key')}
                      className="text-zinc-400 hover:text-zinc-200 transition-all"
                    >
                      {copiedText === 'Key' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 break-all select-all">
                    {activeGatewayKey.substring(0, 15)}... (via {activeGatewayKeyName})
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dynamic Code Samples */}
          <div className="lg:col-span-7 space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
                  <Code size={14} className="text-primary-light" /> Request Snippets
                </span>
              </div>

              {/* cURL Codebox */}
              <div className="rounded-xl border border-zinc-850 bg-zinc-950 overflow-hidden font-mono text-[11px] text-zinc-300">
                <div className="flex justify-between items-center px-4 py-2 bg-zinc-900 border-b border-zinc-850">
                  <span className="text-xs text-zinc-500 font-sans">cURL Sample</span>
                  <button
                    onClick={() => handleCopyToClipboard(curlSnippet, 'cURL')}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                  >
                    {copiedText === 'cURL' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>
                <pre className="p-4 overflow-x-auto whitespace-pre-wrap select-all max-h-40 leading-relaxed break-all">
                  {curlSnippet}
                </pre>
              </div>
            </div>

            {/* JavaScript Fetch Codebox */}
            <div className="rounded-xl border border-zinc-850 bg-zinc-950 overflow-hidden font-mono text-[11px] text-zinc-300">
              <div className="flex justify-between items-center px-4 py-2 bg-zinc-900 border-b border-zinc-850">
                <span className="text-xs text-zinc-500 font-sans">JavaScript fetch</span>
                <button
                  onClick={() => handleCopyToClipboard(jsSnippet, 'JS')}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                >
                  {copiedText === 'JS' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
              <pre className="p-4 overflow-x-auto whitespace-pre-wrap select-all max-h-40 leading-relaxed">
                {jsSnippet}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiProviders;
