// =============================================
// Time utility functions
// =============================================

export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  return date.toLocaleDateString();
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getNextSessionTime(startHourUTC: number): Date {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(startHourUTC, 0, 0, 0);

  // If this hour has passed today, schedule for tomorrow
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}
