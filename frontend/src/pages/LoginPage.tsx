import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WolfLogo } from '../components/ui/WolfLogo';
import { login } from '../api/api';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

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
          placeholder="Username"
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
        <button type="submit" disabled={isLoading} className="btn primary" style={{ marginTop: '8px', padding: '12px' }}>
          {isLoading ? 'Loading...' : 'Login'}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
