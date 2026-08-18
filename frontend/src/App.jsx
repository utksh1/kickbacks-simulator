import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { 
  Activity, ShieldAlert, Cpu, CircleDollarSign, Terminal,
  Settings, LineChart as LineChartIcon, RefreshCw, LogOut, Plus, Trash2,
  Play, Square, AlertCircle, Ban, Server, Compass, Sparkles,
  TrendingUp, Zap, Target, ShieldCheck, Gauge, BarChart3, Clock, DollarSign
} from 'lucide-react';

const MuiLineChart = lazy(() =>
  import('@mui/x-charts/LineChart').then((module) => ({ default: module.LineChart }))
);

const DEFAULT_INSTANCES = [
  'https://r5.utksh.in',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004'
];

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'analytics', label: 'Analytics', icon: LineChartIcon },
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
    let list = saved ? JSON.parse(saved) : DEFAULT_INSTANCES;
    list = list.filter(item => !item.includes('utksh.in') && !item.includes('utksh.bar'));
    if (!list || list.length === 0) {
      list = DEFAULT_INSTANCES;
    }
    return list;
  });
  const [newUrl, setNewUrl] = useState('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('dashboard_password')));
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const getCachedMetrics = useCallback(() => {
    const saved = localStorage.getItem('kickbacks_cached_metrics');
    return saved ? JSON.parse(saved) : {
      totalTodayRun: 0,
      totalCurrentToday: 0,
      totalClientsCount: 0,
      runningBackends: 0,
      uniqueProfilesCount: 0,
      allClientsList: []
    };
  }, []);

  const [selectedLogInstance, setSelectedLogInstance] = useState(instances[0] || '');
  const [configJson, setConfigJson] = useState('[]');
  const [configSaving, setConfigSaving] = useState(false);

  const [revenueHistories, setRevenueHistories] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);

  // Rolling revenue samples for velocity calculation
  const revenueSamplesRef = useRef([]);
  const MAX_SAMPLES = 30; // Keep ~2.5 min of samples at 5s polling

  const logsEndRef = useRef(null);
  const initialAuthCheckedRef = useRef(!password);

  const verifyPassword = useCallback(async (pass) => {
    setAuthChecking(true);
    setAuthError('');
    const testUrl = instances[0] || 'https://r5.utksh.in';
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
  }, [instances]);

  // Initial Auth Check
  useEffect(() => {
    if (initialAuthCheckedRef.current || !password) return;
    initialAuthCheckedRef.current = true;
    verifyPassword(password);
  }, [password, verifyPassword]);

  // Save instances list
  useEffect(() => {
    localStorage.setItem('dashboard_instances', JSON.stringify(instances));
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
    const interval = setInterval(fetchAllStatuses, 2000);
    return () => clearInterval(interval);
  }, [isAuthorized, instances, password, refreshTrigger]);

  // Save status metrics to localStorage when statuses change
  useEffect(() => {
    const onlineCount = Object.values(statuses).filter(s => s.online).length;
    if (onlineCount === 0) return;

    let runningBackends = Object.values(statuses).filter(s => s.online && s.running).length;
    let totalClientsCount = 0;
    let allClientsList = [];
    const uniqueProfiles = {};

    Object.keys(statuses).forEach(url => {
      const s = statuses[url];
      if (s && s.online) {
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
          if (!uniqueProfiles[p.name] || (uniqueProfiles[p.name].currentLifetimeUsd || 0) < (p.currentLifetimeUsd || 0)) {
            uniqueProfiles[p.name] = p;
          }
        });
      }
    });

    const totalTodayRun = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.earnedTodayRun, 0);
    const totalCurrentToday = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.currentTodayUsd, 0);
    const totalCurrentLifetime = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentLifetimeUsd || 0), 0);

    const newMetrics = {
      totalTodayRun,
      totalCurrentToday,
      totalCurrentLifetime,
      totalClientsCount,
      runningBackends,
      uniqueProfilesCount: Object.keys(uniqueProfiles).length,
      allClientsList
    };

    localStorage.setItem('kickbacks_cached_metrics', JSON.stringify(newMetrics));
  }, [statuses]);

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
    if (activeTab !== 'config') return undefined;

    const onlineInstance = Object.keys(statuses).find(url => statuses[url]?.online);
    if (!onlineInstance || !statuses[onlineInstance]?.configProfiles) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setConfigJson(JSON.stringify(statuses[onlineInstance].configProfiles, null, 2));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeTab, statuses]);

  // Auto-scroll log console
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [statuses, selectedLogInstance]);

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
      const nextInstances = instances.filter(u => u !== url);
      setInstances(nextInstances);
      if (selectedLogInstance === url) {
        setSelectedLogInstance(nextInstances[0] || '');
      }
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
  
  let runningBackends = 0;
  let totalTodayRun = 0;
  let totalClientsCount = 0;
  let allClientsList = [];
  const uniqueProfiles = {};
  let totalCurrentToday = 0;
  let totalCurrentLifetime = 0;
  let uniqueProfilesCount = 0;

  if (onlineCount > 0) {
    runningBackends = Object.values(statuses).filter(s => s.online && s.running).length;
    Object.keys(statuses).forEach(url => {
      const s = statuses[url];
      if (s && s.online) {
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
          if (!uniqueProfiles[p.name] || (uniqueProfiles[p.name].currentLifetimeUsd || 0) < (p.currentLifetimeUsd || 0)) {
            uniqueProfiles[p.name] = p;
          }
        });
      }
    });
    totalTodayRun = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.earnedTodayRun, 0);
    totalCurrentToday = Object.values(uniqueProfiles).reduce((sum, p) => sum + p.currentTodayUsd, 0);
    totalCurrentLifetime = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentLifetimeUsd || 0), 0);
    uniqueProfilesCount = Object.keys(uniqueProfiles).length;

    // Track revenue samples for velocity calculation
    const now = Date.now();
    const samples = revenueSamplesRef.current;
    if (samples.length === 0 || now - samples[samples.length - 1].t >= 4000) {
      samples.push({ t: now, v: totalTodayRun });
      if (samples.length > MAX_SAMPLES) samples.shift();
    }

  } else {
    // When offline, fallback to the overall global cached metrics
    const cached = getCachedMetrics();
    runningBackends = cached.runningBackends;
    totalTodayRun = cached.totalTodayRun;
    totalClientsCount = cached.totalClientsCount;
    totalCurrentToday = cached.totalCurrentToday;
    uniqueProfilesCount = cached.uniqueProfilesCount;
    allClientsList = cached.allClientsList || [];
  }

  // === COMPUTED ANALYTICS (all derived, zero hardcoded) ===

  // Revenue Velocity
  const samples = revenueSamplesRef.current;
  let revenuePerMinute = 0;
  let revenuePerHour = 0;
  let projectedDaily = 0;

  if (samples.length >= 2) {
    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const dtMinutes = (newest.t - oldest.t) / 60000;
    if (dtMinutes > 0) {
      const delta = newest.v - oldest.v;
      revenuePerMinute = Math.max(0, delta / dtMinutes);
      revenuePerHour = revenuePerMinute * 60;
      projectedDaily = revenuePerHour * 24;
    }
  }

  // Fleet Efficiency
  const activeClients = allClientsList.filter(c => c.lastStatus !== 'Stopped' && c.lastStatus !== 'inactive').length;
  const totalTicks = allClientsList.reduce((sum, c) => sum + (c.ticks || 0), 0);
  const totalBills = allClientsList.reduce((sum, c) => sum + (c.billing_count || 0), 0);
  const billingSuccessRate = totalTicks > 0 ? ((totalBills / totalTicks) * 100) : 0;
  const revenuePerClient = activeClients > 0 ? (totalTodayRun / activeClients) : 0;
  const revenuePerBackend = runningBackends > 0 ? (totalTodayRun / runningBackends) : 0;
  const errorClients = allClientsList.filter(c => (c.lastStatus || '').includes('HTTP Error') || (c.lastStatus || '').includes('Billing Error')).length;
  const errorRate = allClientsList.length > 0 ? ((errorClients / allClientsList.length) * 100) : 0;
  const fleetUtilization = allClientsList.length > 0 ? ((activeClients / allClientsList.length) * 100) : 0;
  const avgTicksPerClient = activeClients > 0 ? (totalTicks / activeClients) : 0;
  const avgBillsPerClient = activeClients > 0 ? (totalBills / activeClients) : 0;

  const activeTitle = TAB_TITLES[activeTab] || 'Dashboard';

  // MUI X Charts data
  const buildRevenueChart = () => {
    const allTimestamps = new Set();

    instances.forEach((url) => {
      const history = revenueHistories[url] || [];
      history.forEach(pt => {
        allTimestamps.add(new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      });
    });

    const labels = Array.from(allTimestamps).sort();

    const series = instances.map((url) => {
      const history = revenueHistories[url] || [];
      const dataMap = {};
      history.forEach(pt => {
        dataMap[new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] = parseFloat(pt.today_usd);
      });

      const dataPoints = labels.map(lbl => dataMap[lbl] !== undefined ? dataMap[lbl] : null);
      return {
        id: url,
        label: statuses[url]?.instanceName || url.replace('https://', ''),
        data: dataPoints,
        curve: 'linear',
        connectNulls: true,
        showMark: ({ index }) => index === dataPoints.length - 1,
        valueFormatter: (value) => value == null ? 'No sample' : `$${Number(value).toFixed(4)}`
      };
    });

    return { labels, series };
  };
  const revenueChart = buildRevenueChart();

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
            <section className="ops-hero">
              <div className="ops-hero-copy">
                <div className="hero-eyebrow">
                  <Compass size={15} />
                  Live simulator fleet
                </div>
                <h1>{totalClientsCount} active simulator{totalClientsCount === 1 ? '' : 's'}</h1>
                <p>
                  Monitor backend health, client billing ticks, and daily revenue without leaving the control surface.
                </p>
                <div className="hero-signal-row" aria-label="Backend status overview">
                  {instances.map(url => (
                    <span
                      key={url}
                      className={`hero-signal ${statuses[url]?.online ? 'online' : 'offline'} ${statuses[url]?.running ? 'running' : ''}`}
                      title={`${statuses[url]?.instanceName || url}: ${statuses[url]?.online ? 'online' : 'offline'}`}
                    />
                  ))}
                </div>
              </div>

              <div className="hero-meter">
                <div className="hero-meter-icon">
                  <CircleDollarSign size={22} />
                </div>
                <p className="hero-meter-label">Run revenue</p>
                <p className="hero-meter-value">${totalTodayRun.toFixed(4)}</p>
                <p className="hero-meter-footnote">Account balance: ${totalCurrentLifetime.toFixed(2)} (today: ${totalCurrentToday.toFixed(2)})</p>
                {revenuePerHour > 0 && (
                  <p className="hero-meter-rate">
                    <TrendingUp size={12} />
                    ${revenuePerHour.toFixed(4)}/hr
                  </p>
                )}
              </div>
            </section>

            <section className="metric-strip" aria-label="Fleet summary">
              <div className="metric-tile">
                <Sparkles size={18} />
                <div>
                  <p className="metric-label">Client span</p>
                  <p className="metric-value">{allClientsList.length}</p>
                </div>
              </div>
              <div className="metric-tile">
                <Server size={18} />
                <div>
                  <p className="metric-label">Backends online</p>
                  <p className="metric-value">{onlineCount}/{instances.length}</p>
                </div>
              </div>
              <div className="metric-tile">
                <Activity size={18} />
                <div>
                  <p className="metric-label">Running backends</p>
                  <p className="metric-value">{runningBackends}</p>
                </div>
              </div>
              <div className="metric-tile">
                <Cpu size={18} />
                <div>
                  <p className="metric-label">Profiles tracked</p>
                  <p className="metric-value">{uniqueProfilesCount}</p>
                </div>
              </div>
            </section>

            {/* Revenue Velocity Strip */}
            <section className="velocity-strip" aria-label="Revenue velocity">
              <div className={`velocity-tile ${revenuePerMinute > 0 ? 'earning' : ''}`}>
                <div className="velocity-icon">
                  <Zap size={18} />
                </div>
                <div>
                  <p className="metric-label">Revenue / min</p>
                  <p className="velocity-value">${revenuePerMinute.toFixed(6)}</p>
                </div>
              </div>
              <div className={`velocity-tile ${revenuePerHour > 0 ? 'earning' : ''}`}>
                <div className="velocity-icon">
                  <Clock size={18} />
                </div>
                <div>
                  <p className="metric-label">Revenue / hour</p>
                  <p className="velocity-value">${revenuePerHour.toFixed(4)}</p>
                </div>
              </div>
              <div className={`velocity-tile ${projectedDaily > 0 ? 'earning' : ''}`}>
                <div className="velocity-icon">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <p className="metric-label">Projected / day</p>
                  <p className="velocity-value">${projectedDaily.toFixed(2)}</p>
                </div>
              </div>
            </section>

            {/* Backends Card Grid */}
            <section className="store-cards-grid">
              {instances.map(url => {
                const s = statuses[url];
                const activeClients = s?.clients?.filter(c => c.lastStatus !== 'Stopped' && c.lastStatus !== 'inactive').length || 0;
                return (
                  <div
                    key={url}
                    className={`store-utility-card ${s?.online ? 'online' : 'offline'} ${s?.running ? 'running' : 'stopped'}`}
                  >
                    <div>
                      <div className="card-top">
                        <div>
                          <h3 className="card-title">{s?.instanceName || url.replace('https://', '')}</h3>
                          <p className="card-subtitle">{url}</p>
                        </div>
                        <div className="card-status">
                          <span className={s?.online ? 'status-dot-active' : 'status-dot-inactive'}></span>
                          <span>{s?.online ? 'Online' : 'Offline'}</span>
                        </div>
                      </div>
                      
                      <div className="card-middle">
                        <div className="card-metric-block">
                          <p className="label">Status</p>
                          <p className={`val ${s?.online ? (s.running ? 'success' : 'neutral') : 'danger'}`}>
                            {s?.online ? (s.running ? 'Running' : 'Stopped') : 'Offline'}
                          </p>
                        </div>
                        
                        {s?.online && (
                          <div className="card-metric-block">
                            <p className="label">Clients</p>
                            <p className="val">
                              {activeClients} active
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
                        <button className="btn-dark-utility hollow disabled" disabled>
                          Offline
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {/* Fleet Intelligence Grid */}
            <section className="panel intel-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Fleet intelligence</p>
                  <h2>Performance analytics</h2>
                </div>
                <span className="panel-count">{activeClients} active</span>
              </div>

              <div className="intel-grid">
                <div className="intel-card">
                  <div className="intel-card-icon green">
                    <ShieldCheck size={18} />
                  </div>
                  <p className="intel-card-label">Billing success rate</p>
                  <p className="intel-card-value">{billingSuccessRate.toFixed(1)}%</p>
                  <p className="intel-card-sub">{totalBills} bills / {totalTicks} ticks</p>
                </div>

                <div className="intel-card">
                  <div className="intel-card-icon blue">
                    <DollarSign size={18} />
                  </div>
                  <p className="intel-card-label">Revenue / client</p>
                  <p className="intel-card-value">${revenuePerClient.toFixed(6)}</p>
                  <p className="intel-card-sub">{activeClients} active client{activeClients === 1 ? '' : 's'}</p>
                </div>

                <div className="intel-card">
                  <div className="intel-card-icon violet">
                    <Server size={18} />
                  </div>
                  <p className="intel-card-label">Revenue / backend</p>
                  <p className="intel-card-value">${revenuePerBackend.toFixed(6)}</p>
                  <p className="intel-card-sub">{runningBackends} running backend{runningBackends === 1 ? '' : 's'}</p>
                </div>

                <div className="intel-card">
                  <div className={`intel-card-icon ${errorRate > 0 ? 'red' : 'green'}`}>
                    <AlertCircle size={18} />
                  </div>
                  <p className="intel-card-label">Error rate</p>
                  <p className={`intel-card-value ${errorRate > 0 ? 'danger' : ''}`}>{errorRate.toFixed(1)}%</p>
                  <p className="intel-card-sub">{errorClients} error{errorClients === 1 ? '' : 's'} / {allClientsList.length} total</p>
                </div>

                <div className="intel-card">
                  <div className="intel-card-icon cyan">
                    <Gauge size={18} />
                  </div>
                  <p className="intel-card-label">Fleet utilization</p>
                  <p className="intel-card-value">{fleetUtilization.toFixed(0)}%</p>
                  <p className="intel-card-sub">{activeClients} / {allClientsList.length} clients active</p>
                </div>

                <div className="intel-card">
                  <div className="intel-card-icon amber">
                    <BarChart3 size={18} />
                  </div>
                  <p className="intel-card-label">Avg ticks / bills</p>
                  <p className="intel-card-value">{avgTicksPerClient.toFixed(0)} / {avgBillsPerClient.toFixed(0)}</p>
                  <p className="intel-card-sub">Per active client</p>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Live clients</p>
                  <h2>Connected virtual clients</h2>
                </div>
                <span className="panel-count">{allClientsList.length}</span>
              </div>
              
              {allClientsList.length === 0 ? (
                <div className="empty-state">
                  <AlertCircle size={30} />
                  <h3>No active clients yet</h3>
                  <p>No active simulator clients. Launch simulators to fetch live metrics.</p>
                </div>
              ) : (
                <div className="table-shell">
                  <table className="client-table">
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>Client</th>
                        <th>Ad render</th>
                        <th>Ticks</th>
                        <th>Bills</th>
                        <th>Revenue</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allClientsList.map((client, idx) => {
                        const isBilled = client.lastStatus?.includes('Billed');
                        const isSuccess = client.lastStatus?.includes('Success');
                        const isViewing = client.lastStatus?.includes('Viewing');
                        const isRotating = client.lastStatus?.includes('Next prompt') || client.lastStatus?.includes('Rotating');
                        const isError = client.lastStatus?.includes('Error');
                        const isStopped = client.lastStatus?.includes('Stopped');
                        
                        let chipClass = 'neutral';
                        if (isBilled) chipClass = 'blue';
                        else if (isSuccess || isViewing) chipClass = 'green';
                        else if (isRotating) chipClass = 'purple';
                        else if (isError) chipClass = 'red';
                        else if (isStopped) chipClass = 'neutral';

                        return (
                          <tr key={idx}>
                            <td>
                              <span className="cell-strong">{client.instanceName}</span>
                            </td>
                            <td>{client.name}</td>
                            <td>{client.adTitle || <span className="muted-text">None</span>}</td>
                            <td className="cell-number">{client.ticks || 0}</td>
                            <td className="cell-number">{client.billing_count || 0}</td>
                            <td className="cell-money">
                              ${parseFloat(client.revenue_usd || 0).toFixed(6)}
                            </td>
                            <td>
                              <span className={`chip ${chipClass}`}>
                                {client.lastStatus || 'Initial'}
                              </span>
                            </td>
                            <td className="muted-text">{client.lastTickTime || 'Never'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: ANALYTICS */}
        {activeTab === 'analytics' && (
          <div className="panel analytics-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">PostgreSQL snapshots</p>
                <h2>Revenue growth</h2>
              </div>
              <span className="panel-count">{Object.keys(revenueHistories).length}</span>
            </div>
            <p className="panel-description">
              Real-time daily revenue tracking loaded dynamically from each online backend.
            </p>
            
            {historyLoading ? (
              <div className="chart-placeholder">
                <div className="loading-ring small" aria-label="Loading chart" />
                <span>Loading graph data...</span>
              </div>
            ) : Object.keys(revenueHistories).length === 0 ? (
              <div className="empty-state tall">
                <Ban size={30} />
                <h3>No revenue history yet</h3>
                <p>No historical database data logged yet.</p>
              </div>
            ) : (
              <div className="chart-frame">
                <Suspense
                  fallback={
                    <div className="chart-placeholder inline">
                      <div className="loading-ring small" aria-label="Loading chart renderer" />
                      <span>Loading chart renderer...</span>
                    </div>
                  }
                >
                  <MuiLineChart
                    height={410}
                    margin={{ top: 52, right: 8, bottom: 38, left: 58 }}
                    colors={['#0a72d8', '#2bb8d8', '#11a36a', '#7757d9', '#d98200']}
                    series={revenueChart.series}
                    xAxis={[{
                      id: 'time',
                      scaleType: 'point',
                      data: revenueChart.labels,
                      tickLabelStyle: {
                        fill: '#687083',
                        fontSize: 11,
                        fontFamily: 'Inter, system-ui, sans-serif'
                      }
                    }]}
                    yAxis={[{
                      width: 52,
                      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
                      tickLabelStyle: {
                        fill: '#687083',
                        fontSize: 11,
                        fontFamily: 'Inter, system-ui, sans-serif'
                      }
                    }]}
                    grid={{ horizontal: true }}
                    axisHighlight={{ x: 'line' }}
                    slotProps={{
                      legend: {
                        direction: 'horizontal',
                        position: { vertical: 'top', horizontal: 'middle' },
                        padding: 0
                      }
                    }}
                    sx={{
                      width: '100%',
                      '& .MuiChartsAxis-line': { stroke: '#dce4ee' },
                      '& .MuiChartsAxis-tick': { stroke: '#dce4ee' },
                      '& .MuiChartsGrid-line': { stroke: '#eef3f8' },
                      '& .MuiChartsLegend-label': {
                        color: '#3a3f4b',
                        fontSize: 12,
                        fontFamily: 'Inter, system-ui, sans-serif',
                        fontWeight: 700
                      },
                      '& .MuiLineElement-root': { strokeWidth: 3 },
                      '& .MuiMarkElement-root': { strokeWidth: 2 }
                    }}
                  />
                </Suspense>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONFIGURATION */}
        {activeTab === 'config' && (
          <div className="config-layout">
            <div className="panel endpoint-panel">
              <div className="panel-header compact">
                <div>
                  <p className="panel-kicker">Backends</p>
                  <h2>Render API endpoints</h2>
                </div>
              </div>

              <div className="endpoint-list">
                {instances.map(url => (
                  <div key={url} className="endpoint-row">
                    <span>{url}</span>
                    <button 
                      className="icon-button danger ghost"
                      onClick={() => handleRemoveInstance(url)}
                      disabled={instances.length <= 1}
                      title="Remove endpoint"
                      aria-label={`Remove ${url}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddInstance}>
                <div className="form-group">
                  <label htmlFor="newBackendUrl">New endpoint</label>
                  <div className="inline-form">
                    <input 
                      id="newBackendUrl"
                      type="text" 
                      className="form-input" 
                      placeholder="https://example.onrender.com"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                    />
                    <button type="submit" className="icon-button primary" title="Add endpoint" aria-label="Add endpoint">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="panel config-editor-panel">
              <div className="panel-header compact">
                <div>
                  <p className="panel-kicker">Profiles</p>
                  <h2>Simulator configuration</h2>
                </div>
              </div>
              <p className="panel-description">
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
                  className="btn-primary submit-config"
                  disabled={configSaving}
                >
                  <Settings size={14} />
                  {configSaving ? 'Saving...' : 'Save config and restart'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: TERMINAL CONSOLE */}
        {activeTab === 'logs' && (
          <div className="console-frame">
            <div className="console-topbar">
              <div>
                <p className="console-kicker">Instance stream</p>
                <h3 className="console-title">Live log stream</h3>
              </div>
              
              <div className="console-actions">
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

                <button className="btn-dark-utility hollow on-dark" onClick={() => clearInstanceLogs(selectedLogInstance)}>
                  Clear
                </button>
              </div>
            </div>

            <div className="console-content">
              {statuses[selectedLogInstance]?.logs?.length === 0 ? (
                <div className="console-empty">No logs recorded.</div>
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
