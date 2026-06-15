import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, ShieldAlert, Cpu, CircleDollarSign, Terminal,
  Settings, LineChart, RefreshCw, LogOut, Plus, Trash2,
  Play, Square, AlertCircle, Ban, Server, Compass, Sparkles
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

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

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'analytics', label: 'Analytics', icon: LineChart },
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'logs', label: 'Logs', icon: Terminal }
];

const TAB_TITLES = {
  dashboard: 'Fleet command',
  analytics: 'Revenue trace',
  config: 'Control settings',
  logs: 'Live terminal'
};

export default function App() {
  const [password, setPassword] = useState(localStorage.getItem('dashboard_password') || '');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authChecking, setAuthChecking] = useState(false);

  const [instances, setInstances] = useState(() => {
    const saved = localStorage.getItem('dashboard_instances');
    return saved ? JSON.parse(saved) : DEFAULT_INSTANCES;
  });
  const [newUrl, setNewUrl] = useState('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [selectedLogInstance, setSelectedLogInstance] = useState(instances[0] || '');
  const [configJson, setConfigJson] = useState('[]');
  const [configSaving, setConfigSaving] = useState(false);

  const [revenueHistories, setRevenueHistories] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);

  const logsEndRef = useRef(null);

  // Initial Auth Check
  useEffect(() => {
    if (password) {
      verifyPassword(password);
    } else {
      setLoading(false);
    }
  }, []);

  // Save instances list
  useEffect(() => {
    localStorage.setItem('dashboard_instances', JSON.stringify(instances));
    if (instances.length > 0 && !selectedLogInstance) {
      setSelectedLogInstance(instances[0]);
    }
  }, [instances]);

  // Status Polling Loop
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
              results[url] = { online: false, error: `HTTP ${res.status}` };
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

  // Fetch histories when Analytics tab is selected
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

  // Load config JSON into configurator
  useEffect(() => {
    if (activeTab === 'config') {
      const onlineInstance = Object.keys(statuses).find(url => statuses[url]?.online);
      if (onlineInstance && statuses[onlineInstance]?.configProfiles) {
        setConfigJson(JSON.stringify(statuses[onlineInstance].configProfiles, null, 2));
      }
    }
  }, [activeTab, statuses]);

  // Auto-scroll log console
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [statuses, selectedLogInstance]);

  const verifyPassword = async (pass) => {
    setAuthChecking(true);
    setAuthError('');
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
        setAuthError('Invalid master password.');
      }
    } catch (err) {
      console.warn("Auth check failed:", err.message);
      // Fallback in case of CORS / offline
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

  const handleAddInstance = (e) => {
    e.preventDefault();
    if (!newUrl) return;
    let formatted = newUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    if (formatted.endsWith('/')) {
      formatted = formatted.slice(0, -1);
    }
    if (!instances.includes(formatted)) {
      setInstances([...instances, formatted]);
    }
    setNewUrl('');
  };

  const handleRemoveInstance = (url) => {
    if (window.confirm(`Are you sure you want to remove instance: ${url}?`)) {
      setInstances(instances.filter(u => u !== url));
    }
  };

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
      alert(`Failed to start simulator: ${err.message}`);
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
      alert(`Failed to stop simulator: ${err.message}`);
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
      alert(`Failed to clear logs: ${err.message}`);
    }
  };

  const saveConfiguration = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    try {
      const parsed = JSON.parse(configJson);
      const onlineUrls = instances.filter(url => statuses[url]?.online);
      if (onlineUrls.length === 0) {
        throw new Error("No backend instances are online to save config.");
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

      alert("Configuration updated successfully. Simulators are restarting.");
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  // Log level message styling
  const getLogClass = (message) => {
    if (message.includes('SYSTEM:')) return 'console-msg system';
    if (message.includes('ERROR:')) return 'console-msg error';
    if (message.includes('Auth:')) return 'console-msg auth';
    if (message.includes('Tick:')) return 'console-msg success';
    if (message.includes('Billing') || message.includes('Billed')) return 'console-msg billing';
    return 'console-msg';
  };

  // Aggregate Metrics Calculations
  const onlineCount = Object.values(statuses).filter(s => s.online).length;
  const runningBackends = Object.values(statuses).filter(s => s.online && s.running).length;
  let totalTodayRun = 0;
  let totalClientsCount = 0;
  let allClientsList = [];
  const uniqueProfiles = {};

  Object.keys(statuses).forEach(url => {
    const s = statuses[url];
    if (s && s.online) {
      totalTodayRun += parseFloat(s.totals?.earnedTodayRun || 0);
      
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

      (s.profiles || []).forEach(p => {
        if (!uniqueProfiles[p.name] || uniqueProfiles[p.name].currentTodayUsd < p.currentTodayUsd) {
          uniqueProfiles[p.name] = p;
        }
      });
    }
  });

  const totalCurrentToday = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.currentTodayUsd, 0);
  const activeTitle = TAB_TITLES[activeTab] || 'Dashboard';

  // Line Chart Data
  const renderChartData = () => {
    const allTimestamps = new Set();
    const datasets = [];
    const colors = ['#0066cc', '#2997ff', '#10b981', '#333333']; // Apple theme colors

    instances.forEach((url) => {
      const history = revenueHistories[url] || [];
      history.forEach(pt => {
        allTimestamps.add(new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      });
    });

    const labels = Array.from(allTimestamps).sort();

    instances.forEach((url, index) => {
      const history = revenueHistories[url] || [];
      const dataMap = {};
      history.forEach(pt => {
        dataMap[new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] = parseFloat(pt.today_usd);
      });

      const dataPoints = labels.map(lbl => dataMap[lbl] !== undefined ? dataMap[lbl] : null);
      const color = colors[index % colors.length];
      
      datasets.push({
        label: statuses[url]?.instanceName || url.replace('https://', ''),
        data: dataPoints,
        borderColor: color,
        backgroundColor: color + '08',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.1,
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
          color: '#1d1d1f',
          font: { family: 'Inter', size: 12 }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      }
    },
    scales: {
      x: {
        grid: { color: '#f0f0f0' },
        ticks: { color: '#86868b', font: { family: 'Inter', size: 11 } }
      },
      y: {
        grid: { color: '#f0f0f0' },
        ticks: { color: '#86868b', font: { family: 'Inter', size: 11 } }
      }
    }
  };

  if (loading) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="brand-mark">
            <Cpu size={24} />
          </div>
          <div className="auth-header">
            <h1>Kickbacks Control</h1>
            <p>Connecting to your render backends.</p>
          </div>
          <div className="loading-ring" aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="auth-overlay">
        <form className="auth-card" onSubmit={handleLoginSubmit}>
          <div className="brand-mark">
            <ShieldAlert size={24} />
          </div>
          <div className="auth-header">
            <h1>Kickbacks Control</h1>
            <p>Sign in to manage simulators, endpoints, and logs.</p>
          </div>
          <div className="form-group">
            <label htmlFor="authPassword">Password</label>
            <input 
              id="authPassword"
              name="authPassword"
              type="password" 
              className="form-input" 
              placeholder="Master password"
              required 
            />
          </div>
          <button type="submit" className="btn-primary" disabled={authChecking}>
            {authChecking ? 'Verifying...' : 'Sign in'}
          </button>
          {authError && <div className="auth-error">{authError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav className="global-nav">
        <div className="global-nav-content">
          <button className="global-nav-logo" onClick={() => setActiveTab('dashboard')}>
            <span className="logo-glyph">
              <Cpu size={16} />
            </span>
            <span>Kickbacks</span>
          </button>

          <div className="global-nav-links" role="tablist" aria-label="Primary navigation">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`global-nav-item ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
                role="tab"
                aria-selected={activeTab === id}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <button
            className="global-nav-logout"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <nav className="sub-nav-frosted">
        <div className="sub-nav-content">
          <div>
            <p className="sub-nav-kicker">Control surface</p>
            <h2 className="sub-nav-title">{activeTitle}</h2>
          </div>

          <div className="sub-nav-right">
            <div className="status-pill">
              <span className={onlineCount ? 'status-dot-active' : 'status-dot-inactive'}></span>
              <span>{onlineCount}/{instances.length} online</span>
            </div>
            <div className="status-pill muted">
              <Activity size={14} />
              <span>{runningBackends} running</span>
            </div>

            {activeTab === 'dashboard' && (
              <div className="command-group">
                <button className="btn-primary compact" onClick={startAllSimulators}>
                  <Play size={14} />
                  Start all
                </button>
                <button className="btn-secondary-pill danger compact" onClick={stopAllSimulators}>
                  <Square size={13} />
                  Stop all
                </button>
              </div>
            )}

            <button
              className="icon-button"
              onClick={() => setRefreshTrigger(p => p + 1)}
              title="Refresh stats"
              aria-label="Refresh stats"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="app-container content-wrapper">
        
        {/* TAB 1: DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Parchment Hero Tile */}
            <section className="hero-tile-parchment">
              <h2>{totalClientsCount} Active Simulators</h2>
              <p className="tagline">headlessly spinning client metrics and logging revenue streams in PostgreSQL.</p>
              
              <div className="hero-metrics-row">
                <div className="hero-metric-item">
                  <p className="hero-metric-label">RUN REVENUE</p>
                  <p className="hero-metric-val green">${totalTodayRun.toFixed(4)}</p>
                </div>
                <div className="hero-metric-item">
                  <p className="hero-metric-label">REAL ACCOUNT TOTAL</p>
                  <p className="hero-metric-val">${totalCurrentToday.toFixed(2)}</p>
                </div>
                <div className="hero-metric-item">
                  <p className="hero-metric-label">TOTAL SPANNING</p>
                  <p className="hero-metric-val blue">{allClientsList.length}</p>
                </div>
                <div className="hero-metric-item">
                  <p className="hero-metric-label">ACTIVE BACKENDS</p>
                  <p className="hero-metric-val">{onlineCount}/{instances.length}</p>
                </div>
              </div>
            </section>

            {/* Backends Card Grid */}
            <section className="store-cards-grid">
              {instances.map(url => {
                const s = statuses[url];
                return (
                  <div key={url} className="store-utility-card">
                    <div>
                      <div className="card-top">
                        <div>
                          <h3 className="card-title">{s?.instanceName || url.replace('https://', '')}</h3>
                          <p className="card-subtitle">{url}</p>
                        </div>
                        <span className={s?.online ? 'status-dot-active' : 'status-dot-inactive'}></span>
                      </div>
                      
                      <div className="card-middle">
                        <div className="card-metric-block">
                          <p className="label">Status</p>
                          <p className="val" style={{ color: s?.online ? (s.running ? 'var(--color-success)' : 'var(--colors-ink)') : 'var(--color-danger)' }}>
                            {s?.online ? (s.running ? 'Running' : 'Stopped') : 'Offline'}
                          </p>
                        </div>
                        
                        {s?.online && (
                          <div className="card-metric-block">
                            <p className="label">Clients Count</p>
                            <p className="val">
                              {s.clients?.filter(c => c.lastStatus !== 'Stopped' && c.lastStatus !== 'inactive').length || 0} active
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="card-actions">
                      {s?.online && !s.running && (
                        <button className="btn-dark-utility" onClick={() => startSingleSimulator(url)}>
                          <Play size={12} /> Start
                        </button>
                      )}
                      {s?.online && s.running && (
                        <button className="btn-dark-utility hollow" onClick={() => stopSingleSimulator(url)}>
                          <Square size={10} /> Stop
                        </button>
                      )}
                      {!s?.online && (
                        <button className="btn-dark-utility hollow" style={{ opacity: 0.5, cursor: 'not-allowed' }} disabled>
                          Offline
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {/* High contrast Minimal Client List */}
            <section className="section-card">
              <h2>Connected Virtual Clients</h2>
              
              {allClientsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: 'var(--colors-ink-muted-48)' }}>
                  <AlertCircle size={28} style={{ marginBottom: 12 }} />
                  <p>No active simulator clients. Launch simulators to fetch live metrics.</p>
                </div>
              ) : (
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>Instance</th>
                      <th>Client Name</th>
                      <th>Ad Render Title</th>
                      <th>Ticks</th>
                      <th>Bills</th>
                      <th>Revenue</th>
                      <th>Last Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allClientsList.map((client, idx) => {
                      const isBilled = client.lastStatus?.includes('Billed');
                      const isSuccess = client.lastStatus?.includes('Success');
                      const isStopped = client.lastStatus?.includes('Stopped');
                      
                      let chipClass = 'neutral';
                      if (isBilled) chipClass = 'blue';
                      else if (isSuccess) chipClass = 'green';
                      else if (isStopped) chipClass = 'red';

                      return (
                        <tr key={idx}>
                          <td>
                            <span style={{ fontWeight: '600' }}>{client.instanceName}</span>
                          </td>
                          <td>{client.name}</td>
                          <td>{client.adTitle || <span style={{ color: 'var(--colors-ink-muted-48)' }}>None</span>}</td>
                          <td style={{ fontWeight: '600' }}>{client.ticks || 0}</td>
                          <td style={{ fontWeight: '600' }}>{client.billing_count || 0}</td>
                          <td style={{ fontWeight: '600', color: 'var(--color-success)' }}>
                            ${parseFloat(client.revenue_usd || 0).toFixed(6)}
                          </td>
                          <td>
                            <span className={`chip ${chipClass}`}>
                              {client.lastStatus || 'Initial'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--colors-ink-muted-48)' }}>{client.lastTickTime || 'Never'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: ANALYTICS */}
        {activeTab === 'analytics' && (
          <div className="section-card">
            <h2>Revenue Growth Snapshots</h2>
            <p style={{ color: 'var(--colors-ink-muted-48)', fontSize: '14px', marginTop: '-16px', marginBottom: '32px' }}>
              Real-time daily revenue tracking loaded dynamically from PostgreSQL.
            </p>
            
            {historyLoading ? (
              <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--colors-ink-muted-48)' }}>
                Loading graphs...
              </div>
            ) : Object.keys(revenueHistories).length === 0 ? (
              <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--colors-ink-muted-48)' }}>
                <Ban size={28} style={{ marginBottom: 12 }} />
                <p>No historical database data logged yet.</p>
              </div>
            ) : (
              <div style={{ position: 'relative', height: '400px', width: '100%' }}>
                <Line data={renderChartData()} options={chartOptions} />
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONFIGURATION */}
        {activeTab === 'config' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
            {/* Endpoints settings */}
            <div className="section-card" style={{ height: 'fit-content' }}>
              <h2>Render API Endpoints</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                {instances.map(url => (
                  <div key={url} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#fafafc', border: '1px solid var(--hairline)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                    <button 
                      className="btn-dark-utility hollow" 
                      style={{ padding: '6px', border: 'none', color: 'var(--color-danger)' }}
                      onClick={() => handleRemoveInstance(url)}
                      disabled={instances.length <= 1}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddInstance}>
                <div className="form-group">
                  <label htmlFor="newBackendUrl">New Endpoint</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      id="newBackendUrl"
                      type="text" 
                      className="form-input" 
                      placeholder="https://example.onrender.com"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                    />
                    <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '10px 14px' }}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Config Sync editor */}
            <div className="section-card">
              <h2>Simulator Configurations</h2>
              <p style={{ color: 'var(--colors-ink-muted-48)', fontSize: '14px', marginTop: '-16px', marginBottom: '24px' }}>
                Updates are stored in PostgreSQL and reloaded immediately on both active instances.
              </p>

              <form onSubmit={saveConfiguration}>
                <div className="form-group">
                  <textarea 
                    className="configurator-textarea"
                    value={configJson}
                    onChange={e => setConfigJson(e.target.value)}
                    required
                  />
                </div>
                
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ width: 'auto', display: 'flex', gap: '8px', alignItems: 'center', float: 'right' }}
                  disabled={configSaving}
                >
                  <Settings size={14} />
                  {configSaving ? 'Saving...' : 'Save Config & Restart'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: TERMINAL CONSOLE */}
        {activeTab === 'logs' && (
          <div className="console-frame">
            <div className="console-topbar">
              <h3 className="console-title">Live Log Stream</h3>
              
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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

                <button className="btn-dark-utility hollow" style={{ color: 'white', borderColor: '#3d3d40', padding: '4px 10px', fontSize: '12px' }} onClick={() => clearInstanceLogs(selectedLogInstance)}>
                  Clear
                </button>
              </div>
            </div>

            <div className="console-content">
              {statuses[selectedLogInstance]?.logs?.length === 0 ? (
                <div style={{ color: '#6e6e73', textAlign: 'center', padding: '40px' }}>No logs recorded.</div>
              ) : (
                (statuses[selectedLogInstance]?.logs || []).map((log, idx) => (
                  <div key={idx} className="console-row">
                    <span className="console-time">[{log.time}]</span>
                    <span className={getLogClass(log.message)}>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
