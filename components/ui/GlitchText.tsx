'use client';

// =============================================
// Glitch Text Component
// Creates the glitchy neon text effect
// =============================================

interface GlitchTextProps {
  text: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  color?: 'green' | 'pink' | 'cyan' | 'orange';
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl',
  '2xl': 'text-4xl',
  '3xl': 'text-6xl',
};

const colorClasses = {
  green: 'neon-text-green',
  pink: 'neon-text-pink',
  cyan: 'neon-text-cyan',
  orange: 'neon-text-orange',
};

export default function GlitchText({
  text,
  className = '',
  size = 'xl',
  color = 'green',
}: GlitchTextProps) {
  return (
    <span
      className={`glitch font-black tracking-tight ${sizeClasses[size]} ${colorClasses[color]} ${className}`}
      data-text={text}
      style={{ fontFamily: 'Space Grotesk, sans-serif' }}
    >
      {text}
    </span>
  );
}
