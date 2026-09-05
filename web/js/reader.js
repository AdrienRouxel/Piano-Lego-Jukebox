/**
 * Lecteur de documentation intégré au site.
 *
 * Le guide et les autres documents du dépôt sont servis en Markdown par
 * `/api/docs`, convertis en HTML dans le navigateur, et affichés dans un
 * panneau plein écran avec un sommaire cliquable.
 *
 * L'intérêt : on peut ouvrir le mode d'emploi sans quitter la page, sans
 * connexion Internet, et sans chercher un fichier dans un dossier.
 */

import { renderMarkdown } from './markdown.js';

const el = (id) => document.getElementById(id);

export class DocReader {
  constructor() {
    this.overlay = el('reader');
    this.titleEl = el('reader-title');
    this.subtitleEl = el('reader-subtitle');
    this.tabsEl = el('reader-tabs');
    this.tocEl = el('reader-toc');
    this.bodyEl = el('reader-body');

    this.docs = null;
    this.current = null;
    /** Les documents déjà chargés ne sont pas redemandés. */
    this.cache = new Map();
    this._lastFocus = null;

    el('btn-reader-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });

    // Les liens entre documents et les ancres restent dans le panneau.
    this.bodyEl.addEventListener('click', (event) => this._onLinkClick(event));
    this.tocEl.addEventListener('click', (event) => this._onLinkClick(event));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.overlay.hidden) {
        event.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen() {
    return !this.overlay.hidden;
  }

  /**
   * @param {string} [docId] document à afficher (défaut : le guide)
   * @param {string} [anchor] titre vers lequel faire défiler
   */
  async open(docId = 'guide.md', anchor = null) {
    this._lastFocus = document.activeElement;
    this.overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    el('btn-reader-close').focus();
    await this.show(docId, anchor);
  }

  close() {
    if (!this.isOpen) return;
    this.overlay.hidden = true;
    document.body.style.overflow = '';
    this._lastFocus?.focus?.();
  }

  async show(docId, anchor = null) {
    if (!this.docs) await this._loadIndex();

    this.bodyEl.setAttribute('aria-busy', 'true');
    let doc;
    try {
      doc = await this._loadDoc(docId);
    } catch (error) {
      this.bodyEl.innerHTML = '';
      const message = document.createElement('p');
      message.className = 'reader-error';
      message.textContent = `Ce document n’a pas pu être chargé (${error.message}). Le serveur est-il toujours lancé ?`;
      this.bodyEl.append(message);
      this.bodyEl.removeAttribute('aria-busy');
      return;
    }

    this.current = docId;
    this.titleEl.textContent = doc.title;
    this.subtitleEl.textContent = doc.subtitle ?? '';
    this.bodyEl.innerHTML = doc.html;
    this.bodyEl.removeAttribute('aria-busy');
    this._renderTabs();
    this._renderToc(doc.headings);

    if (anchor) this._scrollTo(anchor);
    else this.bodyEl.scrollTop = 0;
  }

  async _loadIndex() {
    const response = await fetch('/api/docs');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    this.docs = (await response.json()).docs;
  }

  async _loadDoc(docId) {
    if (this.cache.has(docId)) return this.cache.get(docId);
    const response = await fetch(`/api/docs/${encodeURIComponent(docId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const { html, headings } = renderMarkdown(payload.markdown);
    const doc = { ...payload, html, headings };
    this.cache.set(docId, doc);
    return doc;
  }

  _renderTabs() {
    this.tabsEl.textContent = '';
    for (const doc of this.docs ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reader-tab';
      button.textContent = doc.title;
      button.setAttribute('aria-current', String(doc.id === this.current));
      button.addEventListener('click', () => this.show(doc.id));
      this.tabsEl.append(button);
    }
  }

  /** Sommaire : les titres de niveau 2 et 3, comme sur une page de manuel. */
  _renderToc(headings) {
    this.tocEl.textContent = '';
    for (const heading of headings) {
      if (heading.level < 2 || heading.level > 3) continue;
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.dataset.anchor = heading.id;
      link.className = `toc-link toc-h${heading.level}`;
      link.textContent = heading.text;
      this.tocEl.append(link);
    }
  }

  _onLinkClick(event) {
    const link = event.target.closest('a');
    if (!link) return;

    const doc = link.dataset.doc;
    const anchor = link.dataset.anchor;

    if (doc) {
      event.preventDefault();
      // « ../README.md » et « README.md » désignent le même document.
      this.show(doc.replace(/^(\.\.?\/)+/, ''), anchor ?? null);
      return;
    }
    if (anchor) {
      event.preventDefault();
      this._scrollTo(anchor);
    }
    // Les liens externes gardent leur comportement : nouvel onglet.
  }

  _scrollTo(anchor) {
    const target = this.bodyEl.querySelector(`#${CSS.escape(anchor)}`);
    if (!target) {
      this.bodyEl.scrollTop = 0;
      return;
    }
    // Affectation directe : l'animation est confiée au CSS (`scroll-behavior`),
    // qui reste correct même là où le défilement fluide n'est pas implémenté.
    this.bodyEl.scrollTop = Math.max(0, target.offsetTop - 16);
    // Repère visuel : le titre visé s'éclaire brièvement.
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }
}
