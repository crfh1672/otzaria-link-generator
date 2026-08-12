import { BookNode } from '../types';
import { MOCK_BOOK_CONTENTS, MOCK_LIBRARY_TREE, MOCK_BOOK_LINKS } from '../data/otzariaLibraryMock';

declare global {
  interface Window {
    Otzaria?: {
      call: (method: string, payload?: any) => Promise<{ success: boolean; data?: any; error?: any }>;
      on: (event: string, callback: (payload: any) => void) => void;
      off: (event: string, callback: (payload: any) => void) => void;
    };
  }
}

export const isOtzariaPresent = (): boolean => {
  return typeof window !== 'undefined' && typeof window.Otzaria !== 'undefined';
};

export const isOtzariaAvailable = (): boolean => {
  return isOtzariaPresent() && typeof window.Otzaria!.call === 'function';
};

export async function waitForOtzariaReady(timeoutMs = 3000): Promise<boolean> {
  if (isOtzariaAvailable()) return true;
  if (!isOtzariaPresent()) return false;

  return new Promise(resolve => {
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (isOtzariaAvailable()) {
        window.clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start >= timeoutMs) {
        window.clearInterval(interval);
        resolve(false);
      }
    }, 200);
  });
}

export async function waitForPluginBoot(timeoutMs = 5000): Promise<boolean> {
  if (typeof window === 'undefined' || !window.Otzaria?.on) return false;

  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      window.Otzaria?.off?.('plugin.boot', onBoot);
      resolve(false);
    }, timeoutMs);

    const onBoot = () => {
      window.clearTimeout(timer);
      window.Otzaria?.off?.('plugin.boot', onBoot);
      resolve(true);
    };

    window.Otzaria.on('plugin.boot', onBoot);
  });
}

function isBookMetaArray(data: any): data is Array<{ bookId: string; title: string; path?: string; type?: string }> {
  return Array.isArray(data) && data.length > 0 && data.every(item => item && typeof item.bookId === 'string' && typeof item.title === 'string');
}

function normalizeBookMeta(raw: any): { bookId: string; title: string; path: string; type: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const bookId = typeof raw.bookId === 'string' ? raw.bookId : typeof raw.id === 'string' ? raw.id : null;
  const title = typeof raw.title === 'string' ? raw.title : typeof raw.name === 'string' ? raw.name : null;
  if (!bookId || !title) return null;
  return {
    bookId,
    title,
    path: typeof raw.path === 'string' ? raw.path : '',
    type: typeof raw.type === 'string' ? raw.type : 'text'
  };
}

async function fetchLibraryBooks(query: string): Promise<Array<{ bookId: string; title: string; path: string; type: string }> | null> {
  if (!isOtzariaAvailable()) return null;
  try {
    const res = await window.Otzaria!.call('library.findBooks', { query });
    if (res && res.success && Array.isArray(res.data)) {
      const books = res.data
        .map(normalizeBookMeta)
        .filter((item): item is { bookId: string; title: string; path: string; type: string } => item !== null);
      return books.length > 0 ? books : null;
    }
  } catch (e) {
    console.warn(`Otzaria findBooks failed for query='${query}'`, e);
  }
  return null;
}

async function fetchLibraryBookList(): Promise<BookNode | null> {
  const queries = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת'];
  const bookMap: Record<string, { bookId: string; title: string; path: string; type: string }> = {};

  for (const query of queries) {
    const books = await fetchLibraryBooks(query);
    if (!books) continue;
    for (const book of books) {
      bookMap[book.bookId] = book;
    }
    if (Object.keys(bookMap).length > 200) {
      break;
    }
  }

  const allBooks = Object.values(bookMap);
  if (allBooks.length === 0) return null;
  return {
    title: 'ספריית אוצריא',
    path: '',
    categories: [],
    books: allBooks
  };
}

export async function fetchLibraryTree(): Promise<BookNode> {
  if (await waitForOtzariaReady()) {
    await waitForPluginBoot(3000);
    try {
      const res = await window.Otzaria!.call('library.getTree', { includeBooks: true });
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch (e) {
      console.warn('Otzaria getTree failed, attempting supported fallback', e);
    }

    const listTree = await fetchLibraryBookList();
    if (listTree) {
      return listTree;
    }
  }

  return MOCK_LIBRARY_TREE;
}

export async function fetchBookContent(bookId: string): Promise<string> {
  if (isOtzariaAvailable()) {
    try {
      // Otzaria content limit is 5000 per request or stream
      let fullContent = '';
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await window.Otzaria!.call('library.getBookContent', {
          bookId,
          offset,
          limit: 5000
        });
        if (res && res.success && typeof res.data === 'string') {
          if (!res.data || res.data.length === 0) {
            hasMore = false;
          } else {
            fullContent += res.data;
            offset += res.data.length;
            if (res.data.length < 5000) hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      if (fullContent.trim()) return fullContent;
    } catch (e) {
      console.warn(`Otzaria getBookContent failed for ${bookId}, fallback to mock`, e);
    }
  }

  // Fallback / local mock match
  if (MOCK_BOOK_CONTENTS[bookId]) {
    return MOCK_BOOK_CONTENTS[bookId];
  }

  // Partial match search in mock contents
  const foundKey = Object.keys(MOCK_BOOK_CONTENTS).find(k => k.includes(bookId) || bookId.includes(k));
  if (foundKey) return MOCK_BOOK_CONTENTS[foundKey];

  return `<h1>${bookId}</h1>\nלא נמצא תוכן עבור ספר זה בספרייה. אנא יבא קובץ טקסט חיצוני או בחר ספר תואם.`;
}

export async function saveToCache(key: string, value: any): Promise<void> {
  if (isOtzariaAvailable()) {
    try {
      await window.Otzaria!.call('storage.set', { key, value });
      return;
    } catch (e) {
      console.warn('Otzaria storage.set failed, using localStorage', e);
    }
  }
  localStorage.setItem(`otzaria_link_gen_${key}`, JSON.stringify(value));
}

export async function getFromCache<T = any>(key: string): Promise<T | null> {
  if (isOtzariaAvailable()) {
    try {
      const res = await window.Otzaria!.call('storage.get', { key });
      if (res && res.success) return res.data as T;
    } catch (e) {
      console.warn('Otzaria storage.get failed, using localStorage', e);
    }
  }
  const raw = localStorage.getItem(`otzaria_link_gen_${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeFromCache(key: string): Promise<void> {
  if (isOtzariaAvailable()) {
    try {
      await window.Otzaria!.call('storage.remove', { key });
      return;
    } catch (e) {
      console.warn('Otzaria storage.remove failed, using localStorage', e);
    }
  }
  localStorage.removeItem(`otzaria_link_gen_${key}`);
}

export async function listCacheKeys(): Promise<string[]> {
  if (isOtzariaAvailable()) {
    try {
      const res = await window.Otzaria!.call('storage.list');
      if (res && res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {
      console.warn('Otzaria storage.list failed, using localStorage', e);
    }
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('otzaria_link_gen_')) {
      keys.push(k.replace('otzaria_link_gen_', ''));
    }
  }
  return keys;
}

export async function notifySuccess(message: string): Promise<void> {
  if (isOtzariaAvailable()) {
    try {
      await window.Otzaria!.call('ui.showSuccess', { message });
      return;
    } catch {}
  }
}

export async function fetchBookLinks(bookId: string): Promise<any[]> {
  if (isOtzariaAvailable()) {
    try {
      const res = await window.Otzaria!.call('library.getBookLinks', { bookId });
      if (res && res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {
      console.warn(`Otzaria getBookLinks failed for ${bookId}`, e);
    }
  }

  if (MOCK_BOOK_LINKS[bookId]) {
    return MOCK_BOOK_LINKS[bookId];
  }

  const foundKey = Object.keys(MOCK_BOOK_LINKS).find(k => k === bookId || k.includes(bookId) || bookId.includes(k));
  if (foundKey) {
    return MOCK_BOOK_LINKS[foundKey];
  }

  return [];
}

export async function notifyError(message: string): Promise<void> {
  if (isOtzariaAvailable()) {
    try {
      await window.Otzaria!.call('ui.showError', { message });
      return;
    } catch {}
  }
}
