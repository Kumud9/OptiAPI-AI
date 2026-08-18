import React, { useState, useEffect } from 'react';
import { Play, Pause, RefreshCw, Layers, Database, Globe, HardDrive, Smartphone } from 'lucide-react';

const FlowPipeline = () => {
  const [isHitCycle, setIsHitCycle] = useState(true);
  const [step, setStep] = useState(0); // 0: Idle, 1: Request, 2: Cache Check, 3: Action (Hit Return / Miss Fetch), 4: DB Log & Client Response

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => {
        if (prev === 4) {
          // Toggle cycle type on loop
          setIsHitCycle((h) => !h);
          return 0;
        }
        return prev + 1;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto mb-16 p-8 rounded-2xl border border-zinc-900 bg-zinc-950/30 backdrop-blur-sm relative overflow-hidden select-none">
      
      {/* Decorative background grid and glow */}
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.03] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      {/* Cycle Indicator Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full animate-ping ${isHitCycle ? 'bg-emerald-500' : 'bg-blue-500'}`} />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
          Current Demo: {isHitCycle ? 'Cache Hit Flow (Fast)' : 'Cache Miss / Proxy Route'}
        </span>
      </div>

      {/* Diagram SVG Container */}
      <div className="relative w-full h-[320px] flex items-center justify-center mt-6">
        <svg className="w-full h-full" viewBox="0 0 800 240" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* DEFINITIONS FOR GRADIENTS AND GLOWS */}
          <defs>
            <linearGradient id="glow-hit" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="glow-miss" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.8" />
            </linearGradient>
            <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* STATIC CONNECTION PIPELINES */}
          {/* Client to Gateway */}
          <path d="M 120 120 L 280 120" stroke="#27272a" strokeWidth="3" strokeDasharray="6 4" />
          
          {/* Gateway to Redis (downwards) */}
          <path d="M 330 150 L 330 200" stroke="#27272a" strokeWidth="3" strokeDasharray="6 4" />
          
          {/* Gateway to Provider */}
          <path d="M 380 120 L 580 120" stroke="#27272a" strokeWidth="3" strokeDasharray="6 4" />
          
          {/* Provider to DB (downwards) */}
          <path d="M 630 150 L 630 200" stroke="#27272a" strokeWidth="3" strokeDasharray="6 4" />


          {/* ANIMATED PULSES ALONG PIPELINES */}
          
          {/* 1. Request Stage (Step 1) */}
          {step === 1 && (
            <circle cx="120" cy="120" r="5" fill="#3B82F6" filter="url(#glow-filter)">
              <animate attributeName="cx" from="120" to="280" dur="1s" repeatCount="indefinite" />
            </circle>
          )}

          {/* 2. Cache Inspection Stage (Step 2) */}
          {step === 2 && (
            <circle cx="330" cy="120" r="5" fill="#a855f7" filter="url(#glow-filter)">
              <animate attributeName="cy" from="120" to="200" dur="0.8s" repeatCount="indefinite" />
            </circle>
          )}

          {/* 3. Action Stage (Step 3) */}
          {step === 3 && (
            <>
              {isHitCycle ? (
                /* Hit Return Path (Redis -> Gateway -> Client) */
                <circle cx="330" cy="200" r="5" fill="#10B981" filter="url(#glow-filter)">
                  <animate attributeName="cy" from="200" to="120" dur="0.8s" repeatCount="1" fill="freeze" />
                </circle>
              ) : (
                /* Miss Route Path (Gateway -> External API) */
                <circle cx="380" cy="120" r="5" fill="#3B82F6" filter="url(#glow-filter)">
                  <animate attributeName="cx" from="380" to="580" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
            </>
          )}

          {/* 4. Complete / Log Stage (Step 4) */}
          {step === 4 && (
            <>
              {isHitCycle ? (
                /* Green response returning to client app */
                <circle cx="280" cy="120" r="5" fill="#10B981" filter="url(#glow-filter)">
                  <animate attributeName="cx" from="280" to="120" dur="0.8s" repeatCount="indefinite" />
                </circle>
              ) : (
                /* Response return + Async DB logging */
                <>
                  {/* External API Response back to Gateway */}
                  <circle cx="580" cy="120" r="5" fill="#3B82F6" filter="url(#glow-filter)">
                    <animate attributeName="cx" from="580" to="380" dur="0.8s" repeatCount="1" fill="freeze" />
                  </circle>
                  {/* Async write to MongoDB log */}
                  <circle cx="630" cy="120" r="5" fill="#ec4899" filter="url(#glow-filter)">
                    <animate attributeName="cy" from="120" to="200" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                  {/* Final delivery to Client */}
                  <circle cx="280" cy="120" r="5" fill="#3B82F6" filter="url(#glow-filter)">
                    <animate attributeName="cx" from="280" to="120" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
            </>
          )}


          {/* LABELS & NODES */}
          
          {/* Node 1: Client App */}
          <g transform="translate(60, 90)">
            <rect x="0" y="0" width="120" height="60" rx="10" fill="#09090b" stroke={step === 1 ? '#3B82F6' : '#27272a'} strokeWidth="1.5" />
            <text x="60" y="35" fill="#e4e4e7" fontSize="11" fontWeight="bold" textAnchor="middle">Client App</text>
            <text x="60" y="48" fill="#52525b" fontSize="8" textAnchor="middle">Initiates Request</text>
          </g>

          {/* Node 2: OptiAPI Gateway */}
          <g transform="translate(270, 90)">
            <rect x="0" y="0" width="120" height="60" rx="10" fill="#09090b" stroke={step === 2 ? '#a855f7' : '#27272a'} strokeWidth="1.5" />
            <text x="60" y="35" fill="#e4e4e7" fontSize="11" fontWeight="bold" textAnchor="middle">OptiAPI Gateway</text>
            <text x="60" y="48" fill="#a855f7" fontSize="8" textAnchor="middle">Auth &amp; Rate Limit</text>
          </g>

          {/* Node 3: Redis Cache */}
          <g transform="translate(270, 185)">
            <rect x="0" y="0" width="120" height="45" rx="8" fill="#09090b" stroke={step === 2 || (step === 3 && isHitCycle) ? '#10B981' : '#27272a'} strokeWidth="1.5" />
            <text x="60" y="24" fill="#e4e4e7" fontSize="10" fontWeight="bold" textAnchor="middle">Redis Cache</text>
            <text x="60" y="35" fill="#10B981" fontSize="7" textAnchor="middle">Fast Memory Lookup</text>
          </g>

          {/* Node 4: External API */}
          <g transform="translate(570, 90)">
            <rect x="0" y="0" width="120" height="60" rx="10" fill="#09090b" stroke={step === 3 && !isHitCycle ? '#3B82F6' : '#27272a'} strokeWidth="1.5" />
            <text x="60" y="35" fill="#e4e4e7" fontSize="11" fontWeight="bold" textAnchor="middle">External APIs</text>
            <text x="60" y="48" fill="#52525b" fontSize="8" textAnchor="middle">OpenAI, Stripe, etc.</text>
          </g>

          {/* Node 5: MongoDB Log Vault */}
          <g transform="translate(570, 185)">
            <rect x="0" y="0" width="120" height="45" rx="8" fill="#09090b" stroke={step === 4 && !isHitCycle ? '#ec4899' : '#27272a'} strokeWidth="1.5" />
            <text x="60" y="24" fill="#e4e4e7" fontSize="10" fontWeight="bold" textAnchor="middle">MongoDB Vault</text>
            <text x="60" y="35" fill="#ec4899" fontSize="7" textAnchor="middle">Async Billing Logs</text>
          </g>
        </svg>
      </div>

      {/* Process Phase Description Text Box */}
      <div className="mt-4 p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/40 text-center min-h-[60px] flex items-center justify-center">
        <p className="text-xs text-zinc-300 transition-all duration-300 font-mono">
          {step === 0 && "Pipeline idle. Awaiting client application execution request..."}
          {step === 1 && "Phase 1: App routes client API credentials and payload through OptiAPI proxy endpoint."}
          {step === 2 && "Phase 2: Gateway validates credentials, increments sliding-window rate limit, and inspects Redis cache memory."}
          {step === 3 && (isHitCycle 
            ? "Phase 3 (CACHE HIT): Identical payload request matching Redis record. Returning cached data payload." 
            : "Phase 3 (CACHE MISS): Unique payload. Gateway routes request directly to external provider with timeout failovers.")}
          {step === 4 && (isHitCycle 
            ? "Phase 4: Response dispatched back to client app in 2ms. Optimization count incremented (0 cost incurred)." 
            : "Phase 4: External response returned, dispatched to client, and logged asynchronously to MongoDB to compile cost analytics.")}
        </p>
      </div>
      
    </div>
  );
};

export default FlowPipeline;
