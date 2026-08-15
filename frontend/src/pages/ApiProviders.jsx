import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { KeyRound, Plus, Trash2, Key, Loader2, Sparkles, Terminal, Copy, Check, Code, Globe, HelpCircle } from 'lucide-react';
import { GATEWAY_INTEGRATIONS, DEFAULT_GEMINI_MODELS } from '../utils/gatewaySpecs';

const ApiProviders = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [saving, setSaving] = useState(false);

  // Integration helper tab
  const [selectedIntProvider, setSelectedIntProvider] = useState('openai');
  const [copiedText, setCopiedText] = useState('');

  // Form states
  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const response = await api.get('/users/providers');
      if (response.data.success) {
        setKeys(response.data.data);
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

  const handleSaveKey = async (e) => {
    e.preventDefault();
    if (!name || !value) {
      addToast('Please enter both key description and value', 'warning');
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/users/providers', { provider, name, value });
      if (response.data.success) {
        addToast('Credentials set successfully!', 'success');
        setName('');
        setValue('');
        fetchKeys();
      }
    } catch (error) {
      console.error('Save key failed:', error);
      addToast('Failed to save provider key credentials', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!window.confirm('Are you sure you want to delete this provider key? This will disable corresponding requests routed through OptiAPI.')) return;
    try {
      const response = await api.delete(`/users/providers/${id}`);
      if (response.data.success) {
        addToast('Provider keys deleted.', 'success');
        setKeys((prev) => prev.filter((k) => k._id !== id));
      }
    } catch (error) {
      console.error('Delete key failed:', error);
      addToast('Failed to remove provider credentials', 'error');
    }
  };

  const handleCopyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    addToast(`${type} copied to clipboard!`, 'info');
    setTimeout(() => setCopiedText(''), 2000);
  };

  // Determine gateway root URL
  const backendBaseUrl = api.defaults.baseURL || 'http://localhost:5000/api/v1';
  const productionGatewayRoot = `${backendBaseUrl}/gateway`;

  // Get active gateway key
  const activeGatewayKey = apiKeys.find(k => k.isActive)?.key || 'YOUR_OPTI_API_KEY';
  const activeGatewayKeyName = apiKeys.find(k => k.isActive)?.name || 'default';

  const selectedIntegration = GATEWAY_INTEGRATIONS[selectedIntProvider];
  // Interpolate model if gemini is selected
  const resolvedEndpoint = selectedIntProvider === 'gemini' 
    ? selectedIntegration.endpoint.replace('{model}', DEFAULT_GEMINI_MODELS[0])
    : selectedIntegration.endpoint;

  const fullGatewayUrl = `${productionGatewayRoot}${resolvedEndpoint}`;

  // Generated code snippets
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="text-primary" /> API Provider Credentials Vault
        </h1>
        <p className="text-xs text-zinc-400 mt-1">Securely store and manage key tokens for third-party API providers</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Left: Input Form */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card h-fit">
          <h3 className="text-sm font-bold mb-4 flex items-center gap-1.5">
            <Plus size={16} className="text-primary-light" /> Configure Provider Key
          </h3>
          <form onSubmit={handleSaveKey} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-300 focus:outline-none focus:border-primary"
              >
                <option value="openai">OpenAI (Chat, Embeddings)</option>
                <option value="gemini">Gemini (Google AI Studio)</option>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="stripe">Stripe Payments</option>
                <option value="google_maps">Google Maps APIs</option>
                <option value="twilio">Twilio Messaging</option>
                <option value="weather">Weather API</option>
                <option value="custom">Custom REST Endpoints</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Key Description Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My production OpenAI key"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">API Key Value</label>
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-proj-..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-primary"
                required
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-primary hover:bg-primary-dark text-white rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-glow-blue transition-all mt-6"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
              Save Credentials
            </button>
          </form>
        </div>

        {/* Right: Key Cards Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="p-4 rounded-xl border border-zinc-800/60 bg-zinc-950/20 text-xs text-zinc-400 flex items-start gap-3">
            <Sparkles size={16} className="text-primary-light mt-0.5" />
            <p>
              Stored API Keys are encrypted in MongoDB and never returned in plain text on client screens. OptiAPI proxy reads keys inside authorization headers automatically to route queries safely.
            </p>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-32 bg-zinc-900 border border-zinc-850 rounded-2xl skeleton-shimmer" />
              ))}
            </div>
          ) : keys.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {keys.map((k) => (
                <div
                  key={k._id}
                  className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card flex flex-col justify-between"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-primary-light uppercase tracking-wider">
                        {k.provider === 'anthropic' || k.provider === 'claude' ? 'Claude' : k.provider.replace('_', ' ')}
                      </span>
                      <h4 className="text-sm font-bold text-zinc-200 mt-1">{k.name}</h4>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(k._id)}
                      className="p-1.5 rounded-lg border border-zinc-850 hover:border-rose-500/20 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mt-6 flex items-center gap-2 text-zinc-500 font-mono text-xs">
                    <Key size={14} />
                    <span>{k.value}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 rounded-2xl border border-zinc-800 bg-zinc-950/20">
              <KeyRound className="mx-auto text-zinc-650 h-10 w-10 mb-2" />
              <p className="text-xs text-zinc-500">Vault is empty. Add a credential set on the left panel</p>
            </div>
          )}
        </div>

      </div>

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
