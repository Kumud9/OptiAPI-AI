import React, { useRef, useEffect } from 'react';

const NetworkGraph = () => {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: null, y: null, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let animationFrameId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    // Particle Colors matching states
    const COLORS = {
      request: '#3B82F6',   // Blue
      cacheHit: '#10B981',  // Green
      queue: '#8B5CF6',     // Purple
      fail: '#EF4444'       // Red
    };

    const colorKeys = Object.keys(COLORS);

    // Node class representing system servers/routers
    class Node {
      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.baseX = this.x;
        this.baseY = this.y;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 3 + 2;
        this.type = colorKeys[Math.floor(Math.random() * colorKeys.length)];
        this.color = COLORS[this.type];
        this.pulse = Math.random() * Math.PI;
      }

      update(mouse) {
        // Handle float velocities
        this.x += this.vx;
        this.y += this.vy;

        // Bounce walls
        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;

        // Mouse Parallax attraction
        if (mouse.active && mouse.x !== null && mouse.y !== null) {
          const dx = mouse.x - this.x;
          const dy = mouse.y - this.y;
          const dist = Math.hypot(dx, dy);
          const limit = 150;

          if (dist < limit) {
            // Push or pull slightly based on proximity
            const force = (limit - dist) / limit * 0.4;
            this.x -= (dx / dist) * force;
            this.y -= (dy / dist) * force;
          }
        }

        this.pulse += 0.02;
      }

      draw() {
        const pulseRadius = this.radius + Math.sin(this.pulse) * 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      }
    }

    // Packet representing moving API traffic requests
    class Packet {
      constructor(startNode, endNode) {
        this.start = startNode;
        this.end = endNode;
        this.progress = 0;
        this.speed = Math.random() * 0.01 + 0.005;
        this.color = startNode.color;
        this.size = Math.random() * 2 + 1.5;
      }

      update() {
        this.progress += this.speed;
        return this.progress >= 1;
      }

      draw() {
        const x = this.start.x + (this.end.x - this.start.x) * this.progress;
        const y = this.start.y + (this.end.y - this.start.y) * this.progress;
        ctx.beginPath();
        ctx.arc(x, y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // Generate graph nodes
    const nodeCount = Math.min(60, Math.floor((width * height) / 15000));
    const nodes = Array.from({ length: nodeCount }, () => new Node());
    let packets = [];

    // Trigger packets flow between connected nodes
    const triggerPacketFlow = () => {
      if (nodes.length < 2) return;
      // Select random pairs of close nodes
      const start = nodes[Math.floor(Math.random() * nodes.length)];
      
      // Find a close node
      const targets = nodes.filter(n => n !== start && Math.hypot(n.x - start.x, n.y - start.y) < 180);
      if (targets.length > 0) {
        const end = targets[Math.floor(Math.random() * targets.length)];
        packets.push(new Packet(start, end));
      }
    };

    // Resize handler
    const handleResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };

    window.addEventListener('resize', handleResize);

    // Mouse events
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Main Canvas Render Loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Randomly spawn packages representing API queries
      if (Math.random() < 0.08) {
        triggerPacketFlow();
      }

      // 1. Draw connecting mesh lines
      ctx.lineWidth = 0.5;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.hypot(dx, dy);
          const limit = 160;

          if (dist < limit) {
            const alpha = (limit - dist) / limit * 0.12;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.stroke();
          }
        }
      }

      // 2. Update and draw nodes
      nodes.forEach(node => {
        node.update(mouseRef.current);
        node.draw();
      });

      // 3. Update and draw packet flows
      packets = packets.filter(p => {
        const completed = p.update();
        p.draw();
        return !completed;
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-auto"
      style={{ mixBlendMode: 'screen' }}
    />
  );
};

export default NetworkGraph;
