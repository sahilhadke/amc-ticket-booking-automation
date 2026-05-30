import * as fs from 'fs';
import * as path from 'path';

const HISTORY_PATH = path.join(process.cwd(), 'watched-history.json');

export interface WatchedMovie {
  title: string;
  date: string;       // YYYY-MM-DD
  theater?: string;
  showtime?: string;
  format?: string;
}

interface HistoryFile {
  lastUpdated: string;
  movies: WatchedMovie[];
}

export function loadHistory(): HistoryFile {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { lastUpdated: new Date().toISOString().split('T')[0], movies: [] };
  }
  return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')) as HistoryFile;
}

export function saveHistory(data: HistoryFile): void {
  data.lastUpdated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
}

export function isAlreadyWatched(title: string): WatchedMovie | null {
  const { movies } = loadHistory();
  const lower = title.toLowerCase();
  return movies.find(m => m.title.toLowerCase().includes(lower) || lower.includes(m.title.toLowerCase())) ?? null;
}

export function addToHistory(movie: WatchedMovie): void {
  const data = loadHistory();
  // Avoid exact duplicates (same title + date)
  const exists = data.movies.some(m => m.title === movie.title && m.date === movie.date);
  if (!exists) {
    data.movies.unshift(movie); // newest first
    saveHistory(data);
  }
}

// Merge crawled entries into the on-disk history, preserving existing ones.
// Returns the count of newly added entries and the resulting total.
export function mergeWatchedMovies(newMovies: WatchedMovie[]): { added: number; total: number } {
  const data = loadHistory();
  const existingKeys = new Set(data.movies.map(m => `${m.title}|${m.date}`));
  let added = 0;
  for (const m of newMovies) {
    const key = `${m.title}|${m.date}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      data.movies.push(m);
      added++;
    }
  }
  if (added > 0) {
    data.movies.sort((a, b) => (b.date > a.date ? 1 : -1));
    saveHistory(data);
  }
  return { added, total: data.movies.length };
}
