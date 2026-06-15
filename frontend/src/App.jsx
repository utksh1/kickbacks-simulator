import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, ShieldAlert, Cpu, CircleDollarSign, Terminal, 
  Settings, LineChart, RefreshCw, LogOut, Plus, Trash2, 
  Play, Square, AlertCircle, Ban 
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const DEFAULT_INSTANCES = [
  'https://r.utksh.in',
  'https://r1.utksh.in'
];

export default function App() {
  // Auth state
  const [password, setPassword] = useState(localStorage.getItem('dashboard_password') || '');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authChecking, setAuthChecking] = useState(false);

  // Instances list state
  const [instances, setInstances] = useState(() => {
    const saved = localStorage.getItem('dashboard_instances');
    return saved ? JSON.parse(saved) : DEFAULT_INSTANCES;
  });
  const [newUrl, setNewUrl] = useState('');

  // Dashboard state
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Selected instance for logs and individual actions
  const [selectedLogInstance, setSelectedLogInstance] = useState(instances[0] || '');

  // Config editor state
  const [configJson, setConfigJson] = useState('[]');
  const [configSaving, setConfigSaving] = useState(false);

  // Historical Revenue state
  const [revenueHistories, setRevenueHistories] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);

  // Auto-scroll ref for console logs
  const logsEndRef = useRef(null);

  // Initialize Auth Check
  useEffect(() => {
    if (password) {
      verifyPassword(password);
    } else {
      setLoading(false);
    }
  }, []);

  // Save instances to local storage
  useEffect(() => {
    localStorage.setItem('dashboard_instances', JSON.stringify(instances));
    if (instances.length > 0 && !selectedLogInstance) {
      setSelectedLogInstance(instances[0]);
    }
  }, [instances]);

  // Main polling effect
  useEffect(() => {
    if (!isAuthorized) return;

    const fetchAllStatuses = async () => {
      const results = {};
      
      await Promise.all(
        instances.map(async (url) => {
          try {
            const res = await fetch(`${url}/api/status`, {
              headers: {
                'Authorization': `Bearer ${password}`,
                'Content-Type': 'application/json'
              }
            });
            if (res.ok) {
              const data = await res.json();
              results[url] = {
                online: true,
                running: data.running,
                instanceName: data.instanceName,
                profiles: data.profiles || [],
                clients: data.clients || [],
                totals: data.totals || {},
                logs: data.logs || [],
                configProfiles: data.configProfiles || []
              };
            } else {
              results[url] = { online: false, error: `HTTP Status ${res.status}` };
            }
          } catch (err) {
            results[url] = { online: false, error: err.message };
          }
        })
      );

      setStatuses(results);
      setLoading(false);
    };

    fetchAllStatuses();
    const interval = setInterval(fetchAllStatuses, 5000);
    return () => clearInterval(interval);
  }, [isAuthorized, instances, password, refreshTrigger]);

  // Fetch Revenue History effect when tab is analytics
  useEffect(() => {
    if (!isAuthorized || activeTab !== 'analytics') return;

    const fetchRevenueHistories = async () => {
      setHistoryLoading(true);
      const histories = {};
      await Promise.all(
        instances.map(async (url) => {
          try {
            const res = await fetch(`${url}/api/revenue-history`, {
              headers: { 'Authorization': `Bearer ${password}` }
            });
            if (res.ok) {
              const data = await res.json();
              histories[url] = data;
            }
          } catch (err) {
            console.error(`Failed to fetch history for ${url}:`, err);
          }
        })
      );
      setRevenueHistories(histories);
      setHistoryLoading(false);
    };

    fetchRevenueHistories();
  }, [isAuthorized, activeTab, instances, password, refreshTrigger]);

  // Load config JSON into editor when config tab opens
  useEffect(() => {
    if (activeTab === 'config') {
      // Find the first online instance to pre-populate configuration
      const onlineInstance = Object.keys(statuses).find(url => statuses[url]?.online);
      if (onlineInstance && statuses[onlineInstance]?.configProfiles) {
        setConfigJson(JSON.stringify(statuses[onlineInstance].configProfiles, null, 2));
      }
    }
  }, [activeTab, statuses]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [statuses, selectedLogInstance]);

  // Password verification helper
  const verifyPassword = async (pass) => {
    setAuthChecking(true);
    setAuthError('');
    
    // We try to verify by making a status call to the first instance
    const testUrl = instances[0] || 'https://r.utksh.in';
    try {
      const res = await fetch(`${testUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      if (res.ok) {
        localStorage.setItem('dashboard_password', pass);
        setPassword(pass);
        setIsAuthorized(true);
      } else {
        setAuthError('Invalid dashboard password.');
      }
    } catch (err) {
      // Fallback: If network is offline or CORS issue but we have a password, let user in or log warning
      console.warn("Auth check failed:", err.message);
      // Let's assume password is OK for client logic and let the status calls fail with 401 if actually wrong
      localStorage.setItem('dashboard_password', pass);
      setPassword(pass);
      setIsAuthorized(true);
    } finally {
      setAuthChecking(false);
      setLoading(false);
    }
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    const inputPass = e.target.elements.authPassword.value;
    verifyPassword(inputPass);
  };

  const handleLogout = () => {
    localStorage.removeItem('dashboard_password');
    setPassword('');
    setIsAuthorized(false);
  };

  // Add backend URL helper
  const handleAddInstance = (e) => {
    e.preventDefault();
    if (!newUrl) return;
    let formatted = newUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    // Remove trailing slash
    if (formatted.endsWith('/')) {
      formatted = formatted.slice(0, -1);
    }
    if (!instances.includes(formatted)) {
      setInstances([...instances, formatted]);
    }
    setNewUrl('');
  };

  // Remove backend URL helper
  const handleRemoveInstance = (url) => {
    if (window.confirm(`Are you sure you want to remove instance: ${url}?`)) {
      setInstances(instances.filter(u => u !== url));
    }
  };

  // Control APIs helpers
  const startAllSimulators = async () => {
    await Promise.all(
      instances.map(async (url) => {
        try {
          await fetch(`${url}/api/start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${password}` }
          });
        } catch (err) {
          console.error(`Start failed for ${url}:`, err);
        }
      })
    );
    setRefreshTrigger(prev => prev + 1);
  };

  const stopAllSimulators = async () => {
    await Promise.all(
      instances.map(async (url) => {
        try {
          await fetch(`${url}/api/stop`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${password}` }
          });
        } catch (err) {
          console.error(`Stop failed for ${url}:`, err);
        }
      })
    );
    setRefreshTrigger(prev => prev + 1);
  };

  const startSingleSimulator = async (url) => {
    try {
      await fetch(`${url}/api/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}` }
      });
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(`Failed to start simulator on ${url}: ${err.message}`);
    }
  };

  const stopSingleSimulator = async (url) => {
    try {
      await fetch(`${url}/api/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}` }
      });
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(`Failed to stop simulator on ${url}: ${err.message}`);
    }
  };

  const clearInstanceLogs = async (url) => {
    try {
      await fetch(`${url}/api/clear-logs`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}` }
      });
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(`Failed to clear logs for ${url}: ${err.message}`);
    }
  };

  const saveConfiguration = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    try {
      const parsed = JSON.parse(configJson);
      
      // Update config on ALL online instances
      const onlineUrls = instances.filter(url => statuses[url]?.online);
      if (onlineUrls.length === 0) {
        throw new Error("No backend instances are currently online to save configuration.");
      }

      await Promise.all(
        onlineUrls.map(async (url) => {
          const res = await fetch(`${url}/api/config`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${password}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(parsed)
          });
          if (!res.ok) {
            throw new Error(`Failed to save config on ${url}`);
          }
        })
      );

      alert("Configuration updated successfully on all online instances. Simulators are restarting.");
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  // Helper: Format log message lines with colors
  const getLogClass = (message) => {
    if (message.includes('SYSTEM:')) return 'log-message system';
    if (message.includes('ERROR:')) return 'log-message error';
    if (message.includes('Auth:')) return 'log-message auth';
    if (message.includes('Tick:')) return 'log-message success';
    if (message.includes('Billing') || message.includes('Billed')) return 'log-message billing';
    return 'log-message';
  };

  // Calculations for dashboard
  const onlineCount = Object.values(statuses).filter(s => s.online).length;
  
  // Aggregate run earnings and client details
  let totalTodayRun = 0;
  let totalLifetimeRun = 0;
  let totalClientsCount = 0;
  let allClientsList = [];
  const uniqueProfiles = {};

  Object.keys(statuses).forEach(url => {
    const s = statuses[url];
    if (s && s.online) {
      totalTodayRun += parseFloat(s.totals?.earnedTodayRun || 0);
      totalLifetimeRun += parseFloat(s.totals?.earnedLifetimeRun || 0);
      
      // Clients
      const runningClients = s.clients || [];
      allClientsList = [
        ...allClientsList,
        ...runningClients.map(c => ({
          ...c,
          instanceUrl: url,
          instanceName: s.instanceName
        }))
      ];
      
      totalClientsCount += runningClients.filter(c => c.lastStatus !== 'Stopped' && c.lastStatus !== 'inactive').length;

      // Unique profiles configuration
      (s.profiles || []).forEach(p => {
        if (!uniqueProfiles[p.name] || uniqueProfiles[p.name].currentTodayUsd < p.currentTodayUsd) {
          uniqueProfiles[p.name] = p;
        }
      });
    }
  });

  const totalCurrentToday = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.currentTodayUsd, 0);
  const totalCurrentLifetime = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.currentLifetimeUsd, 0);

  // Build Analytics Chart Data
  const renderChartData = () => {
    const allTimestamps = new Set();
    const datasets = [];
    const colors = ['#a78bfa', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

    instances.forEach((url, index) => {
      const history = revenueHistories[url] || [];
      history.forEach(pt => {
        allTimestamps.add(new Date(pt.timestamp).toLocaleTimeString());
      });
    });

    const labels = Array.from(allTimestamps).sort();

    instances.forEach((url, index) => {
      const history = revenueHistories[url] || [];
      const dataMap = {};
      history.forEach(pt => {
        dataMap[new Date(pt.timestamp).toLocaleTimeString()] = parseFloat(pt.today_usd);
      });

      const dataPoints = labels.map(lbl => dataMap[lbl] || null);

      const color = colors[index % colors.length];
      datasets.push({
        label: statuses[url]?.instanceName || url,
        data: dataPoints,
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        tension: 0.3,
        spanGaps: true
      });
    });

    return {
      labels,
      datasets
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e5e7eb',
          font: { family: 'Outfit' }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
      }
    }
  };

  if (loading) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-header">
            <h1>LOADING...</h1>
            <p>Initializing connection to Render API services</p>
          </div>
          <div style={{ display: 'inline-block', width: '30px', height: '30px', border: '3px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="auth-overlay">
        <form className="auth-card" onSubmit={handleLoginSubmit}>
          <div className="auth-header">
            <h1>KICKBACKS SIMULATOR</h1>
            <p>Enter the master security password</p>
          </div>
          <div className="form-group">
            <label htmlFor="authPassword">Dashboard Password</label>
            <input 
              id="authPassword"
              name="authPassword"
              type="password" 
              className="form-input" 
              placeholder="••••••••"
              required 
            />
          </div>
          <button type="submit" className="btn-primary" disabled={authChecking}>
            {authChecking ? 'Verifying...' : 'Unlock Dashboard'}
          </button>
          {authError && <div className="auth-error">{authError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="app-header">
        <div className="app-title">
          <h1>KICKBACKS DASHBOARD</h1>
          <p>Unified headless simulator interface • {onlineCount}/{instances.length} Backends Online</p>
        </div>
        
        <div className="nav-tabs">
          <button 
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Cpu size={16} /> Dashboard
          </button>
          <button 
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <LineChart size={16} /> Analytics
          </button>
          <button 
            className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            <Settings size={16} /> Config
          </button>
          <button 
            className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Terminal size={16} /> Console Logs
          </button>
          <button 
            className="tab-btn" 
            style={{ color: 'var(--color-danger)' }}
            onClick={handleLogout}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* METRICS CARDS */}
      <section className="metrics-grid">
        <div className="metric-card success-card">
          <div className="metric-header">
            <span className="metric-title">TOTAL REVENUE (RUN)</span>
            <CircleDollarSign size={20} className="metric-icon" style={{ color: 'var(--color-success)' }} />
          </div>
          <p className="metric-value" style={{ color: 'var(--color-success)' }}>${totalTodayRun.toFixed(4)}</p>
          <p className="metric-subvalue">Today's active run earnings across instances</p>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">TOTAL REVENUE (LIFETIME)</span>
            <CircleDollarSign size={20} className="metric-icon" />
          </div>
          <p className="metric-value">${totalCurrentToday.toFixed(2)}</p>
          <p className="metric-subvalue">Real Postgres DB total: ${totalCurrentLifetime.toFixed(2)} lifetime</p>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">ACTIVE VIRTUAL CLIENTS</span>
            <Activity size={20} className="metric-icon" style={{ color: 'var(--color-secondary)' }} />
          </div>
          <p className="metric-value" style={{ color: 'var(--color-secondary)' }}>{totalClientsCount}</p>
          <p className="metric-subvalue">Total clients running: {allClientsList.length}</p>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">INSTANCES STATUS</span>
            <RefreshCw 
              size={18} 
              className="metric-icon" 
              style={{ cursor: 'pointer' }}
              onClick={() => setRefreshTrigger(p => p + 1)}
            />
          </div>
          <p className="metric-value">{onlineCount}/{instances.length}</p>
          <p className="metric-subvalue">Click refresh icon to manually poll all endpoints</p>
        </div>
      </section>

      {/* INSTANCE CHIPS AREA */}
      <section className="instance-manager-bar">
        <div className="instances-list">
          {instances.map(url => {
            const s = statuses[url];
            return (
              <div key={url} className={`instance-chip ${selectedLogInstance === url ? 'active-instance' : ''}`}>
                <span className={s?.online ? 'pulsing-active' : 'pulsing-inactive'}></span>
                <span>{s?.instanceName || url.replace('https://', '')}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {s?.online ? (s.running ? 'Running' : 'Stopped') : 'Offline'}
                </span>
                
                {s?.online && !s.running && (
                  <button 
                    onClick={() => startSingleSimulator(url)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-success)', cursor: 'pointer', padding: 2 }}
                    title="Start Simulator"
                  >
                    <Play size={12} />
                  </button>
                )}
                {s?.online && s.running && (
                  <button 
                    onClick={() => stopSingleSimulator(url)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 2 }}
                    title="Stop Simulator"
                  >
                    <Square size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="dashboard-controls">
          <button className="btn-control start-btn" onClick={startAllSimulators}>
            <Play size={14} /> Start All
          </button>
          <button className="btn-control stop-btn" onClick={stopAllSimulators}>
            <Square size={12} /> Stop All
          </button>
        </div>
      </section>

      {/* TAB CONTENT AREAS */}
      <main className="tab-content">
        
        {/* TAB 1: DASHBOARD CLIENTS TABLE */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-table-container">
            <div className="table-header-row">
              <h2>Unified Virtual Clients</h2>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Showing {allClientsList.length} clients from {instances.length} backends
              </span>
            </div>
            
            {allClientsList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <AlertCircle size={32} style={{ marginBottom: 12, color: 'var(--text-muted)' }} />
                <p>No virtual clients connected. Please verify that the simulator is running on the backend instances.</p>
              </div>
            ) : (
              <table className="client-table">
                <thead>
                  <tr>
                    <th>Backend</th>
                    <th>Client Identifier</th>
                    <th>Active Ad Title</th>
                    <th>Ticks Sent</th>
                    <th>Last Status</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {allClientsList.map((client, i) => {
                    const isBilled = client.lastStatus?.includes('Billed');
                    const isSuccess = client.lastStatus?.includes('Success');
                    const isStopped = client.lastStatus?.includes('Stopped');
                    
                    let badgeClass = 'initial';
                    if (isBilled) badgeClass = 'billing-success';
                    else if (isSuccess) badgeClass = 'success';
                    else if (isStopped) badgeClass = 'stopped';

                    return (
                      <tr key={i}>
                        <td>
                          <span className="instance-badge">{client.instanceName}</span>
                        </td>
                        <td style={{ fontWeight: '500' }}>{client.name}</td>
                        <td style={{ color: client.adTitle ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {client.adTitle || 'None fetched'}
                        </td>
                        <td style={{ fontWeight: '600' }}>{client.ticks || 0}</td>
                        <td>
                          <span className={`status-badge ${badgeClass}`}>
                            {client.lastStatus || 'Initial'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                          {client.lastTickTime || 'Never'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 2: ANALYTICS */}
        {activeTab === 'analytics' && (
          <div className="chart-card">
            <div className="chart-header">
              <h2>Historical Revenue Streams</h2>
              <p>Compare client earnings history logged in PostgreSQL over the last 24 hours</p>
            </div>
            
            {historyLoading ? (
              <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifySelf: 'center', color: 'var(--text-secondary)' }}>
                Loading graphs...
              </div>
            ) : Object.keys(revenueHistories).length === 0 ? (
              <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                <Ban size={30} style={{ marginBottom: 10, color: 'var(--text-muted)' }} />
                <p>No historical database data found.</p>
              </div>
            ) : (
              <div className="chart-container">
                <Line data={renderChartData()} options={chartOptions} />
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONFIGURATION AND INSTANCES SETTINGS */}
        {activeTab === 'config' && (
          <div className="settings-grid">
            
            {/* Instance Configuration */}
            <div className="settings-card">
              <h3>Backend Endpoints</h3>
              <div className="backend-url-list">
                {instances.map(url => (
                  <div key={url} className="backend-url-item">
                    <span>{url}</span>
                    <button 
                      className="btn-remove-url"
                      onClick={() => handleRemoveInstance(url)}
                      disabled={instances.length <= 1}
                      title="Remove Backend Url"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              
              <form onSubmit={handleAddInstance}>
                <div className="form-group">
                  <label htmlFor="newBackendUrl">Add Render Backend URL</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input 
                      id="newBackendUrl"
                      type="text" 
                      className="form-input" 
                      placeholder="https://example.onrender.com"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                    />
                    <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '12px 18px' }}>
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Profile configuration (Postgres db sync) */}
            <div className="settings-card">
              <h3>Edit Simulator Config</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '-10px', marginBottom: '16px' }}>
                Note: Both Render instances share this configuration in Postgres. Updating it will reload both simulators.
              </p>
              
              <form onSubmit={saveConfiguration}>
                <div className="form-group">
                  <textarea 
                    className="code-editor-textarea"
                    value={configJson}
                    onChange={e => setConfigJson(e.target.value)}
                    required
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={configSaving}
                  style={{ width: 'auto', display: 'flex', gap: 8, alignItems: 'center', float: 'right' }}
                >
                  <Settings size={16} />
                  {configSaving ? 'Saving...' : 'Update & Restart Simulators'}
                </button>
              </form>
            </div>

          </div>
        )}

        {/* TAB 4: CONSOLE LOGS */}
        {activeTab === 'logs' && (
          <div className="console-card">
            <div className="console-header">
              <h2>Instance Log Feeds</h2>
              
              <div className="console-controls">
                <select 
                  className="console-select"
                  value={selectedLogInstance}
                  onChange={e => setSelectedLogInstance(e.target.value)}
                >
                  {instances.map(url => (
                    <option key={url} value={url}>
                      {statuses[url]?.instanceName || url.replace('https://', '')}
                    </option>
                  ))}
                </select>

                <button 
                  className="btn-control"
                  onClick={() => clearInstanceLogs(selectedLogInstance)}
                >
                  Clear Terminal
                </button>
              </div>
            </div>

            <div className="console-body">
              {statuses[selectedLogInstance]?.logs?.length === 0 ? (
                <div className="empty-logs">No terminal logs recorded yet.</div>
              ) : (
                (statuses[selectedLogInstance]?.logs || []).map((log, idx) => (
                  <div key={idx} className="log-row">
                    <span className="log-time">[{log.time}]</span>
                    <span className={getLogClass(log.message)}>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
