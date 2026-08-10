import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { KeyRound, Plus, Trash2, Key, Loader2, Sparkles } from 'lucide-react';

const ApiProviders = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    fetchKeys();
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
                <option value="claude">Claude (Anthropic)</option>
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
                        {k.provider.replace('_', ' ')}
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

    </div>
  );
};

export default ApiProviders;
