'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Canvas from '../Canvas';
import PaintCanvas from '../PaintCanvas';
import { Shape } from '@/lib/canvas';

interface Drawing {
  id: number;
  title: string;
  // Older drawings are vector shapes; newer ones are paint commands
  shapes: Shape[] | { paint: string[] };
  created_at: string;
}

export default function Gallery() {
  const [drawings, setDrawings] = useState<Drawing[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/gallery', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.setup === 'drawings') setNotice('The gallery table doesn’t exist yet. Run the drawings SQL in Supabase.');
        else if (data.error) setNotice(`Could not load the gallery: ${data.error}`);
        setDrawings(data.drawings ?? []);
      })
      .catch(() => {
        setNotice('Could not load the gallery: server unreachable');
        setDrawings([]);
      });
  }, []);

  return (
    <main className="gallery">
      <header className="gallery-header">
        <h1>Gallery</h1>
        <Link href="/">← Back to the bots</Link>
      </header>
      {notice && <div className="notice">{notice}</div>}
      {drawings === null && <p className="empty">Loading…</p>}
      {drawings?.length === 0 && !notice && <p className="empty">No saved drawings yet.</p>}
      <div className="gallery-grid">
        {drawings?.map((d) => (
          <figure key={d.id} className="gallery-item">
            {Array.isArray(d.shapes) ? <Canvas shapes={d.shapes} /> : <PaintCanvas commands={d.shapes.paint ?? []} />}
            <figcaption>
              <strong>{d.title || `Drawing #${d.id}`}</strong>
              <span>{new Date(d.created_at).toLocaleString()}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
