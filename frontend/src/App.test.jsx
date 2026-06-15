import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from './App.jsx';

// Mock window confirm and alert
window.confirm = vi.fn().mockReturnValue(true);
window.alert = vi.fn();

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
  if (url.includes('/api/login')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true })
    });
  }
  if (url.includes('/api/status')) {
    const isInstance2 = url.includes('r1.utksh.in');
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        running: true,
        instanceName: isInstance2 ? "instance_2" : "instance_1",
        configProfiles: [{ name: "client_primary", scale: 10 }],
        profiles: [],
        clients: [
          {
            name: isInstance2 ? "client_primary_v11" : "client_primary_v1",
            instanceName: isInstance2 ? "instance_2" : "instance_1",
            clientId: isInstance2 ? "2a1844a55570cd700d300cb0" : "1a1844a55570cd700d300cb0",
            adTitle: isInstance2 ? "Linear" : "Attio",
            adId: isInstance2 ? "9842108b-1697-5310-af8a-8a7445cc6f4a" : "8842108b-1697-5310-af8a-8a7445cc6f4a",
            ticks: 361,
            billing_count: 25,
            revenue_usd: "0.039816",
            lastStatus: "Success",
            lastTickTime: "7:31:02 PM",
            updatedAt: "2026-06-15T19:31:02.951Z"
          }
        ],
        totals: {
          earnedTodayRun: "0.039816",
          earnedLifetimeRun: "0.039816",
          currentToday: "1.23",
          currentLifetime: "4.56"
        },
        logs: []
      })
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
}));

describe('App Dashboard Interface Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('allows logging in with password and rendering dashboard', async () => {
    render(<App />);

    // Login screen should show
    expect(screen.getByRole('heading', { name: /kickbacks control/i })).toBeInTheDocument();
    
    // Simulate login form submit
    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(passwordInput, { target: { value: 'Ankitsin' } });
    
    const signInButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(signInButton);

    // Wait for async client loading to render in DOM
    await waitFor(() => {
      expect(screen.getByText(/^client_primary_v1$/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Attio/i)).toBeInTheDocument();
    expect(screen.getByText(/fleet command/i)).toBeInTheDocument();
  });

  it('allows switching tabs', async () => {
    localStorage.setItem('dashboard_password', 'Ankitsin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/^client_primary_v1$/i)).toBeInTheDocument();
    });

    // Switch to Config tab
    const configTabs = screen.getAllByRole('tab', { name: /config/i });
    fireEvent.click(configTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/control settings/i)).toBeInTheDocument();
    });

    // Switch to Logs tab
    const logsTabs = screen.getAllByRole('tab', { name: /logs/i });
    fireEvent.click(logsTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/live terminal/i)).toBeInTheDocument();
    });
  });

  it('allows adding and removing server endpoints', async () => {
    localStorage.setItem('dashboard_password', 'Ankitsin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/^client_primary_v1$/i)).toBeInTheDocument();
    });

    // Navigate to Config
    const configTabs = screen.getAllByRole('tab', { name: /config/i });
    fireEvent.click(configTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/new endpoint/i)).toBeInTheDocument();
    });

    // Add new backend endpoint
    const newEndpointInput = screen.getByPlaceholderText(/https:\/\/example.onrender.com/i);
    fireEvent.change(newEndpointInput, { target: { value: 'https://test-backend.onrender.com' } });
    
    const addBtn = screen.getByRole('button', { name: /add endpoint/i });
    fireEvent.click(addBtn);

    // Verify endpoint is listed in Config list
    expect(screen.getByText('https://test-backend.onrender.com')).toBeInTheDocument();

    // Remove the newly added endpoint
    const removeBtns = screen.getAllByRole('button', { name: /remove https:\/\/test-backend.onrender.com/i });
    fireEvent.click(removeBtns[0]);

    // Verify it is removed
    expect(screen.queryByText('https://test-backend.onrender.com')).not.toBeInTheDocument();
  });
});
