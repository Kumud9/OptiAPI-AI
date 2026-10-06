const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');
const net = require('net');

const ROOT_DIR = __dirname;
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

// Helper to log with custom colors
const log = (prefix, message, colorCode = '32') => {
  console.log(`\x1b[${colorCode}m[${prefix}]\x1b[0m ${message}`);
};

const logError = (prefix, message) => {
  console.error(`\x1b[31m[${prefix} ERROR]\x1b[0m ${message}`);
};

// Check if a port is in use
const isPortInUse = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
};

// Poll a port until it is open
const waitForPort = (port, serviceName, timeoutMs = 45000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    log('System', `Waiting for ${serviceName} (port ${port}) to accept connections...`);
    
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        log('System', `${serviceName} is ready!`);
        resolve(true);
      });
      
      const retry = () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for ${serviceName} on port ${port}`));
        } else {
          setTimeout(check, 1500);
        }
      };
      
      socket.on('error', retry);
      socket.on('timeout', retry);
      socket.connect(port, '127.0.0.1');
    };
    
    check();
  });
};

async function main() {
  console.log('\x1b[35m================================================================\x1b[0m');
  console.log('\x1b[35m              OptiAPI AI Platform Startup Coordinator            \x1b[0m');
  console.log('\x1b[35m================================================================\x1b[0m\n');

  // 1. Check or Create Environment Variables
  const envPath = path.join(BACKEND_DIR, '.env');
  const envExamplePath = path.join(BACKEND_DIR, '.env.example');
  
  if (!fs.existsSync(envPath)) {
    log('System', '.env file missing in backend directory. Creating default .env...');
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      log('System', 'Created backend/.env from backend/.env.example.');
    } else {
      const defaultEnv = `PORT=5000\nMONGODB_URI=mongodb://localhost:27017/optiapi\nREDIS_URL=redis://localhost:6379\nRABBITMQ_URL=amqp://localhost:5672\nJWT_SECRET=optiapi_secret_key_for_jwt_tokens_2026_secure\nNODE_ENV=development\n`;
      fs.writeFileSync(envPath, defaultEnv);
      log('System', 'Created backend/.env with safe default values.');
    }
  }

  // 2. Verify Node Modules (Dependencies)
  const rootModules = path.join(ROOT_DIR, 'node_modules');
  const backendModules = path.join(BACKEND_DIR, 'node_modules');
  const frontendModules = path.join(FRONTEND_DIR, 'node_modules');

  if (!fs.existsSync(rootModules) || !fs.existsSync(backendModules) || !fs.existsSync(frontendModules)) {
    log('System', 'One or more node_modules folders are missing. Installing dependencies...', '33');
    try {
      if (!fs.existsSync(rootModules)) {
        log('System', 'Installing root orchestrator packages...');
        execSync('npm install', { stdio: 'inherit', cwd: ROOT_DIR });
      }
      log('System', 'Running sub-project installers (frontend & backend)...');
      execSync('npm run setup', { stdio: 'inherit', cwd: ROOT_DIR });
      log('System', 'All dependencies successfully installed!');
    } catch (err) {
      logError('System', `Failed to install dependencies: ${err.message}`);
      process.exit(1);
    }
  }

  // 3. Port Conflict Pre-checks
  log('System', 'Performing pre-flight port availability checks...');
  const backendPortInUse = await isPortInUse(5000);
  let frontendPort = 5173;
  let frontendPortInUse = await isPortInUse(5173);

  if (backendPortInUse) {
    logError('Pre-flight', 'Port 5000 (Backend API Server) is already in use.');
    console.log('Please terminate the process running on port 5000 or update the PORT in backend/.env.');
    process.exit(1);
  }
  if (frontendPortInUse) {
    log('Pre-flight', 'Port 5173 is currently occupied by another service. Checking fallback port 5174...', '33');
    const port5174InUse = await isPortInUse(5174);
    if (!port5174InUse) {
      frontendPort = 5174;
      log('Pre-flight', 'Port 5174 is available! Setting frontend port to 5174.', '32');
    } else {
      logError('Pre-flight', 'Both ports 5173 and 5174 are already in use.');
      console.log('Please terminate conflicting processes.');
      process.exit(1);
    }
  } else {
    log('System', 'Ports 5000 and 5173 are free. Proceeding...');
  }

  // 4. Spin up Docker Services
  log('System', 'Launching Docker containers for MongoDB, Redis, and RabbitMQ...');
  let dockerStarted = false;
  
  try {
    execSync('docker compose up -d mongodb redis rabbitmq', { stdio: 'pipe', cwd: ROOT_DIR });
    dockerStarted = true;
  } catch (err1) {
    try {
      execSync('docker-compose up -d mongodb redis rabbitmq', { stdio: 'pipe', cwd: ROOT_DIR });
      dockerStarted = true;
    } catch (err2) {
      logError('Docker', 'Failed to execute Docker Compose.');
      console.log('\x1b[31m[ERROR] Docker Desktop is not running or Docker is not installed on your system.\x1b[0m');
      console.log('Please follow these steps:');
      console.log('  1. Install Docker Desktop if needed: https://www.docker.com/products/docker-desktop/');
      console.log('  2. Launch Docker Desktop and wait until the Docker Engine is running.');
      console.log('  3. Re-run "npm start".');
      console.log('\n-------------------------------------------------------------');
      console.log('Note: If you run the app without Docker, it will attempt to use');
      console.log('in-memory fallbacks, but database records will not persist.');
      console.log('-------------------------------------------------------------\n');
      process.exit(1);
    }
  }

  if (dockerStarted) {
    log('System', 'Docker compose command executed successfully.');
  }

  // 5. Poll Ports for Health
  try {
    await waitForPort(27017, 'MongoDB Database');
    await waitForPort(6379, 'Redis Cache');
    await waitForPort(5672, 'RabbitMQ Message Broker');
  } catch (timeoutErr) {
    logError('Infrastructure', timeoutErr.message);
    console.log('Please check your running containers by typing: docker ps');
    process.exit(1);
  }

  // 6. Run Seeding Script
  log('System', 'Checking database seed status...');
  try {
    execSync('npm run seed', { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (seedErr) {
    logError('Database Seeding', `Seed script failed: ${seedErr.message}`);
    // Non-blocking, attempt to continue startup anyway
  }

  // 7. Start Frontend & Backend Concurrently
  log('System', 'Starting Express API and Vite Dev Servers concurrently...\n');

  const runLocalService = (command, args, prefix, colorCode) => {
    const child = spawn(command, args, { shell: true, cwd: ROOT_DIR });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`\x1b[${colorCode}m[${prefix}]\x1b[0m ${line.trim()}`);
        }
      });
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.error(`\x1b[${colorCode}m[${prefix}]\x1b[0m \x1b[31m${line.trim()}\x1b[0m`);
        }
      });
    });

    child.on('close', (code) => {
      log(prefix, `Process exited with code ${code}`, '31');
    });

    return child;
  };

  const backendProc = runLocalService('npm', ['run', 'backend'], 'Backend', '34');
  const frontendArgs = frontendPort === 5173
    ? ['run', 'frontend']
    : ['run', 'frontend', '--', '--port', String(frontendPort)];
  const frontendProc = runLocalService('npm', frontendArgs, 'Frontend', '36');

  // Let servers initialize a bit before printing final access block
  setTimeout(() => {
    console.log('\n\x1b[32m================================================================');
    console.log('🚀 OPTIAPI AI SERVICES ARE RUNNING SUCCESSFULLY');
    console.log('================================================================\x1b[0m');
    console.log(`  \x1b[1mFrontend Console\x1b[0m:        http://localhost:${frontendPort}`);
    console.log('  \x1b[1mBackend API Server\x1b[0m:      http://localhost:5000');
    console.log('  \x1b[1mRabbitMQ Dashboard\x1b[0m:      http://localhost:15672 (guest/guest)');
    console.log('\x1b[32m================================================================\x1b[0m');
    console.log('  \x1b[1mDemo User Profile:\x1b[0m');
    console.log('  Username: \x1b[33mdemo@optiapi.com\x1b[0m');
    console.log('  Password: \x1b[33mpassword123\x1b[0m');
    console.log('\x1b[32m================================================================\x1b[0m\n');
  }, 3500);

  // Clean shutdown handlers
  process.on('SIGINT', () => {
    log('System', 'Shutting down services...');
    backendProc.kill();
    frontendProc.kill();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('System', 'Shutting down services...');
    backendProc.kill();
    frontendProc.kill();
    process.exit(0);
  });
}

main().catch(err => {
  logError('System', `Fatal script crash: ${err.message}`);
  process.exit(1);
});
