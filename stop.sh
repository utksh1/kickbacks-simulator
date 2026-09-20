#!/usr/bin/env bash

# Kickbacks Simulator - Fleet Shutdown Script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "========================================================"
echo "🛑 Stopping Kickbacks Distributed Simulator Fleet..."
echo "========================================================"

cleanup_port() {
  local port=$1
  local pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "   -> Stopping process on port $port (PID: $pid)..."
    kill -9 $pid 2>/dev/null || true
  fi
}

for p in $(seq 3001 3010); do
  cleanup_port $p
done
cleanup_port 5174

# Kill any leftover node simulator and server processes
pkill -9 -f "simulator.js" 2>/dev/null || true
pkill -9 -f "server.js" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true

echo "========================================================"
echo "✅ Backend instance(s) and dashboard stopped successfully."
echo "========================================================"
