import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Hero from '../components/landing/Hero';
import FlowPipeline from '../components/landing/FlowPipeline';
import { 
  Zap, 
  Coins, 
  Shield, 
  Activity, 
  Database, 
  RefreshCcw, 
  TrendingDown, 
  CheckCircle,
  HelpCircle,
  Layers,
  ArrowRight,
  Sparkles,
  Check,
  Code
} from 'lucide-react';

const Landing = () => {
  const [activeProblemCard, setActiveProblemCard] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProblemCard((prev) => (prev + 1) % 3);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-background text-zinc-100 min-h-screen">
      
      {/* 1. Header/Navbar */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/70 backdrop-blur-md fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="text-primary h-6 w-6" />
            <span className="text-lg font-bold tracking-tight">OptiAPI</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-zinc-200 transition-colors">Features</a>
            <a href="#architecture" className="hover:text-zinc-200 transition-colors">Architecture</a>
            <a href="#pricing" className="hover:text-zinc-200 transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-zinc-200 transition-colors">FAQ</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
              Log In
            </Link>
            <Link to="/register" className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-dark shadow-glow-blue transition-all">
              Sign Up Free
            </Link>
          </div>
        </div>
      </header>
      {/* 2. Premium Animated Hero Section */}
      <Hero />

      {/* 3. Problem Statement & Cost Facts */}
      <section className="py-20 border-t border-zinc-900 bg-zinc-950/40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              The Secret Problem: Uncontrolled API Costs
            </h2>
            <p className="text-zinc-400">
              Modern applications consume hundreds of API endpoints. LLM tokens, geocoding maps queries, and payment webhooks run up heavy monthly invoices from duplicate requests and un-cached response payloads.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Duplicate Queries */}
            <div className={`p-8 rounded-2xl border transition-all duration-700 text-center ${
              activeProblemCard === 0
                ? 'border-rose-500/40 bg-rose-950/15 scale-[1.04] shadow-[0_0_30px_-5px_rgba(244,63,94,0.3)]'
                : 'border-zinc-900 bg-zinc-900/20 opacity-70'
            }`}>
              <Coins className={`mx-auto h-8 w-8 mb-4 transition-transform duration-700 ${activeProblemCard === 0 ? 'text-rose-400 scale-110' : 'text-rose-500/60'}`} />
              <h3 className={`text-lg font-bold mb-2 transition-colors duration-700 ${activeProblemCard === 0 ? 'text-rose-300' : 'text-zinc-200'}`}>Duplicate Queries</h3>
              <p className="text-sm text-zinc-400">
                Up to 28% of LLM queries and data fetches request identical inputs within 30 minutes, burning cash for zero value.
              </p>
            </div>

            {/* High Latency Rates */}
            <div className={`p-8 rounded-2xl border transition-all duration-700 text-center ${
              activeProblemCard === 1
                ? 'border-amber-500/40 bg-amber-950/15 scale-[1.04] shadow-[0_0_30px_-5px_rgba(245,158,11,0.3)]'
                : 'border-zinc-900 bg-zinc-900/20 opacity-70'
            }`}>
              <Activity className={`mx-auto h-8 w-8 mb-4 transition-transform duration-700 ${activeProblemCard === 1 ? 'text-amber-400 scale-110' : 'text-amber-500/60'}`} />
              <h3 className={`text-lg font-bold mb-2 transition-colors duration-700 ${activeProblemCard === 1 ? 'text-amber-300' : 'text-zinc-200'}`}>High Latency Rates</h3>
              <p className="text-sm text-zinc-400">
                Direct external integrations slow down clients due to network hops. Caching speeds response latency by up to 98%.
              </p>
            </div>

            {/* Cost Spikes */}
            <div className={`p-8 rounded-2xl border transition-all duration-700 text-center ${
              activeProblemCard === 2
                ? 'border-emerald-500/40 bg-emerald-950/15 scale-[1.04] shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]'
                : 'border-zinc-900 bg-zinc-900/20 opacity-70'
            }`}>
              <TrendingDown className={`mx-auto h-8 w-8 mb-4 transition-transform duration-700 ${activeProblemCard === 2 ? 'text-emerald-400 scale-110' : 'text-emerald-500/60'}`} />
              <h3 className={`text-lg font-bold mb-2 transition-colors duration-700 ${activeProblemCard === 2 ? 'text-emerald-300' : 'text-zinc-200'}`}>Cost Spikes</h3>
              <p className="text-sm text-zinc-400">
                Unstructured API prompts create cost unpredictability, resulting in sudden monthly billing shock.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. How It Works (Middleware Flow) */}
      <section id="how-it-works" className="py-20 border-t border-zinc-900">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              How OptiAPI Works
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Our intelligent proxy routes requests efficiently, applying layers of optimization at speed.
            </p>
          </div>

          <FlowPipeline />

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Route Request', text: 'Point your code client SDKs to the OptiAPI Gateway proxy URL.' },
              { step: '02', title: 'Cache Inspection', text: 'OptiAPI instantly checks Redis to serve cached duplicates.' },
              { step: '03', title: 'Traffic Routing', text: 'Un-cached queries route to external providers with automatic failover retries.' },
              { step: '04', title: 'Cost Analysis', text: 'Logs save to MongoDB, updating costs and compiling cash saving tips.' }
            ].map((item, index) => (
              <div key={index} className="relative p-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 glass-card">
                <span className="absolute -top-4 left-6 text-4xl font-black text-primary/10 select-none">{item.step}</span>
                <h3 className="text-lg font-bold mt-2 mb-2">{item.title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Core Features */}
      <section id="features" className="py-20 border-t border-zinc-900 bg-zinc-950/40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Engineered for High-Scale API Optimization
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              All tools required to secure, analyze, and lower API cost variables.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Database, title: 'Smart Redis Caching', text: 'Set granular cache rules for provider endpoints, keeping budgets predictable.' },
              { icon: Shield, title: 'Sliding-Window Rate Limiting', text: 'Establish requests-per-second ceilings per API Key to throttle bad actors.' },
              { icon: RefreshCcw, title: 'Auto-Retry Mechanisms', text: 'Gateway retries timed-out external provider services with backoff routines.' },
              { icon: Layers, title: 'RabbitMQ Request Queueing', text: 'Spikes queue requests to prevent downstream timeouts or API lockouts.' },
              { icon: Coins, title: 'Granular Cost Calculations', text: 'Real-time pricing analysis per provider, geocodes, and LLM input tokens.' },
              { icon: Sparkles, title: 'Optimization Center', text: 'Get tailored monthly saving tips, with one-click implementation triggers.' }
            ].map((feat, index) => {
              const Icon = feat.icon;
              return (
                <div key={index} className="p-6 rounded-2xl border border-zinc-900 bg-zinc-900/10 flex gap-4">
                  <div className="p-3 h-fit rounded-xl bg-primary/10 border border-primary/20 text-primary-light">
                    <Icon size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold mb-2">{feat.title}</h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">{feat.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. System Architecture */}
      <section id="architecture" className="py-20 border-t border-zinc-900">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              OptiAPI System Topology
            </h2>
            <p className="text-zinc-400">
              An enterprise-grade stack designed for low-latency execution and high fault tolerance.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-900/20 glass-card">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div className="p-4 rounded-xl border border-zinc-800 bg-background/50">
                <Code className="mx-auto text-cyan-400 mb-2" />
                <h4 className="text-sm font-bold">App Client</h4>
                <p className="text-[10px] text-zinc-500 mt-1">Routes queries through proxy</p>
              </div>
              <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
                <Layers className="mx-auto text-cyan-400 mb-2 animate-bounce" />
                <h4 className="text-sm font-bold">Express Gateway</h4>
                <p className="text-[10px] text-zinc-500 mt-1">Authenticates and limits</p>
              </div>
              <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5">
                <Database className="mx-auto text-purple-400 mb-2" />
                <h4 className="text-sm font-bold">Redis &amp; MQ</h4>
                <p className="text-[10px] text-zinc-500 mt-1">Caches hits &amp; queues spikes</p>
              </div>
              <div className="p-4 rounded-xl border border-zinc-800 bg-background/50">
                <Sparkles className="mx-auto text-emerald-400 mb-2" />
                <h4 className="text-sm font-bold">External APIs</h4>
                <p className="text-[10px] text-zinc-500 mt-1">OpenAI, Stripe, Google</p>
              </div>
            </div>
            <div className="mt-8 text-center text-xs text-zinc-500">
              Data is written asynchronously to MongoDB in the background, keeping request proxy overhead under 5ms.
            </div>
          </div>
        </div>
      </section>

      {/* 7. Comparison Table */}
      <section className="py-20 border-t border-zinc-900 bg-zinc-950/40">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Built Specifically for API Costs
            </h2>
            <p className="text-zinc-400">
              Traditional gateways do rate limiting. OptiAPI does cost intelligence.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse rounded-xl overflow-hidden border border-zinc-800">
              <thead>
                <tr className="bg-zinc-900/60 text-sm font-bold border-b border-zinc-800">
                  <th className="p-4">Feature</th>
                  <th className="p-4 text-zinc-400">Traditional Gateway</th>
                  <th className="p-4 text-primary-light">OptiAPI</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-zinc-800/40 bg-zinc-950/20">
                {[
                  { name: 'Sliding-window Rate Limiting', trad: true, opti: true },
                  { name: 'Hashed Payload Cache Caching', trad: false, opti: true },
                  { name: 'LLM Token Billing tracking', trad: false, opti: true },
                  { name: 'Cost Optimization Suggestions', trad: false, opti: true },
                  { name: 'RabbitMQ heavy load buffer queueing', trad: false, opti: true },
                  { name: 'Auto-retries with exponential delay', trad: true, opti: true }
                ].map((row, index) => (
                  <tr key={index}>
                    <td className="p-4 font-medium text-zinc-200">{row.name}</td>
                    <td className="p-4">
                      {row.trad ? <CheckCircle size={16} className="text-zinc-500" /> : '—'}
                    </td>
                    <td className="p-4">
                      {row.opti ? <CheckCircle size={16} className="text-primary" /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 8. Pricing Plans */}
      <section id="pricing" className="py-20 border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Flexible Plans for Every Stage
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Start optimizing your APIs today. Upgrade as your request volumes grow.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Free */}
            <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-950/20 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold">Developer</h3>
                <p className="text-xs text-zinc-500 mt-1">Perfect for hobbyists and side projects</p>
                <div className="my-6">
                  <span className="text-4xl font-extrabold">$0</span>
                  <span className="text-zinc-500 text-xs"> / month</span>
                </div>
                <ul className="space-y-3 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> 50,000 requests/mo</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> 3 Cache Rules</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Standard rate limiting</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Winston logging details</li>
                </ul>
              </div>
              <Link to="/register" className="mt-8 w-full py-3 rounded-lg text-center font-semibold border border-zinc-800 hover:bg-zinc-900/40 text-xs transition-all">
                Get Started Free
              </Link>
            </div>

            {/* Pro */}
            <div className="p-8 rounded-2xl border border-primary/40 bg-primary/5 flex flex-col justify-between relative shadow-glow-blue">
              <span className="absolute -top-3.5 right-6 px-3 py-1 rounded-full text-[10px] font-bold bg-primary text-white">RECOMMENDED</span>
              <div>
                <h3 className="text-lg font-bold">Pro Scale</h3>
                <p className="text-xs text-zinc-400 mt-1">For growing teams and active apps</p>
                <div className="my-6">
                  <span className="text-4xl font-extrabold">$49</span>
                  <span className="text-zinc-500 text-xs"> / month</span>
                </div>
                <ul className="space-y-3 text-xs text-zinc-300">
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> 2,000,000 requests/mo</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Unlimited Cache Rules</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Advanced cost calculations</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Optimization recommendations engine</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> RabbitMQ Spikes buffer</li>
                </ul>
              </div>
              <Link to="/register" className="mt-8 w-full py-3 rounded-lg text-center font-semibold bg-primary hover:bg-primary-dark text-xs transition-all shadow-glow-blue">
                Upgrade to Pro
              </Link>
            </div>

            {/* Enterprise */}
            <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-950/20 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold">Enterprise</h3>
                <p className="text-xs text-zinc-500 mt-1">For heavy loads and regulated sectors</p>
                <div className="my-6">
                  <span className="text-4xl font-extrabold">Custom</span>
                </div>
                <ul className="space-y-3 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Custom request volumes</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Dedicated Redis cache servers</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> Custom data residency (SLA)</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-primary" /> 24/7 engineering support</li>
                </ul>
              </div>
              <Link to="/register" className="mt-8 w-full py-3 rounded-lg text-center font-semibold border border-zinc-800 hover:bg-zinc-900/40 text-xs transition-all">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 9. Testimonials */}
      <section className="py-20 border-t border-zinc-900 bg-zinc-950/40">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Saved Thousands of Dollars
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 rounded-2xl border border-zinc-900 bg-zinc-900/20">
              <p className="text-sm text-zinc-300 italic mb-4">
                "Our OpenAI token bills were spinning out of control. By placing OptiAPI in front, our API cost dropped by 42% on day one due to payload hashing cache hits."
              </p>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center font-bold text-xs text-white">AR</div>
                <div>
                  <h4 className="text-xs font-bold">Alex Rivera</h4>
                  <p className="text-[10px] text-zinc-500">CTO, NeuroStack</p>
                </div>
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-zinc-900 bg-zinc-900/20">
              <p className="text-sm text-zinc-300 italic mb-4">
                "OptiAPI's auto-retry and RabbitMQ buffer saved our customer checkout flows during Stripe webhook spikes. A must-have for critical service scaling."
              </p>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-purple-600 flex items-center justify-center font-bold text-xs text-white">MK</div>
                <div>
                  <h4 className="text-xs font-bold">Maya K.</h4>
                  <p className="text-[10px] text-zinc-500">Lead Architect, CartPulse</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. FAQ */}
      <section id="faq" className="py-20 border-t border-zinc-900">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-4 flex items-center justify-center gap-3">
              <HelpCircle className="text-primary" /> Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-6">
            {[
              { q: 'Is there any request delay using OptiAPI?', a: 'OptiAPI is designed for microsecond execution. Cache hits return in ~2ms. Cache misses add less than 5ms of routing overhead.' },
              { q: 'Where are my stored credentials saved?', a: 'All external key credentials are encrypted and stored inside secure vaults in our MongoDB cluster. They are never returned in plain text to client dashboards.' },
              { q: 'How does the auto-retry backoff function?', a: 'If an external service fails, OptiAPI automatically retries it up to 3 times, delaying execution with binary exponential backoff to reduce provider load.' }
            ].map((faq, index) => (
              <div key={index} className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-900/20">
                <h4 className="text-sm font-bold text-zinc-200 mb-2">{faq.q}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 11. Footer */}
      <footer className="border-t border-zinc-900 py-12 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Zap className="text-primary h-5 w-5" />
            <span className="text-sm font-bold tracking-tight">OptiAPI</span>
          </div>
          <div className="text-xs text-zinc-500">
            &copy; 2026 OptiAPI Inc. All rights reserved.
          </div>
          <div className="flex gap-6 text-xs text-zinc-500">
            <a href="#" className="hover:text-zinc-400">Terms</a>
            <a href="#" className="hover:text-zinc-400">Privacy</a>
            <a href="#" className="hover:text-zinc-400">Status</a>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;
