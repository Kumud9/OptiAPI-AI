import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import LaserFlow from './LaserFlow';
import CTAButtons from './CTAButtons';
import dashboardPreviewImg from '../../assets/dashboard_preview.jpg';

const Hero = () => {
  const revealImgRef = useRef(null);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const el = revealImgRef.current;
    if (el) {
      el.style.setProperty('--mx', `${x}px`);
      el.style.setProperty('--my', `${y}px`);
    }
  };

  const handleMouseLeave = () => {
    const el = revealImgRef.current;
    if (el) {
      el.style.setProperty('--mx', '-9999px');
      el.style.setProperty('--my', '-9999px');
    }
  };

  return (
    <section 
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative min-h-screen flex items-center pt-24 pb-16 overflow-hidden select-none bg-[#09090b] w-full cursor-crosshair"
    >
      {/* Background grid lines */}
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.12] pointer-events-none z-0" />

      {/* LaserFlow animation spanning the background */}
      <div className="absolute inset-0 w-full h-full z-1 pointer-events-none">
        <LaserFlow
          horizontalBeamOffset={0.15}
          verticalBeamOffset={-0.4}
          horizontalSizing={1.5}
          verticalSizing={3.5}
          color="#60A5FA"
          wispDensity={1.5}
          wispSpeed={18.0}
          wispIntensity={15.0}
          fogIntensity={0.8}
        />
      </div>

      {/* Dashboard Image revealed on mouse move across the entire section background */}
      <img
        ref={revealImgRef}
        src={dashboardPreviewImg}
        alt="Live Dashboard Reveal"
        className="absolute w-full h-full object-cover top-0 left-0 pointer-events-none z-2 transition-opacity duration-350"
        style={{
          mixBlendMode: 'lighten',
          opacity: 0.45,
          '--mx': '-9999px',
          '--my': '-9999px',
          WebkitMaskImage: 'radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,1) 0px, rgba(255,255,255,0.95) 120px, rgba(255,255,255,0.6) 240px, rgba(255,255,255,0.25) 360px, rgba(255,255,255,0) 480px)',
          maskImage: 'radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,1) 0px, rgba(255,255,255,0.95) 120px, rgba(255,255,255,0.6) 240px, rgba(255,255,255,0.25) 360px, rgba(255,255,255,0) 480px)',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat'
        }}
      />

      {/* Radial overlay to dim background edges */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-zinc-950 pointer-events-none z-3" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-transparent to-zinc-950 pointer-events-none z-3" />

      {/* Content Layout */}
      <div className="max-w-7xl mx-auto px-6 w-full relative z-10">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Left / Main Column: Marketing pitch texts and call-to-actions */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="lg:col-span-8 text-center lg:text-left flex flex-col items-center lg:items-start"
          >
            {/* Headline heading */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 leading-tight text-white w-full">
              Optimize Every API Call. <br />
              <span className="text-[#3B82F6] block mt-2">
                Reduce Every Cost
              </span>
            </h1>

            {/* Pitch description */}
            <p className="text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed mb-8">
              Monitor API usage, reduce operational costs, improve response times, manage traffic intelligently, and gain real-time insights—all from one powerful platform.
            </p>

            {/* Action buttons */}
            <CTAButtons />
          </motion.div>
        </div>
      </div>

    </section>
  );
};

export default Hero;
