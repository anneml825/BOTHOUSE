'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Menu, X, Tv, Users, Archive, Home } from 'lucide-react';

// =============================================
// BOT HOUSE - Main Header / Navigation
// =============================================

interface HeaderProps {
  isLive?: boolean;
  viewerCount?: number;
}

export default function Header({ isLive = false, viewerCount = 0 }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/', label: 'LIVE', icon: <Tv size={16} /> },
    { href: '/cast', label: 'CAST', icon: <Users size={16} /> },
    { href: '/relationships', label: 'DRAMA MAP', icon: <Home size={16} /> },
    { href: '/archive', label: 'REPLAYS', icon: <Archive size={16} /> },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#080810]/95 backdrop-blur-md border-b border-[#1e1e35]'
          : 'bg-[#080810]/80 backdrop-blur-sm'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative">
              <span
                className="glitch text-2xl font-black tracking-tight neon-text-green"
                data-text="BOT HOUSE"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                BOT HOUSE
              </span>
            </div>
            <span className="text-[#5a5a78] text-sm font-mono">S1</span>
          </Link>

          {/* Center: Live status */}
          <div className="hidden md:flex items-center gap-4">
            {isLive ? (
              <div className="flex items-center gap-2 bg-[#ff4400]/20 border border-[#ff4400]/40 rounded-full px-4 py-1.5">
                <span className="live-dot" />
                <span className="text-[#ff4400] font-mono text-sm font-bold tracking-wider">
                  LIVE
                </span>
                {viewerCount > 0 && (
                  <span className="text-[#ff4400]/70 font-mono text-xs">
                    {viewerCount.toLocaleString()} watching
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-[#1e1e35] rounded-full px-4 py-1.5">
                <span className="w-2 h-2 rounded-full bg-[#5a5a78]" />
                <span className="text-[#9090a8] font-mono text-sm tracking-wider">
                  OFFLINE
                </span>
              </div>
            )}
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[#9090a8] hover:text-[#00ff88] hover:bg-[#00ff88]/5 transition-all duration-200 font-mono text-sm font-bold tracking-wider"
              >
                {link.icon}
                {link.label}
              </Link>
            ))}
            <Link
              href="/auth/login"
              className="ml-2 btn-secondary text-xs"
            >
              SIGN IN
            </Link>
          </nav>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-lg text-[#9090a8] hover:text-[#00ff88] hover:bg-[#00ff88]/10 transition-all"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0f0f1a] border-t border-[#1e1e35]">
          <nav className="flex flex-col p-4 gap-1">
            {/* Mobile live status */}
            {isLive ? (
              <div className="flex items-center gap-2 mb-3 bg-[#ff4400]/20 border border-[#ff4400]/40 rounded-lg px-3 py-2">
                <span className="live-dot" />
                <span className="text-[#ff4400] font-mono text-sm font-bold">LIVE NOW</span>
                {viewerCount > 0 && (
                  <span className="text-[#ff4400]/60 font-mono text-xs ml-auto">
                    {viewerCount.toLocaleString()} watching
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-3 bg-[#1e1e35] rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-[#5a5a78]" />
                <span className="text-[#9090a8] font-mono text-sm">OFFLINE</span>
              </div>
            )}

            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 px-3 py-3 rounded-lg text-[#9090a8] hover:text-[#00ff88] hover:bg-[#00ff88]/5 transition-all font-mono text-sm font-bold"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.icon}
                {link.label}
              </Link>
            ))}

            <div className="mt-2 pt-2 border-t border-[#1e1e35]">
              <Link
                href="/auth/login"
                className="block text-center btn-secondary text-xs w-full"
                onClick={() => setMobileMenuOpen(false)}
              >
                SIGN IN
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
