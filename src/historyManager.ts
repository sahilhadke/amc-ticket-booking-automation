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
