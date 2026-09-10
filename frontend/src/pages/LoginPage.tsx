import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WolfLogo } from '../components/ui/WolfLogo';
import { login } from '../api/api';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Auto-login if ?access= or ?token= is provided in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessKey = params.get('access') || params.get('token');
    if (accessKey) {
      setIsLoading(true);
      login('guest', accessKey).then((success) => {
        if (success) {
          const url = new URL(window.location.href);
          url.searchParams.delete('access');
          url.searchParams.delete('token');
          window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
          navigate('/');
        } else {
          setError('Invalid access token');
          setIsLoading(false);
        }
      });
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const success = await login(username, password);
      if (success) {
        navigate('/');
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      setError('An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError('');
    setIsLoading(true);
    try {
      const guestSecret = import.meta.env.VITE_GUEST_SECRET || 'howl-guest';
      const success = await login('guest', guestSecret);
      if (success) {
        navigate('/');
      } else {
        setError('Guest access is currently unavailable');
      }
    } catch {
      setError('An error occurred during guest login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-main)' }}>
      <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ color: 'var(--logo-color)' }}>
          <WolfLogo size={64} />
        </div>
        <h1 style={{ fontFamily: '"Permanent Marker", cursive', fontSize: '3rem', letterSpacing: '0.12rem', textTransform: 'uppercase', color: 'var(--logo-color)', marginTop: '8px' }}>HOWL</h1>
      </div>
      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-card)', padding: '32px', borderRadius: '16px', border: '1px solid var(--border-subtle)', width: '100%', maxWidth: '320px' }}>
        <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', textAlign: 'center', color: 'var(--text-main)' }}>Sign In</h2>
        
        {error && <div style={{ color: 'var(--rank-0)', fontSize: '0.9rem', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '8px' }}>{error}</div>}
        
        <input
          type="text"
          placeholder="Username (e.g. guest or admin)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-inset)', color: 'var(--text-main)', fontSize: '1rem' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-inset)', color: 'var(--text-main)', fontSize: '1rem' }}
        />
        <button type="submit" disabled={isLoading} className="btn primary" style={{ marginTop: '4px', padding: '12px' }}>
          {isLoading ? 'Signing In...' : 'Sign In'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
        </div>

        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={isLoading}
          className="btn secondary"
          style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 600 }}
        >
          Explore as Guest
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
