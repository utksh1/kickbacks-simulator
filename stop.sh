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

cleanup_port 3001
cleanup_port 3002
cleanup_port 3003
cleanup_port 3004
cleanup_port 5173

# Kill any leftover node simulator processes
pkill -f "node.*simulator.js" 2>/dev/null || true

echo "========================================================"
echo "✅ All instances and dashboard stopped successfully."
echo "========================================================"
