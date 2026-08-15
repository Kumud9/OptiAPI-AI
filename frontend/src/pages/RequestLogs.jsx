import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { FileCode2, ArrowLeft, ArrowRight, Eye, RefreshCw, X } from 'lucide-react';

const RequestLogs = () => {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  // Filters
  const [provider, setProvider] = useState('');
  const [cacheStatus, setCacheStatus] = useState('');
  const [status, setStatus] = useState('');

  // Selected Log Modal
  const [selectedLog, setSelectedLog] = useState(null);

  const fetchLogs = async (pageNum = 1) => {
    setLoading(true);
    try {
      let query = `/analytics/logs?page=${pageNum}&limit=12`;
      if (provider) query += `&provider=${provider}`;
      if (cacheStatus) query += `&cacheStatus=${cacheStatus}`;
      if (status) query += `&status=${status}`;

      const response = await api.get(query);
      if (response.data.success) {
        setLogs(response.data.data.data);
        setPage(response.data.data.page);
        setTotalPages(response.data.data.pages);
        setTotalLogs(response.data.data.total);
      }
    } catch (error) {
      console.error('Fetch logs failed:', error);
      addToast('Failed to load gateway logs', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [provider, cacheStatus, status]);

  const handleNextPage = () => {
    if (page < totalPages) {
      fetchLogs(page + 1);
    }
  };

  const handlePrevPage = () => {
    if (page > 1) {
      fetchLogs(page - 1);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileCode2 className="text-primary" /> Gateway Transaction Logs
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Audit trail of API routing transactions</p>
        </div>
        <button
          onClick={() => fetchLogs(page)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 text-xs font-semibold transition-all hover:border-zinc-700"
        >
          <RefreshCw size={14} className="text-zinc-400" /> Refresh List
        </button>
      </div>

      {/* Filter panel */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/20 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Provider filter */}
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Filter Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-zinc-300 focus:outline-none focus:border-primary"
          >
            <option value="">All Providers</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="anthropic">Claude</option>
            <option value="stripe">Stripe</option>
            <option value="google_maps">Google Maps</option>
            <option value="twilio">Twilio</option>
            <option value="weather">Weather API</option>
          </select>
        </div>

        {/* Cache status filter */}
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Filter Caching</label>
          <select
            value={cacheStatus}
            onChange={(e) => setCacheStatus(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-zinc-300 focus:outline-none focus:border-primary"
          >
            <option value="">All Cache States</option>
            <option value="HIT">Cache HIT</option>
            <option value="MISS">Cache MISS</option>
            <option value="BYPASS">Cache BYPASS</option>
          </select>
        </div>

        {/* Http Status filter */}
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Filter HTTP Code</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-zinc-300 focus:outline-none focus:border-primary"
          >
            <option value="">All Codes</option>
            <option value="200">200 OK</option>
            <option value="202">202 Accepted (Queued)</option>
            <option value="429">429 Rate Exceeded</option>
            <option value="502">502 Bad Gateway</option>
          </select>
        </div>
      </div>

      {/* Logs Table Grid */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-10 bg-zinc-900 rounded-lg skeleton-shimmer" />
            ))}
          </div>
        ) : logs.length > 0 ? (
          <div className="space-y-4">
            <div className="overflow-x-auto font-sans">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 font-semibold pb-2">
                    <th className="py-2.5">Date &amp; Time</th>
                    <th className="py-2.5">Provider</th>
                    <th className="py-2.5">Method</th>
                    <th className="py-2.5">Endpoint</th>
                    <th className="py-2.5">Code</th>
                    <th className="py-2.5 text-center">Cache</th>
                    <th className="py-2.5 text-right">Latency</th>
                    <th className="py-2.5 text-right">Cost</th>
                    <th className="py-2.5 text-right">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {logs.map((log) => (
                    <tr key={log._id} className="hover:bg-zinc-900/10">
                      <td className="py-3 text-zinc-500">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="py-3 font-semibold capitalize text-zinc-200">{log.provider === 'anthropic' || log.provider === 'claude' ? 'Claude' : log.provider.replace('_', ' ')}</td>
                      <td className="py-3 font-semibold text-zinc-400">{log.method}</td>
                      <td className="py-3 text-zinc-400 font-mono truncate max-w-xs">{log.endpoint}</td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          log.status === 200 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          log.cacheStatus === 'HIT' 
                            ? 'bg-cyan-500/10 text-cyan-400' 
                            : log.cacheStatus === 'MISS'
                            ? 'bg-purple-500/10 text-purple-400'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {log.cacheStatus}
                        </span>
                      </td>
                      <td className="py-3 text-right font-medium text-zinc-300">{log.responseTimeMs}ms</td>
                      <td className="py-3 text-right font-mono font-semibold text-zinc-200">
                        {log.cacheStatus === 'HIT' ? '$0.0000' : `$${log.costUsd.toFixed(4)}`}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="p-1 rounded bg-zinc-905 border border-zinc-800 text-zinc-500 hover:text-primary hover:border-primary/20 transition-all"
                        >
                          <Eye size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex justify-between items-center pt-4 border-t border-zinc-900 text-xs">
              <span className="text-zinc-500">
                Showing logs {((page - 1) * 12) + 1} - {Math.min(page * 12, totalLogs)} of {totalLogs.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 disabled:opacity-50 flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> Prev
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 disabled:opacity-50 flex items-center gap-1"
                >
                  Next <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-xs text-zinc-500">No request logs match filter parameters</p>
          </div>
        )}
      </div>

      {/* Selected Log Drawer Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl relative flex flex-col max-h-[85vh]">
            <button
              onClick={() => setSelectedLog(null)}
              className="absolute top-4 right-4 p-1 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <X size={18} />
            </button>

            <h3 className="text-sm font-bold mb-1">Transaction Diagnostics</h3>
            <p className="text-[10px] text-zinc-500 mb-4 font-mono">ID: {selectedLog._id}</p>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              {/* Header Grid */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-zinc-900/30 border border-zinc-850">
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block">Provider</span>
                  <span className="capitalize font-medium text-zinc-300">{selectedLog.provider === 'anthropic' || selectedLog.provider === 'claude' ? 'Claude' : selectedLog.provider.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block">Endpoint</span>
                  <span className="font-mono font-medium text-zinc-300">{selectedLog.endpoint}</span>
                </div>
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block">HTTP Status</span>
                  <span className="font-semibold text-zinc-300">{selectedLog.status}</span>
                </div>
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block">Caching Status</span>
                  <span className="font-semibold text-zinc-300">{selectedLog.cacheStatus}</span>
                </div>
              </div>

              {/* Request Payload */}
              {selectedLog.requestBody && (
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block mb-1">Request Payload</span>
                  <pre className="p-4 rounded-xl bg-zinc-900 border border-zinc-850 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-36">
                    {JSON.stringify(JSON.parse(selectedLog.requestBody), null, 2)}
                  </pre>
                </div>
              )}

              {/* Response Payload */}
              {selectedLog.responseBody && (
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[9px] block mb-1">Response Payload</span>
                  <pre className="p-4 rounded-xl bg-zinc-900 border border-zinc-850 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-52">
                    {JSON.stringify(JSON.parse(selectedLog.responseBody), null, 2)}
                  </pre>
                </div>
              )}

              {/* Error logs */}
              {selectedLog.errorMessage && (
                <div>
                  <span className="text-rose-400 font-semibold uppercase text-[9px] block mb-1">Exceptions Trace</span>
                  <pre className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 font-mono text-[10px] text-rose-300 overflow-x-auto">
                    {selectedLog.errorMessage}
                  </pre>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default RequestLogs;
