#!/usr/bin/env bash

# Kickbacks Simulator - Complete Local Fleet Startup Script
# Starts 4 Backends (ports 3001-3004) and 1 Frontend Dashboard (port 5173)

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================"
echo "🚀 Starting Kickbacks Distributed Simulator Fleet..."
echo "========================================================"

# Make log directory
mkdir -p "$DIR/logs"

# Function to stop existing processes on target ports
cleanup_port() {
  local port=$1
  local pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "⚠️  Cleaning up old process on port $port (PID: $pid)..."
    kill -9 $pid 2>/dev/null || true
  fi
}

echo "1. Checking and cleaning existing ports..."
cleanup_port 3001
cleanup_port 3002
cleanup_port 3003
cleanup_port 3004
cleanup_port 5173

echo "2. Starting 4 local backend instances..."
PORT=3001 INSTANCE_NAME=instance_1 TOTAL_INSTANCES=4 node "$DIR/backend/server.js" > "$DIR/logs/backend_1.log" 2>&1 &
echo "   -> [Backend 1] instance_1 started on http://localhost:3001 (PID: $!)"

PORT=3002 INSTANCE_NAME=instance_2 TOTAL_INSTANCES=4 node "$DIR/backend/server.js" > "$DIR/logs/backend_2.log" 2>&1 &
echo "   -> [Backend 2] instance_2 started on http://localhost:3002 (PID: $!)"

PORT=3003 INSTANCE_NAME=instance_3 TOTAL_INSTANCES=4 node "$DIR/backend/server.js" > "$DIR/logs/backend_3.log" 2>&1 &
echo "   -> [Backend 3] instance_3 started on http://localhost:3003 (PID: $!)"

PORT=3004 INSTANCE_NAME=instance_4 TOTAL_INSTANCES=4 node "$DIR/backend/server.js" > "$DIR/logs/backend_4.log" 2>&1 &
echo "   -> [Backend 4] instance_4 started on http://localhost:3004 (PID: $!)"

echo "3. Starting React Frontend Dashboard..."
npm run dev --prefix "$DIR/frontend" > "$DIR/logs/frontend.log" 2>&1 &
echo "   -> [Frontend] Dashboard started on http://localhost:5173 (PID: $!)"

echo ""
echo "========================================================"
echo "✨ Fleet is live and running!"
echo "   - Dashboard: http://localhost:5173"
echo "   - Backend 1: http://localhost:3001"
echo "   - Backend 2: http://localhost:3002"
echo "   - Backend 3: http://localhost:3003"
echo "   - Backend 4: http://localhost:3004"
echo "========================================================"
