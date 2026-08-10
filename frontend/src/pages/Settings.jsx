import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Settings as SettingsIcon, Plus, Trash2, Key, Copy, Check, Loader2 } from 'lucide-react';

const Settings = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Form states
  const [name, setName] = useState('');
  const [rateLimitRps, setRateLimitRps] = useState(10);

  const fetchApiKeys = async () => {
    setLoading(true);
    try {
      const response = await api.get('/users/keys');
      if (response.data.success) {
        setApiKeys(response.data.data);
      }
    } catch (error) {
      console.error('Fetch API keys failed:', error);
      addToast('Failed to load gateway API keys', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!name) {
      addToast('Please enter a key description name', 'warning');
      return;
    }

    setCreating(true);
    try {
      const response = await api.post('/users/keys', {
        name,
        rateLimitRps: parseInt(rateLimitRps, 10)
      });

      if (response.data.success) {
        addToast('Gateway API Key created successfully!', 'success');
        setName('');
        setRateLimitRps(10);
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Create key failed:', error);
      addToast('Failed to generate new key', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!window.confirm('Are you sure you want to revoke this API key? This will immediately lock client access to the gateway.')) return;
    try {
      const response = await api.delete(`/users/keys/${id}`);
      if (response.data.success) {
        addToast('Gateway API Key revoked.', 'success');
        setApiKeys((prev) => prev.filter((k) => k._id !== id));
      }
    } catch (error) {
      console.error('Revoke key failed:', error);
      addToast('Failed to revoke API key', 'error');
    }
  };

  const handleCopyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    addToast('API Key token copied to clipboard!', 'info');
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="text-primary" /> Gateway Configurations
        </h1>
        <p className="text-xs text-zinc-400 mt-1">Configure client-side API Keys and Rate Limits for the OptiAPI Gateway</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Left: Create Form */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card h-fit">
          <h3 className="text-sm font-bold mb-4 flex items-center gap-1.5">
            <Plus size={16} className="text-primary-light" /> Generate Gateway Key
          </h3>
          <form onSubmit={handleCreateKey} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Key Name / Description</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Product App Dev Key"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">RPS Rate Limit (Req/Sec)</label>
              <input
                type="number"
                value={rateLimitRps}
                onChange={(e) => setRateLimitRps(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-zinc-200 focus:outline-none focus:border-primary"
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
              Generate Key
            </button>
          </form>
        </div>

        {/* Right: Key list table */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
          <h3 className="text-sm font-bold mb-4">Active Gateway Client Access Keys</h3>
          
          {loading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-12 bg-zinc-900 rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : apiKeys.length > 0 ? (
            <div className="space-y-4">
              {apiKeys.map((k) => (
                <div
                  key={k._id}
                  className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/10 flex justify-between items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-zinc-200 truncate">{k.name}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[9px] bg-zinc-800 text-zinc-400 font-mono">
                        Limit: {k.rateLimitRps} rps
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-zinc-500 font-mono text-xs">
                      <Key size={14} className="text-zinc-655" />
                      <span className="truncate select-all">{k.key}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyToClipboard(k.key, k._id)}
                      className="p-1.5 rounded-lg border border-zinc-800 hover:border-primary/20 text-zinc-500 hover:text-primary hover:bg-primary/5 transition-all"
                    >
                      {copiedId === k._id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => handleDeleteKey(k._id)}
                      className="p-1.5 rounded-lg border border-zinc-800 hover:border-rose-500/20 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Key className="mx-auto text-zinc-650 h-10 w-10 mb-2" />
              <p className="text-xs text-zinc-500">No active gateway client keys generated yet</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};

export default Settings;
