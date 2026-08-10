import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import AnimatedBackground from './AnimatedBackground';
import DashboardPreview from './DashboardPreview';
import CTAButtons from './CTAButtons';
import StrokeText from '../StrokeText';

const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center pt-24 pb-16 overflow-hidden select-none">
      
      {/* 1. Canvas Network Graph and Glowing Grid Background */}
      <AnimatedBackground />

      {/* 2. Central Content Grid Layout */}
      <div className="max-w-7xl mx-auto px-6 w-full relative z-10 grid lg:grid-cols-12 gap-12 items-center">
        
        {/* Left: Marketing pitch texts and call-to-actions */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="lg:col-span-7 text-center lg:text-left flex flex-col items-center lg:items-start"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border border-primary/30 bg-primary/10 text-primary-light mb-6">
            <Sparkles size={12} className="animate-pulse" /> 🚀 AI-Powered API Intelligence Platform
          </div>

          {/* Headline heading */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 leading-tight text-white w-full">
            Optimize Every API Call. <br />
            <StrokeText
              text="Reduce Every Cost"
              strokeColor="#a62828"
              fillColor="#d6e7e9"
              strokeWidth={1.5}
              drawDuration={1.5}
              fillDelay={0.15}
              stagger={0.05}
              trigger="mount"
              fillMode="wipe"
              fontSize={68}
              fontWeight={800}
              letterSpacing={-2}
              className="mt-2 block"
            />
          </h1>

          {/* Pitch description */}
          <p className="text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed mb-8">
            Monitor API usage, reduce operational costs, improve response times, manage traffic intelligently, and gain real-time insights—all from one powerful platform.
          </p>

          {/* Action buttons */}
          <CTAButtons />
        </motion.div>

        {/* Right: Floating Dashboard Card Preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className="lg:col-span-5 flex justify-center w-full"
        >
          <DashboardPreview />
        </motion.div>

      </div>

    </section>
  );
};

export default Hero;
