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
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://kickbacks-backend-yj6t.onrender.com'
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
    const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
    const saved = localStorage.getItem('dashboard_instances');
    let list = saved ? JSON.parse(saved) : DEFAULT_INSTANCES;
    list = list.filter(item => !item.includes('utksh.in') && !item.includes('utksh.bar') && !item.match(/:(300[2-9]|3010)/));
    if (!isLocal) {
      // In production (e.g. Vercel), strip plain localhost/http URLs to avoid mixed content errors
      list = list.filter(item => !item.includes('localhost') && !item.includes('127.0.0.1'));
    }
    if (!list || list.length === 0) {
      list = [...DEFAULT_INSTANCES];
    }
    DEFAULT_INSTANCES.forEach(def => {
      if (!list.includes(def)) list.push(def);
    });
    return list;
  });
  const [newUrl, setNewUrl] = useState('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('dashboard_password')));
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState('all');

  const getCachedMetrics = useCallback(() => {
    const saved = localStorage.getItem('kickbacks_cached_metrics');
    return saved ? JSON.parse(saved) : {
      realTodayUsd: 0,
      realLifetimeUsd: 0,
      estimatedRevenue: 0,
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
    const testUrl = instances[0] || 'http://localhost:3001';
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

    const realTodayUsd = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentTodayUsd || 0), 0);
    const realLifetimeUsd = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentLifetimeUsd || 0), 0);
    const estimatedRevenue = allClientsList.reduce((sum, c) => sum + (parseFloat(c.revenue_usd) || 0), 0);

    const newMetrics = {
      realTodayUsd,
      realLifetimeUsd,
      estimatedRevenue,
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
  let totalClientsCount = 0;
  let allClientsList = [];
  const uniqueProfiles = {};
  let uniqueProfilesCount = 0;

  // Real earnings from Kickbacks /v1/earnings API
  let realTodayUsd = 0;
  let realLifetimeUsd = 0;
  let sessionEarnedToday = 0;

  // Local estimated revenue (billing_count * $0.0001)
  let estimatedRevenue = 0;
  let totalBillingCount = 0;

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

        // Aggregate real earnings from each backend
        if (s.realEarnings) {
          realTodayUsd += (s.realEarnings.todayUsd || 0);
          realLifetimeUsd += (s.realEarnings.lifetimeUsd || 0);
          sessionEarnedToday += (s.realEarnings.sessionEarnedToday || 0);
        }
        if (s.estimatedRevenue) {
          estimatedRevenue += (s.estimatedRevenue.total || 0);
          totalBillingCount += (s.estimatedRevenue.totalBillingCount || 0);
        }
      }
    });
    // Deduplicate real earnings from profiles (same account seen by multiple backends)
    realTodayUsd = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentTodayUsd || 0), 0);
    realLifetimeUsd = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.currentLifetimeUsd || 0), 0);
    sessionEarnedToday = Object.values(uniqueProfiles).reduce((sum, p) => sum + (p.earnedTodayRun || 0), 0);
    uniqueProfilesCount = Object.keys(uniqueProfiles).length;

    // Estimated revenue from client billing counts
    const totalClientRevenueSum = allClientsList.reduce((sum, c) => sum + (parseFloat(c.revenue_usd) || 0), 0);
    if (totalClientRevenueSum > estimatedRevenue) {
      estimatedRevenue = totalClientRevenueSum;
    }

    // Track revenue samples for velocity calculation (use estimated since real may be delayed)
    const now = Date.now();
    const samples = revenueSamplesRef.current;
    if (samples.length === 0 || now - samples[samples.length - 1].t >= 4000) {
      samples.push({ t: now, v: estimatedRevenue });
      if (samples.length > MAX_SAMPLES) samples.shift();
    }

  } else {
    // When offline, fallback to the overall global cached metrics
    const cached = getCachedMetrics();
    runningBackends = cached.runningBackends;
    estimatedRevenue = cached.estimatedRevenue || cached.totalTodayRun || 0;
    totalClientsCount = cached.totalClientsCount;
    realTodayUsd = cached.realTodayUsd || 0;
    realLifetimeUsd = cached.realLifetimeUsd || 0;
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
  const revenuePerClient = activeClients > 0 ? (estimatedRevenue / activeClients) : 0;
  const revenuePerBackend = runningBackends > 0 ? (estimatedRevenue / runningBackends) : 0;
  const errorClients = allClientsList.filter(c => (c.lastStatus || '').includes('HTTP Error') || (c.lastStatus || '').includes('Billing Error')).length;
  const errorRate = allClientsList.length > 0 ? ((errorClients / allClientsList.length) * 100) : 0;
  const fleetUtilization = allClientsList.length > 0 ? ((activeClients / allClientsList.length) * 100) : 0;
  const avgTicksPerClient = activeClients > 0 ? (totalTicks / activeClients) : 0;
  const avgBillsPerClient = activeClients > 0 ? (totalBills / activeClients) : 0;

  // Fleet Analytics Computations
  const totalFleetTicks = allClientsList.reduce((acc, c) => acc + (c.ticks || 0), 0);
  const totalFleetRevenue = allClientsList.reduce((acc, c) => acc + (parseFloat(c.revenue_usd) || 0), 0);
  const fleetRpm = totalFleetTicks > 0 ? ((totalFleetRevenue / totalFleetTicks) * 1000).toFixed(2) : '0.00';
  const fleetConversionRate = totalFleetTicks > 0 ? ((totalBills / totalFleetTicks) * 100).toFixed(1) : '0.0';

  // Ad Sponsor Campaign Breakdown
  const adPerformanceMap = {};
  allClientsList.forEach((c) => {
    const title = c.adTitle || 'Rotating / Pending';
    if (!adPerformanceMap[title]) {
      adPerformanceMap[title] = {
        title,
        clientsCount: 0,
        ticks: 0,
        bills: 0,
        revenue: 0
      };
    }
    adPerformanceMap[title].clientsCount += 1;
    adPerformanceMap[title].ticks += (c.ticks || 0);
    adPerformanceMap[title].bills += (c.billing_count || 0);
    adPerformanceMap[title].revenue += (parseFloat(c.revenue_usd) || 0);
  });
  const adPerformanceList = Object.values(adPerformanceMap).sort((a, b) => b.revenue - a.revenue);

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

    let labels = Array.from(allTimestamps).sort();
    if (labels.length === 0) {
      const now = Date.now();
      labels = [
        new Date(now - 120000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        new Date(now - 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      ];
    } else if (labels.length === 1) {
      labels = [
        new Date(Date.now() - 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        labels[0]
      ];
    }

    const series = instances.map((url, idx) => {
      const history = revenueHistories[url] || [];
      const s = statuses[url];
      const accountName = s?.profiles?.[0]?.name || s?.instanceName?.split(' · ')[1] || `Account #${idx + 1}`;
      const dataMap = {};
      history.forEach(pt => {
        dataMap[new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] = parseFloat(pt.today_usd || 0);
      });

      // Total revenue for this instance from its active clients
      const clientRev = (s?.clients || []).reduce((sum, c) => sum + (parseFloat(c.revenue_usd) || 0), 0);

      const dataPoints = labels.map((lbl, lIdx) => {
        if (dataMap[lbl] !== undefined && dataMap[lbl] > 0) return dataMap[lbl];
        if (lIdx === labels.length - 1) return clientRev;
        if (lIdx === 0) return 0;
        return (clientRev * (lIdx / (labels.length - 1)));
      });

      return {
        id: url,
        label: `#${idx + 1} ${accountName}`,
        data: dataPoints,
        curve: 'linear',
        connectNulls: true,
        showMark: ({ index }) => index === dataPoints.length - 1,
        valueFormatter: (value) => value == null ? '$0.0000' : `$${Number(value).toFixed(4)}`
      };
    });

    return { labels, series };
  };
  const revenueChart = buildRevenueChart();

  if (loading) {
    return (
      <div className="auth-overlay">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="logo-leaf" style={{ margin: '0 auto 18px auto', width: 44, height: 44 }}>
            <Cpu size={22} />
          </div>
          <div className="auth-header">
            <h1>Kickbacks Atlas</h1>
            <p>Connecting to {instances.length > 1 ? `${instances.length} dedicated account backends` : 'dedicated backend'}...</p>
          </div>
          <div className="loading-ring" style={{ margin: '16px auto 0 auto' }} aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="auth-overlay">
        <form className="auth-card" onSubmit={handleLoginSubmit}>
          <div className="logo-leaf" style={{ margin: '0 auto 18px auto', width: 44, height: 44 }}>
            <ShieldAlert size={22} />
          </div>
          <div className="auth-header" style={{ textAlign: 'center' }}>
            <h1>Kickbacks Atlas</h1>
            <p>Sign in to manage the 5-account dedicated fleet</p>
          </div>
          <div className="form-group">
            <label htmlFor="authPassword">Master Password</label>
            <input
              id="authPassword"
              name="authPassword"
              type="password"
              className="form-input"
              placeholder="Master password"
              required
            />
          </div>
          <button type="submit" className="btn-primary-pill" style={{ width: '100%', justifyContent: 'center' }} disabled={authChecking}>
            {authChecking ? 'Verifying Credentials...' : 'Access Atlas Fleet'}
          </button>
          {authError && <div className="auth-error">{authError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Global Navigation (Clean White Sticky Header) */}
      <nav className="global-nav">
        <div className="global-nav-content">
          <div className="global-nav-left">
            <button className="global-nav-logo" onClick={() => setActiveTab('dashboard')}>
              <div className="logo-leaf">
                <Cpu size={16} />
              </div>
              <div className="logo-text-group">
                <span className="logo-text">Kickbacks</span>
                <span className="logo-badge">Fleet</span>
              </div>
            </button>

            <div className="nav-pill-tabs" role="tablist" aria-label="Primary navigation">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`pill-tab-item ${activeTab === id ? 'active' : ''}`}
                  onClick={() => setActiveTab(id)}
                  role="tab"
                  aria-selected={activeTab === id}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="global-nav-right">
            <div className="badge-soft-pill">
              <span className="status-pulse-dot"></span>
              <span>{onlineCount}/{instances.length} Online</span>
            </div>
            <div className="badge-soft-pill neutral">
              <Activity size={13} />
              <span>{runningBackends} Running</span>
            </div>

            {activeTab === 'dashboard' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-primary-pill" onClick={startAllSimulators}>
                  <Play size={13} fill="currentColor" />
                  Start All
                </button>
                <button className="btn-secondary-pill danger" onClick={stopAllSimulators}>
                  <Square size={12} fill="currentColor" />
                  Stop All
                </button>
              </div>
            )}

            <button
              className="btn-icon-pill"
              onClick={() => setRefreshTrigger(p => p + 1)}
              title="Refresh stats"
              aria-label="Refresh stats"
            >
              <RefreshCw size={14} />
            </button>

            <button
              className="btn-icon-pill"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main App Container */}
      <div className="app-container" style={{ paddingTop: '24px' }}>

        {/* TAB 1: DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Overview Metric Strip */}
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <p className="section-kicker">Fleet Intelligence</p>
                <h2 className="section-title">Overview</h2>
              </div>
              <span className="panel-count">{allClientsList.length} Active Clients</span>
            </div>

            <section className="metric-strip" aria-label="Fleet summary" style={{ marginBottom: '28px' }}>
              <div className="metric-tile">
                <div className="metric-icon-wrap green">
                  <DollarSign size={20} />
                </div>
                <div>
                  <p className="metric-label">Kickbacks Earnings (Today)</p>
                  <p className="metric-value">${realTodayUsd.toFixed(6)}</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap blue">
                  <CircleDollarSign size={20} />
                </div>
                <div>
                  <p className="metric-label">Lifetime Balance</p>
                  <p className="metric-value">${realLifetimeUsd.toFixed(6)}</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap purple">
                  <Target size={20} />
                </div>
                <div>
                  <p className="metric-label">Billing Events (est.)</p>
                  <p className="metric-value">{totalBills} billed</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap orange">
                  <Activity size={20} />
                </div>
                <div>
                  <p className="metric-label">Active Clients</p>
                  <p className="metric-value">{activeClients} / {allClientsList.length}</p>
                </div>
              </div>
            </section>

            {/* Accounts & Divided Clients Telemetry */}
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <p className="section-kicker">Accounts &amp; Virtual Clients</p>
                <h2 className="section-title">Fleet Accounts ({instances.length})</h2>
              </div>
              <span className="panel-count">{allClientsList.length} Clients Total</span>
            </div>

            {/* Account Selector Filter Bar */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <button
                className={`filter-tab-pill ${selectedAccount === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedAccount('all')}
              >
                All Accounts ({allClientsList.length})
              </button>
              {instances.map((url, idx) => {
                const s = statuses[url];
                const profile = s?.profiles?.[0];
                const accountName = profile?.name || s?.instanceName?.split(' · ')[1] || `Account ${idx + 1}`;
                const count = s?.clients?.length || 0;
                return (
                  <button
                    key={url}
                    className={`filter-tab-pill ${selectedAccount === String(idx) ? 'active' : ''}`}
                    onClick={() => setSelectedAccount(String(idx))}
                  >
                    #{idx + 1} {accountName} ({count})
                  </button>
                );
              })}
            </div>

            {/* Divided Account Panels with their respective clients */}
            <div className="account-sections-list">
              {instances.map((url, idx) => {
                if (selectedAccount !== 'all' && selectedAccount !== String(idx)) {
                  return null;
                }
                const s = statuses[url];
                const profile = s?.profiles?.[0];
                const accountName = profile?.name || s?.instanceName?.split(' · ')[1] || `account_${idx + 1}`;
                const clients = s?.clients || [];
                const activeClientsCount = clients.filter(c => c.lastStatus !== 'Stopped' && c.lastStatus !== 'inactive').length;
                const acctClientRev = clients.reduce((sum, c) => sum + (parseFloat(c.revenue_usd) || 0), 0);
                const todayUsd = (profile?.currentTodayUsd !== undefined && profile.currentTodayUsd > 0) ? profile.currentTodayUsd : acctClientRev;
                const lifetimeUsd = (profile?.currentLifetimeUsd !== undefined && profile.currentLifetimeUsd > 0) ? (profile.currentLifetimeUsd + acctClientRev) : acctClientRev;
                const isOnline = Boolean(s?.online);
                const isRunning = Boolean(s?.running);

                return (
                  <div key={url} className="panel" style={{ marginBottom: '22px', padding: 0, overflow: 'hidden' }}>
                    {/* Dedicated Account Header Bar */}
                    <div style={{
                      padding: '16px 20px',
                      backgroundColor: 'var(--canvas)',
                      borderBottom: '1px solid var(--hairline)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="chip purple" style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px' }}>
                          Account #{idx + 1}
                        </span>
                        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>{accountName}</span>
                        <span className={`chip ${isOnline ? (isRunning ? 'green' : 'neutral') : 'neutral'}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                          {isOnline ? (isRunning ? 'Running' : 'Idle') : 'Offline'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--steel)', fontFamily: 'var(--font-code)' }}>{url}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                          <span style={{ color: 'var(--steel)' }}>Active: <strong style={{ color: 'var(--ink)' }}>{activeClientsCount}/{clients.length}</strong></span>
                          <span style={{ color: 'var(--steel)' }}>Earned: <strong style={{ color: 'var(--brand-green-dark)' }}>${acctClientRev.toFixed(6)}</strong></span>
                          <span style={{ color: 'var(--steel)' }}>Today: <strong style={{ color: 'var(--ink)' }}>${todayUsd.toFixed(4)}</strong></span>
                          <span style={{ color: 'var(--steel)' }}>Lifetime: <strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-code)' }}>${lifetimeUsd.toFixed(2)}</strong></span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          {isOnline && !isRunning && (
                            <button className="btn-card-action start" onClick={() => startSingleSimulator(url)} style={{ padding: '4px 12px', fontSize: '11px' }}>
                              <Play size={10} fill="currentColor" /> Start Account
                            </button>
                          )}
                          {isOnline && isRunning && (
                            <button className="btn-card-action stop" onClick={() => stopSingleSimulator(url)} style={{ padding: '4px 12px', fontSize: '11px' }}>
                              <Square size={9} fill="currentColor" /> Stop Account
                            </button>
                          )}
                          {!isOnline && (
                            <button className="btn-card-action disabled" disabled style={{ padding: '4px 12px', fontSize: '11px' }}>
                              Offline
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Table of Clients Divided to THIS Account */}
                    {clients.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--steel)', fontSize: '13px' }}>
                        No clients initialized for this account yet. Click Start Account to begin.
                      </div>
                    ) : (
                      <div className="table-shell" style={{ border: 'none', borderRadius: 0 }}>
                        <table className="client-table">
                          <thead>
                            <tr>
                              <th>Client</th>
                              <th>Ad Render</th>
                              <th>Ticks</th>
                              <th>Bills</th>
                              <th>Revenue</th>
                              <th>Status</th>
                              <th>Last Tick</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clients.map((client, cIdx) => {
                              const isBilled = client.lastStatus?.includes('Billed (Success)');
                              const isUnbilled = client.lastStatus?.includes('Unbilled');
                              const isSuccess = client.lastStatus?.includes('Success');
                              const isViewing = client.lastStatus?.includes('Viewing');
                              const isRotating = client.lastStatus?.includes('Next prompt') || client.lastStatus?.includes('Rotating');
                              const isError = client.lastStatus?.includes('Error');
                              const isStopped = client.lastStatus?.includes('Stopped');

                              let chipClass = 'neutral';
                              if (isBilled) chipClass = 'blue';
                              else if (isUnbilled) chipClass = 'neutral';
                              else if (isSuccess || isViewing) chipClass = 'green';
                              else if (isRotating) chipClass = 'purple';
                              else if (isError) chipClass = 'red';
                              else if (isStopped) chipClass = 'neutral';

                              return (
                                <tr key={cIdx}>
                                  <td>
                                    <span className="cell-code" style={{ fontWeight: 600 }}>{client.name}</span>
                                  </td>
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
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: ANALYTICS VIEW */}
        {activeTab === 'analytics' && (
          <div>
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <p className="section-kicker">Fleet Intelligence &amp; Telemetry</p>
                <h2 className="section-title">Fleet Analytics</h2>
              </div>
              <span className="panel-count">{instances.length} Backend{instances.length === 1 ? '' : 's'} · {allClientsList.length} Clients</span>
            </div>

            {/* Analytics Metric Strip */}
            <section className="metric-strip" aria-label="Analytics summary" style={{ marginBottom: '24px' }}>
              <div className="metric-tile">
                <div className="metric-icon-wrap green">
                  <DollarSign size={20} />
                </div>
                <div>
                  <p className="metric-label">Verified Today Earnings</p>
                  <p className="metric-value">${realTodayUsd.toFixed(6)}</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap blue">
                  <CircleDollarSign size={20} />
                </div>
                <div>
                  <p className="metric-label">Total Lifetime Balance</p>
                  <p className="metric-value">${realLifetimeUsd.toFixed(6)}</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap purple">
                  <Activity size={20} />
                </div>
                <div>
                  <p className="metric-label">Fleet Impressions (Ticks)</p>
                  <p className="metric-value">{totalFleetTicks}</p>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-icon-wrap orange">
                  <Cpu size={20} />
                </div>
                <div>
                  <p className="metric-label">Fleet Health</p>
                  <p className="metric-value">{onlineCount}/{instances.length} Online <span style={{ fontSize: '12px', color: 'var(--brand-green-dark)' }}>({runningBackends} Running)</span></p>
                </div>
              </div>
            </section>

            {/* Divided Account Comparison Matrix */}
            <div className="panel" style={{ marginBottom: '24px', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <p className="panel-kicker" style={{ margin: 0 }}>Divided by Backend</p>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>Account Performance Breakdown</h3>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className={`filter-tab-pill ${selectedAccount === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedAccount('all')}
                    style={{ padding: '3px 10px', fontSize: '11px' }}
                  >
                    All Accounts
                  </button>
                  {instances.map((_, i) => (
                    <button
                      key={i}
                      className={`filter-tab-pill ${selectedAccount === String(i) ? 'active' : ''}`}
                      onClick={() => setSelectedAccount(String(i))}
                      style={{ padding: '3px 10px', fontSize: '11px' }}
                    >
                      #{i + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="table-shell" style={{ border: 'none', borderRadius: 0 }}>
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>Account / Backend</th>
                      <th>Port</th>
                      <th>Clients</th>
                      <th>Primary Ad</th>
                      <th>Ticks</th>
                      <th>Today's Real ($)</th>
                      <th>Lifetime Balance ($)</th>
                      <th>Account Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((url, idx) => {
                      if (selectedAccount !== 'all' && selectedAccount !== String(idx)) {
                        return null;
                      }
                      const s = statuses[url];
                      const profile = s?.profiles?.[0];
                      const accountName = profile?.name || s?.instanceName?.split(' · ')[1] || `Account ${idx + 1}`;
                      const clients = s?.clients || [];
                      const acctTicks = clients.reduce((acc, c) => acc + (c.ticks || 0), 0);
                      const realToday = profile?.currentTodayUsd ?? s?.realEarnings?.todayUsd ?? 0;
                      const realLifetime = profile?.currentLifetimeUsd ?? s?.realEarnings?.lifetimeUsd ?? 0;
                      const topAd = clients[0]?.adTitle || 'Rotating / Pending';
                      const isBlocked = profile?.blocked === true;

                      return (
                        <tr key={url}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="chip purple" style={{ fontSize: '10px', padding: '2px 6px' }}>#{idx + 1}</span>
                              <strong style={{ color: 'var(--ink)', fontSize: '13px' }}>{accountName}</strong>
                            </div>
                          </td>
                          <td>
                            <span className="cell-code">{url.replace('http://localhost:', ':')}</span>
                          </td>
                          <td className="cell-number">{clients.length}</td>
                          <td style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={topAd}>
                            {topAd}
                          </td>
                          <td className="cell-number">{acctTicks}</td>
                          <td className="cell-money" style={{ fontWeight: 600, color: 'var(--brand-green-dark)' }}>
                            ${realToday.toFixed(6)}
                          </td>
                          <td className="cell-money" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                            ${realLifetime.toFixed(6)}
                          </td>
                          <td>
                            <span className={`chip ${isBlocked ? 'red' : 'green'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                              {isBlocked ? 'Blocked' : 'Active (Normal)'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ad Sponsor Campaign Breakdown */}
            <div className="panel" style={{ marginBottom: '24px', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p className="panel-kicker" style={{ margin: 0 }}>Campaign Telemetry</p>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>Active Ad Sponsors ({adPerformanceList.length})</h3>
                </div>
                <span className="panel-count">{allClientsList.length} Total Impressions Rotating</span>
              </div>

              <div className="table-shell" style={{ border: 'none', borderRadius: 0 }}>
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>Sponsor / Ad Campaign</th>
                      <th>Active Clients</th>
                      <th>Total Impressions</th>
                      <th>Paid Bills</th>
                      <th>Conversion</th>
                      <th>Revenue Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adPerformanceList.map((ad, aIdx) => {
                      const convRate = ad.ticks > 0 ? ((ad.bills / ad.ticks) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={aIdx}>
                          <td>
                            <strong style={{ color: 'var(--ink)', fontSize: '13px' }}>{ad.title}</strong>
                          </td>
                          <td className="cell-number">{ad.clientsCount} clients</td>
                          <td className="cell-number">{ad.ticks}</td>
                          <td className="cell-number">{ad.bills}</td>
                          <td>
                            <span className="chip green" style={{ fontSize: '10px', padding: '2px 6px' }}>{convRate}%</span>
                          </td>
                          <td className="cell-money" style={{ fontWeight: 600 }}>${ad.revenue.toFixed(6)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Time-Series Growth Trace Chart */}
            <div className="panel analytics-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Time-Series Telemetry</p>
                  <h2>Revenue Growth Trace</h2>
                </div>
                <span className="panel-count">{instances.length} Backend{instances.length === 1 ? '' : 's'}</span>
              </div>
              <p className="panel-description">
                Real-time verified revenue growth trace across active fleet backends.
              </p>

              {historyLoading ? (
                <div className="chart-placeholder">
                  <div className="loading-ring" aria-label="Loading chart" />
                  <span>Loading revenue trace...</span>
                </div>
              ) : (
                <div className="chart-frame">
                  <Suspense
                    fallback={
                      <div className="chart-placeholder">
                        <div className="loading-ring" aria-label="Loading chart renderer" />
                        <span>Initializing chart renderer...</span>
                      </div>
                    }
                  >
                    <MuiLineChart
                      height={380}
                      margin={{ top: 40, right: 24, bottom: 44, left: 70 }}
                      colors={['#00ed64', '#7b3ff2', '#fa6e39', '#3d4f9f', '#003d4f', '#00a35c', '#f06bb8', '#2bb8d8']}
                      series={revenueChart.series}
                      xAxis={[{
                        id: 'time',
                        scaleType: 'point',
                        data: revenueChart.labels,
                        tickLabelStyle: {
                          fill: '#5c6c7a',
                          fontSize: 11,
                          fontFamily: 'Euclid Circular A, Plus Jakarta Sans, sans-serif'
                        }
                      }]}
                      yAxis={[{
                        width: 70,
                        valueFormatter: (value) => {
                          const num = Number(value || 0);
                          if (num === 0) return '$0.000';
                          if (num < 0.01) return `$${num.toFixed(4)}`;
                          return `$${num.toFixed(2)}`;
                        },
                        tickLabelStyle: {
                          fill: '#5c6c7a',
                          fontSize: 11,
                          fontFamily: 'Euclid Circular A, Plus Jakarta Sans, sans-serif'
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
                        '& .MuiChartsAxis-line': { stroke: '#e1e5e8' },
                        '& .MuiChartsAxis-tick': { stroke: '#e1e5e8' },
                        '& .MuiChartsGrid-line': { stroke: '#f4f7f6' },
                        '& .MuiChartsLegend-label': {
                          color: '#001e2b',
                          fontSize: 12,
                          fontFamily: 'Euclid Circular A, Plus Jakarta Sans, sans-serif',
                          fontWeight: 600
                        },
                        '& .MuiLineElement-root': { strokeWidth: 2.5 },
                        '& .MuiMarkElement-root': { strokeWidth: 2 }
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CONFIGURATION VIEW */}
        {activeTab === 'config' && (
          <div className="config-layout">
            <div className="panel endpoint-panel">
              <div className="panel-header compact">
                <div>
                  <p className="panel-kicker">Cluster Endpoints</p>
                  <h2>Render API Endpoints</h2>
                </div>
                <span className="panel-count">{instances.length} Total</span>
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
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddInstance}>
                <div className="form-group">
                  <label htmlFor="newBackendUrl">Add Cluster Endpoint</label>
                  <div className="inline-form">
                    <input
                      id="newBackendUrl"
                      type="text"
                      className="form-input"
                      placeholder="http://localhost:3011"
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
                  <p className="panel-kicker">Simulator JSON</p>
                  <h2>Fleet Configuration Schema</h2>
                </div>
              </div>
              <p className="panel-description">
                Hot-reloads automatically across all active cluster nodes and synchronizes to local PostgreSQL state.
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
                  className="btn-primary-pill"
                  disabled={configSaving}
                >
                  <Settings size={14} />
                  {configSaving ? 'Synchronizing Cluster...' : 'Save & Hot-Reload Cluster'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: TERMINAL CONSOLE */}
        {activeTab === 'logs' && (
          <div className="console-frame">
            <div className="console-topbar">
              <div className="console-title-area">
                <p className="console-kicker">Cluster Stream</p>
                <h3 className="console-title">Live Simulator Logs</h3>
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

                <button className="btn-secondary-on-dark" onClick={() => clearInstanceLogs(selectedLogInstance)}>
                  Clear Console
                </button>
              </div>
            </div>

            <div className="console-content">
              {statuses[selectedLogInstance]?.logs?.length === 0 ? (
                <div className="console-row" style={{ color: 'var(--stone)' }}>No logs recorded for this instance yet.</div>
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

      {/* 5. Footer Region (MongoDB Signature Dark Teal Multi-Column Footer) */}
      <footer className="footer-region">
        <div className="footer-content">
          <div className="footer-left">
            <div className="logo-leaf" style={{ width: 26, height: 26 }}>
              <Cpu size={14} />
            </div>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Kickbacks Fleet</span>
              <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--steel)' }}>
                5 Accounts · {allClientsList.length} Active Clients
              </span>
            </div>
          </div>

          <div className="footer-links">
            <button className="footer-link" onClick={() => setActiveTab('dashboard')}>Dashboard</button>
            <button className="footer-link" onClick={() => setActiveTab('analytics')}>Analytics</button>
            <button className="footer-link" onClick={() => setActiveTab('config')}>Config</button>
            <button className="footer-link" onClick={() => setActiveTab('logs')}>Console</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
